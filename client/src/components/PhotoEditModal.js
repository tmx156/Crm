import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FiX, FiZap, FiLoader, FiCheck, FiRotateCcw, FiAlertCircle } from 'react-icons/fi';
import axios from 'axios';

/**
 * AI retouch dialog: original on the left, the edit appearing on the right.
 *
 * WHY fetch() AND NOT EventSource OR axios
 * ----------------------------------------
 * The endpoint streams Server-Sent Events so the drafts OpenAI sends back
 * during an edit can be shown as they arrive. EventSource cannot carry the
 * Authorization header this API needs, and axios in the browser buffers the
 * whole response before resolving, which would throw the partials away. So
 * the response body is read as a stream directly.
 *
 * The result is saved as a NEW photo server-side - the original is never
 * touched - so "Keep" just refreshes the grid, and discarding costs nothing
 * but the tokens already spent.
 */

// Matches the placeholder count the server sends per edit.
const PARTIAL_STEPS = 3;

/**
 * Read off axios rather than rebuilt from NODE_ENV, so this cannot drift from
 * the base URL the rest of the app uses (AuthContext sets it). It also keeps
 * the stream off the CRA dev proxy in development - the proxy is free to
 * buffer a response, which would hold every draft back until the edit ended.
 */
const apiBase = () => axios.defaults.baseURL || '';

const QUALITY_HINTS = {
  low: 'Default - everyday use',
  medium: 'Sharper hair and skin',
  high: 'Best detail, about 3x the cost',
  xhigh: 'Slower, finer detail',
  max: 'Slowest, best for print'
};

