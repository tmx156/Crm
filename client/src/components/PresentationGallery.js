import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FiX, FiChevronLeft, FiChevronRight, FiPlay, FiPause,
  FiCheck, FiPlus, FiSend, FiMaximize, FiMinimize, FiLoader, FiTrash2
} from 'react-icons/fi';
import axios from 'axios';

/**
 * Fullscreen slideshow for presenting a client's photos - crossfade, auto-play,
 * thumbnail strip, keyboard control, selection.
 *
 * Ported from the gallery in the Alan CRM, with three changes:
 *
 *  - Images come from our own derivatives rather than Cloudinary transforms:
 *    display_url (~1400px) for the stage, thumb_url (~300px) for the strip and
 *    as the blur-up placeholder. The 4 MB original is never fetched here.
 *
 *  - The "Select Package" button, which drove Alan's package sales, is now
 *    "Send as ZIP" and hands the selection back to the panel's send dialog.
 *    This CRM has no packages; sending the client their photos is what a
 *    selection is for.
 *
 *  - Alan's version asked for 500 photos in one request. Our API pages at 100
 *    per request with a cursor, so the gallery walks the pages instead.
 *
 * Folders are the same two as the panel: Retouched and Original.
 */

// Ids must match VIEWS in server/routes/photos.js.
const PHOTO_FOLDERS = [
  { id: 'retouched', label: 'Retouched' },
  { id: 'original', label: 'Original' }
];

const PAGE_SIZE = 100;
// A backstop, not an expected size - stops a runaway loop if the API ever
// kept reporting more pages.
const MAX_PHOTOS = 2000;

const isRetouched = (photo) => photo.is_ai_edited === true;
const stageUrl = (photo) => photo.display_url || photo.url;
const thumbUrl = (photo) => photo.thumb_url || photo.display_url || photo.url;

