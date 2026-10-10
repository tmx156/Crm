/**
 * Photo storage: uploads originals and generates the derivatives that the
 * gallery actually renders.
 *
 * WHY THIS EXISTS
 * ---------------
 * Client photos average ~4.4 MB. A 20-tile grid that points at originals
 * pulls ~88 MB every time someone opens an appointment, which is what
 * drives a storage bill - not the stored bytes. So every upload writes
 * three objects:
 *
 *   thumb    ~300px  q45   ~20 KB   grid tiles
 *   display ~1400px  q78  ~300 KB   lightbox, and "web quality" ZIP sends
 *   original  as-is        ~4.4 MB  full-resolution ZIP sends only
 *
 * That is roughly +7% storage for a ~1000x cut in the bytes served during
 * normal browsing.
 *
 * Everything goes through this module so the backend stays swappable: the
 * photos table records storage_provider/bucket/key per row, so moving to
 * S3 or R2 later means adding a driver here, not rewriting the routes.
 */

const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

const BUCKET = process.env.PHOTOS_BUCKET || 'client-photos';
const PROVIDER = 'supabase';

// Derivative recipes. Sizes are the long edge; aspect ratio is preserved and
// images are never scaled up.
//
// display is what Present and the client gallery put on screen: 2560 on the
// long edge (Oct 2026, was 1400 at q78) so it is sharp on a 4K TV, a big
// monitor or a Retina laptop in fullscreen. Progressive, so a slow
// connection shows the whole photo at once and sharpens as it arrives.
const VARIANTS = {
  thumb:   { width: 300,  quality: 60 },
  display: { width: 2560, quality: 86 }
};

// One recipe for writing a derivative, shared with the display backfill.
async function renderDerivative(buffer, name) {
  const { width, quality } = VARIANTS[name];
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
    .jpeg({
      quality,
      mozjpeg: true,
      progressive: true,
      chromaSubsampling: name === 'display' ? '4:4:4' : '4:2:0'
    })
    .toBuffer();
}

// Supabase free tier caps uploads at 50 MB; Pro is far higher. 45 MB keeps
// headroom for a large JPEG without tripping the smaller limit.
const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;

// Longest edge of an image sent to the edit API. Comfortably above any
// output we request (1536 by default) so no detail is lost, and well below
// the point where the API starts refusing files with a bare "Invalid image
// file" - a 6000x4000, 12.6 MB original does exactly that. Sending more is
// wasted upload regardless: the API bills the same 1536 image_tokens however
// large the input is, so it is downscaling internally anyway.
const INPUT_MAX_EDGE = parseInt(process.env.PHOTO_EDIT_INPUT_MAX_EDGE, 10) || 2048;

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/heic', 'image/heif'
]);

let bucketReady = null;

/**
 * Create the bucket on first use. Mirrors the retry behaviour of
 * utils/supabaseStorage.js so a cold Supabase instance does not fail a boot.
 */
async function ensureBucket(retries = 3) {
  if (bucketReady) return bucketReady;

  bucketReady = (async () => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const { data: buckets, error } = await supabase.storage.listBuckets();
        if (error) throw error;

        if (buckets.some(b => b.name === BUCKET)) return true;

        console.log(`[photos] Creating bucket: ${BUCKET}`);
        const { error: createError } = await supabase.storage.createBucket(BUCKET, {
          public: true,
          fileSizeLimit: MAX_UPLOAD_BYTES,
          allowedMimeTypes: [...ALLOWED_MIME, 'application/zip']
        });
        if (createError && !/already exists/i.test(createError.message)) throw createError;

        console.log(`[photos] Bucket ready: ${BUCKET}`);
        return true;
      } catch (err) {
        if (attempt < retries) {
          console.log(`[photos] Bucket init failed (${attempt}/${retries}): ${err.message}`);
          await new Promise(r => setTimeout(r, attempt * 2000));
          continue;
        }
        console.error('[photos] Bucket init failed after retries:', err.message);
        // Reset so a later request can retry rather than being stuck.
        bucketReady = null;
        return false;
      }
    }
    return false;
  })();

  return bucketReady;
}

function publicUrl(key) {
  return supabase.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
}

/** Strip anything that would be awkward inside an object key or a ZIP entry. */
function safeBaseName(originalName) {
  const base = path.basename(originalName || 'photo', path.extname(originalName || ''));
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  return cleaned || 'photo';
}

async function putObject(key, buffer, contentType) {
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, {
    contentType,
    upsert: true,
    // Derivatives are addressed by photo id, so they never change once
    // written - let the CDN hold them for a year.
    cacheControl: '31536000'
  });
  if (error) throw new Error(`upload ${key}: ${error.message}`);
  return key;
}

/**
 * Process one uploaded image and write all three objects.
 *
 * @returns {Promise<object>} a row ready to insert into `photos`
 */
