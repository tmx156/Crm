const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Import centralized configuration
const config = require('../config');

// Use centralized Supabase configuration
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      console.error('Authentication failed: No token provided');
      return res.status(401).json({ message: 'No token, authorization denied' });
    }


    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-fallback-secret-key');
    } catch (verifyError) {
      console.error('Token verification failed:', verifyError.message);
      return res.status(401).json({ message: 'Invalid token' });
    }
    
  // Check for null UUID (common issue) - FORCE LOGOUT
  if (!decoded.userId || decoded.userId === '00000000-0000-0000-0000-000000000001') {
    console.error('🚨 INVALID USER ID IN TOKEN:', decoded.userId);
    console.error('🚨 FORCING IMMEDIATE LOGOUT');
    
    // Clear the token from client immediately
    res.clearCookie('token');
    res.clearCookie('authToken');
    res.clearCookie('jwt');
    
    // Send response that forces client to clear localStorage
    return res.status(401).json({ 
      message: 'Invalid user session - please login again',
      clearToken: true,
      forceLogout: true,
      invalidUserId: decoded.userId
    });
  }

    // Find user in database
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (error) {
      console.error('User lookup error:', error.message);
      console.error('Error details:', error);
      console.error('User ID being looked up:', decoded.userId);

      // Handle specific Supabase errors
      if (error.message.includes('Cannot coerce')) {
        console.error('Multiple users found with same ID - this should not happen!');
        return res.status(500).json({ message: 'Database integrity error' });
      }

      return res.status(401).json({ message: 'User lookup failed' });
    }

    if (!user) {
      console.error('User not found in database:', decoded.userId);
      return res.status(401).json({ message: 'User not found' });
    }

    // Check if user is active (optional, if you have an is_active column)
    if (user.is_active === 0) {
      console.error(`Authentication failed: User account is inactive - ID: ${decoded.userId}`);
      return res.status(403).json({ message: 'Account is inactive' });
    }

    req.user = user; // Single user object
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Authentication failed' });
  }
};

const adminAuth = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Middleware to check if user is booker or admin
const bookerAuth = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'booker') {
      return res.status(403).json({ message: 'Access denied. Booker or admin role required.' });
    }

    next();
  } catch (error) {
    console.error('Booker auth error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { auth, adminAuth, bookerAuth }; 