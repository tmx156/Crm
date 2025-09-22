import React, { useState, useRef, useEffect } from 'react';

const LazyImage = ({ 
  src, 
  alt, 
  className = "w-10 h-10 rounded-full object-cover border-2 border-gray-200",
  fallbackClassName = "w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center border-2 border-gray-200",
  placeholder = null,
  onError = null,
  onLoad = null,
  lazy = true, // New prop to control lazy loading
  preload = false, // New prop for preloading
  ...props 
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(!lazy || preload); // Start loading immediately if not lazy or preloading
  const imgRef = useRef(null);
  const observerRef = useRef(null);

  // Reset state when src changes (important for navigation)
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
    setIsInView(!lazy || preload);
  }, [src, lazy, preload]);

  useEffect(() => {
    if (!lazy || preload) {
      setIsInView(true);
      return;
    }

    // Create intersection observer for lazy loading with better performance
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observerRef.current?.disconnect();
        }
      },
      {
        rootMargin: '10px', // Even more aggressive - load only when very close
        threshold: 0.1 // Higher threshold for better performance
      }
    );

    if (imgRef.current) {
      observerRef.current.observe(imgRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [lazy, preload]);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    setHasError(true);
    onError?.();
  };

  // If no image URL, show fallback immediately
  if (!src || src === '' || src === null || src === undefined) {
    return (
      <div ref={imgRef} className={fallbackClassName}>
        <span className="text-sm font-medium text-gray-600">
          {alt ? alt.charAt(0).toUpperCase() : '?'}
        </span>
      </div>
    );
  }

  // If image failed to load, show fallback
  if (hasError) {
    return (
      <div className={fallbackClassName}>
        <span className="text-sm font-medium text-gray-600">
          {alt ? alt.charAt(0).toUpperCase() : '?'}
        </span>
      </div>
    );
  }

  return (
    <div ref={imgRef} className="relative">
      {/* Placeholder while loading */}
      {!isLoaded && isInView && (
        <div className={`${fallbackClassName} absolute inset-0`}>
          <div className="animate-pulse bg-gray-300 w-full h-full rounded-full"></div>
        </div>
      )}
      
      {/* Actual image */}
      {isInView && (
        <img
          src={src}
          alt={alt}
          className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
          onLoad={handleLoad}
          onError={handleError}
          loading={lazy ? "lazy" : "eager"}
          {...props}
        />
      )}
      
      {/* Loading placeholder */}
      {isInView && !isLoaded && !hasError && (
        <div className={`${fallbackClassName} absolute inset-0`}>
          <div className="animate-pulse bg-gray-300 w-full h-full rounded-full"></div>
        </div>
      )}
    </div>
  );
};

export default LazyImage;
