/**
 * Stream a set of photos to the client as a ZIP, built as it downloads.
 *
 * WHY NOT BUILD IT AT SEND TIME
 * -----------------------------
 * The ZIP used to be built in memory when the email was sent and parked in
 * storage for "Download all". The bucket caps a single file at 45 MB, so any
 * send of more than about fourteen full-size originals failed outright with a
 * 413 and the client got nothing. It also meant every send waited while the
 * whole ZIP was built, held two copies of it in memory, and stored a duplicate
 * of every photo.
 *
 * Built on request instead, there is no size ceiling, the send is instant,
 * nothing is duplicated, and memory stays at roughly one photo: each file is
 * fetched only after the previous one has been written into the archive.
 *
 * Store-only (level 0): JPEG is already compressed, so deflate gains well
 * under 1% for real CPU. The ZIP is simply the photos, back to back.
 */

const archiver = require('archiver');
const photoStorage = require('./photoStorage');

/** "IMG_1.jpg" twice must not collapse into one entry. */
function uniqueNamer() {
  const used = new Map();
  return (filename) => {
    const name = filename || 'photo.jpg';
    if (!used.has(name)) {
      used.set(name, 1);
      return name;
    }
    const next = used.get(name) + 1;
    used.set(name, next);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)}_${next}${name.slice(dot)}` : `${name}_${next}`;
  };
}

/**
 * @param {object}  res          Express response - headers are set here
 * @param {Array}   photos       rows with filename, storage_key, display_key
 * @param {string}  sizeVariant  'original' | 'delivery' (1400px copies)
 * @param {string}  zipFilename  what the browser saves it as
 * @returns {Promise<{ files: number, missing: number, aborted: boolean }>}
 */
async function streamPhotosAsZip(res, photos, sizeVariant, zipFilename) {
  const archive = archiver('zip', { store: true });
  const nameFor = uniqueNamer();
  let aborted = false;
  let files = 0;
  const missing = [];

  // The client closing the tab mid-download must stop the storage fetches,
  // not leave them running to feed a socket nobody is reading.
  res.on('close', () => {
    if (!res.writableFinished) {
      aborted = true;
      archive.abort();
    }
  });

  archive.on('warning', (err) => console.warn('[zip] warning:', err.message));

  res.status(200);
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${zipFilename.replace(/"/g, '')}"`,
    'Cache-Control': 'no-store'
  });
  archive.pipe(res);

  for (const photo of photos) {
    if (aborted) break;

    const key = sizeVariant === 'delivery'
      ? (photo.display_key || photo.storage_key)
      : photo.storage_key;

    let buffer;
    try {
      buffer = await photoStorage.downloadObject(key);
    } catch (err) {
      // One unreadable file should not cost the client the rest: skip it
      // and say so inside the ZIP rather than truncating the download.
      console.error(`[zip] Skipping ${photo.filename}: ${err.message}`);
      missing.push(photo.filename || key);
      continue;
    }
    if (aborted) break;

    // Wait for this entry to be fully written before fetching the next, so
    // only one photo is ever held in memory.
    const written = new Promise((resolve, reject) => {
      const onEntry = () => { archive.off('error', onError); resolve(); };
      const onError = (e) => { archive.off('entry', onEntry); reject(e); };
      archive.once('entry', onEntry);
      archive.once('error', onError);
    });
    archive.append(buffer, { name: nameFor(photo.filename) });
    buffer = null;
    await written;
    files += 1;
  }

  if (!aborted) {
    if (missing.length) {
      archive.append(
        'These photos could not be included - please ask us to resend them:\r\n' +
        missing.map(n => ` - ${n}`).join('\r\n') + '\r\n',
        { name: 'MISSING_PHOTOS.txt' }
      );
    }
    await archive.finalize();
  }

  return { files, missing: missing.length, aborted };
}

module.exports = { streamPhotosAsZip };
