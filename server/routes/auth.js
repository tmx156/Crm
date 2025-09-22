const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

// @route   POST /api/auth/register
// @desc    Register new user
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role = 'sales' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    // Using Supabase instead of SQLite

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser && !checkError) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Generate UUID for user ID
    const { v4: uuidv4 } = require('uuid');
    const userId = uuidv4();

    // Create user profile in users table
    const { data, error: insertError } = await supabase
      .from('users')
      .insert({
        id: userId,
        email: email.toLowerCase(),
        name: name,
        password_hash: passwordHash,
        role: role,
        leads_assigned: 0,
        bookings_made: 0,
        show_ups: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('Error creating user:', insertError);
      return res.status(500).json({ message: 'Error creating user profile' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: userId, 
        email: email.toLowerCase(), 
        role 
      },
      process.env.JWT_SECRET || 'your-fallback-secret-key',
      { expiresIn: '7d' }
    );

    // Return user data
    const userData = {
      id: userId,
      name,
      email: email.toLowerCase(),
      role,
      leadsAssigned: 0,
      bookingsMade: 0,
      showUps: 0
    };

    // Using Supabase instead of SQLite

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: userData
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Get user profile from users table
    const { data: userProfile, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (!userProfile || userError) {
      console.error(`Login attempt failed: User not found - ${email}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, userProfile.password_hash);
    if (!isValidPassword) {
      console.error(`Login attempt failed: Invalid password - ${email}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Log successful login attempt
    console.log(`Successful login: ${email} (Role: ${userProfile.role})`);

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: userProfile.id, 
        email: userProfile.email, 
        role: userProfile.role 
      },
      process.env.JWT_SECRET || 'your-fallback-secret-key',
      { expiresIn: '7d' }
    );

    // Return user data
    const userData = {
      id: userProfile.id,
      name: userProfile.name,
      email: userProfile.email,
      role: userProfile.role,
      leadsAssigned: userProfile.leads_assigned || 0,
      bookingsMade: userProfile.bookings_made || 0,
      showUps: userProfile.show_ups || 0
    };

    // Using Supabase instead of SQLite

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
    
    // Get user from database
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (!user || userError) {
      return res.status(401).json({ message: 'Token is not valid' });
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

    // Using Supabase instead of SQLite
    res.json({ user: userData });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 