async function processAndUpload({ buffer, originalName, mimeType, leadId, uploadedBy, folder }) {
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (${(buffer.length / 1048576).toFixed(1)} MB, max 45 MB)`);
  }

  const ok = await ensureBucket();
  if (!ok) throw new Error('Photo storage bucket is unavailable');

  const photoId = crypto.randomUUID();
  const base = safeBaseName(originalName);
  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase();
  const prefix = leadId ? `leads/${leadId}` : 'unassigned';

  // .rotate() with no argument applies the EXIF orientation and drops the
  // tag, so portrait shots from a camera do not come back sideways.
  const meta = await sharp(buffer, { failOn: 'none' }).rotate().metadata().catch(() => ({}));

  const derivative = async (name) => {
    const out = await renderDerivative(buffer, name);
    const key = `${prefix}/${photoId}/${name}.jpg`;
    await putObject(key, out, 'image/jpeg');
    return { key, size: out.length };
  };

  const originalKey = `${prefix}/${photoId}/original${ext}`;
  const [, thumb, display] = await Promise.all([
    putObject(originalKey, buffer, mimeType),
    derivative('thumb'),
    derivative('display')
  ]);

  return {
    id: photoId,
    lead_id: leadId || null,
    storage_provider: PROVIDER,
    bucket: BUCKET,
    storage_key: originalKey,
    thumb_key: thumb.key,
    display_key: display.key,
    url: publicUrl(originalKey),
    thumb_url: publicUrl(thumb.key),
    display_url: publicUrl(display.key),
    filename: `${base}${ext}`,
    file_size: buffer.length,
    thumb_size: thumb.size,
    display_size: display.size,
    width: meta.width || null,
    height: meta.height || null,
    format: (meta.format || ext.replace('.', '')) || null,
    mime_type: mimeType,
    folder: folder || null,
    uploaded_by: uploadedBy || null
  };
}

/** Remove every object belonging to a photo. Missing keys are not an error. */
async function removeObjectKeys(keys) {
  keys = (keys || []).filter(Boolean);
  if (!keys.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(keys);
  if (error) console.error('[photos] Object delete failed:', error.message);
}

async function removePhotoObjects(photo) {
  await removeObjectKeys([photo.storage_key, photo.thumb_key, photo.display_key]);
}

/**
 * Prepare an image for the edit API: upright pixels, and the dimensions that
 * match them.
 *
 * Originals are stored byte-for-byte as uploaded, EXIF and all. A phone photo
 * is routinely stored as landscape pixels plus an "rotate 90" tag, and
 * whether a consumer honours that tag is its own business. If it does not,
 * we would be requesting a portrait output for landscape pixels, and the
 * model would have to crop or extend to reconcile them - the exact
 * recomposition the size matching exists to prevent.
 *
 * So anything with a non-trivial orientation tag is baked upright first.
 * Images that are already upright (orientation 1 or absent, which is most
 * camera work on a tripod) are passed through untouched - no re-encode, no
 * generation loss.
 *
 * @returns {Promise<{buffer: Buffer, mimeType: string, width: number|null,
 *                    height: number|null, rotated: boolean}>}
 */
async function prepareForEdit(buffer, mimeType) {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata().catch(() => ({}));

  // Always re-encode rather than passing the stored bytes through.
  //
  // A 24 MP, 12.6 MB original is rejected outright by the edit API with a
  // bare "Invalid image file", and sending it buys nothing anyway: the API
  // reports the same 1536 image_tokens whatever the input resolution, so it
  // is downscaling internally regardless. Re-encoding here also flattens the
  // awkward cases that would otherwise reach the API untouched - CMYK,
  // 16-bit, progressive, alpha, odd colour profiles - into one boring
  // baseline sRGB JPEG that it will always accept.
  const pipeline = sharp(buffer, { failOn: 'none' })
    .rotate()                                   // bake in EXIF orientation
    .resize({
      width: INPUT_MAX_EDGE,
      height: INPUT_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true                  // never invent detail
    })
    .flatten({ background: '#ffffff' })          // drop alpha
    .toColourspace('srgb');

  const prepared = await pipeline
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();

  const preparedMeta = await sharp(prepared).metadata().catch(() => ({}));

  return {
    buffer: prepared,
    mimeType: 'image/jpeg',
    width: preparedMeta.width || null,
    height: preparedMeta.height || null,
    // The uploaded photo's own size, upright - a retouch is delivered back
    // at exactly this size (see tonalFinish targetSize)
    originalWidth: (meta.orientation >= 5 ? meta.height : meta.width) || null,
    originalHeight: (meta.orientation >= 5 ? meta.width : meta.height) || null,
    rotated: !!meta.orientation && meta.orientation > 1,
    resized: (meta.width || 0) > INPUT_MAX_EDGE || (meta.height || 0) > INPUT_MAX_EDGE
  };
}

/**
 * Sample the backdrop colour of a studio shot.
 *
 * Telling the model to "keep the backdrop the colour it already is" does not
 * work - it reads the backdrop's own tint as a colour cast and neutralises
 * it, and lifts its brightness along with the exposure. Handing it the
 * actual RGB value to hold is concrete in a way that prose is not.
 *
 * Fourteen patches are taken along the top and the upper sides, where the
 * backdrop normally is and the floor is not. The subject often covers some of
 * them - on a close-up, hair and shoulders fill half the border - so the
 * answer is the colour most patches AGREE on, not their median: busy patches
 * (hair, clothing, a light stand) are dropped first, then the largest group
 * of patches within a small colour distance of each other wins. A median of
 * six read a white-paper close-up as RGB(200,189,186) - her hair.
 *
 * @returns {Promise<{r:number,g:number,b:number}|null>}
 */
async function backdropColour(buffer) {
  try {
    const { data, info } = await sharp(buffer, { failOn: 'none' }).rotate()
      .resize({ width: 600, withoutEnlargement: true })
      // sRGB forces 3 channels: a black-and-white upload is 1 channel, and the
      // (y * w + x) * 3 indexing below would read it as the wrong pixels.
      .removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    const pw = Math.max(6, Math.floor(w * 0.07));
    const ph = Math.max(6, Math.floor(h * 0.05));

    const spots = [];
    for (const fx of [0, 0.2, 0.4, 0.6, 0.8, 1]) spots.push([Math.round(fx * (w - pw)), 0]);
    for (const fy of [0.12, 0.25, 0.38, 0.5]) {
      spots.push([0, Math.round(fy * h)]);
      spots.push([w - pw, Math.round(fy * h)]);
    }

    const patches = spots.map(([x0, y0]) => {
      const sum = [0, 0, 0], sq = [0, 0, 0]; let n = 0;
      for (let y = y0; y < Math.min(h, y0 + ph); y++) {
        for (let x = x0; x < Math.min(w, x0 + pw); x++) {
          const k = (y * w + x) * 3;
          for (let c = 0; c < 3; c++) { sum[c] += data[k + c]; sq[c] += data[k + c] * data[k + c]; }
          n++;
        }
      }
      const mean = sum.map(v => v / n);
      const sd = Math.sqrt(sq.reduce((a, v, c) => a + v / n - mean[c] * mean[c], 0) / 3);
      return { mean, sd };
    });

    // Backdrop is smooth; hair and fabric are not. Keep the calm patches
    // unless that would leave too few to judge by.
    const calm = patches.filter(p => p.sd <= 14);
    const pool = calm.length >= 3 ? calm : patches;

    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let best = null;
    for (const p of pool) {
      const group = pool.filter(q => dist(p.mean, q.mean) <= 22);
      if (!best || group.length > best.length ||
          (group.length === best.length && p.sd < best.sd)) {
        best = Object.assign(group, { sd: p.sd });
      }
    }
    const avg = (c) => Math.round(best.reduce((a, q) => a + q.mean[c], 0) / best.length);
    // How the backdrop is LIT, not just its colour: a gel or a spotlight is
    // strong at the top and falls off down the wall onto a paler floor. One
    // number for all of it is what made the model paint a gelled backdrop and
    // its floor a single flat blue. Sampled at the frame edges, where the
    // subject rarely is; the calmer of left/right at each height wins.
    const zone = (fy) => {
      const y0 = Math.min(h - ph, Math.max(0, Math.round(fy * h - ph / 2)));
      const cands = [0, w - pw].map((x0) => {
        const sum = [0, 0, 0], sq = [0, 0, 0]; let n = 0;
        for (let y = y0; y < y0 + ph; y++) for (let x = x0; x < x0 + pw; x++) {
          const k = (y * w + x) * 3;
          for (let c = 0; c < 3; c++) { sum[c] += data[k + c]; sq[c] += data[k + c] * data[k + c]; }
          n++;
        }
        const mean = sum.map(v => v / n);
        const sd = Math.sqrt(sq.reduce((a, v, c) => a + v / n - mean[c] * mean[c], 0) / 3);
        return { mean, sd };
      }).sort((a, b) => a.sd - b.sd);
      return cands[0].mean.map(Math.round);
    };
    const profile = { top: zone(0.04), middle: zone(0.5), floor: zone(0.95) };

    return { r: avg(0), g: avg(1), b: avg(2), profile };
  } catch {
    return null;
  }
}

/** Fetch one object's bytes - used when building a ZIP. */
async function downloadObject(key) {
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error) throw new Error(`download ${key}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}


module.exports = {
  BUCKET,
  PROVIDER,
  MAX_UPLOAD_BYTES,
  ALLOWED_MIME,
  ensureBucket,
  processAndUpload,
  removePhotoObjects,
  removeObjectKeys,
  downloadObject,
  prepareForEdit,
  backdropColour,
  publicUrl,
  renderDerivative,
  putObject
};
