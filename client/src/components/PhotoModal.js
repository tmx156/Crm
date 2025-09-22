import React, { useCallback, useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';

const PhotoModal = ({ isOpen, onClose, imageUrl, leadName }) => {
  const [imageError, setImageError] = useState(false);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      // Reset error state when modal opens
      setImageError(false);
    } else {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="relative max-w-4xl max-h-screen p-4">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 bg-black bg-opacity-50 text-white rounded-full p-2 hover:bg-opacity-70 transition-all duration-200"
          aria-label="Close photo modal"
        >
          <FiX className="h-6 w-6" />
        </button>

        {/* Image container */}
        <div className="relative">
          {!imageError ? (
            <img
              src={imageUrl}
              alt={leadName}
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onError={() => {
                setImageError(true);
              }}
            />
          ) : (
            // Fallback when image fails to load
            <div className="max-w-full max-h-[90vh] bg-gray-100 rounded-lg shadow-2xl flex items-center justify-center p-8">
              <div className="text-center text-gray-500">
                <FiX className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                <p className="text-lg font-medium mb-2">Image could not be loaded</p>
                <p className="text-sm">The image file may be missing or corrupted</p>
              </div>
            </div>
          )}

          {/* Image info */}
          <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white p-4 rounded-b-lg">
            <p className="text-lg font-medium">{leadName}</p>
            <p className="text-sm opacity-90">Click outside or press ESC to close</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhotoModal;
