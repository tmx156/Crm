const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { auth } = require('../middleware/auth');
const imageOptimizer = require('../services/imageOptimizer');
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads/images');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// @route   POST /api/upload/image
// @desc    Upload an image
// @access  Private
router.post('/image', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    // Process image and generate optimized versions
    const processedImages = await imageOptimizer.processImage(
      req.file.path, 
      req.file.filename
    );
    
    res.json({
      message: 'Image uploaded and optimized successfully',
      imageUrl: processedImages.optimized || processedImages.original,
      thumbnailUrl: processedImages.thumbnail,
      originalUrl: processedImages.original,
      filename: req.file.filename
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ message: 'Server error during image upload' });
  }
});

// @route   POST /api/upload/lead-image/:leadId
// @desc    Upload an image for a specific lead
// @access  Private
router.post('/lead-image/:leadId', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const { leadId } = req.params;
    
    // Create the public URL for the image
    const imageUrl = `/uploads/images/${req.file.filename}`;
    
    // Update the lead with the new image URL using Supabase
    const { data: updateResult, error: updateError } = await supabase
      .from('leads')
      .update({ image_url: imageUrl })
      .eq('id', leadId)
      .select();

    if (updateError) {
      console.error('Error updating lead with image:', updateError);
      return res.status(500).json({ message: 'Failed to update lead with image', error: updateError.message });
    }

    if (!updateResult || updateResult.length === 0) {
      console.error('Error updating lead with image: Lead not found');
      return res.status(500).json({ message: 'Failed to update lead with image' });
    }

    // Get the updated lead using Supabase
    const updatedLead = updateResult[0];

    res.json({
      message: 'Image uploaded and lead updated successfully',
      imageUrl,
      lead: updatedLead
    });
  } catch (error) {
    console.error('Lead image upload error:', error);
    res.status(500).json({ message: 'Server error during image upload' });
  }
});

// @route   DELETE /api/upload/image/:filename
// @desc    Delete an uploaded image
// @access  Private
router.delete('/image/:filename', auth, async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(uploadsDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Image not found' });
    }
    
    // Delete the file
    fs.unlinkSync(filePath);
    
    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Image deletion error:', error);
    res.status(500).json({ message: 'Server error during image deletion' });
  }
});

module.exports = router;
