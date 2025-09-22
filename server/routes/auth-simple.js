const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Import centralized configuration
const config = require('../config');

// Use centralized Supabase configuration
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'your-fallback-secret-key', {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user in users table using Supabase with better error handling
    let user = null;
    let userError = null;

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase());

      if (error) {
        userError = error;
        console.error('Database query error:', error);
      } else if (!data || data.length === 0) {
        console.log('No user found for email:', email.toLowerCase());
        return res.status(401).json({ message: 'Invalid credentials' });
      } else if (data.length > 1) {
        console.error('Multiple users found with same email - database integrity issue!');
        console.error('Found users:', data.map(u => ({ id: u.id, email: u.email, created_at: u.created_at })));
        
        // Use the oldest user (first created) and log the issue
        user = data.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
        console.log('Using oldest user:', { id: user.id, email: user.email, created_at: user.created_at });
      } else {
        user = data[0];
      }
    } catch (fetchError) {
      console.error('Network/connection error during user lookup:', fetchError);
      return res.status(500).json({ message: 'Connection error - please try again' });
    }

    if (userError && !user) {
      console.error('User lookup failed:', userError.message);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user) {
      console.error('User not found for email:', email.toLowerCase());
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if user has a password hash (for existing users)
    if (user.password_hash) {
      // Compare password with bcrypt
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
    } else {
      // For users without password hash, check if it's the admin user
      if (user.email === 'admin@crm.com' && password === 'admin123') {
        // Update the user with a proper password hash using Supabase
        const hashedPassword = await bcrypt.hash(password, 10);

        const { error: updateError } = await supabase
          .from('users')
          .update({ password_hash: hashedPassword })
          .eq('id', user.id);

        if (updateError) {
          console.error('Error updating password hash:', updateError);
          return res.status(500).json({ message: 'Error updating password' });
        }
      } else {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      },
      process.env.JWT_SECRET || 'your-fallback-secret-key',
      { expiresIn: '7d' }
    );

    // Return user data
    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      leadsAssigned: user.leads_assigned || 0,
      bookingsMade: user.bookings_made || 0,
      showUps: user.show_ups || 0
    };

    res.json({
      message: 'Login successful',
      token,
      user: userData
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Get current user route
router.get('/me', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-fallback-secret-key');
    
    // Get user from users table using Supabase with better error handling
    let user = null;
    let userError = null;

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', decoded.userId);

      if (error) {
        userError = error;
        console.error('Database query error in /me:', error);
      } else if (!data || data.length === 0) {
        console.error('User not found in /me for ID:', decoded.userId);
        return res.status(404).json({ message: 'User not found' });
      } else if (data.length > 1) {
        console.error('Multiple users found with same ID in /me - database integrity issue!');
        console.error('Found users:', data.map(u => ({ id: u.id, email: u.email, created_at: u.created_at })));
        
        // Use the oldest user and log the issue
        user = data.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
        console.log('Using oldest user in /me:', { id: user.id, email: user.email });
      } else {
        user = data[0];
      }
    } catch (fetchError) {
      console.error('Network/connection error in /me:', fetchError);
      return res.status(500).json({ message: 'Connection error' });
    }

    if (userError && !user) {
      console.error('User lookup failed in /me:', userError.message);
      return res.status(401).json({ message: 'Token is not valid' });
    }

    if (!user) {
      console.error('No user data found in /me for ID:', decoded.userId);
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      leadsAssigned: user.leads_assigned || 0,
      bookingsMade: user.bookings_made || 0,
      showUps: user.show_ups || 0
    };

    res.json({ user: userData });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 