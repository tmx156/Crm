/**
 * AI photo retouching via the OpenAI image edit API.
 *
 * WHY IT STREAMS
 * --------------
 * A single retouch takes 20-60s. Handing the booker a spinner for a minute
 * and then a finished image is unusable in front of a client on the phone,
 * so this requests `stream: true` with `partial_images: 3`: OpenAI sends
 * progressively sharper drafts of the same image while it works, and the
 * route relays each one to the browser. The booker watches the edit appear.
 *
 * WHY gpt-image-2.5-sunburst
 * --------------------------
 * These are modelling headshots, so the one unacceptable failure is a face
 * that no longer looks like the client. Sunburst processes reference images
 * at high fidelity automatically (no `input_fidelity` flag needed, which is
 * why one is not sent) and is the variant tuned for edit precision - it
 * changes what was asked and leaves the rest, including faces, alone.
 * Override with OPENAI_IMAGE_MODEL if that ever changes.
 *
 * Nothing here writes to the database or to storage; routes/photo-edit.js
 * owns that. This module turns (image bytes + prompt) into (image bytes).
 */

const ENDPOINT = 'https://api.openai.com/v1/images/edits';

const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst';

/**
 * Per-model differences that actually change the request.
 *
 * These are not cosmetic. The gpt-image-1 family only preserves a face if
 * `input_fidelity: high` is sent explicitly, and sending it to a 2.x model is
 * a rejected parameter, so the flag has to follow the model. gpt-image-1.5 is
 * the odd one out: it takes neither the flag nor the extra quality tiers.
 *
 * gpt-image-1-mini is the cheap option - image output at $8/M against
 * Sunburst's $30/M, and image input at $2.50/M against $8/M, which is the
 * rate that bites on an edit because an edit always sends a photo in. The
 * trade is weaker face preservation, so Sunburst stays the default and mini
 * is opt-in via OPENAI_IMAGE_MODEL.
 */
// The inputFidelity values below were measured against the live API on
// 2026-09-28, not taken from documentation - published guidance had both
// gpt-image-1-mini and gpt-image-1.5 the wrong way round. Sending the
// parameter to a model that does not take it is a hard 400, so if a new
// model is added here, probe it rather than assuming.
const MODEL_CAPABILITIES = {
  'gpt-image-1':      { inputFidelity: true,  qualities: ['low', 'medium', 'high'] },
  'gpt-image-1.5':    { inputFidelity: true,  qualities: ['low', 'medium', 'high'] },
  // Rejects input_fidelity outright: "not supported for gpt-image-1-mini".
  'gpt-image-1-mini': { inputFidelity: false, qualities: ['low', 'medium', 'high'] }
};

// Anything else is assumed to be a 2.x model: high fidelity on reference
// images is automatic, and the two extra quality tiers exist.
const DEFAULT_CAPABILITIES = {
  inputFidelity: false,
  qualities: ['low', 'medium', 'high', 'xhigh', 'max']
};

const capabilitiesFor = (model) => MODEL_CAPABILITIES[model] || DEFAULT_CAPABILITIES;

// What the configured model will actually accept. 'auto' is always valid but
// is not offered in the UI - it makes the cost unpredictable.
const QUALITIES = [...capabilitiesFor(MODEL).qualities, 'auto'];

// 'medium' by default (Oct 2026, the studio's call): 'low' ($0.02 an image
// on the studio's own frames) was visibly soft in hair, lace and sequins
// once the retouch moved to a premium beauty finish. 'high' (~$0.06) is still
// there in the retouch dialog for the shots a client is paying for. Applies
// to auto-retouch too, unless PHOTO_AUTO_RETOUCH_QUALITY says otherwise.
const DEFAULT_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';

// JPEG rather than the PNG default: every derivative in this CRM is already
// JPEG, and a PNG partial is several times larger to push down the SSE pipe
// three times per edit for no visible gain on a photograph.
const OUTPUT_FORMAT = 'jpeg';
// 100, not 90: the tonal finish re-encodes every result, and two lossy
// passes left blocky smudges in hair and skin. The finish does the one
// real JPEG encode.
const OUTPUT_COMPRESSION = 100;

// Stripe limits (tonalFinish.stripeScore). A clean finish adds 0.00-0.07 and a
// clean retouch differs from its source by ~0.16; the striped retouches scored
// 0.65-1.5. The model limit sits higher because a retouch legitimately changes
// far more than the finish does.
const STRIPE_LIMIT_FINISH = 0.25;
const STRIPE_LIMIT_MODEL = 0.45;

// 0-3 per the API. 3 is the smoothest preview; the final image can still
// arrive before all three if the model finishes early.
const PARTIAL_IMAGES = 3;

// The API accepts png/webp/jpg only, so a HEIC original has to be edited via
// its JPEG derivative instead. Callers use this to pick which object to send.
const API_INPUT_MIME = new Set(['image/png', 'image/webp', 'image/jpeg']);