const PhotoEditModal = ({ photo, leadName, onClose, onSaved }) => {
  const [config, setConfig] = useState(null);
  const [preset, setPreset] = useState('skin-retouch');
  const [prompt, setPrompt] = useState('');
  const [quality, setQuality] = useState('low');

  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(null);
  const [partial, setPartial] = useState(null);
  const [partialIndex, setPartialIndex] = useState(-1);
  const [savedPhoto, setSavedPhoto] = useState(null);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);
  // Set on unmount so a stream frame landing after close cannot call
  // setState on a component that is gone.
  const liveRef = useRef(true);

  const sourceSrc = photo?.display_url || photo?.url;

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Presets double as the capability check - the panel only opens this modal
  // when editing is configured, but the qualities and labels come from here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/photo-edit/presets`, {
          headers: authHeaders()
        });
        const data = await res.json();
        if (cancelled || !liveRef.current) return;
        if (data?.success) {
          setConfig(data);
          setQuality(data.defaultQuality && data.defaultQuality !== 'auto'
            ? data.defaultQuality
            : 'low');
        }
      } catch {
        if (!cancelled) setError('Could not load the retouch options');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const runEdit = useCallback(async () => {
    setRunning(true);
    setError(null);
    setSavedPhoto(null);
    setPartial(null);
    setPartialIndex(-1);
    setStage({ stage: 'preparing', message: 'Starting' });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${apiBase()}/api/photo-edit/${photo.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ preset: preset || undefined, prompt, quality }),
        signal: controller.signal
      });

      // Rejections before the stream starts (no permission, not configured,
      // bad prompt) still come back as ordinary JSON.
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `The edit failed (${res.status})`);
      }
      if (!res.body) throw new Error('This browser cannot stream the edit');

      await readStream(res.body, (event, payload) => {
        if (!liveRef.current) return;
        if (event === 'status') {
          setStage(payload);
        } else if (event === 'partial') {
          setPartial(payload.image);
          setPartialIndex(payload.index);
        } else if (event === 'saved') {
          setPartial(payload.photo.display_url || payload.photo.url);
          setSavedPhoto(payload.photo);
          setStage(null);
        } else if (event === 'error') {
          setError(payload.message);
          setStage(null);
        }
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        // Closing the modal or pressing Stop - not worth an error banner.
      } else if (liveRef.current) {
        setError(err.message);
      }
    } finally {
      if (liveRef.current) {
        setRunning(false);
        abortRef.current = null;
      }
    }
  }, [photo?.id, preset, prompt, quality]);

  const stop = () => abortRef.current?.abort();

  const close = () => {
    abortRef.current?.abort();
    // Only refresh the grid if something was actually saved.
    if (savedPhoto) onSaved?.(savedPhoto);
    onClose();
  };

  const presets = config?.presets || [];
  const qualities = config?.qualities || ['low', 'medium', 'high'];
  const maxPrompt = config?.maxPromptLength || 1200;
  const canRun = !running && (preset || prompt.trim());

  // Progress is the partial count, which is all the API gives us - there is
  // no percentage to read, so the bar is honest about being a step counter.
  const progress = savedPhoto
    ? 100
    : partialIndex >= 0
      ? Math.min(((partialIndex + 1) / (PARTIAL_STEPS + 1)) * 100, 90)
      : running ? 8 : 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div>
            <h3 className="text-base font-semibold text-gray-900 flex items-center">
              <FiZap className="mr-2 h-4 w-4 text-indigo-600" />
              AI Retouch
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {leadName ? `${leadName} - ` : ''}{photo?.filename || 'photo'}
              {config?.model && <span className="text-gray-400"> &middot; {config.model}</span>}
            </p>
          </div>
          <button
            onClick={close}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Close"
          >
            <FiX className="h-5 w-5" />
          </button>
        </div>

        {/* Before / after */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-4">
            <figure className="m-0">
              <figcaption className="text-xs font-medium text-gray-500 mb-1.5">Original</figcaption>
              <div className="relative bg-gray-100 rounded-lg overflow-hidden" style={{ aspectRatio: '3/4' }}>
                <img src={sourceSrc} alt="Original" className="w-full h-full object-contain" />
              </div>
            </figure>

            <figure className="m-0">
              <figcaption className="text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
                <span>{savedPhoto ? 'Retouched - saved' : 'Retouched'}</span>
                {running && partialIndex >= 0 && (
                  <span className="text-indigo-600 font-normal">
                    draft {partialIndex + 1}
                  </span>
                )}
              </figcaption>
              <div
                className={`relative rounded-lg overflow-hidden border-2 ${
                  savedPhoto ? 'border-green-400' : 'border-transparent bg-gray-100'
                }`}
                style={{ aspectRatio: '3/4' }}
              >
                {partial ? (
                  <img
                    src={partial}
                    alt={savedPhoto ? 'Retouched photo' : 'Retouch in progress'}
                    className={`w-full h-full object-contain transition-opacity duration-300 ${
                      running ? 'opacity-90' : 'opacity-100'
                    }`}
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                    {running ? (
                      <>
                        <FiLoader className="h-7 w-7 text-indigo-500 animate-spin mb-2" />
                        <p className="text-sm text-gray-600">{stage?.message || 'Working'}...</p>
                        <p className="text-xs text-gray-400 mt-1">
                          The first draft usually appears within 20 seconds
                        </p>
                      </>
                    ) : (
                      <>
                        <FiZap className="h-7 w-7 text-gray-300 mb-2" />
                        <p className="text-sm text-gray-400">
                          Pick a retouch and the result will appear here as it is generated
                        </p>
                      </>
                    )}
                  </div>
                )}

                {savedPhoto && (
                  <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-green-600
                                   text-white text-[10px] font-semibold rounded-full shadow">
                    <FiCheck className="h-3 w-3" />
                    Saved to gallery
                  </span>
                )}
              </div>
            </figure>
          </div>

          {(running || savedPhoto) && (
            <div className="mt-3 w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  savedPhoto ? 'bg-green-500' : 'bg-indigo-600'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {error && (
            <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <FiAlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Controls */}
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1.5">Retouch</p>
              <div className="flex flex-wrap gap-1.5">
                {presets.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setPreset(preset === p.id ? '' : p.id)}
                    disabled={running}
                    title={p.description}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                                disabled:opacity-50 disabled:cursor-not-allowed ${
                      preset === p.id
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">
                Extra instructions <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, maxPrompt))}
                disabled={running}
                rows={2}
                placeholder="e.g. remove the lanyard, warm the background slightly"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none
                           focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500
                           disabled:bg-gray-50 disabled:text-gray-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Faces, body shape and age are locked on every edit - the model is told to keep
                the person recognisable.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600">Quality</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                disabled={running}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white
                           disabled:bg-gray-50 disabled:text-gray-500"
              >
                {qualities.map(q => (
                  <option key={q} value={q}>
                    {q}{QUALITY_HINTS[q] ? ` - ${QUALITY_HINTS[q]}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <p className="text-xs text-gray-500">
            {savedPhoto
              ? 'The original is untouched - both are in the gallery.'
              : 'Saved as a new photo. The original is never overwritten.'}
          </p>

          <div className="flex items-center gap-2">
            {running ? (
              <button
                onClick={stop}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg
                           text-sm font-medium hover:bg-gray-100 transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={close}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg
                           text-sm font-medium hover:bg-gray-100 transition-colors"
              >
                {savedPhoto ? 'Done' : 'Cancel'}
              </button>
            )}

            <button
              onClick={runEdit}
              disabled={!canRun}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg
                         text-sm font-medium hover:bg-indigo-700 disabled:opacity-40
                         disabled:cursor-not-allowed transition-colors"
            >
              {running ? (
                <>
                  <FiLoader className="h-4 w-4 animate-spin" />
                  Retouching...
                </>
              ) : savedPhoto ? (
                <>
                  <FiRotateCcw className="h-4 w-4" />
                  Try again
                </>
              ) : (
                <>
                  <FiZap className="h-4 w-4" />
                  Retouch
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * axios holds the auth token on its own defaults, and fetch does not see it,
 * so read it back out of storage the same way AuthContext put it there.
 */
function authHeaders() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Read an SSE body and hand each complete frame to `onEvent`.
 *
 * A base64 partial image is a few hundred KB on a single line, so frames
 * routinely span several network chunks - the buffer only emits on a blank
 * line, which is what terminates an event.
 */
async function readStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let event = 'message';
      const data = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (!data.length) continue;

      try {
        onEvent(event, JSON.parse(data.join('')));
      } catch {
        // Ignore a frame we cannot parse rather than abandoning the edit.
      }
    }
  }
}

export default PhotoEditModal;
