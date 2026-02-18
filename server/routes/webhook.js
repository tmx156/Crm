const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const dbManager = require('../database-connection-manager');

// API key auth middleware for webhooks
const webhookAuth = (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey || apiKey !== config.webhook.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
};

// @route   POST /api/webhook/leads
// @desc    Create a lead from an external source (landing page, etc.)
// @access  API Key
router.post('/leads', webhookAuth, async (req, res) => {
  try {
    const { name, email, phone, age, postcode, parent_phone, image_url, source } = req.body;

    // Validation
    if (!name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: name, phone' });
    }

    // Duplicate check by normalized name + phone
    const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');
    const normalizedName = name.trim().toLowerCase();

    const existingLeads = await dbManager.query('leads', {
      select: 'id, name, phone',
      is: { deleted_at: null }
    });

    const duplicate = existingLeads.find(lead => {
      const leadName = lead.name ? lead.name.trim().toLowerCase() : '';
      const leadPhone = lead.phone ? lead.phone.replace(/[\s\-\(\)]/g, '') : '';
      return leadName === normalizedName && leadPhone === normalizedPhone;
    });

    if (duplicate) {
      return res.status(409).json({
        error: 'Lead already exists',
        existingLeadId: duplicate.id
      });
    }

    // Build lead record
    const leadId = uuidv4();
    const leadToInsert = {
      id: leadId,
      name: name.trim(),
      phone: phone,
      email: email || '',
      postcode: postcode || '',
      age: age || null,
      parent_phone: parent_phone || '',
      image_url: image_url || '',
      status: 'New',
      notes: source ? `Website Lead: ${source}` : 'Website Lead',
      booking_history: JSON.stringify([]),
      is_confirmed: 0,
      booking_status: null,
      date_booked: null,
      booker_id: null,
      created_by_user_id: null,
      booked_at: null,
      ever_booked: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Insert using service role to bypass RLS
    const serviceRoleClient = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey || config.supabase.anonKey
    );

    const { data: insertResult, error: insertError } = await serviceRoleClient
      .from('leads')
      .insert([leadToInsert])
      .select();

    if (insertError) {
      console.error('Webhook lead insert error:', insertError);
      return res.status(500).json({ error: 'Failed to create lead: ' + insertError.message });
    }

    if (!insertResult || insertResult.length === 0) {
      return res.status(500).json({ error: 'No data inserted' });
    }

    const lead = insertResult[0];

    // Broadcast real-time update to CRM dashboards
    if (global.io) {
      global.io.emit('lead_updated', {
        lead,
        action: 'created',
        leadId: lead.id,
        timestamp: new Date().toISOString()
      });
      global.io.emit('stats_update_needed', {
        type: 'lead_created',
        leadId: lead.id,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`✅ Webhook: Created lead "${lead.name}" (${lead.id}) from ${source || 'website'}`);

    res.status(201).json({
      success: true,
      leadId: lead.id,
      name: lead.name
    });
  } catch (error) {
    console.error('Webhook lead creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