// Generous, because 'max' quality on a large portrait is genuinely slow. The
// browser can abort earlier; this only stops a wedged request holding a
// socket open forever.
const TIMEOUT_MS = parseInt(process.env.OPENAI_IMAGE_TIMEOUT_MS, 10) || 300000;

// Prompts are capped at 32000 chars by the API. This is far below that - it
// is a retouch note, and a runaway paste is more likely a bug than intent.
const MAX_PROMPT_LENGTH = 1200;

// Decides whether a set is white paper, black, or a colour - the same test the
// tonal finish uses, so the prompt and the finish always agree.
const { classifyBackdrop, finishTones, stripeScore } = require('./tonalFinish');
const sharp = require('sharp');

// API limits on a requested size: each edge a multiple of 16, aspect between
// 1:3 and 3:1, and no larger than 3840x2160.
const SIZE_STEP = 16;
const MAX_LONG_EDGE = 3840;
const MAX_SHORT_EDGE = 2160;
const MIN_EDGE = 256;

// How big a retouch comes back. Output tokens scale with pixels, so this is
// the main cost dial after quality: 1536 is about the resolution the studio
// has been accepting from ChatGPT by hand, and is ample for a web gallery
// and a ZIP. Raise it for print, and expect the per-image price to rise
// roughly in step with the pixel count.
//
// Oct 2026: raised to the API maximum. Measured on the studio's frames,
// drawing at 2144x3216 instead of 1024x1536 cost about a third more output
// tokens (453 vs 343 - a fraction of a cent) and came back visibly sharper in
// eyes, hair and skin. The retouch is then delivered at the uploaded size.
const TARGET_LONG_EDGE = parseInt(process.env.OPENAI_IMAGE_LONG_EDGE, 10) || MAX_LONG_EDGE;

/**
 * Pick an output size with the SAME aspect ratio as the source.
 *
 * This is not a nicety. Ask for a portrait output from a landscape photo and
 * the model has no choice but to crop or extend it to fit - which is how a
 * "just fix the lighting" edit comes back with the subject repositioned and
 * the framing changed. Matching the source ratio is what keeps a retouch a
 * retouch. 'auto' has the same problem, so it is only used as a fallback
 * when the source dimensions are unknown.
 *
 * @returns {string|null} "WIDTHxHEIGHT", or null to fall back to 'auto'
 */
function bestSizeFor(width, height, longEdge = TARGET_LONG_EDGE) {
  if (!width || !height || width < 1 || height < 1) return null;

  // Outside 1:3..3:1 the API will reject the size, and a panorama is not
  // what this feature is for.
  const ratio = width / height;
  if (ratio > 3 || ratio < 1 / 3) return null;

  // Below the grid's minimum edge there is no size that is both legal and
  // not an upscale, so let the API choose rather than inventing pixels.
  if (width < MIN_EDGE || height < MIN_EDGE) return null;

  const landscape = width >= height;
  const sourceLong = landscape ? width : height;

  // Never upscale past the source - inventing pixels costs more and adds
  // nothing a photographer would want.
  // ...and keep the short edge inside the API's 2160 too, or a 4:3 frame at
  // the full long edge would have no legal size at all
  const targetLong = Math.min(longEdge, sourceLong, MAX_LONG_EDGE,
    Math.floor(MAX_SHORT_EDGE * Math.max(ratio, 1 / ratio)));
  const scale = targetLong / sourceLong;

  const snap = (n) => Math.max(MIN_EDGE, Math.round(n / SIZE_STEP) * SIZE_STEP);

  // Rounding each edge to the 16px grid independently can drift the ratio by
  // a percent or so, and a drifted ratio is a small crop. Instead, try a few
  // candidate widths on the grid and keep whichever pairs with a gridded
  // height closest to the true ratio.
  const idealW = width * scale;
  let best = null;

  for (let step = -3; step <= 3; step++) {
    const w = snap(idealW) + step * SIZE_STEP;
    if (w < MIN_EDGE) continue;

    const h = snap(w / ratio);
    if (h < MIN_EDGE) continue;

    // Respect both ceilings, whichever way round the image is.
    if (Math.max(w, h) > MAX_LONG_EDGE || Math.min(w, h) > MAX_SHORT_EDGE) continue;

    // Stay inside the configured budget. Without this, preferring the
    // largest faithful candidate would quietly overshoot the long edge the
    // deployment asked for - and pay for the extra pixels.
    if (Math.max(w, h) > targetLong) continue;

    // Never order more pixels than the source actually has. Snapping up to
    // the grid would otherwise buy an upscale of a few pixels, which costs
    // real money across a shoot and adds nothing.
    if (w > width || h > height) continue;

    const error = Math.abs((w / h) - ratio) / ratio;

    // Among equally faithful candidates take the largest: the grid usually
    // offers several exact matches, and there is no reason to deliver the
    // smallest of them.
    const better = !best ||
      error < best.error - 1e-9 ||
      (Math.abs(error - best.error) < 1e-9 && w > best.w);

    if (better) best = { w, h, error };
  }

  if (!best) return null;
  return `${best.w}x${best.h}`;
}

