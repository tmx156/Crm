/**
 * Measured tonal finish, applied to every AI retouch before it is saved.
 *
 * WHY THIS EXISTS
 * ---------------
 * The image model is good at retouching and bad at hitting exact tones. On a
 * real shoot (Sep 2026, 68 retouches) white backdrops came back at 233-240
 * instead of white, floors a shade or two darker than the wall so the sweep
 * visibly "fades", and black backdrops anywhere from 1 to 17. Asking harder
 * in the prompt moves the average, not the spread. So the prompt asks for the
 * look, and this pass guarantees the numbers:
 *
 *   white set  - backdrop and floor to pure white (255) as one seamless sweep,
 *                keeping small contact shadows under feet and furniture
 *   black set  - backdrop to true black, with blacks in clothing deepened too
 *   anything else (grey, blue, beige, spotlight) - a gentle levels stretch
 *                so the image has a real black and a clean top end, without
 *                moving the backdrop colour the prompt pinned
 *
 * Which of the three a photo gets is decided from the SOURCE backdrop (what
 * the studio actually shot on), not from the model's output, so a model that
 * drifted a white set to grey still gets finished as a white set.
 *
 * Only tones are touched - never geometry, never the face. Every step is a
 * per-pixel curve or a smooth gain, so nothing can be added or moved.
 */

const sharp = require('sharp');

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const chroma = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);

/**
 * 'white' | 'black' | 'colour' for a measured backdrop {r,g,b}.
 * Near-neutral and bright is a white paper; very dark is black velvet/paper.
 */
function classifyBackdrop(backdrop) {
  if (!backdrop) return 'colour';
  const { r, g, b } = backdrop;
  const L = lum(r, g, b);
  if (L >= 200 && chroma(r, g, b) <= 22) return 'white';
  // The black sets here measure 11-17; a dim grey room (23-37) is not one
  if (L <= 22) return 'black';
  return 'colour';
}

/** Median of the six border patches, same spots as photoStorage.backdropColour. */
function measureBackdrop(data, w, h) {
  const pw = Math.max(4, Math.floor(w * 0.08));
  const ph = Math.max(4, Math.floor(h * 0.06));
  const spots = [
    [0, 0], [Math.floor(w / 2 - pw / 2), 0], [w - pw, 0],
    [0, Math.floor(h * 0.25)], [w - pw, Math.floor(h * 0.25)], [w - pw, Math.floor(h * 0.45)]
  ];
  const means = spots.map(([x0, y0]) => {
    const s = [0, 0, 0]; let n = 0;
    for (let y = y0; y < y0 + ph; y++) for (let x = x0; x < x0 + pw; x++) {
      const k = (y * w + x) * 3; s[0] += data[k]; s[1] += data[k + 1]; s[2] += data[k + 2]; n++;
    }
    return s.map(v => v / n);
  });
  const med = (c) => means.map(m => m[c]).sort((a, b) => a - b)[3];
  return { r: med(0), g: med(1), b: med(2) };
}

/** Luminance percentile over the whole image (sampled). */
function lumPercentile(data, p) {
  const hist = new Uint32Array(256); let n = 0;
  for (let k = 0; k < data.length; k += 3 * 4) { hist[Math.round(lum(data[k], data[k + 1], data[k + 2]))]++; n++; }
  const target = n * p; let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
  return 255;
}

/**
 * Per-channel highlight curve: identity up to a knee, then a straight run
 * that lands `whitePoint` on 255. Mid-tones and skin below the knee are left
 * alone; only the top end is pulled up, so a grey-ish white set becomes
 * white without the whole photo going flat and bright.
 */
function highlightLut(whitePoint) {
  const wp = clamp(whitePoint, 180, 255);
  const knee = wp * 0.62;
  const lut = new Uint8ClampedArray(256);
  for (let x = 0; x < 256; x++) {
    lut[x] = x <= knee ? x : Math.round(knee + (x - knee) * (255 - knee) / (wp - knee));
  }
  return lut;
}

/**
 * Shadow curve: `blackPoint` lands on 0 and the rest is re-spread above it,
 * with a short toe so shadow detail rolls into black rather than clipping
 * in a hard band.
 */
