/**
 * Teeth touch-up, run on every finished retouch.
 *
 * Nov 2026: the main retouch whitens teeth when the face fills the frame,
 * but in half- and full-length shots the mouth is a few dozen pixels wide
 * and the model leaves stained teeth as yellow as they went in (Irene
 * Clark, DSC_0031). So after the retouch:
 *
 *   1. a vision model says whether teeth are visible and roughly where the
 *      mouth is (its coordinates are only approximate);
 *   2. a generous square around that point is sent to the image model with
 *      a teeth-only brief;
 *   3. only the pixels that actually got whiter and less yellow are taken
 *      back, feathered - so an imprecise box or small drift elsewhere in
 *      the crop never reaches the photo.
 *
 * The brief aims at a natural off-white and leaves teeth that are already
 * clean alone, so running it after a close-up the main retouch already
 * whitened does not bleach them. Any failure returns null and the retouch
 * is kept as it was.
 */
const sharp = require('sharp');
const imageEdit = require('./imageEdit');

const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini';
const ENABLED = process.env.TEETH_PASS !== 'false';

const TEETH_ONLY =
  'Whiten the teeth only. Remove all yellow, brown and beige staining so ' +
  'every visible tooth is clearly whiter than now - an even, clean, ' +
  'natural off-white with a hint of warm ivory, like healthy, freshly ' +
  'cleaned teeth. Not perfect bright white, glowing, chalky or ' +
  'blue-white. Keep the shape, size and position of every tooth. Change ' +
  'nothing else at all: same face, lips, skin, hair, lighting, colours ' +
  'and framing.';

async function locateFace(buffer, signal) {
  const small = await sharp(buffer).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Reply JSON: {"teeth_visible": bool, "face": {"x0": number, ' +
              '"y0": number, "x1": number, "y1": number}} - the bounding box ' +
              'of the person\'s face (forehead to chin) as fractions (0-1) of ' +
              'the image width and height. teeth_visible is true only if ' +
              'teeth can be seen.'
          },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}` } }
        ]
      }]
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `vision ${res.status}`);
  const out = JSON.parse(json.choices[0].message.content);
  const f = out.face || {};
  if (!out.teeth_visible || ![f.x0, f.y0, f.x1, f.y1].every(Number.isFinite)) return null;
  if (f.x1 <= f.x0 || f.y1 <= f.y0) return null;
  return f;
}

/**
 * @param {Buffer} buffer  the finished retouch
 * @returns {Promise<Buffer|null>} the photo with teeth touched up, or null
 *   when there are no visible teeth, nothing changed, or anything failed
 */
async function apply(buffer, { signal } = {}) {
  if (!ENABLED || !imageEdit.isConfigured()) return null;
  try {
    const base = await sharp(buffer).removeAlpha().toBuffer();
    const { width: W, height: H } = await sharp(base).metadata();
    const square = (cx, cy, s) => {
      const side = Math.round(Math.min(Math.min(W, H), s));
      return {
        left: Math.round(Math.min(Math.max(cx - side / 2, 0), W - side)),
        top: Math.round(Math.min(Math.max(cy - side / 2, 0), H - side)),
        width: side, height: side
      };
    };

    // A face box is placed far more reliably than a mouth point, and a
    // face-sized crop makes the mouth big enough for the model to act on -
    // in a crop of the whole upper body it left full-length shots alone.
    const face = await locateFace(base, signal);
    if (!face) return null;
    const fw = (face.x1 - face.x0) * W, fh = (face.y1 - face.y0) * H;
    const box = square((face.x0 + face.x1) / 2 * W, (face.y0 + face.y1) / 2 * H,
      Math.max(fw, fh) * 1.15);
    const { left, top, width: side } = box;
    if (side < 64) return null;

    const crop = await sharp(base).extract(box).png().toBuffer();
    const result = await imageEdit.editImage({
      buffer: crop, filename: 'mouth.png', mimeType: 'image/png',
      prompt: TEETH_ONLY, quality: 'high', size: '1024x1024', signal
    });
    if (process.env.DEBUG_TEETH) {
      require('fs').writeFileSync(process.env.DEBUG_TEETH + '_crop.png', crop);
      require('fs').writeFileSync(process.env.DEBUG_TEETH + '_ai.jpg', result.buffer);
    }
    const ai = await sharp(result.buffer).removeAlpha().resize(side, side, { fit: 'fill' }).raw().toBuffer();
    const orig = await sharp(crop).removeAlpha().raw().toBuffer();

    // Find the teeth as the pixels that turned clearly whiter and less
    // yellow, in the lower-middle of the face where a mouth can be. Their
    // bounding box, padded, is the mouth: the model's whole mouth is blended
    // in there, feathered, and the rest of the crop is left untouched.
    const n = side * side;
    const xs = [], ys = [];
    for (let y = Math.round(side * 0.35); y < Math.round(side * 0.98); y++) {
      for (let x = Math.round(side * 0.15); x < Math.round(side * 0.85); x++) {
        const o = (y * side + x) * 3;
        const yo = (orig[o] + orig[o + 1]) / 2 - orig[o + 2];
        const ya = (ai[o] + ai[o + 1]) / 2 - ai[o + 2];
        const la = (ai[o] + ai[o + 1] + ai[o + 2]) / 3;
        if (yo - ya > 10 && la > 110) { xs.push(x); ys.push(y); }
      }
    }
    if (xs.length < 20) { if (process.env.DEBUG_TEETH) console.log('[teeth] hits', xs.length); return null; } // nothing whitened
    // Percentiles, not min/max: a few stray pixels elsewhere would otherwise
    // stretch the box over half the face.
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const pct = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
    const x0 = pct(xs, 0.02), x1 = pct(xs, 0.98), y0 = pct(ys, 0.02), y1 = pct(ys, 0.98);
    const bw = x1 - x0, bh = y1 - y0;
    // Not mouth-shaped - a whole-crop colour shift rather than teeth.
    if (process.env.DEBUG_TEETH) console.log('[teeth] hits', xs.length, 'box', x0, y0, x1, y1, 'side', side);
    if (bw <= 0 || bw > side * 0.6 || bh > side * 0.35) return null;

    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rx = bw * 0.65 + 4, ry = bh * 0.8 + 4;
    const out = Buffer.alloc(orig.length);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        const a = d <= 0.75 ? 1 : d >= 1 ? 0 : (1 - d) / 0.25;
        const o = (y * side + x) * 3;
        for (let k = 0; k < 3; k++) out[o + k] = Math.round(orig[o + k] + (ai[o + k] - orig[o + k]) * a);
      }
    }
    const patch = await sharp(out, { raw: { width: side, height: side, channels: 3 } }).png().toBuffer();
    return await sharp(base).composite([{ input: patch, left, top }])
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[teeth] Touch-up skipped:', err.message);
    return null;
  }
}

module.exports = { apply, locateFace, TEETH_ONLY };
