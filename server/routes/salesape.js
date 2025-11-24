/**
 * SalesAPE API Integration Routes
 * 
 * These endpoints allow SalesAPE to:
 * - GET leads from our CRM
 * - POST/PUT leads to our CRM
 * - Read/Write custom fields
 * 
 * Authentication: API Key via middleware
 */

const express = require('express');
const router = express.Router();
const salesapeAuth = require('../middleware/salesapeAuth');
const dbManager = require('../database-connection-manager');
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * @route   GET /api/salesape/leads
 * @desc    Get leads (SalesAPE can read leads from CRM)
 * @access  SalesAPE API Key
 */
router.get('/leads', salesapeAuth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      status, 
      search,
      created_at_start,
      created_at_end,
      updated_since // For syncing only updated leads
    } = req.query;

    // Validate and cap limit
    const validatedLimit = Math.min(parseInt(limit) || 50, 100);
    const pageInt = Math.max(parseInt(page) || 1, 1);
    const from = (pageInt - 1) * validatedLimit;
    const to = from + validatedLimit - 1;

    // Build query
    let query = supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // Filter out ghost bookings
    query = query.neq('postcode', 'ZZGHOST');

    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    }

    if (created_at_start) {
      query = query.gte('created_at', created_at_start);
    }

    if (created_at_end) {
      query = query.lte('created_at', created_at_end);
    }

    // For syncing: get leads updated since a certain time
    if (updated_since) {
      query = query.gte('updated_at', updated_since);
    }

    const { data: leads, error, count } = await query;

    if (error) {
      console.error('SalesAPE GET leads error:', error);
      return res.status(500).json({ 
        message: 'Error fetching leads',
        error: error.message
      });
    }

    console.log(`✅ SalesAPE: Retrieved ${leads?.length || 0} leads (total: ${count})`);

    res.json({
      success: true,
      data: leads || [],
      pagination: {
        page: pageInt,
        limit: validatedLimit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / validatedLimit)
      }
    });
  } catch (error) {
    console.error('SalesAPE GET leads error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/salesape/leads/:id
 * @desc    Get single lead by ID
 * @access  SalesAPE API Key
 */
router.get('/leads/:id', salesapeAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: lead, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ 
          message: 'Lead not found',
          error: 'Lead with this ID does not exist'
        });
      }
      console.error('SalesAPE GET lead error:', error);
      return res.status(500).json({ 
        message: 'Error fetching lead',
        error: error.message
      });
    }

    res.json({
      success: true,
      data: lead
    });
  } catch (error) {
    console.error('SalesAPE GET lead error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/salesape/leads
 * @desc    Create new lead (SalesAPE can create leads in CRM)
 * @access  SalesAPE API Key
 */
router.post('/leads', salesapeAuth, async (req, res) => {
  try {
    const leadData = req.body;

    // Map SalesAPE fields to our CRM structure
    const mappedLead = {
      name: leadData.name || leadData.full_name || leadData.contact_name,
      phone: leadData.phone || leadData.phone_number || leadData.mobile,
      email: leadData.email || leadData.email_address,
      postcode: leadData.postcode || leadData.postal_code || leadData.zip,
      age: leadData.age ? parseInt(leadData.age) : null,
      notes: leadData.notes || leadData.qualification_notes || leadData.comments || '',
      status: leadData.status || 'New',
      date_booked: leadData.date_booked || leadData.appointment_date || null,
      time_booked: leadData.time_booked || leadData.appointment_time || null,
      // Store SalesAPE metadata
      salesape_id: leadData.salesape_id || leadData.id,
      salesape_qualified: leadData.qualified || false,
      salesape_conversation_id: leadData.conversation_id || null,
      // Custom fields (stored in notes or as JSON)
      custom_fields: leadData.custom_fields ? JSON.stringify(leadData.custom_fields) : null
    };

    // Remove null/undefined values
    Object.keys(mappedLead).forEach(key => {
      if (mappedLead[key] === null || mappedLead[key] === undefined) {
        delete mappedLead[key];
      }
    });

    // Check for duplicates (by phone or email)
    if (mappedLead.phone || mappedLead.email) {
      let duplicateQuery = supabase.from('leads').select('id, name, phone, email');

      if (mappedLead.phone) {
        duplicateQuery = duplicateQuery.eq('phone', mappedLead.phone);
      } else if (mappedLead.email) {
        duplicateQuery = duplicateQuery.eq('email', mappedLead.email);
      }

      const { data: existingLeads } = await duplicateQuery;

      if (existingLeads && existingLeads.length > 0) {
        console.log(`⚠️ SalesAPE: Duplicate lead detected - ${mappedLead.name} (${mappedLead.phone || mappedLead.email})`);
        // Return existing lead instead of creating duplicate
        return res.json({
          success: true,
          data: existingLeads[0],
          duplicate: true,
          message: 'Lead already exists'
        });
      }
    }

    // Insert lead
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert([mappedLead])
      .select()
      .single();

    if (error) {
      console.error('SalesAPE POST lead error:', error);
      return res.status(500).json({ 
        message: 'Error creating lead',
        error: error.message
      });
    }

    console.log(`✅ SalesAPE: Created new lead - ${newLead.name} (ID: ${newLead.id})`);

    res.status(201).json({
      success: true,
      data: newLead,
      message: 'Lead created successfully'
    });
  } catch (error) {
    console.error('SalesAPE POST lead error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/salesape/leads/:id
 * @desc    Update existing lead (SalesAPE can update leads in CRM)
 * @access  SalesAPE API Key
 */
router.put('/leads/:id', salesapeAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Map SalesAPE fields to our CRM structure
    const mappedUpdate = {};

    if (updateData.name || updateData.full_name) mappedUpdate.name = updateData.name || updateData.full_name;
    if (updateData.phone || updateData.phone_number) mappedUpdate.phone = updateData.phone || updateData.phone_number;
    if (updateData.email || updateData.email_address) mappedUpdate.email = updateData.email || updateData.email_address;
    if (updateData.postcode || updateData.postal_code) mappedUpdate.postcode = updateData.postcode || updateData.postal_code;
    if (updateData.age !== undefined) mappedUpdate.age = parseInt(updateData.age);
    if (updateData.notes || updateData.qualification_notes) {
      mappedUpdate.notes = updateData.notes || updateData.qualification_notes;
    }
    if (updateData.status) mappedUpdate.status = updateData.status;
    if (updateData.date_booked || updateData.appointment_date) {
      mappedUpdate.date_booked = updateData.date_booked || updateData.appointment_date;
    }
    if (updateData.time_booked || updateData.appointment_time) {
      mappedUpdate.time_booked = updateData.time_booked || updateData.appointment_time;
    }

    // Update SalesAPE metadata
    if (updateData.salesape_id || updateData.id) {
      mappedUpdate.salesape_id = updateData.salesape_id || updateData.id;
    }
    if (updateData.qualified !== undefined) {
      mappedUpdate.salesape_qualified = updateData.qualified;
    }
    if (updateData.conversation_id) {
      mappedUpdate.salesape_conversation_id = updateData.conversation_id;
    }
    if (updateData.custom_fields) {
      mappedUpdate.custom_fields = JSON.stringify(updateData.custom_fields);
    }

    // Always update updated_at timestamp
    mappedUpdate.updated_at = new Date().toISOString();

    // Update lead
    const { data: updatedLead, error } = await supabase
      .from('leads')
      .update(mappedUpdate)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ 
          message: 'Lead not found',
          error: 'Lead with this ID does not exist'
        });
      }
      console.error('SalesAPE PUT lead error:', error);
      return res.status(500).json({ 
        message: 'Error updating lead',
        error: error.message
      });
    }

    console.log(`✅ SalesAPE: Updated lead - ${updatedLead.name} (ID: ${updatedLead.id})`);

    res.json({
      success: true,
      data: updatedLead,
      message: 'Lead updated successfully'
    });
  } catch (error) {
    console.error('SalesAPE PUT lead error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/salesape/fields
 * @desc    Get available fields and custom fields for leads
 * @access  SalesAPE API Key
 */
router.get('/fields', salesapeAuth, async (req, res) => {
  try {
    // Return schema information about lead fields
    const fields = {
      standard_fields: [
        { name: 'id', type: 'uuid', required: false, description: 'Unique lead identifier' },
        { name: 'name', type: 'string', required: true, description: 'Lead full name' },
        { name: 'phone', type: 'string', required: false, description: 'Contact phone number' },
        { name: 'email', type: 'string', required: false, description: 'Contact email address' },
        { name: 'postcode', type: 'string', required: false, description: 'Postal/ZIP code' },
        { name: 'age', type: 'number', required: false, description: 'Age of lead' },
        { name: 'notes', type: 'string', required: false, description: 'Additional notes' },
        { name: 'status', type: 'string', required: false, description: 'Lead status (New, Assigned, Booked, etc.)' },
        { name: 'date_booked', type: 'date', required: false, description: 'Appointment date' },
        { name: 'time_booked', type: 'string', required: false, description: 'Appointment time' },
        { name: 'booker_id', type: 'uuid', required: false, description: 'Assigned team member ID' }
      ],
      custom_fields: [
        { name: 'salesape_id', type: 'string', description: 'SalesAPE lead ID' },
        { name: 'salesape_qualified', type: 'boolean', description: 'Whether lead is qualified by SalesAPE' },
        { name: 'salesape_conversation_id', type: 'string', description: 'SalesAPE conversation ID' },
        { name: 'custom_fields', type: 'json', description: 'Additional custom fields as JSON' }
      ],
      status_values: ['New', 'Assigned', 'Booked', 'Confirmed', 'Completed', 'Cancelled', 'No Answer']
    };

    res.json({
      success: true,
      data: fields
    });
  } catch (error) {
    console.error('SalesAPE GET fields error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/salesape/health
 * @desc    Health check endpoint for SalesAPE
 * @access  SalesAPE API Key
 */
router.get('/health', salesapeAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

module.exports = router;

