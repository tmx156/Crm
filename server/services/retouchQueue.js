/**
 * Background auto-retouch: every uploaded photo gets the magazine finish
 * without anyone pressing a button.
 *
 * WHY A QUEUE
 * -----------
 * A shoot arrives as 40-50 files in one drop. Each retouch is a 20-60s API
 * call, so doing them inline would hold the upload request open for half an
 * hour, and firing all 50 at once would hit the rate limit and bury the
 * event loop under base64 decoding. So the upload route returns as soon as
 * the originals are stored, and the retouches drain through here a couple at
 * a time.
 *
 * THE ORIGINAL IS NEVER TOUCHED
 * -----------------------------
 * Same contract as a manual edit: the retouch is inserted as a NEW photos
 * row pointing back through `edited_from`. If the AI makes a mess of one,
 * the photographer's file is still sitting there untouched.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * The queue lives in this process, so a restart mid-drop loses whatever had
 * not started. On Railway `resumeOnBoot()` picks those back up; anywhere else,
 * or for anything that was tried and failed, the panel's "Retouch missing"
 * button re-queues them. `recoverStale()` tidies audit rows a restart left
 * stuck at 'running'.
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const photoStorage = require('./photoStorage');
const imageEdit = require('./imageEdit');

const supabase = createClient(config.supabase.url, config.supabase.serverKey);

// Auto-retouch is on by default, but it is inert without an API key - the
// gate below checks both, so a deployment with no key behaves exactly as it
// did before this feature existed.
const ENABLED = process.env.PHOTO_AUTO_RETOUCH !== 'false';
const PRESET = process.env.PHOTO_AUTO_RETOUCH_PRESET || 'magazine';
const QUALITY = process.env.PHOTO_AUTO_RETOUCH_QUALITY || imageEdit.DEFAULT_QUALITY;

// Two at a time: enough to keep a 50-photo drop moving (~15 min) without
// tripping image rate limits, which are far tighter than text ones.
const CONCURRENCY = Math.max(1, parseInt(process.env.PHOTO_AUTO_RETOUCH_CONCURRENCY, 10) || 2);

// An edit that has been 'running' longer than this was almost certainly
// orphaned by a restart; nothing legitimately takes 30 minutes.
const STALE_AFTER_MS = 30 * 60 * 1000;

// Rate limits. A new OpenAI account allows only a handful of images a minute,
// and a 13-photo drop has been seen to lose 4 retouches to a 429 because the
// queue gave up on the first one. So a limit is now waited out: OpenAI's own
// "try again in Ns" when it gives one, otherwise this ladder. Six attempts
// spans about seven minutes - long enough for a per-minute limit to clear
// many times over, short enough that a genuinely stuck photo still fails in
// the same sitting rather than lingering.
const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [15000, 30000, 60000, 120000, 180000];
const MAX_WAIT_MS = 5 * 60 * 1000;

// When anything is told to back off, everything does: the limit is per
// account, so another worker's next call - or a booker's manual retouch -
// would only earn another 429. The clock lives in imageEdit so both share it.
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitForCooldown() {
  const wait = imageEdit.cooldownRemainingMs();
  if (wait > 0) await sleep(wait);
}

const queue = [];
let active = 0;

// Jobs currently being worked on, keyed by source photo id, so a panel opened
// mid-drop can draw placeholders for retouches it never saw get queued.
const running = new Map();

// Recent end-to-end durations, for an estimated progress bar. The image API
// reports no progress of its own, so the browser animates against this.
const recentDurations = [];
const DEFAULT_ESTIMATE_MS = 45 * 1000;
function estimateMs() {
  if (!recentDurations.length) return DEFAULT_ESTIMATE_MS;
  return Math.round(recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length);
}
function recordDuration(ms) {
  recentDurations.push(ms);
  if (recentDurations.length > 10) recentDurations.shift();
}

const isEnabled = () => ENABLED && imageEdit.isConfigured();

/** Tell the browser something changed, if anyone is listening. */
function emit(event, payload) {
  if (global.io) global.io.emit(event, payload);
}

function stats() {
  return {
    enabled: isEnabled(),
    queued: queue.length,
    active,
    concurrency: CONCURRENCY,
    estimateMs: estimateMs()
  };
}

/**
 * In-flight retouches for one lead: running ones first (with when they
 * started), then queued ones in the order they will run.
 */