/**
 * Canned retouches, phrased as instructions to leave everything else alone.
 *
 * Every preset says some form of "do not change the face" on purpose. Asked
 * only to "improve the skin", these models will happily also slim a jaw or
 * open a squint, and a headshot that flatters someone who does not look like
 * that is worse than an unretouched one - the client turns up to the casting
 * and does not match their card.
 */
const PRESETS = {
  // Derived from a real before/after set the studio delivered (Margaret
  // Bennett, Sep 2026). Across 45 edits the recipe was always the same:
  // the floor-to-wall junction, cracks, scuffs and tape disappear into a
  // seamless backdrop; intruding lamps and stands go; exposure comes up;
  // colour gets richer but stays true; skin evens out - and the pose,
  // expression, outfit and framing are left completely alone.
  //
  // Oct 2026: rebuilt on the brief the studio's client actually retouches
  // to - the shoot keeps its own backdrop colour, gels and mood, while the
  // person gets a full beauty retouch (under-eyes, lines, jaw and neck,
  // subtle slimming) and a soft beauty light on the face. This is the preset
  // auto-retouch uses. White and black sets are then finished to pure white
  // and true black by services/tonalFinish.js.
  magazine: {
    label: 'Magazine finish',
    description: 'Life-like premium retouch, keeping the shoot\'s own mood - the house look',
    prompt:
      'This is a professional fashion and beauty retouch of one studio ' +
      'photograph. Return one finished edit of this exact photograph: same ' +
      'model, same pose, same clothing, same composition, camera angle and ' +
      'perspective - never a different pose, a duplicate, a collage or a ' +
      'composite. ' +
      // Mood and backdrop
      'Preserve the original background colour, the overall colour ' +
      'temperature and the intended studio mood, including any coloured gels, ' +
      'spotlight pools and soft falloff on the backdrop. Correct and improve ' +
      'the lighting where needed - uneven exposure, dull or muddy light, harsh ' +
      'highlights, blocked shadows, colour casts on the subject and uneven ' +
      'light across the face, body or clothing - so it looks professionally ' +
      'lit and balanced while staying believable and consistent with the ' +
      'original direction and character of the light. Lighting corrections ' +
      'must not shift, bleach, neutralise, brighten or recolour the backdrop. ' +
      'Add a soft, flattering beauty light on the face, as if from a beauty ' +
      'dish or soft key light from the same direction as the existing light: ' +
      'a gentle glow that lifts and models the face, with natural catchlights ' +
      'in the eyes, without flattening it or changing the mood of the shot. ' +
      'Remove unwanted room and studio elements - visible walls, corners, ' +
      'skirting boards, door frames, ceiling lines, cables, sockets, light ' +
      'stands, lamps, equipment, floor edges, backdrop seams, wrinkles, ' +
      'stains, scuffs and marks. Where the backdrop does not fill the frame, ' +
      'extend it naturally so the photograph looks as if it was taken against ' +
      'a clean, seamless professional studio backdrop, matching the original ' +
      'backdrop tone, colour, texture, falloff and lighting rather than ' +
      'replacing it with a generic one. Keep realistic floor contact shadows, ' +
      'with no cut-out edges, halos or artificial masking. Keep anything the ' +
      'subject is using - whatever they are sitting on, leaning on, lying on, ' +
      'holding or touching stays exactly as it is. ' +
      // Beauty - Oct 2026: the client brief's jaw/neck/slimming wording made
      // the model reshape heads and de-age people. The studio wants the
      // TV / streaming-poster / fashion-campaign standard instead: the person
      // on their best day, flattered by light, skin and grade - never reshaped.
      'Retouch the person to the standard of a high-end TV or streaming-series ' +
      'poster or a fashion campaign, for someone who does not usually ' +
      'photograph well: they must look like themselves on their best day - ' +
      'fresh, rested, well lit and polished - completely believable and ' +
      'life-like, never like a different, younger or reshaped person. ' +
      'Give the face and all visible skin a clear, professional airbrush ' +
      'retouch, the kind a high-end retoucher does with frequency separation: ' +
      'remove every blemish, spot, mark, red patch, broken capillary and ' +
      'uneven pigmentation; even out the skin tone and blotchiness; smooth ' +
      'rough or uneven texture, enlarged pores and shine; soften forehead ' +
      'lines, fine lines and crow\'s-feet and lighten under-eye darkness and ' +
      'puffiness, so the skin is visibly smoother and cleaner than in the ' +
      'original - while still looking natural, with a fine, real skin ' +
      'texture, never plastic, waxy or blurred, and with the person\'s age ' +
      'and character still there. Do this however small the face is in the ' +
      'frame and whichever way up it is. ' +
      "Keep the person's own natural skin tone - do not tan, bronze or " +
      'orange the skin. Remove only the few stray hairs that cross the face ' +
      'or eyes; keep the natural soft, fine wisps along the outline of the ' +
      'hair so the hairline and edges look real, never cut out or helmet-' +
      'smooth. Keep the natural hair texture and hairstyle. Retouch any visible neck, ' +
      'decolletage, arms, hands and legs to match. On the neck and ' +
      'decolletage, fully smooth out the lines, folds, creases and crepey ' +
      'texture so that skin looks smooth and youthful like the face - this is ' +
      'the one place where lines are removed, not just softened - as a ' +
      'skin-surface retouch only, keeping the same shape and outline. ' +
      'Do not reshape anything: keep the exact shape, size and outline of ' +
      'the head and skull, hairline, forehead, ears, eyes, nose, mouth, lips, ' +
      'jaw, chin, neck and body, and the same proportions between them - no ' +
      'slimming, no jaw or neck sculpting, no enlarged eyes, no bigger or ' +
      'rounder head. Do not distort garments, prints, seams, buttons, ' +
      'jewellery, glasses, footwear, folds or fabric structure. ' +
      'Keep the framing exactly: the same crop and zoom, with the subject at ' +
      'exactly the same size and position in the frame - do not zoom in, do ' +
      'not crop tighter and do not make the face or head larger. ' +
      // Finish
      'Improve overall photographic quality: balance highlights, midtones ' +
      'and shadows while keeping dimension, with rich deep blacks and clean ' +
      'whites; improve skin luminosity without making it flat, plastic, ' +
      'overexposed or excessively airbrushed; enhance garment texture, ' +
      'fabric detail, jewellery and accessories while keeping them realistic; ' +
      'keep the highlight direction and natural shadow placement; and apply a ' +
      'sophisticated, high-end colour grade suited to this particular ' +
      'photograph. Keep hands, fingers, limbs, face, jaw, neck and body ' +
      'proportions realistic, and keep the image free of generation ' +
      'artifacts - no thin etched lines, scratches or streaks drawn across ' +
      'the skin or forehead, no smeared or melted textures, no garbled lace or ' +
      'patterns, no blotchy or muddy patches, no warped anatomy, extra or fused fingers, ' +
      'stretched features or altered facial identity. Keep the head angle, ' +
      'the direction the face is turned, whether the eyes are open or closed, ' +
      'the gaze and the expression exactly as photographed. The result ' +
      'should look like a premium TV or streaming-series poster or a fashion ' +
      'campaign: clean seamless backdrop, flattering professional light, ' +
      'polished but real skin, refreshed under-eyes, crisp clothing detail ' +
      'and a sophisticated grade - with the person exactly as they are, ' +
      'just at their best.'
  },
  'face-light': {
    label: 'Face light',
    description: 'Adds a soft beauty light to the face',
    prompt:
      'Add a soft, flattering beauty light on the face, as if from a beauty ' +
      'dish or large soft key light placed in the same direction as the ' +
      'existing light: gently lift and model the face, brighten the eyes with ' +
      'natural catchlights and soften shadows under the eyes and chin, while ' +
      'keeping the dimension of the face and the mood of the shot. Do not ' +
      'change anything else - same face, expression, pose, hair, clothing, ' +
      'backdrop colour and composition.'
  },
  'skin-retouch': {
    label: 'Skin retouch',
    description: 'Life-like skin retouch, no reshaping',
    prompt:
      'Give the face and all visible skin a clear, professional airbrush ' +
      'retouch, the kind a high-end retoucher does with frequency separation: ' +
      'remove every blemish, spot, mark, red patch, broken capillary and ' +
      'uneven pigmentation; even out the skin tone and blotchiness; smooth ' +
      'rough or uneven texture, enlarged pores and shine; soften forehead ' +
      'lines, fine lines and crow\'s-feet and lighten under-eye darkness and ' +
      'puffiness, so the skin is visibly smoother and cleaner than in the ' +
      'original - while still looking natural, with a fine, real skin ' +
      'texture, never plastic, waxy or blurred, and with the person\'s age ' +
      'and character still there. Do this however small the face is in the ' +
      'frame and whichever way up it is. ' +
      "Keep the person's own natural skin tone - no tan, bronze or orange. " +
      'Keep moles and scars. Do not reshape anything: keep the exact shape, ' +
      'size and outline of the head, hairline, face, features, jaw, neck and ' +
      'body, and the same framing and zoom. Do not change the expression, ' +
      'head angle, eyes, gaze, hair style, clothing, backdrop or lighting.'
  },
  'studio-lighting': {
    label: 'Fix lighting',
    description: 'Corrects exposure, shadows and colour cast',
    prompt:
      'Correct the lighting only: fix the exposure, lift harsh shadows on the ' +
      'face, neutralise any colour cast on the skin and clothing, and balance ' +
      'the white balance to look like clean studio lighting. Leave the ' +
      'backdrop its original colour - even out its lighting without ' +
      'neutralising, warming or cooling its hue. Do not change the subject, their ' +
      'face, hair, clothing or pose, and do not restyle the backdrop beyond ' +
      'clearing studio leftovers from it.'
  },
  'white-background': {
    // Its whole job is to change the backdrop, so never pin it to the source.
    replacesBackdrop: true,
    label: 'White background',
    description: 'Replaces the background with a clean studio white',
    prompt:
      'Replace the background with a clean, evenly lit plain white studio ' +
      'backdrop. Keep the subject exactly as photographed - same face, hair, ' +
      'hairline, clothing, pose and edges, with a natural cut-out and no halo ' +
      'or fringing. Match the lighting on the subject to the new backdrop ' +
      'without relighting their face.'
  },
  'grey-background': {
    // Its whole job is to change the backdrop, so never pin it to the source.
    replacesBackdrop: true,
    label: 'Grey background',
    description: 'Replaces the background with a mid-grey studio backdrop',
    prompt:
      'Replace the background with a smooth mid-grey studio backdrop with a ' +
      'subtle gradient. Keep the subject exactly as photographed - same face, ' +
      'hair, hairline, clothing, pose and edges, with a natural cut-out and ' +
      'no halo or fringing.'
  },
  'colour-grade': {
    label: 'Colour grade',
    description: 'Applies a clean, neutral commercial grade',
    prompt:
      'Apply a clean, neutral commercial colour grade to the subject: ' +
      'accurate skin tones, gentle contrast, no heavy filter or colour tint. ' +
      'Leave the backdrop its original colour and depth. Do not change the ' +
      'subject, their face, clothing or pose, and do not restyle the backdrop ' +
      'beyond clearing studio leftovers from it.'
  },
  'headshot-crop': {
    label: 'Headshot crop',
    description: 'Recomposes as a head-and-shoulders portrait',
    prompt:
      'Recompose as a professional head-and-shoulders headshot: centre the ' +
      'subject with natural headroom, framed from the top of the chest up. ' +
      'Extend the existing background if more is needed. Do not change the ' +
      'face, features, expression, hair or clothing.'
  },
  'remove-distractions': {
    label: 'Clean up',
    description: 'Removes clutter and blemishes from the background',
    prompt:
      'Remove distracting objects, clutter, marks and blemishes from the ' +
      'background, filling them in to match the surrounding backdrop. Do not ' +
      'change the subject in any way - same face, hair, clothing and pose.'
  }
};

