/**
 * AI photo retouching endpoints.
 *
 * An edit is a long request with intermediate results, so POST /:photoId
 * replies as Server-Sent Events rather than JSON: `partial` frames carry the
 * drafts OpenAI streams back, then one `saved` frame carries the finished
 * photo row. The browser drives this with fetch() rather than EventSource,
 * because EventSource cannot set an Authorization header.
 *
 * An edit never overwrites its source. The result is uploaded as a new photo
 * that points back through `edited_from`, so the original as shot is always
 * there and a booker can re-run an edit with different instructions without
 * having lost anything. Editing an edit is therefore free multi-turn
 * refinement - the chain is just rows.
 *
 * See services/imageEdit.js for the API call and services/photoStorage.js
 * for how the saved result gets its derivatives.
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const config = require('../config');
const photoStorage = require('../services/photoStorage');
const imageEdit = require('../services/imageEdit');

const router = express.Router();

const supabase = createClient(config.supabase.url, config.supabase.serverKey);

// Matches CAN_EDIT_ROLES in routes/photos.js - editing a client's photos is
// the same privilege as deleting them.
const CAN_EDIT_ROLES = ['admin', 'booker'];

// Retries for a manual retouch. Tighter than the background queue's (which
// can wait minutes unseen): about a minute in all before telling the booker,
// who is sat watching the dialog.
const MANUAL_MAX_ATTEMPTS = 4;
const MANUAL_BACKOFF_MS = [10000, 20000, 30000];
const MANUAL_MAX_WAIT_MS = 60000;
const canEdit = (user) => CAN_EDIT_ROLES.includes(user?.role);

// The columns the gallery renders, plus the edit provenance. Keep in step
// with LIST_FIELDS in routes/photos.js.
const PHOTO_FIELDS = [
  'id', 'lead_id', 'url', 'thumb_url', 'display_url', 'filename',
  'file_size', 'display_size', 'width', 'height', 'folder', 'description',
  'is_primary', 'created_at', 'edited_from', 'edit_prompt', 'edit_model',
  'is_ai_edited'
].join(', ');

/**
 * GET /api/photo-edit/presets
 *
 * Also the capability check: `configured` false means no OPENAI_API_KEY, and
 * the UI hides the edit buttons rather than offering a button that 500s.
 */
router.get('/presets', auth, (req, res) => {
  res.json({
    success: true,
    configured: imageEdit.isConfigured(),
    model: imageEdit.MODEL,
    qualities: imageEdit.QUALITIES.filter(q => q !== 'auto'),
    defaultQuality: imageEdit.DEFAULT_QUALITY,
    maxPromptLength: imageEdit.MAX_PROMPT_LENGTH,
    presets: Object.entries(imageEdit.PRESETS).map(([id, p]) => ({
      id,
      label: p.label,
      description: p.description
    }))
  });
});

/**
 * GET /api/photo-edit/pending?leadId=...
 * Auto-retouches still queued or running for a lead, with the source photo's
 * thumbnail, so the Retouched folder can show blurred "coming soon" tiles.
 */
