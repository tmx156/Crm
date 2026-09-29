/**
 * Client photo gallery.
 *
 * Grids are served from the `thumb_url` derivative and lightboxes from
 * `display_url`, so the 4 MB originals are only ever read when a ZIP is
 * actually being built. See services/photoStorage.js for the reasoning.
 *
 * Listing uses keyset (cursor) pagination rather than offset: at a few
 * thousand photos per lead, OFFSET makes Postgres walk every skipped row,
 * while a keyset seek stays flat.
 */

const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { auth } = require('../middleware/auth');
const config = require('../config');
const photoStorage = require('../services/photoStorage');
const retouchQueue = require('../services/retouchQueue');

const router = express.Router();

const supabase = createClient(config.supabase.url, config.supabase.serverKey);

// 'viewer' is a read-only role in this CRM, so it can browse but not change
// anything. Widen this list if studio staff get their own role later.
const CAN_EDIT_ROLES = ['admin', 'booker'];
const canEdit = (user) => CAN_EDIT_ROLES.includes(user?.role);

const VALID_FOLDERS = ['headshots', 'zcard', 'best-pics'];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Files are held in memory because sharp and the storage upload both want a
// buffer; nothing is ever written to local disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: photoStorage.MAX_UPLOAD_BYTES,
    files: 50
  },
  fileFilter: (req, file, cb) => {
    if (photoStorage.ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`${file.originalname}: unsupported file type (${file.mimetype})`));
  }
});

// Columns the gallery needs. Selecting explicitly keeps the storage keys and
// other internals off the wire and cuts the payload substantially.
// display_size is included so the send dialog can predict whether a ZIP will
// be attached or linked before the user commits to sending it.
// The edit_* columns let the grid mark AI retouches and tell the booker which
// tile is the original. Keep in step with PHOTO_FIELDS in routes/photo-edit.js.
const LIST_FIELDS = [
  'id', 'lead_id', 'url', 'thumb_url', 'display_url', 'filename',
  'file_size', 'display_size', 'width', 'height', 'folder', 'description',
  'is_primary', 'created_at', 'edited_from', 'edit_prompt', 'edit_model',
  'is_ai_edited'
].join(', ');

/** Encode/decode the keyset cursor as an opaque token. */
const encodeCursor = (row) =>
  Buffer.from(`${row.created_at}|${row.id}`).toString('base64url');

const decodeCursor = (cursor) => {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
};

const normaliseFolder = (value) => {
  if (!value || value === 'all' || value === 'null') return null;
  return VALID_FOLDERS.includes(value) ? value : undefined; // undefined = invalid
};

/**
 * The gallery shows exactly two folders, and neither is stored: a photo is
 * "retouched" if the AI produced it and "original" otherwise. Deriving them
 * from is_ai_edited means a retouch lands in the right place the moment it is
 * saved, with nothing to keep in sync. The old folder column (headshots,
 * z-card, best pics) is left in the table but no longer surfaced.
 */
const VIEWS = ['all', 'original', 'retouched'];

const applyView = (query, view) => {
  if (view === 'retouched') return query.eq('is_ai_edited', true);
  // NOT (is true) rather than = false, so rows written before the column
  // existed - where it may be null - still count as originals.
  if (view === 'original') return query.not('is_ai_edited', 'is', true);
  return query;
};

/**
 * GET /api/photos
 * Query: leadId (required), folder (all | original | retouched), limit, cursor
 */
