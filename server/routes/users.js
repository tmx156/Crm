const express = require('express');
const bcrypt = require('bcryptjs');
const { auth, adminAuth } = require('../middleware/auth');
const dbManager = require('../database-connection-manager');
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

const router = express.Router();

// @route   POST /api/users
// @desc    Create new user
// @access  Private (Admin only)
router.post('/', auth, async (req, res) => {
  try {
    // Ensure only admin can create users
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized: Admin access required' });
    }

    const { name, email, password, role = 'booker' } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({ 
        message: 'Name, email, and password are required' 
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ 
        message: 'Password must be at least 6 characters long' 
      });
    }

    // Validate role
    if (!['admin', 'booker', 'viewer'].includes(role)) {
      return res.status(400).json({ 
        message: 'Role must be admin, booker, or viewer' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if user already exists
    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim());

    if (checkError) {
      console.error('User existence check error:', checkError);
      return res.status(500).json({ message: 'Error checking user existence' });
    }

    if (existingUsers && existingUsers.length > 0) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Generate UUID for user
    const userId = require('crypto').randomUUID();

    // Create user profile in users table using Supabase
    const { data: userResult, error: insertError } = await supabase
      .from('users')
      .insert({
        id: userId,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password_hash: hashedPassword,
        role: role,
        leads_assigned: 0,
        bookings_made: 0,
        show_ups: 0,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select('id, name, email, role')
      .single();

    if (insertError || !userResult) {
      console.error('User creation error:', insertError);
      return res.status(500).json({ message: 'Error creating user profile', error: insertError?.message });
    }

    // Prepare user response (exclude sensitive info)
    const responseData = {
      id: userId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      role: role,
      leadsAssigned: 0,
      bookingsMade: 0,
      showUps: 0,
      isActive: true
    };

    res.status(201).json({
      message: 'User created successfully',
      user: responseData
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// @route   GET /api/users
// @desc    Get all users
// @access  Private (Admin only)
router.get('/', auth, async (req, res) => {
  try {
    const users = await dbManager.query('users', {
      select: '*',
      eq: { is_active: true },
      order: { created_at: 'desc' }
    });
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/bookers
// @desc    Get team members for assignment (sales and admins)
// @access  Private (Admin only)
router.get('/bookers', auth, adminAuth, async (req, res) => {
  try {
    console.log('🔍 Fetching bookers for user:', req.user.name, req.user.role);
    
    // Get users with booker or admin roles who are active
    const bookerUsers = await dbManager.query('users', {
      select: 'id, name, email, leads_assigned',
      eq: { role: 'booker', is_active: true },
      order: { name: 'asc' }
    });
    
    const adminUsers = await dbManager.query('users', {
      select: 'id, name, email, leads_assigned',
      eq: { role: 'admin', is_active: true },
      order: { name: 'asc' }
    });
    
    // Combine and sort all team members
    const allBookers = [...bookerUsers, ...adminUsers].sort((a, b) => a.name.localeCompare(b.name));
    
    console.log('📋 Found bookers:', allBookers);
    res.json(allBookers);
  } catch (error) {
    console.error('Get bookers error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/:id
// @desc    Get single user
// @access  Private (Admin only)
router.get('/:id', auth, async (req, res) => {
  try {
    const users = await dbManager.query('users', {
      select: '*',
      eq: { id: req.params.id }
    });

    if (!users || users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(users[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/users/:id
// @desc    Update user details (Admin only)
// @access  Private (Admin only)
router.put('/:id', auth, async (req, res) => {
  try {
    // Ensure only admin can update users
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized: Admin access required' });
    }

    const userId = req.params.id;
    const { name, email, role, password } = req.body;

    // Validate inputs
    if (!name || !email) {
      return res.status(400).json({ 
        message: 'Name and email are required' 
      });
    }

    // Validate role
    if (role && !['admin', 'booker', 'viewer'].includes(role)) {
      return res.status(400).json({ 
        message: 'Role must be admin, booker, or viewer' 
      });
    }

    // Validate password if provided
    if (password && password.length < 6) {
      return res.status(400).json({ 
        message: 'Password must be at least 6 characters long' 
      });
    }

    // Check if user exists
    const existingUsers = await dbManager.query('users', {
      select: '*',
      eq: { id: userId }
    });

    if (!existingUsers || existingUsers.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const existingUser = existingUsers[0];

    // Prevent changing the last admin
    if (existingUser.role === 'admin') {
      const adminUsers = await dbManager.query('users', {
        select: 'id',
        eq: { role: 'admin' }
      });
      if (adminUsers.length <= 1 && role !== 'admin') {
        return res.status(400).json({ message: 'Cannot change the role of the last admin' });
      }
    }

    // Check if email is already in use by another user
    const { data: emailCheck, error: emailError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .neq('id', userId);

    if (emailError) {
      console.error('Email check error:', emailError);
      return res.status(500).json({ message: 'Error checking email availability' });
    }

    if (emailCheck && emailCheck.length > 0) {
      return res.status(400).json({ message: 'Email is already in use by another user' });
    }

    // Hash password if provided
    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Prepare update data
    const updateData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      role: role || existingUser.role,
      updated_at: new Date().toISOString()
    };

    if (hashedPassword) {
      updateData.password_hash = hashedPassword;
    }

    // Update user using Supabase
    const { data: updateResult, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, name, email, role');

    if (updateError) {
      console.error('Update user error:', updateError);
      return res.status(500).json({ message: 'Failed to update user', error: updateError.message });
    }

    if (!updateResult || updateResult.length === 0) {
      return res.status(500).json({ message: 'Failed to update user' });
    }

    const updatedUser = updateResult[0];

    res.json({
      message: 'User updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role
      }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// @route   DELETE /api/users/:id
// @desc    Delete a user (Admin only)
// @access  Private (Admin only)
router.delete('/:id', auth, async (req, res) => {
  try {
    // Ensure only admin can delete users
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized: Admin access required' });
    }

    const userId = req.params.id;

    // Prevent deleting self
    if (userId === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    // Check if user exists using Supabase
    const { data: existingUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !existingUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user being deleted is an admin, and if so, prevent deleting last admin
    if (existingUser.role === 'admin') {
      // Count total admin users
      const { data: adminUsers, error: adminError } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'admin');

      if (adminError) {
        console.error('Error checking admin count:', adminError);
        return res.status(500).json({ message: 'Error checking admin permissions' });
      }

      // If this is the last admin, prevent deletion
      if (adminUsers.length <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last admin user' });
      }
    }

    // Log the deletion attempt
    console.log(`🗑️ Admin ${req.user.name} attempting to delete user ${existingUser.name} (${existingUser.role})`);

    // Delete user using Supabase
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (deleteError) {
      console.error('Error deleting user:', deleteError);
      return res.status(500).json({ message: 'Failed to delete user', error: deleteError.message });
    }

    res.json({
      success: true,
      message: 'User deleted successfully',
      deletedUserId: userId
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


// @route   GET /api/users/active-count
// @desc    Get count of active users (recently logged in)
// @access  Private
router.get('/active-count', auth, async (req, res) => {
  try {
    // For now, return a count based on users who have logged in recently
    // In a production app, you'd track active sessions or socket connections
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentUsers, error } = await supabase
      .from('users')
      .select('id')
      .gte('updated_at', sevenDaysAgo);

    if (error) {
      console.error('Error fetching active users:', error);
      // Fallback: return total user count if query fails
      const { data: allUsers, error: allError } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true });

      return res.json({
        count: allError ? 1 : (allUsers?.length || 1),
        period: 'fallback'
      });
    }

    // Return count of users active in the last 7 days
    const activeCount = recentUsers?.length || 0;

    res.json({
      count: activeCount,
      period: '7_days',
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Active users count error:', error);
    // Return a reasonable default if everything fails
    res.json({ count: 1, period: 'error_fallback' });
  }
});

module.exports = router; 