function shadowLut(blackPoint) {
  const bp = clamp(blackPoint, 0, 40);
  const lut = new Uint8ClampedArray(256);
  for (let x = 0; x < 256; x++) {
    let y = (x - bp) * 255 / (255 - bp);
    const toe = bp * 1.5;
    if (x > bp * 0.5 && x < toe && bp > 0) {
      // Smooth join between the clipped region and the linear run
      const t = (x - bp * 0.5) / (toe - bp * 0.5);
      const lin = (toe - bp) * 255 / (255 - bp);
      y = lin * t * t;
    }
    lut[x] = Math.round(clamp(y, 0, 255));
  }
  return lut;
}

/**
 * The white sweep. The floor on a white set is lit less than the wall, so
 * even after the highlight curve it sits grey and the join shows as a fade.
 *
 * Find the backdrop region - bright, near-neutral, smoothly varying and
 * connected to the top/sides of the frame - then divide out its LARGE-scale
 * shading (the wall-to-floor falloff) so it all lands on white. Small-scale
 * darkening inside that region - the contact shadow under a foot or a box -
 * is finer than the blur, survives the division, and stays in the picture.
 *
 * Worked out at low resolution and applied as a smooth gain map, so it
 * cannot introduce edges of its own.
 */
async function whiteSweepGain(rgb, w, h) {
  const LW = 320;
  const lh = Math.max(8, Math.round(h * LW / w));
  const small = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .resize(LW, lh, { fit: 'fill' }).raw().toBuffer();

  const N = LW * lh;
  const L = new Float32Array(N), C = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = i * 3;
    L[i] = lum(small[k], small[k + 1], small[k + 2]);
    C[i] = chroma(small[k], small[k + 1], small[k + 2]);
  }

  // Region grow from bright, neutral pixels along the top and both sides.
  const inMask = new Uint8Array(N);
  const queue = [];
  const seedOk = (i) => L[i] >= 225 && C[i] <= 16;
  for (let x = 0; x < LW; x++) for (let y = 0; y < Math.round(lh * 0.1); y++) {
    const i = y * LW + x; if (seedOk(i) && !inMask[i]) { inMask[i] = 1; queue.push(i); }
  }
  for (let y = 0; y < lh; y++) for (const x of [0, 1, LW - 2, LW - 1]) {
    const i = y * LW + x; if (seedOk(i) && !inMask[i]) { inMask[i] = 1; queue.push(i); }
  }
  while (queue.length) {
    const i = queue.pop();
    const x = i % LW, y = (i / LW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= LW || ny >= lh) continue;
      const j = ny * LW + nx;
      if (inMask[j]) continue;
      // Neutral, not dark, and no hard edge between the two pixels - that is
      // what stops the fill at a white shirt's outline or the edge of a box.
      if (L[j] >= 150 && C[j] <= 18 && Math.abs(L[j] - L[i]) <= 5) { inMask[j] = 1; queue.push(j); }
    }
  }

  let count = 0; for (let i = 0; i < N; i++) count += inMask[i];
  if (count < N * 0.08) return null; // no real backdrop found - leave it

  // Large-scale shading of the backdrop only (normalised convolution, so the
  // subject's tones do not bleed into the estimate).
  const sigma = Math.max(6, LW * 0.07);
  // Per channel, so a tinted paper (lilac, cream) is neutralised to white -
  // on the backdrop only. Doing it with a global per-channel curve also
  // pushed the person's skin orange on a lilac set.
  const weight = Buffer.alloc(N);
  const masked = [0, 1, 2].map(() => Buffer.alloc(N));
  for (let i = 0; i < N; i++) {
    weight[i] = inMask[i] ? 255 : 0;
    for (let c = 0; c < 3; c++) masked[c][i] = inMask[i] ? small[i * 3 + c] : 0;
  }
  const blur = (buf) => sharp(buf, { raw: { width: LW, height: lh, channels: 1 } }).blur(sigma).raw().toBuffer();
  const [bR, bG, bB, bW] = await Promise.all([...masked.map(blur), blur(weight)]);
  const bC = [bR, bG, bB];

  // Feathered mask for blending the gain in and out
  const feather = await sharp(Buffer.from(inMask.map(v => v * 255)), { raw: { width: LW, height: lh, channels: 1 } })
    .blur(1.5).raw().toBuffer();

  const gain = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    const m = feather[i] / 255;
    for (let c = 0; c < 3; c++) {
      const shading = bW[i] > 8 ? (bC[c][i] * 255) / bW[i] : 255;
      // Aim a touch past white so the paper clips clean - any faint banding
      // the model left in it disappears, as it did with the old global curve
      const g = clamp(260 / Math.max(shading, 1), 1, 1.45);
      // Stored as (gain - 1) * 400 in a byte for the resize
      gain[i * 3 + c] = Math.round(clamp((g - 1) * m * 400, 0, 255));
    }
  }

  // Three channels, interleaved like the image itself
  return sharp(gain, { raw: { width: LW, height: lh, channels: 3 } })
    .resize(w, h, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer();
}