function pendingFor(leadId) {
  const out = [];
  for (const [photoId, job] of running) {
    if (job.leadId === leadId) out.push({ photoId, status: 'running', startedAt: job.startedAt });
  }
  queue.forEach((job, index) => {
    if (job.leadId === leadId) out.push({ photoId: job.photoId, status: 'queued', position: index + 1 });
  });
  return out;
}

/**
 * Queue a freshly uploaded photo.
 * Safe to call unconditionally - it returns false when auto-retouch is off.
 *
 * @param {object} photo   a photos row (needs id, lead_id, storage_key, ...)
 * @param {string} userId  who uploaded it, recorded as the editor
 */
function enqueue(photo, userId) {
  if (!isEnabled()) return false;
  if (!photo?.id) return false;

  // Never retouch a retouch. Nothing currently feeds an edit back in here,
  // but if it ever did this is the difference between one extra image and an
  // unbounded loop billed by the image.
  if (photo.is_ai_edited || photo.edited_from) return false;

  // Already waiting or already being worked on - a second copy would retouch
  // (and bill) the same photo twice.
  if (running.has(photo.id) || queue.some(job => job.photoId === photo.id)) return false;

  queue.push({ photoId: photo.id, leadId: photo.lead_id, userId });
  emit('photo_retouch_queued', { photoId: photo.id, leadId: photo.lead_id, ...stats() });

  drain();
  return true;
}

/** Start as many workers as the concurrency limit allows. */
function drain() {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift();
    active += 1;
    run(job)
      .catch(err => console.error('[retouch] Worker crashed:', err.message))
      .finally(() => {
        active -= 1;
        drain();
      });
  }
}

