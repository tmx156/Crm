// ✅ FIXED: Messages route now uses Supabase for SMS/Email storage

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const MessagingService = require('../utils/messagingService');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Legacy getDb function - to be removed
const getDb = () => {
  throw new Error('SQLite is disabled - use Supabase instead');
};

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

// Get message history for a lead
router.get('/lead/:leadId', auth, async (req, res) => {
  try {
    const { leadId } = req.params;
    
    // Check if user has access to this lead using Supabase
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id')
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Build query for messages - only admins can view all message history
    let messagesQuery = supabase
      .from('messages')
      .select(`
        *,
        templates(name, type),
        users(name)
      `)
      .eq('lead_id', leadId);

    if (req.user.role !== 'admin') {
      messagesQuery = messagesQuery.eq('sent_by', req.user.id);
    }

    const { data: messages, error: messagesError } = await messagesQuery
      .order('created_at', { ascending: false });

    if (messagesError) {
      console.error('Error fetching messages:', messagesError);
      return res.status(500).json({ message: 'Error fetching messages' });
    }

    res.json(messages || []);
  } catch (error) {
    console.error('Error fetching message history:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all messages (admin only)
router.get('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const { page = 1, limit = 20, status, type } = req.query;
    const offset = (page - 1) * limit;

    // Build base query with joins
    let query = supabase
      .from('messages')
      .select(`
        *,
        leads!inner(
          id,
          name,
          email,
          phone
        ),
        templates(
          id,
          name,
          type
        ),
        users!messages_sent_by_fkey(
          id,
          name
        )
      `, { count: 'exact' });

    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }
    if (type) {
      query = query.eq('type', type);
    }

    // Apply pagination and ordering (use sent_at if available, otherwise created_at)
    query = query
      .order('sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    const { data: messages, error, count } = await query;

    if (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({ message: 'Error fetching messages' });
    }

    // Format the response to match the expected structure
    const formattedMessages = (messages || []).map(msg => ({
      ...msg,
      lead_name: msg.leads?.name,
      lead_email: msg.leads?.email,
      lead_phone: msg.leads?.phone,
      template_name: msg.templates?.name,
      template_type: msg.templates?.type,
      sent_by_name: msg.users?.name
    }));

    res.json({
      messages: formattedMessages,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(count / limit),
        totalMessages: count
      }
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get message by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const { data: message, error } = await supabase
      .from('messages')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Check access permissions
    if (req.user.role !== 'admin' && message.sent_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(message);
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send manual message
router.post('/send', auth, async (req, res) => {
  try {
    const { leadId, templateId, customSubject, customEmailBody, customSmsBody } = req.body;

    // Validate required fields
    if (!leadId || !templateId) {
      return res.status(400).json({ message: 'Lead ID and Template ID are required' });
    }

    // Check if user has access to this lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Get template
    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return res.status(404).json({ message: 'Template not found' });
    }

    // Process template
    let processedTemplate;
    if (customSubject && customEmailBody && customSmsBody) {
      // Use custom content
      processedTemplate = {
        subject: customSubject,
        emailBody: customEmailBody,
        smsBody: customSmsBody
      };
    } else {
      // Use template content - adapt template format
      const adaptedTemplate = {
        ...template,
        emailBody: template.email_body || template.content,
        smsBody: template.sms_body || template.content,
        sendEmail: true, // Default values
        sendSMS: true
      };

      processedTemplate = MessagingService.processTemplate(
        adaptedTemplate, 
        lead, 
        req.user, 
        lead.date_booked
      );
    }

    // Create message record
    const messageData = {
      lead_id: leadId,
      template_id: templateId,
      type: template.type || 'both',
      subject: processedTemplate.subject || template.subject,
      email_body: processedTemplate.emailBody,
      sms_body: processedTemplate.smsBody,
      content: processedTemplate.emailBody || processedTemplate.smsBody || processedTemplate.subject,
      status: 'pending',
      sent_by: req.user.id,
      sent_by_name: req.user.name,
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Insert message
    const { data: newMessage, error: insertError } = await supabase
      .from('messages')
      .insert(messageData)
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting message:', insertError);
      return res.status(500).json({ message: 'Failed to create message' });
    }

    // Send messages
    const adaptedTemplate = {
      ...template,
      emailBody: template.email_body || template.content,
      smsBody: template.sms_body || template.content,
      sendEmail: template.send_email !== false,
      sendSMS: template.send_sms !== false
    };

    try {
      if (adaptedTemplate.sendEmail && lead.email) {
        await MessagingService.sendEmail({
          ...newMessage,
          to: lead.email,
          leadName: lead.name
        });
      }
      if (adaptedTemplate.sendSMS && lead.phone) {
        await MessagingService.sendSMS({
          ...newMessage,
          to: lead.phone,
          leadName: lead.name
        });
      }

      // Update message status
      await supabase
        .from('messages')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', newMessage.id);
    } catch (sendError) {
      console.error('Error sending message:', sendError);
      // Update status to failed
      await supabase
        .from('messages')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', newMessage.id);
    }

    // Get populated message
    const { data: populatedMessage } = await supabase
      .from('messages')
      .select('*')
      .eq('id', newMessage.id)
      .single();

    res.status(201).json(populatedMessage);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Resend failed message
router.post('/:id/resend', auth, async (req, res) => {
  try {
    // Get message with lead info
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select(`
        *,
        leads(
          id,
          name,
          email,
          phone
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (messageError || !message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Check access permissions
    if (req.user.role !== 'admin' && message.sent_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Reset status
    const { error: updateError } = await supabase
      .from('messages')
      .update({ 
        status: 'pending', 
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id);

    if (updateError) {
      console.error('Error updating message status:', updateError);
      return res.status(500).json({ message: 'Failed to update message status' });
    }

    // Get template for resending
    const { data: template } = await supabase
      .from('templates')
      .select('*')
      .eq('id', message.template_id)
      .single();

    // Resend messages
    try {
      if (template) {
        const adaptedTemplate = {
          ...template,
          sendEmail: template.send_email !== false,
          sendSMS: template.send_sms !== false
        };

        if (adaptedTemplate.sendEmail && message.leads?.email) {
          await MessagingService.sendEmail({
            ...message,
            to: message.leads.email,
            leadName: message.leads.name
          });
        }
        if (adaptedTemplate.sendSMS && message.leads?.phone) {
          await MessagingService.sendSMS({
            ...message,
            to: message.leads.phone,
            leadName: message.leads.name
          });
        }
      }

      // Update status to sent
      await supabase
        .from('messages')
        .update({ 
          status: 'sent',
          updated_at: new Date().toISOString()
        })
        .eq('id', req.params.id);
    } catch (sendError) {
      console.error('Error resending message:', sendError);
      // Update status to failed
      await supabase
        .from('messages')
        .update({ 
          status: 'failed',
          updated_at: new Date().toISOString() 
        })
        .eq('id', req.params.id);
    }

    // Get updated message
    const { data: updatedMessage } = await supabase
      .from('messages')
      .select('*')
      .eq('id', req.params.id)
      .single();

    res.json(updatedMessage);
  } catch (error) {
    console.error('Error resending message:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get message statistics
router.get('/stats/overview', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const { startDate, endDate } = req.query;
    
    // Build query
    let query = supabase
      .from('messages')
      .select(`
        *,
        templates(
          id,
          name
        )
      `);
    
    if (startDate && endDate) {
      query = query
        .gte('sent_at', startDate)
        .lte('sent_at', endDate);
    }

    const { data: messages, error } = await query;

    if (error) {
      console.error('Error fetching messages:', error);
      return res.status(500).json({ message: 'Error fetching statistics' });
    }

    // Calculate statistics
    const stats = {
      total: messages?.length || 0,
      sent: messages?.filter(m => m.status === 'sent').length || 0,
      delivered: messages?.filter(m => m.status === 'delivered').length || 0,
      failed: messages?.filter(m => m.status === 'failed').length || 0,
      pending: messages?.filter(m => m.status === 'pending').length || 0,
      email: messages?.filter(m => m.type === 'email' || m.type === 'both').length || 0,
      sms: messages?.filter(m => m.type === 'sms' || m.type === 'both').length || 0
    };

    // Get template statistics
    const templateStats = {};
    messages?.forEach(message => {
      if (message.template_id) {
        const templateId = message.template_id;
        const templateName = message.templates?.name || 'Unknown Template';
        
        if (!templateStats[templateName]) {
          templateStats[templateName] = {
            count: 0,
            sent: 0,
            failed: 0
          };
        }
        templateStats[templateName].count++;
        if (message.status === 'sent') templateStats[templateName].sent++;
        if (message.status === 'failed') templateStats[templateName].failed++;
      }
    });

    // Format template stats
    const byTemplate = Object.entries(templateStats).map(([templateName, stats]) => ({
      _id: templateName,
      count: stats.count,
      sent: stats.sent,
      failed: stats.failed
    })).sort((a, b) => b.count - a.count);

    res.json({
      overview: stats,
      byTemplate
    });
  } catch (error) {
    console.error('Error fetching message statistics:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 