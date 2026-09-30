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
const VARIANTS = {
  thumb:   { width: 300,  quality: 45 },
  display: { width: 1400, quality: 78 }
};

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
    const { width, quality } = VARIANTS[name];
    const out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
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
async function removePhotoObjects(photo) {
  const keys = [photo.storage_key, photo.thumb_key, photo.display_key].filter(Boolean);
  if (!keys.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(keys);
  if (error) console.error('[photos] Object delete failed:', error.message);
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
 * Six patches are taken around the border, where studio backdrop normally
 * is and the subject normally is not, and the MEDIAN of the patch means is
 * returned. The median is the point: a light stand in one corner or a lamp
 * intruding at the top skews an average badly, but it cannot move the middle
 * value of six.
 *
 * @returns {Promise<{r:number,g:number,b:number}|null>}
 */
async function backdropColour(buffer) {
  try {
    const img = sharp(buffer, { failOn: 'none' }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return null;

    const flat = await img.toBuffer();
    const pw = Math.max(8, Math.floor(meta.width * 0.08));
    const ph = Math.max(8, Math.floor(meta.height * 0.06));

    // Along the top and the upper sides: away from the floor, which is often
    // a different surface, and away from the centre where the subject stands.
    const spots = [
      { left: 0,                          top: 0 },
      { left: Math.floor(meta.width / 2 - pw / 2), top: 0 },
      { left: meta.width - pw,            top: 0 },
      { left: 0,                          top: Math.floor(meta.height * 0.25) },
      { left: meta.width - pw,            top: Math.floor(meta.height * 0.25) },
      { left: meta.width - pw,            top: Math.floor(meta.height * 0.45) }
    ];

    const means = [];
    for (const s of spots) {
      try {
        const stats = await sharp(flat)
          .extract({ left: s.left, top: s.top, width: pw, height: ph })
          .stats();
        means.push(stats.channels.slice(0, 3).map(c => c.mean));
      } catch { /* a patch that falls outside the image is simply skipped */ }
    }
    if (means.length < 3) return null;

    const median = (xs) => {
      const sorted = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    return {
      r: Math.round(median(means.map(m => m[0]))),
      g: Math.round(median(means.map(m => m[1]))),
      b: Math.round(median(means.map(m => m[2])))
    };
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
  downloadObject,
  prepareForEdit,
  backdropColour,
  publicUrl
};
