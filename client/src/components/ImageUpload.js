import React from 'react';
import { FiImage } from 'react-icons/fi';

const ImageUpload = ({ currentImageUrl }) => {
  return (
    <div className="image-upload-container">
      <h3 className="text-lg font-semibold mb-3 flex items-center">
        <FiImage className="mr-2" />
        Lead Photo
      </h3>
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
        {currentImageUrl ? (
          <div className="relative">
            <img
              src={currentImageUrl}
              alt="Lead"
              className="w-full h-64 object-cover rounded-lg"
              onError={(e) => {
                if (e.target && e.target.style) {
                  e.target.style.display = 'none';
                }
                if (e.target && e.target.nextSibling && e.target.nextSibling.style) {
                  e.target.nextSibling.style.display = 'block';
                }
              }}
            />
            <div className="hidden text-center py-8 text-red-500">
              <FiImage className="mx-auto text-4xl mb-2" />
              <p>Failed to load image</p>
              <p className="text-sm mt-1">URL: {currentImageUrl}</p>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              <p><strong>Image URL:</strong> {currentImageUrl}</p>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <FiImage className="mx-auto text-4xl text-gray-400 mb-2" />
            <p className="text-gray-500">No image uploaded</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageUpload;
