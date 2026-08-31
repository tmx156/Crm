const express = require('express');
const dbManager = require('../database-connection-manager');

const router = express.Router();

// @route   GET /api/users-public
// @desc    Get users for dashboard (temporary fix for authentication issue)
// @access  Public (temporary)
router.get('/', async (req, res) => {
  try {
    const { role } = req.query;

    console.log('📊 PUBLIC USERS API: Dashboard requesting user details');
    console.log(`👤 Role filter: ${role || 'all'}`);

    let queryOptions = {
      select: 'id, name, role, email',
      eq: { is_active: true },
      order: { created_at: 'desc' }
    };

    // Add role filter if specified
    if (role) {
      queryOptions.eq = { ...queryOptions.eq, role: role };
    }

    const users = await dbManager.query('users', queryOptions);

    console.log(`📊 PUBLIC USERS RESULT: Found ${users.length} users${role ? ` with role ${role}` : ''}`);
    res.json({ users });

  } catch (error) {
    console.error('❌ Public users error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;