router.get('/pending', auth, async (req, res) => {
  try {
    const { leadId } = req.query;
    if (!leadId) return res.status(400).json({ success: false, message: 'leadId is required' });

    // Required lazily: retouchQueue is also loaded by server.js at boot
    const retouchQueue = require('../services/retouchQueue');
    const pending = retouchQueue.pendingFor(leadId);

    let thumbs = {};
    if (pending.length) {
      const { data } = await supabase
        .from('photos')
        .select('id, thumb_url, display_url, filename')
        .in('id', pending.map(p => p.photoId));
      thumbs = Object.fromEntries((data || []).map(p => [p.id, p]));
    }

    res.json({
      success: true,
      estimateMs: retouchQueue.stats().estimateMs,
      pending: pending
        .filter(p => thumbs[p.photoId]) // deleted sources have nothing to show
        .map(p => ({
          ...p,
          thumbUrl: thumbs[p.photoId].thumb_url || thumbs[p.photoId].display_url,
          filename: thumbs[p.photoId].filename
        }))
    });
  } catch (err) {
    console.error('[photo-edit] Pending failed:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/photo-edit/missing?leadId=...
 * How many originals in an appointment have no retouch and nothing in
 * flight - the number shown on the "Retouch missing" button.
 */
router.get('/missing', auth, async (req, res) => {
  try {
    const { leadId } = req.query;
    if (!leadId) return res.status(400).json({ success: false, message: 'leadId is required' });
    const retouchQueue = require('../services/retouchQueue');
    if (!retouchQueue.isEnabled()) return res.json({ success: true, missing: 0 });
    const missing = await retouchQueue.findMissing({ leadId });
    res.json({ success: true, missing: missing.length });
  } catch (error) {
    console.error('[photo-edit] Missing count failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/photo-edit/retouch-missing  { leadId }
 * Queue every original in the appointment that still has no retouch,
 * including ones that failed earlier (e.g. to a rate limit).
 */
router.post('/retouch-missing', auth, async (req, res) => {
  try {
    if (!canEdit(req.user)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to edit photos' });
    }
    const { leadId } = req.body || {};
    if (!leadId) return res.status(400).json({ success: false, message: 'leadId is required' });

    const retouchQueue = require('../services/retouchQueue');
    if (!retouchQueue.isEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'AI retouching is not configured - add OPENAI_API_KEY to the server environment'
      });
    }

    const queued = await retouchQueue.requeueMissing(leadId, req.user.id);
    res.json({ success: true, queued, ...retouchQueue.stats() });
  } catch (error) {
    console.error('[photo-edit] Retouch missing failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/photo-edit/:photoId/history
 * Every attempt against one photo, failures included.
 */
router.get('/:photoId/history', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('photo_edits')
      .select('id, prompt, preset, model, quality, status, error_message, ' +
              'result_photo_id, duration_ms, created_at')
      .eq('source_photo_id', req.params.photoId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ success: true, edits: data || [] });
  } catch (error) {
    console.error('[photo-edit] History failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/photo-edit/:photoId
 * Body: { preset, prompt, quality, size, folder }
 *
 * Responds as SSE. Frames:
 *   status  { stage, message }
 *   partial { index, total, image }   image is a data: URL
 *   saved   { photo, editId, usage }
 *   error   { message }
 */
router.post('/:photoId', auth, async (req, res) => {
  // --- Everything that can fail with a normal status code, first --------
  // Once the SSE headers go out the status line is spent, so all the cheap
  // rejections happen before that.
  if (!canEdit(req.user)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to edit photos' });
  }
  if (!imageEdit.isConfigured()) {
    return res.status(503).json({
      success: false,
      message: 'AI photo editing is not configured - add OPENAI_API_KEY to the server environment'
    });
  }

  const { preset, prompt, quality = imageEdit.DEFAULT_QUALITY, size = 'auto' } = req.body || {};

  // Resolve the prompt up front: it validates the request before anything is
  // spent, and it is what gets recorded. The audit row stores the text that
  // actually went to OpenAI - preset recipe, the booker's note and the
  // identity guardrail - rather than just the note, which is null whenever a
  // preset is used on its own and would violate photo_edits.prompt NOT NULL.
  let resolvedPrompt;
  try {
    resolvedPrompt = imageEdit.buildPrompt({ preset, prompt });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }

  const { data: source, error: sourceError } = await supabase
    .from('photos')
    .select('id, lead_id, filename, folder, mime_type, file_size, width, height, storage_key, display_key')
    .eq('id', req.params.photoId)
    .is('deleted_at', null)
    .single();

  if (sourceError || !source) {
    return res.status(404).json({ success: false, message: 'Photo not found' });
  }

  // The API takes png/webp/jpg only, and the original may be HEIC or TIFF.
  // The 1400px display derivative is always JPEG, so it is the fallback -
  // and for a web gallery it is usually indistinguishable anyway.
  const useOriginal =
    imageEdit.API_INPUT_MIME.has(source.mime_type) &&
    source.storage_key &&
    (source.file_size || 0) <= photoStorage.MAX_UPLOAD_BYTES;

  const inputKey = useOriginal ? source.storage_key : source.display_key;
  const inputMime = useOriginal ? source.mime_type : 'image/jpeg';

  if (!inputKey) {
    return res.status(422).json({ success: false, message: 'This photo has no editable file in storage' });
  }


  // --- SSE from here on -------------------------------------------------
  // `no-transform` is what stops the compression middleware from buffering
  // the stream until the response ends, which would defeat the point.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Belt and braces for nginx, which buffers proxied responses by default.
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  let closed = false;
  const send = (event, payload) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  // If the booker closes the modal or the tab, stop paying OpenAI to finish
  // an image nobody will see.
  const abort = new AbortController();
  res.on('close', () => {
    closed = true;
    abort.abort();
  });

  const startedAt = Date.now();
  let editId = null;

  try {
    send('status', { stage: 'preparing', message: 'Fetching the photo' });

    const raw = await photoStorage.downloadObject(inputKey);

    // Bake in EXIF rotation and measure the result. Camera files routinely
    // carry an orientation tag, and sending those bytes untouched means the
    // API sees landscape pixels while we ask for a portrait output - which
    // comes back with the subject rotated 90 degrees.
    const input = await photoStorage.prepareForEdit(raw, inputMime);

    // 'auto' lets the model choose an output shape, and if it chooses a
    // different one from the source it has to crop or extend to get there -
    // which is how a lighting fix comes back recomposed. Pin the output to
    // the upright input's own aspect ratio unless a size was requested.
    const backdrop = await photoStorage.backdropColour(input.buffer);

    const outputSize = size === 'auto'
      ? (imageEdit.bestSizeFor(input.width, input.height) || 'auto')
      : size;

    // Logged before the call so a crash or a restart still leaves a trace of
    // what was attempted, and so the id can be attached to the result.
    const { data: editRow, error: editError } = await supabase
      .from('photo_edits')
      .insert({
        source_photo_id: source.id,
        lead_id: source.lead_id,
        prompt: imageEdit.buildPrompt({ preset, prompt, backdrop }),
        preset: preset || null,
        model: imageEdit.MODEL,
        quality,
        size: outputSize,
        status: 'running',
        edited_by: req.user.id
      })
      .select('id')
      .single();

    if (editError) throw editError;
    editId = editRow.id;

    // A booker is watching this one, so the waits are shorter than the
    // background queue's and each one is announced on screen. It shares the
    // queue's cooldown: during a big upload the account's per-minute image
    // limit is already in use, and firing anyway only earns a 429.
    const waitAbortable = (ms) => new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      abort.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });
    const announceWait = (ms, why) => send('status', {
      stage: 'waiting', message: `${why} - trying again in ${Math.ceil(ms / 1000)}s`, editId
    });

    let result;
    for (let attempt = 1; ; attempt++) {
      const cooling = imageEdit.cooldownRemainingMs();
      if (cooling > 0) {
        announceWait(cooling, 'OpenAI is busy with other retouches');
        await waitAbortable(cooling);
      }
      if (closed) throw Object.assign(new Error('Edit cancelled'), { cancelled: true });

      send('status', { stage: 'editing', message: 'Sending to OpenAI', editId });
      try {
        result = await imageEdit.editImage({
          buffer: input.buffer,
          filename: source.filename || 'photo.jpg',
          mimeType: input.mimeType,
          preset,
          prompt,
          backdrop,
          quality,
          size: outputSize,
          signal: abort.signal,
          onPartial: ({ index, buffer }) => {
            send('partial', {
              index,
              total: 3,
              image: `data:image/${imageEdit.OUTPUT_FORMAT};base64,${buffer.toString('base64')}`
            });
          }
        });
        break;
      } catch (err) {
        if (!err.retryable || attempt >= MANUAL_MAX_ATTEMPTS) throw err;
        const ladder = MANUAL_BACKOFF_MS[Math.min(attempt - 1, MANUAL_BACKOFF_MS.length - 1)];
        const wait = Math.min(Math.max(err.retryAfterMs || 0, ladder), MANUAL_MAX_WAIT_MS);
        imageEdit.noteRateLimit(wait);
        announceWait(wait, 'OpenAI asked us to slow down');
        await waitAbortable(wait);
      }
    }

    if (closed) throw Object.assign(new Error('Edit cancelled'), { cancelled: true });

    send('status', { stage: 'saving', message: 'Saving the retouched photo' });

    // Same pipeline as a manual upload, so the edit gets its thumb and
    // display derivatives and behaves like any other photo in the gallery.
    const editedName = withEditedSuffix(source.filename, imageEdit.OUTPUT_FORMAT);
    const row = await photoStorage.processAndUpload({
      buffer: result.buffer,
      originalName: editedName,
      mimeType: result.mimeType,
      leadId: source.lead_id,
      uploadedBy: req.user.id,
      // Land the edit in the same folder as its source.
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
      .select(PHOTO_FIELDS)
      .single();

    if (insertError) throw insertError;

    await supabase
      .from('photo_edits')
      .update({
        status: 'completed',
        result_photo_id: saved.id,
        input_tokens: result.usage?.input_tokens ?? null,
        output_tokens: result.usage?.output_tokens ?? null,
        duration_ms: Date.now() - startedAt,
        updated_at: new Date().toISOString()
      })
      .eq('id', editId);

    send('saved', { photo: saved, editId, usage: result.usage || null });
    res.end();
  } catch (err) {
    const cancelled = !!err.cancelled || abort.signal.aborted;
    if (!cancelled) console.error('[photo-edit] Edit failed:', err.message);

    if (editId) {
      // Best effort: a failed status update must not mask the real error.
      await supabase
        .from('photo_edits')
        .update({
          status: cancelled ? 'cancelled' : 'failed',
          error_message: err.message?.slice(0, 500) || null,
          duration_ms: Date.now() - startedAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', editId)
        .then(({ error }) => {
          if (error) console.error('[photo-edit] Could not record failure:', error.message);
        });
    }

    send('error', { message: err.message || 'The edit failed' });
    if (!closed) res.end();
  }
});

/**
 * "IMG_4821.jpg" -> "IMG_4821-edited.jpeg"
 *
 * The suffix is what tells a booker which tile is which when the original
 * and the retouch sit next to each other in the grid, and it carries
 * through into the filename inside a delivery ZIP.
 */
function withEditedSuffix(filename, format) {
  const base = (filename || 'photo').replace(/\.[^.]+$/, '');
  return `${base}-edited.${format}`;
}

module.exports = router;