/**
 * Real-camera skin. AI-rendered skin is too clean - an even, waxy surface
 * that reads as AI the moment anyone zooms in. A fine luminance grain, like
 * a DSLR file at ISO 200-400, breaks that up so the skin reads as
 * photographed. It sits in the midtones (skin, fabric) and fades to nothing
 * in clipped whites and deep blacks, so white and black sets stay clean.
 * Strength matches what the studio signed off on the Keiran Sherwin set.
 * In place on a raw RGB buffer.
 */
const GRAIN = parseFloat(process.env.PHOTO_GRAIN_STRENGTH || '0.45');

/**
 * The backdrop, as a soft 0-255 mask: grown from the top and sides of the
 * frame through smoothly varying pixels, stopping at any edge (the subject's
 * outline, a box). Grain belongs on the person - on a smooth grey or coloured
 * paper it just reads as noise.
 */
async function backdropMask(rgb, w, h) {
  const LW = 320;
  const lh = Math.max(8, Math.round(h * LW / w));
  const small = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .resize(LW, lh, { fit: 'fill' }).blur(0.8).raw().toBuffer();
  const N = LW * lh;
  const mask = new Uint8Array(N);
  const queue = [];
  const seed = (i) => { if (!mask[i]) { mask[i] = 1; queue.push(i); } };
  for (let x = 0; x < LW; x++) for (let y = 0; y < Math.max(2, Math.round(lh * 0.05)); y++) seed(y * LW + x);
  for (let y = 0; y < lh; y++) { seed(y * LW); seed(y * LW + LW - 1); }
  const diff = (i, j) => Math.max(
    Math.abs(small[i * 3] - small[j * 3]),
    Math.abs(small[i * 3 + 1] - small[j * 3 + 1]),
    Math.abs(small[i * 3 + 2] - small[j * 3 + 2]));
  while (queue.length) {
    const i = queue.pop();
    const x = i % LW, y = (i / LW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= LW || ny >= lh) continue;
      const j = ny * LW + nx;
      if (!mask[j] && diff(i, j) <= 4) { mask[j] = 1; queue.push(j); }
    }
  }
  return sharp(Buffer.from(mask.map(v => v * 255)), { raw: { width: LW, height: lh, channels: 1 } })
    .blur(1.2).resize(w, h, { fit: 'fill' }).raw().toBuffer();
}

async function cameraTexture(rgb, w, h) {
  if (!(GRAIN > 0)) return;
  const backdrop = await backdropMask(rgb, w, h);
  const noise = Buffer.alloc(w * h);
  for (let i = 0; i < noise.length; i++) {
    let u = 0; while (!u) u = Math.random();
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    noise[i] = clamp(Math.round(128 + g * 40), 0, 255);
  }
  // A touch of blur so it reads as sensor grain, not digital speckle
  const grain = await sharp(noise, { raw: { width: w, height: h, channels: 1 } }).blur(0.55).raw().toBuffer();
  const amp = 7.5 * GRAIN;
  for (let i = 0, k = 0; i < grain.length; i++, k += 3) {
    const L = lum(rgb[k], rgb[k + 1], rgb[k + 2]) / 255;
    const weight = Math.max(0, 1 - Math.pow(Math.abs(L - 0.5) * 2, 3)) * (1 - backdrop[i] / 255);
    if (weight <= 0) continue;
    const n = ((grain[i] - 128) / 40) * amp * weight;
    rgb[k] = clamp(Math.round(rgb[k] + n), 0, 255);
    rgb[k + 1] = clamp(Math.round(rgb[k + 1] + n), 0, 255);
    rgb[k + 2] = clamp(Math.round(rgb[k + 2] + n), 0, 255);
  }
}