router.get('/', auth, async (req, res) => {
  try {
    const { leadId, folder = 'all', cursor } = req.query;

    if (!leadId) {
      return res.status(400).json({ success: false, message: 'leadId is required' });
    }

    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE
    );

    let query = supabase
      .from('photos')
      .select(LIST_FIELDS)
      .eq('lead_id', leadId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1); // one extra row tells us whether more exist

    if (!VIEWS.includes(folder)) {
      return res.status(400).json({ success: false, message: `Unknown folder: ${folder}` });
    }
    query = applyView(query, folder);

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        return res.status(400).json({ success: false, message: 'Invalid cursor' });
      }
      // Strict keyset seek, with the id as tiebreaker for identical timestamps
      // (bulk uploads land in the same millisecond routinely).
      query = query.or(
        `created_at.lt.${decoded.createdAt},` +
        `and(created_at.eq.${decoded.createdAt},id.lt.${decoded.id})`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const hasMore = data.length > limit;
    const photos = hasMore ? data.slice(0, limit) : data;

    res.json({
      success: true,
      photos,
      hasMore,
      nextCursor: hasMore ? encodeCursor(photos[photos.length - 1]) : null
    });
  } catch (error) {
    console.error('[photos] List failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/photos/count?leadId=...
 * Totals for the two folders, so the sidebar can show counts without
 * fetching rows.
 */
router.get('/count', auth, async (req, res) => {
  try {
    const { leadId } = req.query;
    if (!leadId) {
      return res.status(400).json({ success: false, message: 'leadId is required' });
    }

    const { data, error } = await supabase
      .from('photos')
      .select('is_ai_edited')
      .eq('lead_id', leadId)
      .is('deleted_at', null);

    if (error) throw error;

    const retouched = data.filter(row => row.is_ai_edited === true).length;
    const counts = { all: data.length, original: data.length - retouched, retouched };

    res.json({ success: true, counts });
  } catch (error) {
    console.error('[photos] Count failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/photos/upload
 * Multipart: photos[] (up to 50), leadId, folder
 *
 * Files are processed one at a time rather than in parallel: sharp is CPU
 * bound, and 50 concurrent resizes would starve the event loop and stall
 * every other request on the server.
 */
router.post('/upload', auth, upload.array('photos', 50), async (req, res) => {
  try {
    if (!canEdit(req.user)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to upload photos' });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ success: false, message: 'No files provided' });
    }

    const { leadId } = req.body;
    if (!leadId) {
      return res.status(400).json({ success: false, message: 'leadId is required' });
    }

    const folder = normaliseFolder(req.body.folder);
    if (folder === undefined) {
      return res.status(400).json({ success: false, message: `Unknown folder: ${req.body.folder}` });
    }

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id')
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // Callers can opt a drop out of auto-retouch (the toggle in the upload
    // panel). Anything else follows the server default.
    const autoRetouch = req.body.autoRetouch !== 'false' && retouchQueue.isEnabled();

    const uploaded = [];
    const failed = [];
    let queued = 0;

    for (const file of files) {
      try {
        const row = await photoStorage.processAndUpload({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          leadId,
          uploadedBy: req.user.id,
          folder
        });

        const { data: inserted, error: insertError } = await supabase
          .from('photos')
          .insert(row)
          .select(LIST_FIELDS)
          .single();

        if (insertError) throw insertError;
        uploaded.push(inserted);

        // Fire and forget. The retouch runs in the background and lands as a
        // separate photo, so the upload must not wait for it or fail with it -
        // a 50-file drop would otherwise hold this request open for half an
        // hour.
        if (autoRetouch && retouchQueue.enqueue(inserted, req.user.id)) queued += 1;
      } catch (err) {
        console.error(`[photos] Upload failed for ${file.originalname}:`, err.message);
        failed.push({ filename: file.originalname, error: err.message });
      }
    }

    res.status(uploaded.length ? 201 : 500).json({
      success: uploaded.length > 0,
      uploaded,
      failed,
      queuedForRetouch: queued,
      retouch: retouchQueue.stats(),
      message: `${uploaded.length} uploaded, ${failed.length} failed` +
               (queued ? `, ${queued} queued for retouch` : '')
    });
  } catch (error) {
    console.error('[photos] Upload handler failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PATCH /api/photos/:id
 * Move a photo between folders or edit its description.
 */
router.patch('/:id', auth, async (req, res) => {
  try {
    if (!canEdit(req.user)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to edit photos' });
    }

    const updates = { updated_at: new Date().toISOString() };

    if ('folder' in req.body) {
      const folder = normaliseFolder(req.body.folder);
      if (folder === undefined) {
        return res.status(400).json({ success: false, message: `Unknown folder: ${req.body.folder}` });
      }
      updates.folder = folder;
    }
    if ('description' in req.body) updates.description = req.body.description || null;
    if ('isPrimary' in req.body) updates.is_primary = !!req.body.isPrimary;

    const { data, error } = await supabase
      .from('photos')
      .update(updates)
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select(LIST_FIELDS)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Photo not found' });

    res.json({ success: true, photo: data });
  } catch (error) {
    console.error('[photos] Update failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/photos/:id
 *
 * The row is soft-deleted first and the objects removed after. If the object
 * delete fails the photo has still disappeared from the UI, and the orphaned
 * bytes can be swept later - the reverse order could leave a row pointing at
 * a 404.
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!canEdit(req.user)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to delete photos' });
    }

    const { data: photo, error: fetchError } = await supabase
      .from('photos')
      .select('id, storage_key, thumb_key, display_key')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .single();

    if (fetchError || !photo) {
      return res.status(404).json({ success: false, message: 'Photo not found' });
    }

    const { error: updateError } = await supabase
      .from('photos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', photo.id);

    if (updateError) throw updateError;

    await photoStorage.removePhotoObjects(photo);

    res.json({ success: true, message: 'Photo deleted' });
  } catch (error) {
    console.error('[photos] Delete failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Multer rejects (file too large, too many files, bad type) arrive here as
// errors rather than as a normal response, so translate them into 400s.
router.use((err, req, res, next) => {
  if (!err) return next();
  const status = err instanceof multer.MulterError || /unsupported file type/i.test(err.message)
    ? 400
    : 500;
  console.error('[photos] Request rejected:', err.message);
  res.status(status).json({ success: false, message: err.message });
});

module.exports = router;
