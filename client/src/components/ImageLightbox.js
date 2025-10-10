import React, { useEffect } from 'react';
import { FiX } from 'react-icons/fi';

const ImageLightbox = ({ src, alt = 'Photo', onClose }) => {
  useEffect(() => {
    if (!src) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 bg-red-600 hover:bg-red-700 text-white rounded-full p-2 transition-all duration-200 shadow-lg"
          aria-label="Close image"
          title="Close (ESC)"
        >
          <FiX className="h-6 w-6" />
        </button>
        <img
          src={src}
          alt={alt}
          className="block max-w-full max-h-[90vh] rounded-lg shadow-2xl"
        />
      </div>
    </div>
  );
};

export default ImageLightbox;