/**
 * @param {Buffer} buffer        the retouched image (any sharp-readable format)
 * @param {object} [opts]
 * @param {{r,g,b}} [opts.sourceBackdrop]  measured on the ORIGINAL photo
 * @param {string}  [opts.format]           output format, default 'jpeg'
 * @returns {Promise<{buffer: Buffer, kind: string, applied: object}>}
 */
async function finishTones(buffer, { sourceBackdrop = null, format = 'jpeg', targetSize = null } = {}) {
  const kind = classifyBackdrop(sourceBackdrop);
  // The model returns ~1.5K; the studio wants the retouch back at the exact
  // size it uploaded. Scaled here, before the tone work and the grain, so the
  // grain is camera-sized at the final resolution rather than blown up.
  let pipeline = sharp(buffer).rotate();
  if (targetSize?.width && targetSize?.height) {
    const meta = await sharp(buffer).metadata();
    if (meta.width !== targetSize.width || meta.height !== targetSize.height) {
      pipeline = pipeline
        .resize(targetSize.width, targetSize.height, { fit: 'fill', kernel: 'lanczos3' })
        .sharpen({ sigma: 0.7, m1: 0.5, m2: 1.0 });
    }
  }
  const { data, info } = await pipeline.removeAlpha().toColourspace('srgb')
    .raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const out = Buffer.from(data);
  const applied = { kind };

  if (kind === 'white') {
    const bd = measureBackdrop(data, w, h);
    // One curve for all three channels, so the person's colours do not move;
    // any tint on the paper is taken out by the backdrop-only sweep below.
    // White point at the paper's LOWEST channel, so all three clip to white
    // and any banding the model left in the paper goes with it
    const lut = highlightLut(Math.min(bd.r, bd.g, bd.b, 252) - 2);
    const deep = shadowLut(Math.min(lumPercentile(data, 0.002), 14));
    for (let k = 0; k < out.length; k++) out[k] = deep[lut[out[k]]];
    const gain = await whiteSweepGain(out, w, h);
    if (gain) {
      for (let k = 0; k < gain.length; k++) {
        if (gain[k]) out[k] = clamp(Math.round(out[k] * (1 + gain[k] / 400)), 0, 255);
      }
    }
    applied.backdropIn = [bd.r, bd.g, bd.b].map(Math.round);
    applied.sweep = !!gain;
  } else if (kind === 'black') {
    const bd = measureBackdrop(data, w, h);
    const bp = Math.min(Math.max(bd.r, bd.g, bd.b) + 3, 22);
    const lutS = shadowLut(bp);
    const top = lumPercentile(data, 0.998);
    const lutH = highlightLut(Math.max(top, 232));
    for (let k = 0; k < out.length; k++) out[k] = lutH[lutS[out[k]]];
    applied.backdropIn = [bd.r, bd.g, bd.b].map(Math.round);
    applied.blackPoint = bp;
  } else {
    // Coloured/grey backdrop: find a real black and a clean top end, gently.
    const bp = Math.min(lumPercentile(data, 0.003), 16);
    const top = Math.max(lumPercentile(data, 0.998), 236);
    const lutS = shadowLut(bp), lutH = highlightLut(top);
    for (let k = 0; k < out.length; k++) out[k] = lutH[lutS[out[k]]];
    applied.blackPoint = bp;
    applied.whitePoint = top;
  }

  await cameraTexture(out, w, h);

  const img = sharp(out, { raw: { width: w, height: h, channels: 3 } });
  const encoded = format === 'png' ? await img.png().toBuffer()
    : format === 'webp' ? await img.webp({ quality: 94 }).toBuffer()
      : await img.jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
  return { buffer: encoded, kind, applied };
}

module.exports = { finishTones, classifyBackdrop };