async function run({ photoId, leadId, userId }) {
  const startedAt = Date.now();
  let editId = null;
  running.set(photoId, { leadId, startedAt: new Date(startedAt).toISOString() });

  try {
    const { data: source, error } = await supabase
      .from('photos')
      .select('id, lead_id, filename, folder, mime_type, file_size, width, height, storage_key, display_key')
      .eq('id', photoId)
      .is('deleted_at', null)
      .single();

    // Deleted between upload and here - nothing to do, and not an error.
    if (error || !source) return;

    const useOriginal =
      imageEdit.API_INPUT_MIME.has(source.mime_type) &&
      source.storage_key &&
      (source.file_size || 0) <= photoStorage.MAX_UPLOAD_BYTES;

    const inputKey = useOriginal ? source.storage_key : source.display_key;
    const inputMime = useOriginal ? source.mime_type : 'image/jpeg';
    if (!inputKey) return;

    const raw = await photoStorage.downloadObject(inputKey);

    // Bake in EXIF rotation and measure the result. Camera files routinely
    // carry an orientation tag (this studio's portraits are orientation 8),
    // and sending those bytes untouched means the API sees landscape pixels
    // while we ask for a portrait output - which comes back with the subject
    // rotated 90 degrees. Sizing off the upright bytes is also what keeps
    // the retouch from being recomposed, and a HEIC edited via its 1400px
    // derivative from being ordered at the original's dimensions.
    const input = await photoStorage.prepareForEdit(raw, inputMime);
    const size = imageEdit.bestSizeFor(input.originalWidth || input.width, input.originalHeight || input.height) || 'auto';

    // Measured from the source so the model can be told the exact colour to
    // hold, rather than asked to "keep it the same" and quietly neutralising
    // the backdrop's tint while it lifts the exposure.
    const backdrop = await photoStorage.backdropColour(input.buffer);
    const resolvedPrompt = imageEdit.buildPrompt({ preset: PRESET, backdrop });

    // Checked, not best-effort: this row is the only record that money is
    // about to be spent, so if it cannot be written the edit does not run.
    const { data: editRow, error: editError } = await supabase
      .from('photo_edits')
      .insert({
        source_photo_id: source.id,
        lead_id: source.lead_id,
        prompt: resolvedPrompt,
        preset: PRESET,
        model: imageEdit.MODEL,
        quality: QUALITY,
        size,
        status: 'running',
        edited_by: userId || null
      })
      .select('id')
      .single();

    if (editError) throw editError;
    editId = editRow.id;
    emit('photo_retouch_started', { photoId: source.id, leadId, startedAt: new Date(startedAt).toISOString(), ...stats() });

    // No onPartial: nobody is watching this one, and skipping the partials
    // means the API sends one image instead of four.
    let result;
    for (let attempt = 1; ; attempt++) {
      await waitForCooldown();
      try {
        result = await imageEdit.editImage({
          buffer: input.buffer,
          filename: source.filename || 'photo.jpg',
          mimeType: input.mimeType,
          preset: PRESET,
          backdrop,
          quality: QUALITY,
          size,
          outputWidth: input.originalWidth,
          outputHeight: input.originalHeight
        });
        break;
      } catch (err) {
        // No credit, bad key, refused prompt: waiting will not change the
        // answer, so fail now rather than burn seven minutes finding out.
        if (!err.retryable || attempt >= MAX_ATTEMPTS) {
          if (err.retryable) err.message = `${err.message} (gave up after ${attempt} attempts)`;
          throw err;
        }

        // Take the longer of OpenAI's estimate and our ladder, plus a little
        // jitter so the two workers do not wake and collide on the same tick.
        const ladder = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
        const wait = Math.min(Math.max(err.retryAfterMs || 0, ladder), MAX_WAIT_MS) +
          Math.floor(Math.random() * 3000);
        imageEdit.noteRateLimit(wait);

        console.warn(`[retouch] ${source.filename}: ${err.message} - retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(wait / 1000)}s`);
        emit('photo_retouch_retrying', {
          photoId: source.id, leadId, attempt, waitMs: wait, ...stats()
        });
      }
    }

    const base = (source.filename || 'photo').replace(/\.[^.]+$/, '');
    const row = await photoStorage.processAndUpload({
      buffer: result.buffer,
      originalName: `${base}-edited.${imageEdit.OUTPUT_FORMAT}`,
      mimeType: result.mimeType,
      leadId: source.lead_id,
      uploadedBy: userId || null,
      folder: source.folder
    });

    const { data: saved, error: insertError } = await supabase
      .from('photos')
      .insert({
        ...row,
        edited_from: source.id,
        edit_prompt: result.prompt,
        edit_model: result.model,
        is_ai_edited: true
      })
      .select('id, lead_id, url, thumb_url, display_url, filename, file_size, ' +
              'display_size, width, height, folder, description, is_primary, ' +
              'created_at, edited_from, edit_prompt, edit_model, is_ai_edited')
      .single();

    if (insertError) throw insertError;

    if (editId) {
      await supabase.from('photo_edits').update({
        status: 'completed',
        result_photo_id: saved.id,
        input_tokens: result.usage?.input_tokens ?? null,
        output_tokens: result.usage?.output_tokens ?? null,
        duration_ms: Date.now() - startedAt,
        updated_at: new Date().toISOString()
      }).eq('id', editId);
    }

    recordDuration(Date.now() - startedAt);
    // Before the emit, so a panel refetching on this event doesn't redraw it
    running.delete(photoId);
    console.log(`[retouch] ${source.filename} -> ${size} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    emit('photo_retouch_done', { photo: saved, sourcePhotoId: source.id, leadId, ...stats() });

  } catch (err) {
    if (isRefusal(err.message)) {
      console.warn(`[retouch] OpenAI declined to edit photo ${photoId} (content filter) - left as the original, will not be retried`);
    } else {
      console.error(`[retouch] Failed for photo ${photoId}:`, err.message);
    }

    if (editId) {
      await supabase.from('photo_edits').update({
        status: 'failed',
        error_message: err.message?.slice(0, 500) || null,
        duration_ms: Date.now() - startedAt,
        updated_at: new Date().toISOString()
      }).eq('id', editId).then(({ error }) => {
        if (error) console.error('[retouch] Could not record failure:', error.message);
      });
    }

    // The original upload is untouched and already in the gallery, so a
    // failed retouch is a missing extra, not lost work.
    emit('photo_retouch_failed', { photoId, leadId, message: err.message, ...stats() });
  } finally {
    running.delete(photoId);
  }
}

/**
 * Originals that have no retouch yet and are not already being handled.
 *
 * "Being handled" covers this process (queued or running) and, through a
 * recent 'running' audit row, another one: production and a local copy share
 * the database, and both retouching the same photo would bill it twice.
 *
 * @param {object}  opts
 * @param {string}  [opts.leadId]        one appointment, or every lead
 * @param {string}  [opts.since]         ISO time; only originals newer than this
 * @param {boolean} [opts.neverAttempted] only photos with no edit attempt at
 *   all - what a restart drops. Photos that were tried and failed are left for
 *   a person to retry, so a prompt the safety filter refuses is not re-billed
 *   on every deploy.
 */
/** An edit OpenAI's safety system declined - see imageEdit describeFailure */
const isRefusal = (message) => /safety system|OpenAI refused/i.test(message || '');

async function findMissing({ leadId, since, neverAttempted = false } = {}) {
  let q = supabase
    .from('photos')
    .select('id, lead_id, filename')
    .is('deleted_at', null)
    .not('is_ai_edited', 'is', true);
  if (leadId) q = q.eq('lead_id', leadId);
  if (since) q = q.gte('created_at', since);

  const { data: originals, error } = await q.limit(1000);
  if (error) throw error;
  if (!originals.length) return [];

  const ids = originals.map(p => p.id);
  const [{ data: retouches, error: rErr }, { data: edits, error: eErr }] = await Promise.all([
    supabase.from('photos').select('edited_from').in('edited_from', ids).is('deleted_at', null),
    supabase.from('photo_edits').select('source_photo_id, status, created_at, error_message').in('source_photo_id', ids)
  ]);
  if (rErr) throw rErr;
  if (eErr) throw eErr;

  const done = new Set(retouches.map(r => r.edited_from));
  const liveCutoff = Date.now() - STALE_AFTER_MS;
  const inFlightElsewhere = new Set(edits
    .filter(e => e.status === 'running' && new Date(e.created_at).getTime() > liveCutoff)
    .map(e => e.source_photo_id));
  const attempted = new Set(edits.map(e => e.source_photo_id));
  // OpenAI's content filter declined these (e.g. lingerie or lying-down shots
  // read as sexual). The same photo gets the same answer every time, so
  // "Retouch missing" must not keep sending it - and repeated refusals count
  // against the account. Retouch these by hand or leave them as originals.
  const refused = new Set(edits
    .filter(e => e.status === 'failed' && isRefusal(e.error_message))
    .map(e => e.source_photo_id));

  return originals.filter(p =>
    !done.has(p.id) &&
    !refused.has(p.id) &&
    !inFlightElsewhere.has(p.id) &&
    !running.has(p.id) &&
    !queue.some(job => job.photoId === p.id) &&
    (!neverAttempted || !attempted.has(p.id))
  );
}

/**
 * Queue every original in an appointment that still has no retouch - the
 * "Retouch missing" button. Includes ones that failed before.
 *
 * @returns {Promise<number>} how many were queued
 */
async function requeueMissing(leadId, userId) {
  if (!isEnabled()) return 0;
  const missing = await findMissing({ leadId });
  let queued = 0;
  for (const photo of missing) {
    if (enqueue({ id: photo.id, lead_id: photo.lead_id }, userId)) queued += 1;
  }
  if (queued) console.log(`[retouch] Re-queued ${queued} missing retouch(es) for lead ${leadId}`);
  return queued;
}

/**
 * On boot, pick up photos a restart dropped from the queue before they
 * started. Only on Railway: a local copy shares the database, and if every
 * instance resumed on boot they would all go after the same photos.
 */
async function resumeOnBoot() {
  if (!isEnabled() || !process.env.RAILWAY_ENVIRONMENT) return;
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const missing = await findMissing({ since, neverAttempted: true });
    for (const photo of missing) enqueue({ id: photo.id, lead_id: photo.lead_id }, null);
    if (missing.length) console.log(`[retouch] Resumed ${missing.length} retouch(es) dropped by the last restart`);
  } catch (err) {
    console.error('[retouch] Resume on boot failed:', err.message);
  }
}

/**
 * Mark edits orphaned by a restart as failed, so they do not sit at
 * 'running' forever and skew the spend report.
 */
async function recoverStale() {
  // Deliberately not gated on isEnabled(): manual edits from the retouch
  // dialog write these rows too, so turning auto-retouch off must not leave
  // orphaned rows stuck at 'running' forever.
  try {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
    const { data, error } = await supabase
      .from('photo_edits')
      .update({
        status: 'failed',
        error_message: 'Abandoned - the server restarted while this edit was running',
        updated_at: new Date().toISOString()
      })
      .eq('status', 'running')
      .lt('created_at', cutoff)
      .select('id');

    if (error) throw error;
    if (data?.length) console.log(`[retouch] Cleared ${data.length} abandoned edit(s)`);
  } catch (err) {
    console.error('[retouch] Stale sweep failed:', err.message);
  }
}

module.exports = {
  ENABLED,
  PRESET,
  QUALITY,
  CONCURRENCY,
  isEnabled,
  enqueue,
  stats,
  pendingFor,
  findMissing,
  requeueMissing,
  resumeOnBoot,
  recoverStale
};
