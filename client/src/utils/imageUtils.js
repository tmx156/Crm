/**
 * Image utility functions for optimized loading and caching
 */

// Enhanced image cache with size limits and TTL for better performance
const imageCache = new Map();
const CACHE_SIZE_LIMIT = 100; // Limit cache size to prevent memory issues
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes TTL for cache entries

// Clean up old cache entries
const cleanupCache = () => {
  const now = Date.now();
  for (const [key, value] of imageCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      imageCache.delete(key);
    }
  }
  
  // If still over limit, remove oldest entries
  if (imageCache.size > CACHE_SIZE_LIMIT) {
    const entries = Array.from(imageCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, entries.length - CACHE_SIZE_LIMIT);
    toRemove.forEach(([key]) => imageCache.delete(key));
  }
};

/**
 * Get optimized image URL based on size and context
 * @param {string} originalUrl - Original image URL
 * @param {string} size - Size needed ('thumbnail', 'optimized', 'original')
 * @returns {string} - Optimized URL
 */
export const getOptimizedImageUrl = (originalUrl, size = 'optimized') => {
  if (!originalUrl) return null;

  // If it's already an optimized URL, return as is
  if (originalUrl.includes('/opt_') || originalUrl.includes('/thumb_')) {
    return originalUrl;
  }

  // Check if it's an external URL (like Supabase)
  if (originalUrl.startsWith('http://') || originalUrl.startsWith('https://')) {
    // For Supabase URLs, we can use query parameters to resize images
    if (originalUrl.includes('supabase.co')) {
      const baseUrl = originalUrl.split('?')[0];
      const params = new URLSearchParams();
      
      switch (size) {
        case 'thumbnail':
          params.set('width', '24'); // Even smaller for maximum speed
          params.set('height', '24');
          params.set('resize', 'cover');
          params.set('quality', '20'); // Ultra-low quality for maximum speed
          params.set('format', 'webp'); // Use WebP format for better compression
          params.set('blur', '2'); // More blur to reduce file size further
          break;
        case 'optimized':
          params.set('width', '200');
          params.set('height', '200');
          params.set('resize', 'cover');
          params.set('quality', '70'); // Reduced from 85 to 70 for faster loading
          break;
        case 'original':
          // Return original without modifications
          return originalUrl;
        default:
          return originalUrl;
      }
      
      return `${baseUrl}?${params.toString()}`;
    }
    
    // For other external URLs, return as is
    return originalUrl;
  }

  // For local URLs, try to get optimized versions
  const filename = originalUrl.split('/').pop();
  if (!filename) return originalUrl;

  switch (size) {
    case 'thumbnail':
      return `/uploads/thumbnails/thumb_${filename}`;
    case 'optimized':
      return `/uploads/images/opt_${filename}`;
    case 'original':
      return originalUrl;
    default:
      return originalUrl;
  }
};

/**
 * Preload an image
 * @param {string} src - Image source URL
 * @returns {Promise} - Promise that resolves when image is loaded
 */
export const preloadImage = (src) => {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('No image source provided'));
      return;
    }

    // Clean up cache periodically
    cleanupCache();

    // Check cache first
    if (imageCache.has(src)) {
      const cached = imageCache.get(src);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        resolve(cached.img);
        return;
      } else {
        imageCache.delete(src);
      }
    }

    const img = new Image();
    img.onload = () => {
      imageCache.set(src, { img, timestamp: Date.now() });
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
};

/**
 * Preload multiple images
 * @param {string[]} urls - Array of image URLs
 * @returns {Promise} - Promise that resolves when all images are loaded
 */
export const preloadImages = async (urls) => {
  const validUrls = urls.filter(url => url && url !== '');
  if (validUrls.length === 0) return [];

  try {
    const results = await Promise.allSettled(
      validUrls.map(url => preloadImage(url))
    );
    
    return results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
  } catch (error) {
    console.warn('Some images failed to preload:', error);
    return [];
  }
};

/**
 * Get image dimensions from URL
 * @param {string} src - Image source URL
 * @returns {Promise<{width: number, height: number}>} - Image dimensions
 */
export const getImageDimensions = (src) => {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('No image source provided'));
      return;
    }

    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight
      });
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
};

/**
 * Check if an image URL is valid and accessible
 * @param {string} src - Image source URL
 * @returns {Promise<boolean>} - True if image is accessible
 */
export const isImageAccessible = async (src) => {
  try {
    await preloadImage(src);
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if an image is cached and not expired
 * @param {string} src - Image source URL
 * @returns {boolean} - Whether image is cached and valid
 */
export const isImageCached = (src) => {
  if (!imageCache.has(src)) return false;
  const cached = imageCache.get(src);
  return Date.now() - cached.timestamp < CACHE_TTL;
};

/**
 * Generate a fallback image URL with initials
 * @param {string} name - Name to generate initials from
 * @param {string} size - Size of the image (e.g., '40x40', '200x200')
 * @returns {string} - Data URL for fallback image
 */
export const generateFallbackImage = (name, size = '40x40') => {
  const initials = name ? name.charAt(0).toUpperCase() : '?';
  const [width, height] = size.split('x').map(Number);
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  // Create gradient background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#e5e7eb');
  gradient.addColorStop(1, '#d1d5db');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  // Add text
  ctx.fillStyle = '#6b7280';
  ctx.font = `bold ${Math.min(width, height) * 0.4}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, width / 2, height / 2);
  
  return canvas.toDataURL();
};