// Appended to every request, preset or free text. The API will refuse an edit
// that would change someone's identity, but it is not required to notice that
// a quiet "make her look slimmer" is that same request in miniature.
/**
 * Appended to every prompt - preset, free text, auto-retouch alike.
 *
 * These three rules are here rather than in individual presets because they
 * are unconditional. A booker who picks "Skin retouch" still wants the light
 * stand out of the corner, and a model handed an unusual composition -
 * someone lying down, shot from above, upside down in frame - will quietly
 * "correct" it to upright unless told not to, which is a different
 * photograph.
 *
 * The clutter rule carries its own exception, and it matters: without it,
 * "remove the props" takes away the stool someone is sitting on and leaves
 * them floating. The test is whether the subject is using the object, not
 * whether it is furniture.
 */
const GUARDRAIL =
  " Keep the person exactly recognisable as themselves: the same face, " +
  'eyes, nose, mouth, bone structure, head shape and size, hairline, ' +
  'apparent age, ethnicity and gender, with life-like proportions - ' +
  'nothing that turns them into someone else. Edit only this one ' +
  'photograph and keep its pose, framing and zoom exactly. ' +
  'Keep the original orientation and composition: do not rotate, flip, ' +
  'mirror or straighten the image, and do not turn a subject the right way ' +
  'up - return the photograph the same way round as it was given to you. ' +
  'Always clear the background of studio leftovers, whatever else you are ' +
  'asked to do: remove light stands, lamps, softboxes, reflectors, cables, ' +
  'clamps, tape, boxes, discarded props and any equipment intruding at the ' +
  'edges of the frame, and remove floor cracks, scuffs, marks and debris, ' +
  'filling all of it in with the surrounding backdrop so the background ' +
  'reads clean, keeping its original lighting, gradient and falloff. ' +
  'Never remove anything the subject is using: ' +
  'whatever they are sitting on, standing on, leaning on, lying on, holding, ' +
  'wearing or touching stays exactly as it is.';

