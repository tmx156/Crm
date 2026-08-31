import React, { useState } from 'react';

const LazyImage = ({ 
  src, 
  alt, 
  className, 
  onClick, 
  onLoad,
  onError,
  style,
  title,
  // Filter out custom props that shouldn't be passed to DOM
  fallbackClassName, 
  lazy,
  preload,
  ...rest 
}) => {
  const [imgSrc, setImgSrc] = useState(src);
  const fallbackSrc = '/images/fallback.jpeg'; // Replace with your actual fallback image path

  const handleError = (e) => {
    console.warn(`🖼️ Image failed to load: ${imgSrc}`);
    setImgSrc(fallbackSrc);
    // Call the parent's onError if provided
    if (onError) {
      onError(e);
    }
  };

  const handleLoad = (e) => {
    // Call the parent's onLoad if provided
    if (onLoad) {
      onLoad(e);
    }
  };

  return (
    <img
      src={imgSrc}
      alt={alt || 'Lead Image'}
      className={className}
      loading="lazy"
      onError={handleError}
      onLoad={handleLoad}
      onClick={onClick}
      style={style}
      title={title}
      {...rest}
    />
  );
};

export default LazyImage;
