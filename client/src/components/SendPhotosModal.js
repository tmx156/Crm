import React, { useState, useMemo } from 'react';
import { FiX, FiSend, FiLoader, FiLink } from 'react-icons/fi';
import axios from 'axios';

/**
 * Review and send the selected photos to a client. They receive a branded
 * email with a button into a private gallery (server/routes/gallery.js),
 * which is what lets us tell when they have actually looked.
 */


const formatBytes = (bytes) => {
  if (!bytes) return '0 MB';
  const mb = bytes / 1048576;
  return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`;
};

const SendPhotosModal = ({ leadId, leadName, leadEmail, photos, onClose, onSent }) => {
  const [sizeVariant, setSizeVariant] = useState('original');
  const [recipientEmail, setRecipientEmail] = useState(leadEmail || '');
  const [subject, setSubject] = useState('Your photos from your shoot');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // JPEG barely deflates, so the ZIP lands within a few percent of the sum of
  // its parts - close enough to predict attachment vs link.
  const estimatedBytes = useMemo(() => photos.reduce((total, p) => (
    total + (sizeVariant === 'delivery' ? (p.display_size || 0) : (p.file_size || 0))
  ), 0), [photos, sizeVariant]);


  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      const { data } = await axios.post('/api/photo-delivery/send', {
        leadId,
        photoIds: photos.map(p => p.id),
        sizeVariant,
        subject,
        note,
        recipientEmail
      });
      setResult(data.message);
      // Leave the confirmation up briefly so the sender sees what happened.
      setTimeout(() => onSent?.(), 1800);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">
            Send {photos.length} photo{photos.length === 1 ? '' : 's'}
            {leadName ? ` to ${leadName}` : ''}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            aria-label="Close"
          >
            <FiX className="h-5 w-5" />
          </button>
        </div>

        {result ? (
          <div className="p-8 text-center">
            <div className="h-12 w-12 mx-auto mb-3 rounded-full bg-green-100 flex items-center justify-center">
              <FiSend className="h-6 w-6 text-green-600" />
            </div>
            <p className="text-sm text-gray-800">{result}</p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Thumbnail strip */}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {photos.slice(0, 12).map(p => (
                <img
                  key={p.id}
                  src={p.thumb_url || p.url}
                  alt={p.filename || 'Selected photo'}
                  className="h-14 w-14 flex-shrink-0 object-cover rounded-md border border-gray-200"
                />
              ))}
              {photos.length > 12 && (
                <div className="h-14 w-14 flex-shrink-0 rounded-md bg-gray-100 border border-gray-200
                                flex items-center justify-center text-xs text-gray-500 font-medium">
                  +{photos.length - 12}
                </div>
              )}
            </div>

            {/* Size choice */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Photo size</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSizeVariant('original')}
                  className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                    sizeVariant === 'original'
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="block text-sm font-medium text-gray-900">Full resolution</span>
                  <span className="block text-xs text-gray-500">Print quality, originals</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSizeVariant('delivery')}
                  className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                    sizeVariant === 'delivery'
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="block text-sm font-medium text-gray-900">Web quality</span>
                  <span className="block text-xs text-gray-500">1400px, much smaller</span>
                </button>
              </div>
            </div>

            {/* How it will be delivered */}
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs bg-green-50 text-green-900">
              <FiLink className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                They'll get a branded email with a <strong>View your photos</strong> button that opens a
                private gallery ({formatBytes(estimatedBytes)}). You'll see when they view it and when they download.
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Send to</label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="client@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                           focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                           focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Message <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Add a personal note..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none
                           focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                disabled={sending}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg
                           disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !recipientEmail || !photos.length}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg
                           text-sm font-medium hover:bg-indigo-700 disabled:opacity-50
                           disabled:cursor-not-allowed transition-colors"
              >
                {sending
                  ? <><FiLoader className="h-4 w-4 animate-spin" /> Zipping &amp; sending...</>
                  : <><FiSend className="h-4 w-4" /> Send photos</>}
              </button>
            </div>

            {sending && (
              <p className="text-xs text-gray-400 text-center">
                Large sets can take a minute to zip &mdash; keep this open.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SendPhotosModal;
