const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Initialize Supabase client with service role key for storage operations
const supabase = createClient(
  config.supabase.url, 
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

class SupabaseStorageService {
  constructor() {
    this.bucketName = 'template-attachments';
    this.initializeBucket();
  }

  async initializeBucket(retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Check if bucket exists
        const { data: buckets, error } = await supabase.storage.listBuckets();

        if (error) {
          if (attempt < retries) {
            console.log(`⏳ Bucket check failed (attempt ${attempt}/${retries}), retrying in ${attempt * 2}s...`);
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            continue;
          }
          console.error('❌ Error listing buckets after retries:', error);
          console.log('⚠️ Storage service will continue - bucket operations may still work');
          return;
        }

        const bucketExists = buckets.some(bucket => bucket.name === this.bucketName);

        if (!bucketExists) {
          console.log(`📦 Creating bucket: ${this.bucketName}`);
          const { data, error: createError } = await supabase.storage.createBucket(this.bucketName, {
            public: true,
            fileSizeLimit: 50 * 1024 * 1024, // 50MB limit
            allowedMimeTypes: [
              'application/pdf',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'image/jpeg',
              'image/png',
              'image/gif',
              'image/webp',
              'text/plain',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            ]
          });

          if (createError) {
            console.error('❌ Error creating bucket:', createError);
          } else {
            console.log('✅ Bucket created successfully');
          }
        } else {
          console.log('✅ Bucket already exists');
        }

        // Success - exit the retry loop
        return;

      } catch (error) {
        if (attempt < retries) {
          console.log(`⏳ Bucket init error (attempt ${attempt}/${retries}), retrying in ${attempt * 2}s...`);
          await new Promise(resolve => setTimeout(resolve, attempt * 2000));
          continue;
        }
        console.error('❌ Error initializing bucket after retries:', error);
        console.log('⚠️ Storage service will continue - bucket operations may still work');
      }
    }
  }

  /**
   * Upload a file to Supabase Storage
   * @param {string} filePath - Local file path
   * @param {string} fileName - Desired file name in storage
   * @param {string} contentType - MIME type
   * @returns {Promise<{success: boolean, url?: string, error?: string}>}
   */
  async uploadFile(filePath, fileName, contentType) {
    try {
      console.log(`📤 Uploading file to Supabase Storage: ${fileName}`);
      
      // Read file from local filesystem
      const fileBuffer = fs.readFileSync(filePath);
      
      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .upload(fileName, fileBuffer, {
          contentType: contentType,
          upsert: true // Overwrite if exists
        });

      if (error) {
        console.error('❌ Upload error:', error);
        return { success: false, error: error.message };
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(this.bucketName)
        .getPublicUrl(fileName);

      console.log('✅ File uploaded successfully:', urlData.publicUrl);
      
      return {
        success: true,
        url: urlData.publicUrl,
        path: data.path
      };

    } catch (error) {
      console.error('❌ Upload error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Download a file from Supabase Storage
   * @param {string} fileName - File name in storage
   * @returns {Promise<{success: boolean, buffer?: Buffer, error?: string}>}
   */
  async downloadFile(fileName) {
    try {
      console.log(`📥 Downloading file from Supabase Storage: ${fileName}`);
      
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .download(fileName);

      if (error) {
        console.error('❌ Download error:', error);
        return { success: false, error: error.message };
      }

      // Convert blob to buffer
      const buffer = Buffer.from(await data.arrayBuffer());
      
      console.log('✅ File downloaded successfully');
      
      return {
        success: true,
        buffer: buffer
      };

    } catch (error) {
      console.error('❌ Download error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a file from Supabase Storage
   * @param {string} fileName - File name in storage
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteFile(fileName) {
    try {
      console.log(`🗑️ Deleting file from Supabase Storage: ${fileName}`);
      
      const { error } = await supabase.storage
        .from(this.bucketName)
        .remove([fileName]);

      if (error) {
        console.error('❌ Delete error:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ File deleted successfully');
      
      return { success: true };

    } catch (error) {
      console.error('❌ Delete error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get public URL for a file
   * @param {string} fileName - File name in storage
   * @returns {string} Public URL
   */
  getPublicUrl(fileName) {
    const { data } = supabase.storage
      .from(this.bucketName)
      .getPublicUrl(fileName);
    
    return data.publicUrl;
  }

  /**
   * List all files in the bucket
   * @returns {Promise<{success: boolean, files?: Array, error?: string}>}
   */
  async listFiles() {
    try {
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .list();

      if (error) {
        console.error('❌ List error:', error);
        return { success: false, error: error.message };
      }

      return { success: true, files: data };

    } catch (error) {
      console.error('❌ List error:', error);
      return { success: false, error: error.message };
    }
  }
}

// Create singleton instance
const storageService = new SupabaseStorageService();

module.exports = storageService;