const PresentationGallery = ({
  isOpen,
  onClose,
  photos: initialPhotos = [], // shown immediately while the full set loads
  leadId,
  leadName,
  initialPhotoId = null,      // open on this photo, e.g. the tile clicked
  onSendSelected = null,      // (selectedPhotos) => void
  onDeletePhoto = null        // (photoId, event) => Promise<void>
}) => {
  const [allPhotos, setAllPhotos] = useState(initialPhotos);
  const [activeFolder, setActiveFolder] = useState('retouched');
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [isPlaying, setIsPlaying] = useState(true);
  const [playInterval] = useState(4000);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isImmersive, setIsImmersive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const photos = useMemo(() => (
    activeFolder === 'retouched'
      ? allPhotos.filter(isRetouched)
      : allPhotos.filter(p => !isRetouched(p))
  ), [allPhotos, activeFolder]);

  const folderCounts = useMemo(() => {
    const retouched = allPhotos.filter(isRetouched).length;
    return { retouched, original: allPhotos.length - retouched };
  }, [allPhotos]);

  const thumbnailContainerRef = useRef(null);
  const stageImgRef = useRef(null);
  const autoPlayRef = useRef(null);
  const galleryContainerRef = useRef(null);
  const transitionTimeoutRef = useRef(null);
  const currentFetchLeadIdRef = useRef(null);
  // Set once the full photo list has arrived, so the initial folder and
  // position are chosen against real data rather than the placeholder set.
  const positionedRef = useRef(false);

  // Reset whenever the gallery opens.
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(0);
      setPreviousIndex(null);
      setSelectedIds(new Set());
      setIsPlaying(!initialPhotoId); // opening on a chosen photo means "look at this one"
      setImageLoaded(false);
      setIsImmersive(false);
      setAllPhotos(initialPhotos);
      positionedRef.current = false;
    }
    // initialPhotos is deliberately left out: the parent passes a new array on
    // every render, and re-running this would snap the slideshow back to the
    // start mid-presentation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialPhotoId]);

  // Load every photo for the lead, walking the cursor pages.
  useEffect(() => {
    if (!isOpen || !leadId) return;

    const fetchAll = async () => {
      currentFetchLeadIdRef.current = leadId;
      setIsLoadingPhotos(true);

      try {
        const collected = [];
        let cursor = null;

        do {
          const { data } = await axios.get('/api/photos', {
            params: { leadId, folder: 'all', limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }
          });
          // The booker may have moved to another appointment mid-fetch.
          if (currentFetchLeadIdRef.current !== leadId) return;

          collected.push(...(data.photos || []));
          cursor = data.hasMore ? data.nextCursor : null;
        } while (cursor && collected.length < MAX_PHOTOS);

        setAllPhotos(collected);
      } catch (err) {
        // Keep showing whatever the panel handed us.
        console.error('Gallery: could not load all photos:', err.message);
      } finally {
        if (currentFetchLeadIdRef.current === leadId) setIsLoadingPhotos(false);
      }
    };

    fetchAll();
  }, [isOpen, leadId]);

  // Once real data is in, pick where to start: on the clicked photo if there
  // was one, otherwise on Retouched when there is anything retouched to show.
  useEffect(() => {
    if (!isOpen || isLoadingPhotos || positionedRef.current || allPhotos.length === 0) return;
    positionedRef.current = true;

    const target = initialPhotoId && allPhotos.find(p => p.id === initialPhotoId);
    if (target) {
      const folder = isRetouched(target) ? 'retouched' : 'original';
      const list = folder === 'retouched'
        ? allPhotos.filter(isRetouched)
        : allPhotos.filter(p => !isRetouched(p));
      setActiveFolder(folder);
      setCurrentIndex(Math.max(0, list.findIndex(p => p.id === target.id)));
    } else {
      setActiveFolder(allPhotos.some(isRetouched) ? 'retouched' : 'original');
      setCurrentIndex(0);
    }
    setPreviousIndex(null);
    setImageLoaded(false);
  }, [isOpen, isLoadingPhotos, allPhotos, initialPhotoId]);

  // The stage stays hidden until onLoad. But opening resets imageLoaded again
  // once the full photo list arrives, and if the first photo had already
  // loaded by then, the same <img> never fires onLoad a second time - the
  // first slide stayed black until autoplay moved on (or forever, if paused).
  // So whenever we are waiting, check whether the image is in fact ready.
  const stagePhotoId = photos[currentIndex]?.id;
  useEffect(() => {
    const img = stageImgRef.current;
    if (!imageLoaded && img && img.complete && img.naturalWidth > 0) setImageLoaded(true);
  }, [imageLoaded, stagePhotoId]);

  const changeFolder = (folder) => {
    setActiveFolder(folder);
    setCurrentIndex(0);
    setPreviousIndex(null);
    setImageLoaded(false);
  };

  // Keep the index valid if photos are deleted out from under it.
  useEffect(() => {
    if (photos.length > 0 && currentIndex >= photos.length) {
      setCurrentIndex(photos.length - 1);
      setPreviousIndex(null);
    }
  }, [photos.length, currentIndex]);

  const allInFolderSelected = useMemo(() => (
    photos.length > 0 && photos.every(p => selectedIds.has(p.id))
  ), [photos, selectedIds]);

  // Select or clear the current folder only, keeping selections elsewhere.
  const handleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allInFolderSelected) photos.forEach(p => next.delete(p.id));
      else photos.forEach(p => next.add(p.id));
      return next;
    });
  }, [allInFolderSelected, photos]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        if (galleryContainerRef.current) {
          await galleryContainerRef.current.requestFullscreen();
          setIsFullscreen(true);
          setIsImmersive(true);
        }
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
        setIsImmersive(false);
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  }, []);

  // ESC out of browser fullscreen does not go through toggleFullscreen.
  useEffect(() => {
    const onChange = () => {
      const now = !!document.fullscreenElement;
      setIsFullscreen(now);
      if (!now) setIsImmersive(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
    }
  }, [isOpen]);

  const preloadImage = useCallback((index) => {
    if (photos[index]) {
      const img = new Image();
      img.src = stageUrl(photos[index]);
    }
  }, [photos]);

  const goToPhoto = useCallback((newIndex, skipTransition = false) => {
    if (newIndex === currentIndex || photos.length === 0) return;

    const targetIndex = ((newIndex % photos.length) + photos.length) % photos.length;

    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }

    if (skipTransition) {
      setCurrentIndex(targetIndex);
      setPreviousIndex(null);
      setImageLoaded(false);
    } else {
      setPreviousIndex(currentIndex);
      setCurrentIndex(targetIndex);
      setImageLoaded(false);
      preloadImage((targetIndex + 1) % photos.length);
      transitionTimeoutRef.current = setTimeout(() => setPreviousIndex(null), 500);
    }
  }, [currentIndex, photos.length, preloadImage]);

  const goToNext = useCallback(() => goToPhoto(currentIndex + 1), [currentIndex, goToPhoto]);
  const goToPrevious = useCallback(() => goToPhoto(currentIndex - 1), [currentIndex, goToPhoto]);

  useEffect(() => {
    if (!isPlaying || !isOpen || photos.length <= 1) {
      if (autoPlayRef.current) {
        clearInterval(autoPlayRef.current);
        autoPlayRef.current = null;
      }
      return;
    }
    autoPlayRef.current = setInterval(goToNext, playInterval);
    return () => { if (autoPlayRef.current) clearInterval(autoPlayRef.current); };
  }, [isPlaying, isOpen, photos.length, playInterval, goToNext]);

  const toggleSelection = useCallback((photoId) => {
    if (!photoId) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e) => {
      switch (e.key) {
        case 'ArrowLeft':
          goToPrevious();
          setIsPlaying(false);
          break;
        case 'ArrowRight':
          goToNext();
          setIsPlaying(false);
          break;
        case ' ':
          e.preventDefault();
          setIsPlaying(prev => !prev);
          break;
        case 'Escape':
          if (isImmersive) setIsImmersive(false);
          else onClose();
          break;
        case 'Enter':
          toggleSelection(photos[currentIndex]?.id);
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'a':
        case 'A':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleSelectAll();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, currentIndex, goToNext, goToPrevious, onClose, photos, isImmersive,
      handleSelectAll, toggleFullscreen, toggleSelection]);

  // Keep the current thumbnail centred in the strip.
  useEffect(() => {
    const container = thumbnailContainerRef.current;
    if (!container || photos.length === 0) return;
    const thumb = container.children[currentIndex];
    if (!thumb) return;
    const target = thumb.offsetLeft - container.offsetWidth / 2 + thumb.offsetWidth / 2;
    container.scrollTo({ left: Math.max(0, target), behavior: currentIndex === 0 ? 'instant' : 'smooth' });
  }, [currentIndex, photos.length]);

  const handleDeletePhoto = async (photoId, e) => {
    if (!onDeletePhoto) return;
    // The parent confirms first. Only drop the thumbnail if it really went -
    // the original removed it even when the booker pressed Cancel.
    const deleted = await onDeletePhoto(photoId, e);
    if (deleted === false) return;
    setAllPhotos(prev => prev.filter(p => p.id !== photoId));
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(photoId);
      return next;
    });
  };

  const handleSend = () => {
    if (!onSendSelected) return;
    onSendSelected(allPhotos.filter(p => selectedIds.has(p.id)));
  };

  if (!isOpen) return null;

  if (allPhotos.length === 0) {
    return (
      <div ref={galleryContainerRef} className="fixed inset-0 z-[80] bg-black flex items-center justify-center">
        <div className="text-center">
          {isLoadingPhotos ? (
            <FiLoader className="w-8 h-8 text-white/40 animate-spin mx-auto mb-4" />
          ) : (
            <p className="text-white/60 text-lg mb-4">No photos available</p>
          )}
          <button onClick={onClose} className="text-white/80 hover:text-white">Close</button>
        </div>
      </div>
    );
  }

  const currentPhoto = photos[currentIndex] || photos[0];
  const previousPhoto = previousIndex !== null ? photos[previousIndex] : null;
  const isCurrentSelected = currentPhoto ? selectedIds.has(currentPhoto.id) : false;

  return (
    <div ref={galleryContainerRef} className="fixed inset-0 z-[80] bg-black">
      {/* Header */}
      <div className={`absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/80 to-transparent p-3 sm:p-4 transition-all duration-300 ${
        isImmersive ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}>
        <div className="flex items-center justify-between gap-2 max-w-7xl mx-auto">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <h2 className="text-white text-base sm:text-xl font-light tracking-wide truncate">{leadName}</h2>
            <span className="text-white/40 text-sm font-light whitespace-nowrap">
              {photos.length ? `${currentIndex + 1} / ${photos.length}` : '0 / 0'}
            </span>
            {isLoadingPhotos && <FiLoader className="w-4 h-4 text-white/40 animate-spin" />}
          </div>

          <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
            <button
              onClick={handleSelectAll}
              className="text-white/60 hover:text-white px-2 sm:px-3 py-2 whitespace-nowrap transition-colors text-sm font-light tracking-wide"
            >
              {allInFolderSelected ? 'Deselect All' : 'Select All'}
            </button>

            {selectedIds.size > 0 && (
              <span className="hidden sm:inline text-white/60 text-sm font-light">{selectedIds.size} selected</span>
            )}

            <button
              onClick={() => setIsPlaying(p => !p)}
              className="text-white/40 hover:text-white p-2 transition-colors"
              title={isPlaying ? 'Pause (space)' : 'Play (space)'}
            >
              {isPlaying ? <FiPause className="w-5 h-5" /> : <FiPlay className="w-5 h-5" />}
            </button>

            <button
              onClick={toggleFullscreen}
              className="hidden sm:inline-block text-white/40 hover:text-white p-2 transition-colors"
              title="Fullscreen (F)"
            >
              {isFullscreen ? <FiMinimize className="w-5 h-5" /> : <FiMaximize className="w-5 h-5" />}
            </button>

            <button onClick={onClose} className="text-white/40 hover:text-white p-2 transition-colors" title="Close (Esc)">
              <FiX className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Folder navigation */}
      <div className={`absolute left-0 top-14 sm:top-1/2 sm:-translate-y-1/2 z-20 transition-all duration-500 ${
        isImmersive ? 'opacity-0 pointer-events-none -translate-x-full' : 'opacity-100'
      }`}>
        <nav className="flex sm:block py-1 sm:py-4 pl-2 sm:pl-6 pr-2 sm:pr-12">
          {PHOTO_FOLDERS.map(folder => {
            const count = folderCounts[folder.id] || 0;
            const isActive = activeFolder === folder.id;
            return (
              <button
                key={folder.id}
                onClick={() => changeFolder(folder.id)}
                className={`block sm:w-full text-left py-1.5 sm:py-2.5 transition-all duration-300 group ${
                  isActive ? 'pl-4 border-l border-white' : 'pl-4 border-l border-transparent hover:border-white/30'
                }`}
              >
                <span className={`text-sm tracking-wider transition-all duration-300 ${
                  isActive ? 'text-white font-normal' : 'text-white/30 group-hover:text-white/70 font-light'
                }`}>
                  {folder.label}
                </span>
                <span className={`ml-2 text-xs transition-all duration-300 ${
                  isActive ? 'text-white/50' : 'text-white/20'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Stage */}
      <div className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
        isImmersive ? 'px-4 py-4' : 'slideshow-framed px-20 py-24'
      }`}>
        {photos.length > 0 && currentPhoto ? (
          <>
            {previousPhoto && (
              <div className="slideshow-image previous">
                <img src={stageUrl(previousPhoto)} alt="" className="max-w-full max-h-full object-contain" />
              </div>
            )}

            <div className={`slideshow-image ${imageLoaded ? 'active' : ''}`}>
              {/* The ~20 KB thumbnail doubles as the blur-up placeholder. */}
              {!imageLoaded && (
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `url(${thumbUrl(currentPhoto)})`,
                    backgroundSize: 'contain',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    filter: 'blur(20px)',
                    transform: 'scale(1.1)'
                  }}
                />
              )}
              <img
                key={currentPhoto.id}
                src={stageUrl(currentPhoto)}
                alt={currentPhoto.description || `Photo ${currentIndex + 1}`}
                className="max-w-full max-h-full object-contain relative z-10"
                ref={stageImgRef}
                onLoad={() => setImageLoaded(true)}
                // A failed load should not leave the stage black either
                onError={() => setImageLoaded(true)}
              />
            </div>

            {isCurrentSelected && (
              <div className={`absolute top-28 right-24 transition-all duration-300 ${
                isImmersive ? 'opacity-0' : 'opacity-100'
              }`}>
                <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg animate-pulse">
                  <FiCheck className="w-6 h-6 text-white" />
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-white/40 font-light tracking-wide">
            {activeFolder === 'retouched' ? 'No retouched photos yet' : 'No original photos'}
          </p>
        )}
      </div>

      {/* Arrows */}
      {photos.length > 1 && (
        <>
          <button
            onClick={() => { goToPrevious(); setIsPlaying(false); }}
            className={`absolute left-0 sm:left-40 top-1/2 -translate-y-1/2 z-30 text-white/40 sm:text-white/20 hover:text-white p-2 sm:p-4 transition-all hover:scale-110 ${
              isImmersive ? 'opacity-30 hover:opacity-100' : 'opacity-100'
            }`}
          >
            <FiChevronLeft className="w-8 h-8" />
          </button>
          <button
            onClick={() => { goToNext(); setIsPlaying(false); }}
            className={`absolute right-0 sm:right-8 top-1/2 -translate-y-1/2 z-30 text-white/40 sm:text-white/20 hover:text-white p-2 sm:p-4 transition-all hover:scale-110 ${
              isImmersive ? 'opacity-30 hover:opacity-100' : 'opacity-100'
            }`}
          >
            <FiChevronRight className="w-8 h-8" />
          </button>
        </>
      )}

      {/* Select the photo on stage */}
      {photos.length > 0 && currentPhoto && (
        <div className={`absolute bottom-40 sm:bottom-36 left-1/2 -translate-x-1/2 z-20 transition-all duration-300 ${
          isImmersive ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}>
          <button
            onClick={() => toggleSelection(currentPhoto.id)}
            className={`flex items-center space-x-2 sm:space-x-3 px-5 py-2.5 sm:px-8 sm:py-4 rounded-full text-base sm:text-lg font-semibold whitespace-nowrap transition-all transform shadow-xl ${
              isCurrentSelected
                ? 'bg-indigo-600 text-white hover:scale-105'
                : 'bg-white text-gray-900 hover:bg-indigo-50 hover:scale-105'
            }`}
          >
            {isCurrentSelected ? (
              <><FiCheck className="w-5 h-5 sm:w-6 sm:h-6" /><span>Selected</span></>
            ) : (
              <><FiPlus className="w-5 h-5 sm:w-6 sm:h-6" /><span>Add to Selection</span></>
            )}
          </button>
        </div>
      )}

      {/* Thumbnail strip */}
      <div className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-500 ${
        isImmersive ? 'opacity-0 pointer-events-none translate-y-full' : 'opacity-100 translate-y-0'
      }`}>
        <div className="bg-gradient-to-t from-black via-black/80 to-transparent pt-8 pb-4 px-0 sm:px-4">
          <div
            ref={thumbnailContainerRef}
            className="flex space-x-2 overflow-x-auto px-4"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {photos.map((photo, index) => {
              const isCurrent = index === currentIndex;
              const isSelected = selectedIds.has(photo.id);
              return (
                <button
                  key={photo.id}
                  onClick={() => { goToPhoto(index, true); setIsPlaying(false); }}
                  className={`group/thumb relative flex-shrink-0 w-16 h-16 overflow-hidden transition-all duration-300 ${
                    isCurrent
                      ? 'ring-2 ring-white opacity-100'
                      : isSelected
                        ? 'ring-2 ring-indigo-500 opacity-100'
                        : 'opacity-30 hover:opacity-60'
                  }`}
                >
                  <img
                    src={thumbUrl(photo)}
                    alt={`${index + 1}`}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                  {isSelected && (
                    <div className="absolute top-1 right-1 bg-indigo-600 rounded-full p-0.5 z-10">
                      <FiCheck className="w-3 h-3 text-white" />
                    </div>
                  )}
                  {onDeletePhoto && (
                    <span
                      onClick={(e) => { e.stopPropagation(); handleDeletePhoto(photo.id, e); }}
                      className="absolute top-0 left-0 z-20 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-600 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity cursor-pointer hover:bg-red-700"
                      title="Delete photo"
                    >
                      <FiTrash2 className="w-2.5 h-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Send the selection */}
      {selectedIds.size > 0 && onSendSelected && (
        <div className={`absolute bottom-24 right-3 sm:bottom-28 sm:right-8 z-20 transition-all duration-300 ${
          isImmersive ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}>
          <button
            onClick={handleSend}
            className="flex items-center space-x-2 sm:space-x-3 text-white px-4 py-2.5 sm:px-8 sm:py-4 rounded-full text-sm sm:text-lg font-semibold whitespace-nowrap shadow-xl hover:shadow-2xl transition-all transform hover:scale-105 bg-gradient-to-r from-indigo-600 to-purple-600"
          >
            <FiSend className="w-5 h-5 sm:w-6 sm:h-6" />
            <span>Send {selectedIds.size} photo{selectedIds.size === 1 ? '' : 's'}</span>
          </button>
        </div>
      )}

      {isPlaying && (
        <div className={`absolute bottom-28 left-8 z-20 flex items-center space-x-2 text-white/30 transition-all duration-300 ${
          isImmersive ? 'opacity-0' : 'opacity-100'
        }`}>
          <div className="w-1.5 h-1.5 bg-white/50 rounded-full animate-pulse" />
          <span className="text-xs font-light tracking-wider">Auto</span>
        </div>
      )}

      {isFullscreen && (
        <div
          className="absolute top-4 right-4 z-30 text-white/20 text-xs cursor-pointer hover:text-white/60 transition-colors tracking-wider font-light"
          onClick={toggleFullscreen}
        >
          ESC to exit
        </div>
      )}
    </div>
  );
};

export default PresentationGallery;
