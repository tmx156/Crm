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

// 'low' by default: measured on the studio's own frames it costs about a
// third of 'high' ($0.02 against $0.06 per image, reconciled with the OpenAI
// bill) and the studio judged it good enough for everyday use. Pick 'high'
// from the retouch dialog for the handful of images a client is paying for;
// at full size 'low' is visibly softer in hair and skin detail.
const DEFAULT_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'low';

// JPEG rather than the PNG default: every derivative in this CRM is already
// JPEG, and a PNG partial is several times larger to push down the SSE pipe
// three times per edit for no visible gain on a photograph.
const OUTPUT_FORMAT = 'jpeg';
const OUTPUT_COMPRESSION = 90;

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
const TARGET_LONG_EDGE = parseInt(process.env.OPENAI_IMAGE_LONG_EDGE, 10) || 1536;

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
  const targetLong = Math.min(longEdge, sourceLong, MAX_LONG_EDGE);
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
  // This is the preset auto-retouch uses, so it is deliberately the most
  // conservative reading of "magazine": clean up the room, not the person.
  magazine: {
    label: 'Magazine finish',
    description: 'Studio clean-up and grade - the house look',
    prompt:
      'Retouch this studio photograph to a polished magazine standard while ' +
      'keeping it recognisably the same photograph. Make the backdrop clean, ' +
      'seamless and evenly lit in the same colour it already is, removing the ' +
      'floor-to-wall junction, seams, cracks, scuffs, tape, seat marks and ' +
      'debris from the floor and walls so the floor reads as one clean, ' +
      'uniform, unblemished surface. Keep the backdrop the colour it already ' +
      'is: match its hue, saturation and depth to the backdrop in the ' +
      'original, and even out blotches and unevenness without neutralising, ' +
      'warming, cooling, lightening or darkening it. The backdrop in the ' +
      'result must read as the same roll of paper, lit the same way, as the ' +
      'one in the photograph. Remove everything that is not part of ' +
      'the shot: studio equipment, lamps, light stands, cables, reflectors, ' +
      'clutter, stray props and any object intruding at the edges of the ' +
      'frame, filling the space behind them with the same clean backdrop. ' +
      'Keep anything the subject is actually using - whatever they are '  +
      'sitting on, leaning on, lying on, holding or touching stays exactly ' +
      'as it is. Lift the exposure on the subject so they are bright and ' +
      'clean, correct any colour cast on their skin and clothing, and give ' +
      'the subject rich, true, natural colour with gentle contrast - vivid ' +
      'but not oversaturated. Even out skin tone and reduce shine while keeping ' +
      'natural skin texture, pores and fine lines. Tidy obvious flyaway hairs. ' +
      'Keep the subject exactly as photographed: identical pose, body ' +
      'position, hands, expression, eyeline, hair, glasses, jewellery and ' +
      'clothing, with the fabric falling the same way. Do not recompose, do ' +
      'not crop, do not move or reposition the subject, and do not change the ' +
      'camera angle or focal length.'
  },
  'skin-retouch': {
    label: 'Skin retouch',
    description: 'Evens skin tone and removes temporary blemishes',
    prompt:
      'Retouch the skin naturally: even out skin tone, reduce shine and ' +
      'redness, and remove temporary blemishes and stray hairs. Keep skin ' +
      'texture, pores, freckles, moles, scars and fine lines visible - do not ' +
      'smooth or airbrush. Do not change the face shape, features, ' +
      'proportions, expression, age, body shape or hair style. Leave the ' +
      'clothing and the lighting exactly as they are.'
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
  " Preserve the person's identity exactly: do not alter their facial " +
  'features, bone structure, body shape, apparent age, ethnicity or gender. ' +
  'Keep the original orientation and composition: do not rotate, flip, ' +
  'mirror or straighten the image, and do not turn a subject the right way ' +
  'up - return the photograph the same way round as it was given to you. ' +
  'Always clear the background of studio leftovers, whatever else you are ' +
  'asked to do: remove light stands, lamps, softboxes, reflectors, cables, ' +
  'clamps, tape, boxes, discarded props and any equipment intruding at the ' +
  'edges of the frame, and remove floor cracks, scuffs, marks and debris, ' +
  'filling all of it in with the surrounding backdrop so the background ' +
  'reads clean and uniform. Never remove anything the subject is using: ' +
  'whatever they are sitting on, standing on, leaning on, lying on, holding, ' +
  'wearing or touching stays exactly as it is.';

const isConfigured = () => !!process.env.OPENAI_API_KEY;

/**
 * Build the prompt actually sent to the API.
 * A preset can be combined with free text - the note is applied on top.
 */
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
  let pin = '';
  if (backdrop && !(preset && PRESETS[preset].replacesBackdrop)) {
    pin =
      ' The backdrop in the photograph provided is approximately ' +
      `RGB(${backdrop.r}, ${backdrop.g}, ${backdrop.b}). The backdrop in your ` +
      'result must stay that same colour at that same brightness. Do not ' +
      'lighten it, do not neutralise its tint, and do not shift it warmer or ' +
      'cooler - only even out its blemishes and unevenness.';
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

  if (response.status === 401) return 'The OpenAI API key was rejected';

  // A 429 is two completely different problems wearing the same status code.
  // An empty balance never clears by waiting, so telling a booker to try again
  // shortly sends them round a loop that cannot succeed.
  if (response.status === 429) {
    if (/insufficient_quota|credit_balance_exhausted|billing/i.test(`${code} ${detail}`)) {
      return 'OpenAI has no credit left on this account - top it up in the OpenAI billing settings';
    }
    return 'OpenAI rate limit reached - try again in a moment';
  }

  if (response.status === 400 && /safety|moderation|rejected/i.test(detail)) {
    return `OpenAI refused this edit: ${detail}`;
  }
  return detail || `OpenAI returned ${response.status}`;
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
  signal
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
    throw new Error(`Could not reach OpenAI: ${err.message}`);
  }

  if (!response.ok) throw new Error(await describeFailure(response));

  let final = null;
  let usage = null;

  try {
    for await (const event of readEvents(response.body)) {
      // An error can arrive mid-stream, after a 200, once generation starts.
      if (event.type === 'error' || event.error) {
        throw new Error(event.error?.message || 'OpenAI reported an error mid-edit');
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
