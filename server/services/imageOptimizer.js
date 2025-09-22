const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

class ImageOptimizer {
  constructor() {
    this.uploadsDir = path.join(__dirname, '../uploads/images');
    this.thumbnailsDir = path.join(__dirname, '../uploads/thumbnails');
    this.ensureDirectories();
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(this.uploadsDir, { recursive: true });
      await fs.mkdir(this.thumbnailsDir, { recursive: true });
    } catch (error) {
      console.error('Error creating directories:', error);
    }
  }

  /**
   * Generate optimized thumbnail for lead images
   * @param {string} imagePath - Path to original image
   * @param {string} filename - Original filename
   * @returns {Promise<string>} - Path to thumbnail
   */
  async generateThumbnail(imagePath, filename) {
    try {
      const thumbnailPath = path.join(this.thumbnailsDir, `thumb_${filename}`);
      
      // Check if thumbnail already exists
      try {
        await fs.access(thumbnailPath);
        return `/uploads/thumbnails/thumb_${filename}`;
      } catch {
        // Thumbnail doesn't exist, create it
      }

      // Generate 40x40 thumbnail for lead list
      await sharp(imagePath)
        .resize(40, 40, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 80, progressive: true })
        .toFile(thumbnailPath);

      console.log(`✅ Generated thumbnail: ${thumbnailPath}`);
      return `/uploads/thumbnails/thumb_${filename}`;
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      return null;
    }
  }

  /**
   * Generate optimized version of original image
   * @param {string} imagePath - Path to original image
   * @param {string} filename - Original filename
   * @returns {Promise<string>} - Path to optimized image
   */
  async optimizeImage(imagePath, filename) {
    try {
      const optimizedPath = path.join(this.uploadsDir, `opt_${filename}`);
      
      // Check if optimized version already exists
      try {
        await fs.access(optimizedPath);
        return `/uploads/images/opt_${filename}`;
      } catch {
        // Optimized version doesn't exist, create it
      }

      // Generate optimized version (max 800x800, 85% quality)
      await sharp(imagePath)
        .resize(800, 800, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 85, progressive: true })
        .toFile(optimizedPath);

      console.log(`✅ Generated optimized image: ${optimizedPath}`);
      return `/uploads/images/opt_${filename}`;
    } catch (error) {
      console.error('Error optimizing image:', error);
      return null;
    }
  }

  /**
   * Process uploaded image and generate optimized versions
   * @param {string} originalPath - Path to uploaded image
   * @param {string} filename - Original filename
   * @returns {Promise<Object>} - Object with thumbnail and optimized URLs
   */
  async processImage(originalPath, filename) {
    try {
      const [thumbnailUrl, optimizedUrl] = await Promise.all([
        this.generateThumbnail(originalPath, filename),
        this.optimizeImage(originalPath, filename)
      ]);

      return {
        thumbnail: thumbnailUrl,
        optimized: optimizedUrl,
        original: `/uploads/images/${filename}`
      };
    } catch (error) {
      console.error('Error processing image:', error);
      return {
        thumbnail: null,
        optimized: null,
        original: `/uploads/images/${filename}`
      };
    }
  }

  /**
   * Get optimized image URL for different use cases
   * @param {string} originalUrl - Original image URL
   * @param {string} size - Size needed ('thumbnail', 'optimized', 'original')
   * @returns {string} - Optimized URL
   */
  getOptimizedUrl(originalUrl, size = 'optimized') {
    if (!originalUrl) return null;

    const filename = path.basename(originalUrl);
    
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
  }

  /**
   * Clean up old optimized images
   * @param {string} originalFilename - Original filename to clean up
   */
  async cleanupOptimizedImages(originalFilename) {
    try {
      const thumbnailPath = path.join(this.thumbnailsDir, `thumb_${originalFilename}`);
      const optimizedPath = path.join(this.uploadsDir, `opt_${originalFilename}`);

      await Promise.all([
        fs.unlink(thumbnailPath).catch(() => {}),
        fs.unlink(optimizedPath).catch(() => {})
      ]);

      console.log(`✅ Cleaned up optimized images for: ${originalFilename}`);
    } catch (error) {
      console.error('Error cleaning up optimized images:', error);
    }
  }
}

module.exports = new ImageOptimizer();
