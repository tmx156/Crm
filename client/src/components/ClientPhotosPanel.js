import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FiImage, FiUpload, FiTrash2, FiCheck, FiSend, FiLoader, FiZap, FiPlay, FiDownload
} from 'react-icons/fi';
import axios from 'axios';
import SendPhotosModal from './SendPhotosModal';
import PhotoEditModal from './PhotoEditModal';
import PresentationGallery from './PresentationGallery';
import { useSocket } from '../context/SocketContext';

/**
 * Client photo gallery for the appointment modal.
 *
 * Tiles render `thumb_url` (~20 KB) and the presentation gallery renders
 * `display_url` (~300 KB). The 4 MB original is never fetched by the browser
 * - it only leaves storage when a full-resolution ZIP is being built.
 */

// Two folders, both derived from is_ai_edited rather than stored. Ids must
// match VIEWS in server/routes/photos.js.
const PHOTO_FOLDERS = [
  { id: 'retouched', label: 'Retouched' },
  { id: 'original', label: 'Original' }
];

const PAGE_SIZE = 20;

// Files per upload request. Batching keeps any single request small enough to
// finish quickly and means one bad file loses its batch, not the whole drop.
const UPLOAD_BATCH_SIZE = 5;

const EDIT_ROLES = ['admin', 'booker'];

