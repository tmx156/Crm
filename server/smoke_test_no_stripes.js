/**
 * Regression test: the tonal finish must never add horizontal lines.
 *
 *   node server/smoke_test_no_stripes.js [path/to/real-photo.jpg ...]
 *
 * Every retouch once came back striped: sharp returned single-channel
 * buffers as three channels and tonalFinish indexed them as one, so the
 * white-sweep gain map sampled the wrong pixels in alternating rows. This
 * runs the finish over synthetic sets (white, grey, black, coloured, a
 * black-and-white JPEG, a PNG with alpha, odd sizes, the resize path, film
 * grain on) plus any real photos given, and fails if the output carries
 * more row-to-row banding than the input did.
 *
 * Free to run - no OpenAI call, no database.
 */

const fs = require('fs');
const sharp = require('sharp');

let failed = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => { failed++; console.error(`  FAIL  ${m}`); };

/** Greyscale pixels at a given size. */
async function grey(buffer, width, height) {
  const { data } = await sharp(buffer).resize(width, height, { fit: 'fill' }).greyscale()
    .extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  return data;
}

/**
 * Stripes the finish ADDED: take output minus input, average each row, and
 * measure how much each row jumps against the rows 4 above and below. The
 * tone curves change the picture smoothly, so this stays near zero; a
 * striped gain map lifts alternate rows and shows up at once. Whatever
 * texture the photo already had cancels out in the subtraction.
 */
async function addedBanding(input, output) {
  const { width: w, height: h } = await sharp(output).metadata();
  const a = await grey(input, w, h), b = await grey(output, w, h);
  const rows = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += b[y * w + x] - a[y * w + x];
    rows[y] = s / w;
  }
  // Median, not mean: a real edge in the picture (a shoulder, a chin) jumps on
  // a handful of rows, while stripes run through nearly every row of the frame.
  const jumps = [];
  for (let y = 4; y < h - 4; y++) jumps.push(Math.abs(rows[y] - (rows[y - 4] + rows[y + 4]) / 2));
  jumps.sort((p, q) => p - q);
  return jumps[Math.floor(jumps.length / 2)];
}

/** A studio-like test frame: a backdrop with a wall-to-floor falloff, a face, hair and a white top. */
async function makeSet({ width, height, backdrop, greyscale = false, png = false }) {
  const [r, g, b] = backdrop;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="fall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgb(${r},${g},${b})"/>
      <stop offset="1" stop-color="rgb(${Math.round(r * 0.88)},${Math.round(g * 0.88)},${Math.round(b * 0.88)})"/>
    </linearGradient>
</defs>
    <rect width="100%" height="100%" fill="url(#fall)"/>
    <ellipse cx="${width / 2}" cy="${height * 0.36}" rx="${width * 0.16}" ry="${height * 0.17}" fill="#c69c84"/>
    <rect x="${width * 0.2}" y="${height * 0.55}" width="${width * 0.6}" height="${height * 0.45}" rx="40" fill="#f2f2f2"/>
    <rect x="${width * 0.33}" y="${height * 0.1}" width="${width * 0.34}" height="${height * 0.2}" fill="#151515"/>
  </svg>`;
  let img = sharp(Buffer.from(svg));
  if (greyscale) img = img.greyscale();
  return png ? img.png().toBuffer() : img.jpeg({ quality: 92 }).toBuffer();
}

async function check(label, input, opts) {
  // Required fresh so PHOTO_GRAIN_STRENGTH (read at load) can vary per case.
  delete require.cache[require.resolve('./services/tonalFinish')];
  const { finishTones } = require('./services/tonalFinish');
  const { buffer, applied } = await finishTones(input, opts);
  const added = await addedBanding(input, buffer);
  const meta = await sharp(buffer).metadata();
  const sizeOk = !opts.targetSize ||
    (meta.width === opts.targetSize.width && meta.height === opts.targetSize.height);
  // Clean output measures well under 0.1; the striped gain map measured over 1.
  const ok = sizeOk && added <= 0.25;
  (ok ? pass : fail)(`${label}: stripes added ${added.toFixed(2)}` +
    ` (${applied.kind}${applied.sweep ? ', sweep' : ''})${sizeOk ? '' : ' WRONG SIZE'}`);
}

(async () => {
  console.log('Tonal finish stripe regression');

  const cases = [
    ['white set', { width: 1200, height: 1600, backdrop: [236, 236, 238] }, { r: 236, g: 236, b: 238 }],
    ['grey set', { width: 1200, height: 1600, backdrop: [190, 190, 192] }, { r: 190, g: 190, b: 192 }],
    ['black set', { width: 1200, height: 1600, backdrop: [14, 14, 16] }, { r: 14, g: 14, b: 16 }],
    ['coloured set', { width: 1200, height: 1600, backdrop: [190, 160, 215] }, { r: 190, g: 160, b: 215 }],
    ['black-and-white JPEG', { width: 1200, height: 1600, backdrop: [236, 236, 236], greyscale: true }, { r: 236, g: 236, b: 236 }],
    ['PNG with alpha', { width: 1200, height: 1600, backdrop: [236, 236, 238], png: true }, { r: 236, g: 236, b: 238 }],
    ['odd size', { width: 1213, height: 1334, backdrop: [236, 236, 238] }, { r: 236, g: 236, b: 238 }]
  ];

  for (const [label, set, sourceBackdrop] of cases) {
    const input = await makeSet(set);
    await check(label, input, { sourceBackdrop, format: 'jpeg' });
  }

  // The real retouch path: model output a touch smaller, resized back up
  const modelSized = await makeSet({ width: 1168, height: 1280, backdrop: [236, 236, 238] });
  await check('resized to source size', modelSized,
    { sourceBackdrop: { r: 236, g: 236, b: 238 }, format: 'jpeg', targetSize: { width: 1213, height: 1334 } });

  process.env.PHOTO_GRAIN_STRENGTH = '1';
  await check('film grain on', await makeSet({ width: 1200, height: 1600, backdrop: [236, 236, 238] }),
    { sourceBackdrop: { r: 236, g: 236, b: 238 }, format: 'jpeg' });
  delete process.env.PHOTO_GRAIN_STRENGTH;

  for (const file of process.argv.slice(2)) {
    const input = fs.readFileSync(file);
    const { backdropColour } = require('./services/photoStorage');
    await check(`photo ${file}`, input, { sourceBackdrop: await backdropColour(input), format: 'jpeg' });
  }

  console.log(failed ? `\n${failed} FAILED` : '\nAll passed - no stripes');
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