const isConfigured = () => !!process.env.OPENAI_API_KEY;

/**
 * Shared rate-limit cooldown. OpenAI's image limit is per account, so when
 * any caller is told to back off - the background queue or a booker's manual
 * retouch - every caller should hold off until then, or they simply take it
 * in turns to earn the next 429.
 */
let cooldownUntil = 0;
function noteRateLimit(waitMs) {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + waitMs);
}
function cooldownRemainingMs() {
  return Math.max(0, cooldownUntil - Date.now());
}

/**
 * Build the prompt actually sent to the API.
 * A preset can be combined with free text - the note is applied on top.
 */
/** "about RGB(a) at the top, RGB(b) halfway down and RGB(c) on the floor" */
function describeBackdrop(backdrop) {
  const p = backdrop.profile;
  const rgb = (v) => `RGB(${v[0]}, ${v[1]}, ${v[2]})`;
  if (!p) {
    return `The backdrop is approximately RGB(${backdrop.r}, ${backdrop.g}, ${backdrop.b}).`;
  }
  return `Measured from the original, the backdrop is about ${rgb(p.top)} at the top ` +
    `of the frame, ${rgb(p.middle)} halfway down and ${rgb(p.floor)} on the floor.`;
}

function buildPrompt({ preset, prompt, backdrop }) {
  const parts = [];
  if (preset) {
    if (!PRESETS[preset]) throw new Error(`Unknown preset: ${preset}`);
    parts.push(PRESETS[preset].prompt);
  }
  const note = (prompt || '').trim();
  if (note) {
    if (note.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Instructions are too long (max ${MAX_PROMPT_LENGTH} characters)`);
    }
    parts.push(note);
  }
  if (!parts.length) throw new Error('A preset or some instructions are required');

  // A measured value the model can actually hold onto. Prose like "keep the
  // backdrop the colour it already is" does not survive an exposure lift -
  // the model reads the backdrop's own tint as a cast, neutralises it, and
  // brightens it along with everything else. Naming the RGB is concrete in a
  // way that an adjective is not. Skipped for the presets whose entire job
  // is to replace the backdrop.
  //
  // White and black sets are the exception: there the studio wants the
  // backdrop pushed to pure white or true black, not held where the camera
  // left it (services/tonalFinish.js then guarantees the numbers).
  let pin = '';
  if (backdrop && !(preset && PRESETS[preset].replacesBackdrop)) {
    const set = classifyBackdrop(backdrop);
    if (set === 'white') {
      pin =
        ' This is a white studio set. Make the whole backdrop and floor one ' +
        'seamless, evenly lit, pure white (RGB 255, 255, 255) infinity sweep: ' +
        'no grey, no visible floor-to-wall line, no fade or darker band on ' +
        'the floor and no vignette. Keep only a soft, natural contact shadow ' +
        'directly beneath the subject and whatever they are touching.';
    } else if (set === 'black') {
      pin =
        ' This is a black studio set. Make the backdrop and floor a deep, ' +
        'even, true black, close to RGB(0, 0, 0), with no grey haze, no ' +
        'lifted or milky blacks and no visible floor line, while keeping ' +
        "subtle edge detail so the subject's hair and black clothing still " +
        'separate from it.';
    } else {
      pin =
        ' Keep the backdrop lit exactly as it is in the original - this is ' +
        'part of the mood of the shoot. ' + describeBackdrop(backdrop) +
        ' Keep that gradient and falloff, any coloured gel, spotlight pool or ' +
        'vignette, the floor\'s own paler or darker tone, and the natural ' +
        'shadows the subject casts on the floor and wall. Do not flatten the ' +
        'backdrop into one even colour, do not colour the floor to match the ' +
        'wall, and do not lighten, darken, saturate, neutralise or shift the ' +
        'backdrop warmer or cooler - only remove marks, seams and clutter from it.';
    }
  }

  return parts.join(' ') + GUARDRAIL + pin;
}

/**
 * Pull `data:` payloads out of an SSE byte stream.
 *
 * Written by hand rather than with a library because the frames here are
 * large - a base64 partial image is several hundred KB on one line - and the
 * only structure that matters is "data: lines, blank line ends the event".
 * `[DONE]` is tolerated in case the endpoint ever starts sending it.
 */
async function* readEvents(body) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });

    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      const data = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('');

      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {
        // A frame we cannot parse is not worth failing an otherwise good
        // edit over - the completed event is what matters.
        console.warn('[photo-edit] Skipped unparseable stream frame');
      }
    }
  }
}

/** Turn an error body from OpenAI into something worth showing a booker. */
/**
 * An error from the edit API that knows whether waiting would help.
 *
 * `retryable` separates "come back shortly" (rate limit, a blip on OpenAI's
 * side, a dropped connection) from "this will never work" (no credit, bad
 * key, refused prompt). `retryAfterMs` is OpenAI's own estimate when it gives
 * one, so a caller can wait exactly as long as asked instead of guessing.
 */
class ImageEditError extends Error {
  constructor(message, { status = null, retryable = false, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'ImageEditError';
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * How long OpenAI asked us to wait, from the headers or failing that the
 * message text ("...Please try again in 12.5s." / "in 1m30s" / "in 850ms").
 */
function parseRetryAfter(response, detail) {
  const ms = parseFloat(response?.headers?.get?.('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return ms;

  const secs = parseFloat(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(secs) && secs > 0) return secs * 1000;

  // (?!s) keeps the "m" of "850ms" from being read as 850 minutes.
  const m = /try again in\s+(?:(\d+)m(?!s))?\s*(?:([\d.]+)(ms|s))?/i.exec(detail || '');
  if (m && (m[1] || m[2])) {
    const minutes = m[1] ? parseInt(m[1], 10) * 60000 : 0;
    const rest = m[2] ? parseFloat(m[2]) * (m[3] === 'ms' ? 1 : 1000) : 0;
    if (minutes + rest > 0) return minutes + rest;
  }
  return null;
}

async function describeFailure(response) {
  let detail = '';
  let code = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || '';
    code = body?.error?.code || body?.error?.type || '';
  } catch {
    detail = (await response.text().catch(() => '')).slice(0, 300);
  }

  const status = response.status;

  if (status === 401) return new ImageEditError('The OpenAI API key was rejected', { status });

  // A 429 is two completely different problems wearing the same status code.
  // An empty balance never clears by waiting, so it must not be retried - a
  // queue that retried it would just spin until it gave up.
  if (status === 429) {
    if (/insufficient_quota|credit_balance_exhausted|billing/i.test(`${code} ${detail}`)) {
      return new ImageEditError(
        'OpenAI has no credit left on this account - top it up in the OpenAI billing settings',
        { status }
      );
    }
    return new ImageEditError('OpenAI rate limit reached - try again in a moment', {
      status,
      retryable: true,
      retryAfterMs: parseRetryAfter(response, detail)
    });
  }

  if (status === 400 && /safety|moderation|rejected/i.test(detail)) {
    return new ImageEditError(`OpenAI refused this edit: ${detail}`, { status });
  }

  // OpenAI's own hiccups. Worth another go; they rarely last.
  if (status >= 500) {
    return new ImageEditError(detail || `OpenAI returned ${status}`, {
      status,
      retryable: true,
      retryAfterMs: parseRetryAfter(response, detail)
    });
  }

  return new ImageEditError(detail || `OpenAI returned ${status}`, { status });
}

/**
 * Edit one image.
 *
 * @param {Buffer}      buffer      source image bytes (png/webp/jpeg)
 * @param {string}      filename    used only for the multipart part name
 * @param {string}      mimeType    must be in API_INPUT_MIME
 * @param {string}      [preset]    key from PRESETS
 * @param {string}      [prompt]    free-text instructions
 * @param {string}      [quality]
 * @param {string}      [size]      'auto' or WIDTHxHEIGHT
 * @param {Function}    [onPartial] called as ({ index, buffer }) per draft
 * @param {AbortSignal} [signal]    aborts the upstream request
 *
 * @returns {Promise<{buffer: Buffer, mimeType: string, prompt: string,
 *                    model: string, quality: string, usage: object|null}>}
 */
async function editImage({
  buffer,
  filename = 'photo.jpg',
  mimeType = 'image/jpeg',
  preset,
  prompt,
  backdrop,
  quality = DEFAULT_QUALITY,
  size = 'auto',
  onPartial,
  signal,
  outputWidth,
  outputHeight
}) {
  if (!isConfigured()) {
    throw new Error('AI photo editing is not configured (OPENAI_API_KEY is missing)');
  }
  if (!API_INPUT_MIME.has(mimeType)) {
    throw new Error(`${mimeType} cannot be sent to the image API`);
  }
  if (!QUALITIES.includes(quality)) {
    throw new Error(`${MODEL} does not support quality "${quality}" (try: ${QUALITIES.join(', ')})`);
  }

  const fullPrompt = buildPrompt({ preset, prompt, backdrop });
  const capabilities = capabilitiesFor(MODEL);

  const form = new FormData();
  form.append('model', MODEL);
  form.append('image', new Blob([buffer], { type: mimeType }), filename);
  form.append('prompt', fullPrompt);
  form.append('size', size);
  form.append('quality', quality);

  // Only the gpt-image-1 family takes this, and without it a cheaper model
  // will quietly return a face that is not the client's. The 2.x models do
  // it automatically and reject the parameter.
  if (capabilities.inputFidelity) form.append('input_fidelity', 'high');
  form.append('output_format', OUTPUT_FORMAT);
  form.append('output_compression', String(OUTPUT_COMPRESSION));
  form.append('n', '1');
  form.append('stream', 'true');
  form.append('partial_images', String(onPartial ? PARTIAL_IMAGES : 0));

  // The caller's abort and our own timeout both need to kill the request.
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const cancelled = () => Object.assign(new Error('Edit cancelled'), { cancelled: true });
  const timedOut = () =>
    new Error(`The edit took longer than ${Math.round(TIMEOUT_MS / 1000)}s and was stopped`);

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: composed
    });
  } catch (err) {
    if (signal?.aborted) throw cancelled();
    if (timeout.aborted) throw timedOut();
    // A dropped connection or DNS blip - worth another try.
    throw new ImageEditError(`Could not reach OpenAI: ${err.message}`, { retryable: true });
  }

  if (!response.ok) throw await describeFailure(response);

  let final = null;
  let usage = null;

  try {
    for await (const event of readEvents(response.body)) {
      // An error can arrive mid-stream, after a 200, once generation starts.
      if (event.type === 'error' || event.error) {
        const msg = event.error?.message || 'OpenAI reported an error mid-edit';
        // Limits can also be hit after the stream has opened.
        const limited = /rate limit|overloaded|try again/i.test(msg);
        throw new ImageEditError(msg, {
          retryable: limited,
          retryAfterMs: limited ? parseRetryAfter(null, msg) : null
        });
      }

      if (event.type === 'image_edit.partial_image' && event.b64_json) {
        if (onPartial) {
          await onPartial({
            index: event.partial_image_index ?? 0,
            buffer: Buffer.from(event.b64_json, 'base64')
          });
        }
        continue;
      }

      if (event.type === 'image_edit.completed' && event.b64_json) {
        final = Buffer.from(event.b64_json, 'base64');
        usage = event.usage || null;
      }
    }
  } catch (err) {
    if (signal?.aborted) throw cancelled();
    if (timeout.aborted) throw timedOut();
    throw err;
  }

  if (!final) throw new Error('OpenAI finished without returning an image');

  // Lines across the frame are never acceptable in a client's photo. If the
  // model's own output has them, treat it like a failed attempt so the queue
  // retries it, instead of saving it. (See stripeScore for the numbers.)
  const modelStripes = await stripeScore(buffer, final).catch(() => 0);
  if (modelStripes > STRIPE_LIMIT_MODEL) {
    throw new ImageEditError(
      `The retouch came back with lines across it (stripe score ${modelStripes.toFixed(2)}) - retrying`,
      { retryable: true });
  }
  const modelOutput = final;

  // Pure whites, true blacks and a seamless floor are measured in, not left
  // to the model (services/tonalFinish.js). Never at the cost of the edit:
  // if the finish fails for any reason, the paid-for result is kept as is.
  const finishBackdrop = preset === 'white-background'
    ? { r: 255, g: 255, b: 255 }
    : (preset && PRESETS[preset]?.replacesBackdrop ? null : backdrop);
  try {
    final = (await finishTones(final, {
      sourceBackdrop: finishBackdrop,
      format: OUTPUT_FORMAT,
      targetSize: outputWidth && outputHeight ? { width: outputWidth, height: outputHeight } : null
    })).buffer;
  } catch (err) {
    console.warn('[image-edit] Tonal finish skipped:', err.message);
  }

  // Our own finish must never add lines either. If it did, discard it and
  // keep the model's result, sized as the finish would have sized it.
  if (final !== modelOutput) {
    const finishStripes = await stripeScore(modelOutput, final).catch(() => 0);
    if (finishStripes > STRIPE_LIMIT_FINISH) {
      console.error(`[image-edit] Tonal finish added lines (stripe score ${finishStripes.toFixed(2)}) - ` +
        'saving the unfinished retouch instead');
      let fallback = sharp(modelOutput).rotate();
      if (outputWidth && outputHeight) {
        fallback = fallback.resize(outputWidth, outputHeight, { fit: 'fill', kernel: 'lanczos3' });
      }
      final = await fallback.toFormat(OUTPUT_FORMAT, { quality: 94 }).toBuffer();
    }
  }

  return {
    buffer: final,
    mimeType: `image/${OUTPUT_FORMAT}`,
    prompt: fullPrompt,
    model: MODEL,
    quality,
    usage
  };
}

module.exports = {
  ImageEditError,
  noteRateLimit,
  cooldownRemainingMs,
  parseRetryAfter,
  MODEL,
  QUALITIES,
  DEFAULT_QUALITY,
  capabilitiesFor,
  bestSizeFor,
  TARGET_LONG_EDGE,
  PRESETS,
  API_INPUT_MIME,
  MAX_PROMPT_LENGTH,
  OUTPUT_FORMAT,
  isConfigured,
  buildPrompt,
  editImage
};