const ClientPhotosPanel = ({ leadId, leadName, leadEmail, user }) => {
  const [photos, setPhotos] = useState([]);
  const [counts, setCounts] = useState({ all: 0, original: 0, retouched: 0 });
  const [folder, setFolder] = useState('original');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [uploadErrors, setUploadErrors] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showSendModal, setShowSendModal] = useState(false);

  // The photo currently open in the AI retouch dialog, and whether the server
  // has an OpenAI key at all - without one the button is hidden rather than
  // offered and then failing.
  const [editPhoto, setEditPhoto] = useState(null);
  const [aiEditEnabled, setAiEditEnabled] = useState(false);

  // Auto-retouch runs in the background after an upload, so the grid has to
  // learn about photos it never asked for. `pendingRetouches` are the ones
  // still queued or running; the Retouched folder draws each as a blurred
  // copy of its original with a progress bar, so the booker can see what is
  // coming and what is being worked on right now.
  const [autoRetouch, setAutoRetouch] = useState(true);
  const [pendingRetouches, setPendingRetouches] = useState([]);
  const [retouchEstimateMs, setRetouchEstimateMs] = useState(45000);
  const [now, setNow] = useState(() => Date.now());
  const pendingFetchTimer = useRef(null);
  const retouching = pendingRetouches.length;
  // Originals with no retouch and nothing in flight - ones that failed (say to
  // an OpenAI rate limit) or were dropped by a restart. Drives "Retouch missing".
  const [missingRetouches, setMissingRetouches] = useState(0);
  const [requeuing, setRequeuing] = useState(false);

  // "Select all" has to reach photos beyond the page loaded in the grid
  const [selectingAll, setSelectingAll] = useState(false);

  // The fullscreen presentation gallery, and which photo to open it on.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryStartId, setGalleryStartId] = useState(null);
  // Photos handed to the send dialog from the gallery, which selects across
  // both folders rather than just the page loaded in the grid.
  const [sendPhotos, setSendPhotos] = useState(null);

  const fileInputRef = useRef(null);
  // Guards against a slow response for a previous lead landing after the user
  // has already clicked through to a different appointment.
  const activeLeadRef = useRef(leadId);

  const { socket } = useSocket();

  const canEdit = EDIT_ROLES.includes(user?.role);

  const loadCounts = useCallback(async () => {
    if (!leadId) return;
    try {
      const { data } = await axios.get('/api/photos/count', { params: { leadId } });
      if (activeLeadRef.current !== leadId) return null;
      if (data?.success) {
        setCounts(data.counts);
        return data.counts;
      }
    } catch (err) {
      // A failed count is cosmetic - the grid still works.
      console.warn('Photo count failed:', err.message);
    }
    return null;
  }, [leadId]);

  const loadPhotos = useCallback(async (targetFolder) => {
    if (!leadId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get('/api/photos', {
        params: { leadId, folder: targetFolder, limit: PAGE_SIZE }
      });
      if (activeLeadRef.current !== leadId) return;
      setPhotos(data.photos || []);
      setHasMore(!!data.hasMore);
      setNextCursor(data.nextCursor || null);
    } catch (err) {
      if (activeLeadRef.current !== leadId) return;
      setError(err.response?.data?.message || 'Could not load photos');
      setPhotos([]);
    } finally {
      if (activeLeadRef.current === leadId) setLoading(false);
    }
  }, [leadId]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data } = await axios.get('/api/photos', {
        params: { leadId, folder, limit: PAGE_SIZE, cursor: nextCursor }
      });
      if (activeLeadRef.current !== leadId) return;
      setPhotos(prev => [...prev, ...(data.photos || [])]);
      setHasMore(!!data.hasMore);
      setNextCursor(data.nextCursor || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load more photos');
    } finally {
      setLoadingMore(false);
    }
  };

  // Reset everything when the modal switches to a different lead, otherwise
  // one client's photos flash up under another's name.
  useEffect(() => {
    activeLeadRef.current = leadId;
    setPhotos([]);
    setSelectedIds(new Set());
    setSelecting(false);
    setNextCursor(null);
    setHasMore(false);
    setShowUpload(false);
    setUploadErrors([]);
    setPendingRetouches([]);
    setMissingRetouches(0);
    setGalleryOpen(false);
    if (!leadId) return;

    // Open on Retouched when there is anything retouched - that is what gets
    // shown and sent to a client - and on Original otherwise.
    (async () => {
      const c = await loadCounts();
      if (activeLeadRef.current !== leadId) return;
      const start = c?.retouched > 0 ? 'retouched' : 'original';
      setFolder(start);
      loadPhotos(start);
    })();
  }, [leadId, loadPhotos, loadCounts]);

  // Asked once per mount, not per lead - the answer is a server config flag.
  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    axios.get('/api/photo-edit/presets')
      .then(({ data }) => { if (!cancelled) setAiEditEnabled(!!data?.configured); })
      .catch(() => { /* Treat any failure as "not available" and hide the button. */ });
    return () => { cancelled = true; };
  }, [canEdit]);

  const loadPending = useCallback(async () => {
    if (!leadId || !canEdit) return;
    // Fetched together: anything that changes what is in flight also changes
    // what is missing, so one refresh keeps both honest.
    const [pending, missing] = await Promise.allSettled([
      axios.get('/api/photo-edit/pending', { params: { leadId } }),
      axios.get('/api/photo-edit/missing', { params: { leadId } })
    ]);
    if (activeLeadRef.current !== leadId) return;
    // Either can fail on its own; both are niceties and the retouches still arrive.
    if (pending.status === 'fulfilled') {
      setPendingRetouches(pending.value.data?.pending || []);
      if (pending.value.data?.estimateMs) setRetouchEstimateMs(pending.value.data.estimateMs);
    }
    if (missing.status === 'fulfilled') setMissingRetouches(missing.value.data?.missing || 0);
  }, [leadId, canEdit]);

  const retouchMissing = async () => {
    setRequeuing(true);
    try {
      await axios.post('/api/photo-edit/retouch-missing', { leadId });
      await loadPending();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not queue the missing retouches');
    } finally {
      setRequeuing(false);
    }
  };

  // A drop of 40 photos fires 40 "queued" events in a burst - refetch once.
  const schedulePendingRefresh = useCallback(() => {
    clearTimeout(pendingFetchTimer.current);
    pendingFetchTimer.current = setTimeout(loadPending, 400);
  }, [loadPending]);

  useEffect(() => {
    loadPending();
    return () => clearTimeout(pendingFetchTimer.current);
  }, [loadPending]);

  // Tick once a second while something is running, to move the progress bars
  const anyRunning = pendingRetouches.some(p => p.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  /**
   * Background retouches arrive as broadcasts, so filter to this lead before
   * touching the grid - two bookers can have different appointments open.
   */
  useEffect(() => {
    if (!socket || !leadId) return;

    const changed = (p) => {
      if (p.leadId !== leadId) return;
      if (p.estimateMs) setRetouchEstimateMs(p.estimateMs);
      schedulePendingRefresh();
    };
    const settled = (p) => {
      if (p.leadId !== leadId) return;
      setPendingRetouches(prev => prev.filter(x => x.photoId !== p.photoId));
      // A failure is now a missing retouch - refresh so the button counts it.
      schedulePendingRefresh();
    };

    const done = (p) => {
      if (p.leadId !== leadId) return;
      if (p.estimateMs) setRetouchEstimateMs(p.estimateMs);
      setPendingRetouches(prev => prev.filter(x => x.photoId !== p.sourcePhotoId));
      // Every retouch belongs in Retouched, so only that view gains a tile.
      setPhotos(prev => {
        if (folder !== 'retouched' || prev.some(x => x.id === p.photo.id)) return prev;
        return [p.photo, ...prev];
      });
      loadCounts();
    };

    socket.on('photo_retouch_queued', changed);
    socket.on('photo_retouch_started', changed);
    socket.on('photo_retouch_done', done);
    socket.on('photo_retouch_failed', settled);

    return () => {
      socket.off('photo_retouch_queued', changed);
      socket.off('photo_retouch_started', changed);
      socket.off('photo_retouch_done', done);
      socket.off('photo_retouch_failed', settled);
    };
  }, [socket, leadId, folder, loadCounts, schedulePendingRefresh]);

  const changeFolder = (next) => {
    setFolder(next);
    setNextCursor(null);
    loadPhotos(next);
  };

  /**
   * A retouch is saved server-side as a new photo, so it belongs at the top of
   * the grid. It is inserted directly rather than by refetching so the booker
   * does not lose their scroll position or the page of photos already loaded.
   */
  const handleEditSaved = (saved) => {
    setPhotos(prev => {
      // A retouch only belongs in the Retouched view.
      if (folder !== 'retouched' || prev.some(p => p.id === saved.id)) return prev;
      return [saved, ...prev];
    });
    loadCounts();
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;

    setUploading(true);
    setUploadErrors([]);
    setUploadProgress({ done: 0, total: files.length });

    const failures = [];
    let done = 0;

    for (let i = 0; i < files.length; i += UPLOAD_BATCH_SIZE) {
      const batch = files.slice(i, i + UPLOAD_BATCH_SIZE);
      const form = new FormData();
      batch.forEach(file => form.append('photos', file));
      form.append('leadId', leadId);
      // Only sent when opting out; the server default is on.
      if (!autoRetouch) form.append('autoRetouch', 'false');

      try {
        const { data } = await axios.post('/api/photos/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        (data.failed || []).forEach(f => failures.push(`${f.filename}: ${f.error}`));
      } catch (err) {
        batch.forEach(f => failures.push(
          `${f.name}: ${err.response?.data?.message || err.message}`
        ));
      }

      done += batch.length;
      setUploadProgress({ done, total: files.length });
    }

    setUploading(false);
    setUploadErrors(failures);
    if (failures.length < files.length) {
      setShowUpload(false);
      // With auto-retouch on, jump to Retouched so the booker watches the
      // blurred placeholders fill in; otherwise show the new originals.
      const target = aiEditEnabled && autoRetouch ? 'retouched' : 'original';
      setFolder(target);
      await loadPhotos(target);
      await loadCounts();
      loadPending();
    }
  };

  /**
   * @returns {Promise<boolean>} whether the photo was actually deleted, so the
   *   gallery does not drop a thumbnail the booker changed their mind about.
   */
  const handleDelete = async (photoId, event) => {
    event?.stopPropagation();
    if (!window.confirm('Delete this photo? This cannot be undone.')) return false;

    try {
      await axios.delete(`/api/photos/${photoId}`);
      setPhotos(prev => prev.filter(p => p.id !== photoId));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
      loadCounts();
      return true;
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not delete photo');
      return false;
    }
  };

  // Delete everything selected (with "Select all", the whole folder) in one request
  const [deletingSelected, setDeletingSelected] = useState(false);
  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length || deletingSelected) return;
    if (!window.confirm(`Delete ${ids.length} photo${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setDeletingSelected(true);
    try {
      await axios.post('/api/photos/delete-batch', { leadId, photoIds: ids });
      const gone = new Set(ids);
      setPhotos(prev => prev.filter(p => !gone.has(p.id)));
      setSelectedIds(new Set());
      loadCounts();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Could not delete the photos');
    } finally {
      setDeletingSelected(false);
    }
  };

  const toggleSelect = (photoId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  /**
   * Select every photo in the folder, not just the page in the grid. Pulls
   * the remaining pages first (100 at a time, the API's max) so the send
   * dialog has the full photo rows it needs for thumbnails and sizes.
   */
  const selectAllInFolder = async () => {
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      let all = photos;
      let cursor = nextCursor;
      let more = hasMore;
      while (more && cursor) {
        const { data } = await axios.get('/api/photos', {
          params: { leadId, folder, limit: 100, cursor }
        });
        if (activeLeadRef.current !== leadId) return;
        const seen = new Set(all.map(p => p.id));
        all = [...all, ...(data.photos || []).filter(p => !seen.has(p.id))];
        more = !!data.hasMore;
        cursor = data.nextCursor || null;
      }
      setPhotos(all);
      setHasMore(more);
      setNextCursor(cursor);
      setSelectedIds(new Set(all.map(p => p.id)));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load every photo to select');
    } finally {
      setSelectingAll(false);
    }
  };

  const openGallery = (startPhotoId = null) => {
    setGalleryStartId(startPhotoId);
    setGalleryOpen(true);
  };

  const onTileClick = (photo) => {
    if (selecting) toggleSelect(photo.id);
    else openGallery(photo.id);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (canEdit) handleFiles(e.dataTransfer.files);
  };

  const selectedPhotos = photos.filter(p => selectedIds.has(p.id));

  /**
   * Download the selected photos as one ZIP of the full-size files.
   *
   * One ZIP rather than a file per photo: Chrome lets the first of several
   * automatic downloads through and silently blocks the rest. The server
   * streams the ZIP (/api/photos/zip-link), so a big selection never sits in
   * memory on either end.
   */
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  const downloadSelected = async () => {
    const list = selectedPhotos.filter(p => p.url);
    if (!list.length) return;
    setDownloadError(null);
    setDownloadProgress(true);
    try {
      const { data } = await axios.post('/api/photos/zip-link', { leadId, photoIds: list.map(p => p.id) });
      // A navigation, so the ZIP streams to disk instead of into memory. The
      // API may be on another origin in development, hence the base URL.
      window.location.href = `${axios.defaults.baseURL || ''}${data.url}`;
    } catch (err) {
      setDownloadError(err.response?.data?.message || err.message || 'Download failed');
    } finally {
      setTimeout(() => setDownloadProgress(null), 1500);
    }
  };

  return (
    <div className="mt-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 mb-3">
        <h4 className="text-sm font-semibold text-gray-700 flex flex-wrap items-center gap-y-1">
          <FiImage className="mr-2 h-4 w-4 text-indigo-600" />
          Client Photos
          {counts.all > 0 && (
            <span className="ml-2 text-indigo-600 font-bold">{counts.all}</span>
          )}
          {retouching > 0 && (
            <span
              title="Retouches are running in the background - they appear here as they finish"
              className="ml-2 flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700
                         rounded-full text-[10px] font-medium"
            >
              <FiLoader className="h-2.5 w-2.5 animate-spin" />
              retouching {retouching}
            </span>
          )}
          {/* Originals with no retouch and nothing in flight: failed (usually
              an OpenAI rate limit) or dropped by a restart. One click re-queues
              them all. Hidden while anything is still running, so a drop that
              is mid-way through does not look like it has failed. */}
          {canEdit && aiEditEnabled && missingRetouches > 0 && retouching === 0 && (
            <button
              onClick={retouchMissing}
              disabled={requeuing}
              title="These photos have no retouch yet. Queue them again."
              className="ml-2 flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-800
                         border border-amber-200 rounded-full text-[10px] font-medium
                         hover:bg-amber-100 disabled:opacity-50 transition-colors"
            >
              {requeuing
                ? <FiLoader className="h-2.5 w-2.5 animate-spin" />
                : <FiZap className="h-2.5 w-2.5" />}
              Retouch {missingRetouches} missing
            </button>
          )}
        </h4>

        <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
          {counts.all > 0 && (
            <button
              onClick={() => openGallery(null)}
              title="Fullscreen slideshow for showing the client"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         bg-gray-900 text-white hover:bg-gray-700 transition-colors"
            >
              <FiPlay className="h-3.5 w-3.5" />
              Present
            </button>
          )}
          {counts.all > 0 && canEdit && (
            <button
              onClick={() => {
                setSelecting(s => !s);
                setSelectedIds(new Set());
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selecting
                  ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
              }`}
            >
              {selecting ? 'Cancel' : 'Select'}
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setShowUpload(s => !s)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-indigo-600 hover:text-indigo-800
                         hover:bg-indigo-50 rounded-lg text-sm font-medium transition-colors"
            >
              <FiUpload className="h-4 w-4" />
              Upload
            </button>
          )}
        </div>
      </div>

      {/* Selection action bar */}
      {selecting && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-3 py-2 bg-indigo-50
                        border border-indigo-200 rounded-lg">
          <span className="text-sm text-indigo-900">
            {selectedIds.size} selected
            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                className="ml-3 text-xs text-indigo-600 hover:underline"
              >
                Clear
              </button>
            )}
            <button
              onClick={selectAllInFolder}
              disabled={selectingAll}
              className="ml-3 text-xs text-indigo-600 hover:underline disabled:opacity-60 disabled:no-underline"
            >
              {selectingAll ? (
                <span className="inline-flex items-center gap-1">
                  <FiLoader className="h-3 w-3 animate-spin" /> Selecting all...
                </span>
              ) : (
                `Select all (${Math.max(counts[folder] || 0, photos.length)})`
              )}
            </button>
          </span>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <button
              onClick={downloadSelected}
              disabled={selectedIds.size === 0 || !!downloadProgress}
              title="Download the full-size photos as one ZIP file"
              className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 bg-white text-indigo-700 border border-indigo-300
                         rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-40
                         disabled:cursor-not-allowed transition-colors"
            >
              {downloadProgress
                ? <><FiLoader className="h-4 w-4 animate-spin" /> Preparing ZIP...</>
                : <><FiDownload className="h-4 w-4" /> Download {selectedIds.size || ''}</>}
            </button>
            <button
              onClick={() => setShowSendModal(true)}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white rounded-lg
                         text-sm font-medium hover:bg-indigo-700 disabled:opacity-40
                         disabled:cursor-not-allowed transition-colors"
            >
              <FiSend className="h-4 w-4" />
              Send {selectedIds.size || ''}
            </button>
            <button
              onClick={deleteSelected}
              disabled={selectedIds.size === 0 || deletingSelected}
              title="Delete the selected photos"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 border border-red-300 rounded-lg
                         text-sm font-medium hover:bg-red-50 disabled:opacity-40
                         disabled:cursor-not-allowed transition-colors"
            >
              {deletingSelected
                ? <FiLoader className="h-4 w-4 animate-spin" />
                : <FiTrash2 className="h-4 w-4" />}
              <span className="hidden sm:inline">Delete</span> {selectedIds.size || ''}
            </button>
          </div>
        </div>
      )}
      {selecting && downloadError && (
        <p className="-mt-2 mb-3 px-3 text-xs text-red-600">{downloadError}</p>
      )}

      {/* Upload panel */}
      {showUpload && canEdit && (
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <span className="text-xs text-gray-500">
              Uploads go to <span className="font-medium text-gray-700">Original</span>
              {aiEditEnabled && autoRetouch && (
                <> &middot; their retouches appear in <span className="font-medium text-gray-700">Retouched</span></>
              )}
            </span>

            {/* Each retouch is a paid API call, so this is a visible switch
                rather than something that silently happens to every drop. */}
            {aiEditEnabled && (
              <label
                className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"
                title="Every uploaded photo also gets a magazine-finish retouch, saved alongside the original"
              >
                <input
                  type="checkbox"
                  checked={autoRetouch}
                  onChange={(e) => setAutoRetouch(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <FiZap className="h-3 w-3 text-indigo-600" />
                Auto-retouch on upload
              </label>
            )}
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50'
            }`}
          >
            {uploading ? (
              <div>
                <FiLoader className="h-7 w-7 mx-auto text-indigo-500 mb-2 animate-spin" />
                <p className="text-sm text-gray-700 mb-2">
                  Uploading {uploadProgress.done} of {uploadProgress.total}...
                </p>
                <div className="w-full max-w-xs mx-auto bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${uploadProgress.total
                        ? (uploadProgress.done / uploadProgress.total) * 100
                        : 0}%`
                    }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">Please keep this window open</p>
              </div>
            ) : (
              <>
                <FiUpload className="h-7 w-7 mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-600 mb-1">Drag &amp; drop photos here</p>
                <p className="text-xs text-gray-500 mb-3">JPEG, PNG, WebP or HEIC &middot; up to 45 MB each</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  multiple
                  accept="image/*"
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium
                             hover:bg-indigo-700 transition-colors"
                >
                  Select Photos
                </button>
              </>
            )}
          </div>

          {uploadErrors.length > 0 && (
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs font-medium text-red-800 mb-1">
                {uploadErrors.length} file{uploadErrors.length === 1 ? '' : 's'} failed:
              </p>
              <ul className="text-xs text-red-700 space-y-0.5 max-h-24 overflow-y-auto">
                {uploadErrors.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="bg-gray-50 rounded-lg p-6 text-center">
          <div className="animate-spin h-6 w-6 border-2 border-indigo-500 border-t-transparent
                          rounded-full mx-auto mb-2" />
          <p className="text-gray-500 text-sm">Loading photos...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => loadPhotos(folder)}
            className="mt-2 text-xs text-red-800 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      ) : counts.all > 0 || photos.length > 0 ? (
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          {/* Folders: a row of tabs on a phone (a 96px sidebar left the
              grid ~220px wide), a sidebar from sm up */}
          <div className="flex sm:flex-col gap-1 sm:w-24 flex-shrink-0">
            {PHOTO_FOLDERS.map(f => (
              <button
                key={f.id}
                onClick={() => changeFolder(f.id)}
                className={`flex-1 sm:flex-none sm:w-full px-2 py-1.5 rounded-lg text-xs font-medium transition-all text-left ${
                  folder === f.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>{f.label}</span>
                <span className={`ml-1.5 sm:ml-0 sm:block text-[10px] ${
                  folder === f.id ? 'text-indigo-200' : 'text-gray-400'
                }`}>
                  {counts[f.id] || 0}
                </span>
              </button>
            ))}
          </div>

          {/* Tiles */}
          <div className="flex-1 min-w-0">
            {photos.length > 0 || (folder === 'retouched' && pendingRetouches.length > 0) ? (
              <>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {/* Retouches still on the way: a blurred copy of the
                      original, with an estimated progress bar once it starts */}
                  {folder === 'retouched' && pendingRetouches.map(p => {
                    const isRunning = p.status === 'running';
                    const elapsed = isRunning && p.startedAt ? now - new Date(p.startedAt).getTime() : 0;
                    // Eases towards 95% and holds there - never claims done early
                    const pct = isRunning
                      ? Math.min(95, Math.round(95 * (1 - Math.exp(-elapsed / (retouchEstimateMs * 0.6)))))
                      : 0;
                    return (
                      <div
                        key={`pending-${p.photoId}`}
                        style={{ aspectRatio: '1' }}
                        title={isRunning ? 'Retouching now...' : 'Waiting to be retouched'}
                        className="relative rounded-lg overflow-hidden bg-gray-200 border-2 border-dashed border-indigo-300"
                      >
                        {p.thumbUrl && (
                          <img
                            src={p.thumbUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            style={{ filter: `blur(${isRunning ? 6 : 10}px) grayscale(${isRunning ? 0.2 : 0.6})`, transform: 'scale(1.15)' }}
                          />
                        )}
                        <div className="absolute inset-0 bg-white/30" />
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2">
                          {isRunning
                            ? <FiZap className="h-4 w-4 text-indigo-700 animate-pulse" />
                            : <FiLoader className="h-4 w-4 text-gray-600" />}
                          <span className="text-[10px] font-semibold text-gray-800 bg-white/80 px-1.5 py-0.5 rounded">
                            {isRunning ? `Retouching ${pct}%` : `Queued${p.position ? ` #${p.position}` : ''}`}
                          </span>
                        </div>
                        <div className="absolute left-1.5 right-1.5 bottom-1.5 h-1.5 bg-white/70 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                              isRunning ? 'bg-indigo-600' : 'bg-gray-400'
                            }`}
                            style={{ width: isRunning ? `${pct}%` : '0%' }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {photos.map(photo => {
                    const isSelected = selectedIds.has(photo.id);
                    return (
                      <div
                        key={photo.id}
                        onClick={() => onTileClick(photo)}
                        style={{ aspectRatio: '1' }}
                        className={`relative group cursor-pointer rounded-lg overflow-hidden
                                    bg-gray-100 border-2 transition-all ${
                          isSelected
                            ? 'border-indigo-600 ring-2 ring-indigo-300'
                            : 'border-gray-200 hover:border-indigo-400'
                        }`}
                      >
                        <img
                          src={photo.thumb_url || photo.url}
                          alt={photo.description || photo.filename || 'Client photo'}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                          onError={(e) => { e.currentTarget.style.opacity = '0.3'; }}
                        />

                        {selecting && (
                          <div className={`absolute top-1 left-1 h-5 w-5 rounded-full border-2
                                           flex items-center justify-center transition-colors ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-600'
                              : 'bg-white/80 border-white'
                          }`}>
                            {isSelected && <FiCheck className="h-3 w-3 text-white" />}
                          </div>
                        )}

                        {!selecting && (
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25
                                          transition-colors pointer-events-none" />
                        )}

                        {/* Marks a retouch so the original and the edit are
                            never confused in a grid of near-identical tiles. */}
                        {photo.is_ai_edited && (
                          <span
                            className="absolute bottom-1 left-1 flex items-center gap-0.5 px-1.5 py-0.5
                                       bg-indigo-600/90 text-white text-[9px] font-bold rounded
                                       pointer-events-none"
                          >
                            <FiZap className="h-2.5 w-2.5" />
                            Retouched
                          </span>
                        )}

                        {canEdit && !selecting && (
                          <div className="absolute top-1 right-1 flex gap-1 sm:opacity-0
                                          sm:group-hover:opacity-100 transition-opacity z-10">
                            {aiEditEnabled && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditPhoto(photo); }}
                                title="AI retouch"
                                className="p-1.5 bg-indigo-600 text-white rounded-full
                                           hover:bg-indigo-700 shadow-lg"
                              >
                                <FiZap className="h-3 w-3" />
                              </button>
                            )}
                            <button
                              onClick={(e) => handleDelete(photo.id, e)}
                              title="Delete photo"
                              className="p-1.5 bg-red-500 text-white rounded-full
                                         hover:bg-red-600 shadow-lg"
                            >
                              <FiTrash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {hasMore && (
                  <div className="mt-3 text-center">
                    <button
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg text-sm font-medium
                                 hover:bg-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed
                                 transition-colors"
                    >
                      {loadingMore ? (
                        <>
                          <span className="animate-spin h-4 w-4 border-2 border-indigo-500
                                           border-t-transparent rounded-full inline-block mr-2 align-middle" />
                          Loading...
                        </>
                      ) : (
                        `Load More Photos (${photos.length} loaded)`
                      )}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-gray-100 rounded-lg p-6 text-center">
                <FiImage className="h-6 w-6 mx-auto text-gray-300 mb-2" />
                <p className="text-gray-500 text-sm">
                  {folder === 'retouched'
                    ? (retouching > 0 ? 'Retouches on the way...' : 'No retouched photos yet')
                    : 'No original photos'}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-6 text-center">
          <FiImage className="h-6 w-6 mx-auto text-gray-300 mb-2" />
          <p className="text-gray-500 text-sm">No photos uploaded yet</p>
          {canEdit && (
            <button
              onClick={() => setShowUpload(true)}
              className="mt-2 text-xs text-indigo-600 hover:underline"
            >
              Upload the first one
            </button>
          )}
        </div>
      )}

      <PresentationGallery
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        photos={photos}
        leadId={leadId}
        leadName={leadName || 'Client'}
        initialPhotoId={galleryStartId}
        onSendSelected={canEdit ? (picked) => {
          // Close the slideshow first: the send dialog sits beneath it.
          setGalleryOpen(false);
          setSendPhotos(picked);
          setShowSendModal(true);
        } : null}
        onDeletePhoto={canEdit ? handleDelete : null}
      />

      {editPhoto && (
        <PhotoEditModal
          photo={editPhoto}
          leadName={leadName}
          onClose={() => setEditPhoto(null)}
          onSaved={handleEditSaved}
        />
      )}

      {showSendModal && (
        <SendPhotosModal
          leadId={leadId}
          leadName={leadName}
          leadEmail={leadEmail}
          photos={sendPhotos || selectedPhotos}
          onClose={() => {
            setShowSendModal(false);
            setSendPhotos(null);
          }}
          onSent={() => {
            setShowSendModal(false);
            setSendPhotos(null);
            setSelecting(false);
            setSelectedIds(new Set());
          }}
        />
      )}
    </div>
  );
};

export default ClientPhotosPanel;
