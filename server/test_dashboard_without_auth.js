#!/usr/bin/env node

/**
 * Test Dashboard API without authentication to isolate the issue
 */

const express = require('express');
const cors = require('cors');
const dbManager = require('./database-connection-manager');

const app = express();

// Enable CORS
app.use(cors());
app.use(express.json());

// Test endpoint without authentication
app.get('/api/test/stats/leads', async (req, res) => {
  try {
    console.log('🧪 TEST API CALL: /api/test/stats/leads');
    console.log('Query params:', req.query);

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate required' });
    }

    console.log(`📅 Filtering by appointment date: ${startDate} to ${endDate}`);

    // Get leads filtered by date_booked (same as our working test)
    const leads = await dbManager.query('leads', {
      select: 'id, status, created_at, booker_id, date_booked',
      gte: { date_booked: startDate },
      lte: { date_booked: endDate }
    });

    console.log(`✅ Found ${leads.length} leads`);

    // Calculate counts
    const total = leads.length;
    const statusCounts = {
      new: leads.filter(lead => lead.status === 'New').length,
      booked: leads.filter(lead => lead.status === 'Booked').length,
      attended: leads.filter(lead => lead.status === 'Attended').length,
      cancelled: leads.filter(lead => lead.status === 'Cancelled').length,
      assigned: leads.filter(lead => lead.status === 'Assigned').length,
      rejected: leads.filter(lead => lead.status === 'Rejected').length
    };

    const result = {
      total: total || 0,
      new: statusCounts.new || 0,
      booked: statusCounts.booked || 0,
      attended: statusCounts.attended || 0,
      cancelled: statusCounts.cancelled || 0,
      assigned: statusCounts.assigned || 0,
      rejected: statusCounts.rejected || 0
    };

    console.log('📊 Test API result:', result);
    res.json(result);

  } catch (error) {
    console.error('❌ Test API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint for leads
app.get('/api/test/leads', async (req, res) => {
  try {
    console.log('🧪 TEST API CALL: /api/test/leads');
    console.log('Query params:', req.query);

    const { date_booked_start, date_booked_end, limit } = req.query;

    let queryOptions = {
      select: '*'
    };

    if (date_booked_start && date_booked_end) {
      queryOptions.gte = { date_booked: date_booked_start };
      queryOptions.lte = { date_booked: date_booked_end };
    }

    if (limit) {
      queryOptions.limit = parseInt(limit);
    }

    const leads = await dbManager.query('leads', queryOptions);

    console.log(`✅ Found ${leads.length} leads`);

    res.json({ leads });

  } catch (error) {
    console.error('❌ Test API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the test server
const PORT = 5001; // Different port to avoid conflict
app.listen(PORT, () => {
  console.log('🧪 TEST SERVER RUNNING');
  console.log('======================');
  console.log(`🌐 Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('🔍 Test the APIs directly:');
  console.log(`📊 Stats API: http://localhost:${PORT}/api/test/stats/leads?startDate=2025-09-28T00:00:00.000Z&endDate=2025-09-28T23:59:59.999Z`);
  console.log(`📋 Leads API: http://localhost:${PORT}/api/test/leads?date_booked_start=2025-09-28T00:00:00.000Z&date_booked_end=2025-09-28T23:59:59.999Z&limit=1000`);
  console.log('');
  console.log('💡 Open these URLs in browser to see if data is returned correctly');
  console.log('📊 This will help isolate if the issue is authentication or data processing');
});

module.exports = app;