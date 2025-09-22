const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { auth } = require('../middleware/auth');
const MessagingService = require('../utils/messagingService');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey);

const router = express.Router();

// Setup uploads folder for template attachments
const attachmentsDir = path.join(__dirname, '..', 'uploads', 'template_attachments');
if (!fs.existsSync(attachmentsDir)) {
  fs.mkdirSync(attachmentsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, attachmentsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// SQLite dependency removed - using Supabase only

// Upload attachment for template (supports pre-save via 'new' id)
router.post('/:id/attachments', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const fileUrl = `/uploads/template_attachments/${req.file.filename}`;
    return res.json({
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: fileUrl,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  } catch (error) {
    console.error('Error uploading attachment:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/templates
// @desc    Get all templates
// @access  Private (Admin only)
router.get('/', auth, async (req, res) => {
  try {
    const { type, category, isActive } = req.query;

    let query = supabase
      .from('templates')
      .select('*');

    // Apply filters
    if (type) {
      query = query.eq('type', type);
    }
    if (category) {
      query = query.eq('category', category);
    }
    if (isActive !== undefined) {
      query = query.eq('is_active', isActive === 'true');
    }

    query = query.order('type').order('created_at', { ascending: false });

    const { data: templates, error } = await query;

    if (error) {
      console.error('Error fetching templates:', error);
      return res.status(500).json({ message: 'Server error' });
    }

    // Add _id field for frontend compatibility and map field names
    const templatesWithId = (templates || []).map(template => ({
      ...template,
      _id: template.id,
      emailBody: template.email_body || template.content,
      smsBody: template.sms_body || template.content,
      sendEmail: template.send_email || false,
      sendSMS: template.send_sms || false,
      isActive: template.is_active || false,
      reminderDays: template.reminder_days || 5
    }));

    res.json(templatesWithId);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/templates/:id
// @desc    Get single template
// @access  Private (Admin only)
router.get('/:id', auth, async (req, res) => {
  try {
    const { data: template, error } = await supabase
      .from('templates')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      console.error('Error fetching template:', error);
      if (error.code === 'PGRST116') {
        return res.status(404).json({ message: 'Template not found' });
      }
      return res.status(500).json({ message: 'Server error' });
    }

    // Add _id field for frontend compatibility and map field names
    const templateWithId = {
      ...template,
      _id: template.id,
      emailBody: template.email_body || template.content,
      smsBody: template.sms_body || template.content,
      sendEmail: template.send_email || false,
      sendSMS: template.send_sms || false,
      isActive: template.is_active || false,
      reminderDays: template.reminder_days || 5
    };

    res.json(templateWithId);
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/templates
// @desc    Create new template
// @access  Private (Admin only)
router.post('/', auth, async (req, res) => {
  try {
    const {
      name,
      type,
      subject,
      emailBody,
      smsBody,
      variables,
      reminderDays,
      sendEmail,
      sendSMS,
      isActive,
      category
    } = req.body;

    // Validate required fields
    if (!name || !type) {
      return res.status(400).json({ message: 'Name and type are required' });
    }

    // Check if template name already exists
    const { data: existingTemplate, error: checkError } = await supabase
      .from('templates')
      .select('id')
      .eq('name', name)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking existing template:', checkError);
      return res.status(500).json({ message: 'Server error' });
    }

    if (existingTemplate) {
      return res.status(400).json({ message: 'Template name already exists' });
    }

    // Generate unique ID for the template
    const templateId = `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create template data for Supabase
    const templateData = {
      id: templateId,
      name,
      type,
      subject: subject || '',
      email_body: emailBody || '',
      sms_body: smsBody || '',
      category: category || null,
      is_active: isActive !== undefined ? isActive : true,
      is_default: false,
      created_by: req.user.id,
      send_email: sendEmail !== undefined ? sendEmail : true,
      send_sms: sendSMS !== undefined ? sendSMS : false,
      reminder_days: reminderDays || 5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Set content field for backward compatibility
    // Prioritize SMS body for content (shorter messages for SMS)
    if (smsBody) {
      templateData.content = smsBody;
    } else if (emailBody) {
      templateData.content = emailBody;
    }

    // Persist attachments if provided
    if (Array.isArray(req.body.attachments)) {
      templateData.attachments = JSON.stringify(req.body.attachments);
    }

    // Insert template into Supabase
    const { data: createdTemplate, error: insertError } = await supabase
      .from('templates')
      .insert([templateData])
      .select('*')
      .single();

    if (insertError) {
      console.error('Error creating template:', insertError);
      return res.status(500).json({ message: 'Server error', error: insertError.message });
    }

    // Format response for frontend compatibility
    const responseTemplate = {
      ...createdTemplate,
      _id: createdTemplate.id,
      emailBody: createdTemplate.email_body || createdTemplate.content,
      smsBody: createdTemplate.sms_body || createdTemplate.content,
      sendEmail: createdTemplate.send_email,
      sendSMS: createdTemplate.send_sms,
      isActive: createdTemplate.is_active,
      reminderDays: createdTemplate.reminder_days
    };

    res.status(201).json(responseTemplate);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/templates/:id
// @desc    Update template
// @access  Private (Admin only)
router.put('/:id', auth, async (req, res) => {
  try {
    const {
      name,
      type,
      subject,
      emailBody,
      smsBody,
      variables,
      reminderDays,
      sendEmail,
      sendSMS,
      isActive,
      category
    } = req.body;

    // Check if template exists
    const { data: existingTemplate, error: checkError } = await supabase
      .from('templates')
      .select('id, name')
      .eq('id', req.params.id)
      .single();

    if (checkError) {
      console.error('Error checking existing template:', checkError);
      if (checkError.code === 'PGRST116') {
        return res.status(404).json({ message: 'Template not found' });
      }
      return res.status(500).json({ message: 'Server error' });
    }

    // Check if template name already exists (excluding current template)
    if (name && name !== existingTemplate.name) {
      const { data: nameExists, error: nameCheckError } = await supabase
        .from('templates')
        .select('id')
        .eq('name', name)
        .neq('id', req.params.id)
        .single();

      if (nameCheckError && nameCheckError.code !== 'PGRST116') {
        console.error('Error checking template name:', nameCheckError);
        return res.status(500).json({ message: 'Server error' });
      }

      if (nameExists) {
        return res.status(400).json({ message: 'Template name already exists' });
      }
    }

    // Build update data for Supabase
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (subject !== undefined) updateData.subject = subject;
    if (emailBody !== undefined) updateData.email_body = emailBody;
    if (smsBody !== undefined) updateData.sms_body = smsBody;
    if (isActive !== undefined) updateData.is_active = isActive;
    if (category !== undefined) updateData.category = category;
    if (sendEmail !== undefined) updateData.send_email = sendEmail;
    if (sendSMS !== undefined) updateData.send_sms = sendSMS;
    if (reminderDays !== undefined) updateData.reminder_days = reminderDays;

    // Update content field - prioritize SMS body for shorter messages
    if (smsBody !== undefined) {
      updateData.content = smsBody;
    } else if (emailBody !== undefined) {
      updateData.content = emailBody;
    }

    // Persist attachments if provided
    if (Array.isArray(req.body.attachments)) {
      updateData.attachments = JSON.stringify(req.body.attachments);
    }

    // Update template in Supabase
    const { data: updatedTemplate, error: updateError } = await supabase
      .from('templates')
      .update(updateData)
      .eq('id', req.params.id)
      .select('*')
      .single();

    if (updateError) {
      console.error('Error updating template:', updateError);
      return res.status(500).json({ message: 'Server error', error: updateError.message });
    }

    // Format response for frontend compatibility
    const responseTemplate = {
      ...updatedTemplate,
      _id: updatedTemplate.id,
      emailBody: updatedTemplate.email_body || updatedTemplate.content,
      smsBody: updatedTemplate.sms_body || updatedTemplate.content,
      sendEmail: updatedTemplate.send_email,
      sendSMS: updatedTemplate.send_sms,
      isActive: updatedTemplate.is_active,
      reminderDays: updatedTemplate.reminder_days
    };

    // Handle attachments parsing
    if (responseTemplate.attachments && typeof responseTemplate.attachments === 'string') {
      try {
        responseTemplate.attachments = JSON.parse(responseTemplate.attachments);
      } catch (e) {
        console.warn('Failed to parse attachments:', e);
        responseTemplate.attachments = [];
      }
    }

    res.json(responseTemplate);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/templates/:id
// @desc    Delete template
// @access  Private (Admin only)
router.delete('/:id', auth, async (req, res) => {
  try {
    // Delete template from Supabase
    const { error: deleteError } = await supabase
      .from('templates')
      .delete()
      .eq('id', req.params.id);

    if (deleteError) {
      console.error('Error deleting template:', deleteError);
      return res.status(500).json({ message: 'Server error', error: deleteError.message });
    }

    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/templates/sms/default
// @desc    Get default SMS templates for messaging
// @access  Private
router.get('/sms/default', auth, async (req, res) => {
  try {
    const { data: templates, error } = await supabase
      .from('templates')
      .select('id, name, category, sms_body, content')
      .eq('type', 'sms')
      .eq('is_active', true)
      .eq('is_default', true);

    if (error) {
      console.error('Error fetching SMS templates:', error);
      return res.status(500).json({ message: 'Server error' });
    }

    // Adapt response to match expected format
    const adaptedTemplates = (templates || []).map(template => ({
      _id: template.id,
      name: template.name,
      category: template.category,
      message: template.sms_body || template.content,
      placeholders: [] // Would need to extract from content
    }));

    res.json(adaptedTemplates);
  } catch (error) {
    console.error('Get SMS templates error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// @route   POST /api/templates/:id/preview
// @desc    Preview template with sales data
// @access  Private
router.post('/:id/preview', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { sales } = req.body;

    if (!sales || sales.length === 0) {
      return res.status(400).json({ message: 'Sales data is required' });
    }

    // Get the template from Supabase
    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (templateError) {
      console.error('Error fetching template:', templateError);
      if (templateError.code === 'PGRST116') {
        return res.status(404).json({ message: 'Template not found' });
      }
      return res.status(500).json({ message: 'Server error' });
    }

    const previews = [];

    for (const saleData of sales) {
      try {
        // Get the full sale data from Supabase
        const { data: sale, error: saleError } = await supabase
          .from('sales')
          .select(`
            *,
            leads!sales_lead_id_fkey(name, email, phone)
          `)
          .eq('id', saleData.id)
          .single();

        if (saleError || !sale) {
          console.warn(`Sale ${saleData.id} not found, skipping`);
          continue;
        }

        // Prepare variables for template replacement
        const variables = {
          '{leadName}': sale.leads?.name || saleData.lead_name || 'Customer',
          '{leadEmail}': sale.leads?.email || saleData.lead_email || '',
          '{leadPhone}': sale.leads?.phone || saleData.lead_phone || '',
          '{saleAmount}': sale.amount || saleData.amount || '0.00',
          '{saleAmountFormatted}': new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(sale.amount || saleData.amount || 0),
          '{paymentMethod}': sale.payment_method || 'Card',
          '{saleDate}': new Date(saleData.sale_date || sale.created_at).toLocaleDateString('en-GB'),
          '{saleTime}': new Date(saleData.sale_date || sale.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          '{receiptId}': sale.id || 'N/A',
          '{saleNotes}': sale.notes || '',
          '{companyName}': 'Modelling Studio CRM',
          '{paymentType}': sale.payment_type || saleData.payment_type || 'full_payment'
        };

        // Add finance-specific variables if applicable
        if (sale.payment_type === 'finance' || saleData.payment_type === 'finance') {
          const { data: finance, error: financeError } = await supabase
            .from('finance')
            .select('*')
            .eq('sale_id', sale.id)
            .single();

          if (!financeError && finance) {
            variables['{financePaymentAmount}'] = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(finance.payment_amount || 0);
            variables['{financeFrequency}'] = finance.frequency || 'Monthly';
            variables['{financeStartDate}'] = new Date(finance.start_date).toLocaleDateString('en-GB');
            variables['{nextPaymentDate}'] = new Date(finance.next_payment_date).toLocaleDateString('en-GB');
            variables['{remainingBalance}'] = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(finance.remaining_balance || 0);
          }
        }

        // Replace variables in content
        let emailSubject = template.subject || '';
        let emailBody = template.email_body || template.content || '';
        let smsBody = template.sms_body || template.content || '';

        Object.entries(variables).forEach(([key, value]) => {
          emailSubject = emailSubject.replace(new RegExp(key, 'g'), value);
          emailBody = emailBody.replace(new RegExp(key, 'g'), value);
          smsBody = smsBody.replace(new RegExp(key, 'g'), value);
        });

        previews.push({
          customerName: sale.leads?.name || saleData.lead_name || 'Customer',
          paymentType: sale.payment_type || saleData.payment_type || 'full_payment',
          emailSubject,
          emailBody,
          smsBody
        });

      } catch (saleError) {
        console.error('Error processing sale for preview:', saleError);
        previews.push({
          customerName: saleData.lead_name || 'Customer',
          paymentType: saleData.payment_type || 'unknown',
          emailSubject: 'Error generating preview',
          emailBody: 'Error generating preview',
          smsBody: 'Error generating preview'
        });
      }
    }

    res.json(previews);

  } catch (error) {
    console.error('Template preview error:', error);
    res.status(500).json({ message: 'Error generating template preview', error: error.message });
  }
});

// Get template variables
router.get('/variables/list', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const { type } = req.query;
    let variables = [
      { name: '{leadName}', description: 'Lead\'s full name', example: 'John Doe' },
      { name: '{leadEmail}', description: 'Lead\'s email address', example: 'john@example.com' },
      { name: '{leadPhone}', description: 'Lead\'s phone number', example: '+1234567890' },
      { name: '{userName}', description: 'User\'s name who sent the message', example: 'Admin User' },
      { name: '{userEmail}', description: 'User\'s email address', example: 'admin@example.com' },
      { name: '{bookingDate}', description: 'Appointment date', example: '01/15/2024' },
      { name: '{bookingTime}', description: 'Appointment time', example: '2:30 PM' },
      { name: '{companyName}', description: 'Company name', example: 'Modelling Studio CRM' },
      { name: '{currentDate}', description: 'Current date', example: '01/10/2024' },
      { name: '{currentTime}', description: 'Current time', example: '10:30 AM' }
    ];

    // Add sale-specific variables if type is sale_notification
    if (type === 'sale_notification') {
      variables = variables.concat([
        { name: '{saleAmount}', description: 'Sale amount', example: '£150.00' },
        { name: '{saleAmountFormatted}', description: 'Formatted sale amount', example: '£150.00' },
        { name: '{paymentMethod}', description: 'Payment method used', example: 'Card' },
        { name: '{saleDate}', description: 'Date of sale', example: '01/15/2024' },
        { name: '{saleTime}', description: 'Time of sale', example: '2:30 PM' },
        { name: '{receiptId}', description: 'Receipt ID', example: 'RCPT123456' },
        { name: '{saleNotes}', description: 'Notes about the sale', example: 'Package A with extras' }
      ]);
    }

    res.json(variables);
  } catch (error) {
    console.error('Error fetching template variables:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Test template by sending to a specific lead
router.post('/:id/test/:leadId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (templateError) {
      console.error('Error fetching template:', templateError);
      return res.status(404).json({ message: 'Template not found' });
    }

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', req.params.leadId)
      .single();

    if (leadError) {
      console.error('Error fetching lead:', leadError);
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Adapt template format for MessagingService
    const adaptedTemplate = {
      ...template,
      emailBody: template.email_body || template.content,
      smsBody: template.sms_body || template.content,
      sendEmail: true, // Default values since we don't have these columns yet
      sendSMS: true
    };

    // Process template with actual lead data
    const processedTemplate = MessagingService.processTemplate(
      adaptedTemplate, 
      lead, 
      req.user, 
      lead.date_booked
    );

    // Create test message record
    const messageData = {
      lead_id: lead.id,
      type: adaptedTemplate.sendEmail && adaptedTemplate.sendSMS ? 'both' : 
            adaptedTemplate.sendEmail ? 'email' : 'sms',
      content: processedTemplate.emailBody || processedTemplate.smsBody,
      status: 'pending'
    };

    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert([messageData])
      .select()
      .single();

    if (messageError) {
      console.error('Error creating message:', messageError);
      return res.status(500).json({ message: 'Error creating test message' });
    }

    // Send test messages
    if (adaptedTemplate.sendEmail) {
      await MessagingService.sendEmail(message);
    }
    if (adaptedTemplate.sendSMS) {
      await MessagingService.sendSMS(message);
    }

    res.json({ 
      message: 'Test message sent successfully',
      messageId: message.id
    });
  } catch (error) {
    console.error('Error testing template:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create default sales template
router.post('/create-sales-default', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    // Check if sales template already exists
    const { data: existingTemplate } = await supabase
      .from('templates')
      .select('id')
      .eq('type', 'sale_notification')
      .single();

    if (existingTemplate) {
      return res.status(400).json({ message: 'Sales notification template already exists' });
    }

    const defaultSalesTemplate = {
      name: 'Sales Notification',
      type: 'sale_notification',
      subject: 'Thank you for your purchase - {companyName}',
      email_body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Thank you for your purchase!</h1>
          <p>Dear {leadName},</p>
          <p>Thank you for choosing {companyName}. We're delighted to confirm your purchase.</p>
          
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Purchase Details:</h3>
            <p><strong>Customer:</strong> {leadName}</p>
            <p><strong>Date:</strong> {saleDate}</p>
            <p><strong>Time:</strong> {saleTime}</p>
            <p><strong>Amount:</strong> {saleAmountFormatted}</p>
            <p><strong>Payment Method:</strong> {paymentMethod}</p>
            <p><strong>Receipt ID:</strong> {receiptId}</p>
          </div>
          
          <p>If you have any questions about your purchase, please don't hesitate to contact us.</p>
          <p>Best regards,<br>{companyName} Team</p>
        </div>
      `,
      sms_body: `Thank you for your purchase at {companyName}!
Amount: {saleAmountFormatted}
Date: {saleDate}
Receipt ID: {receiptId}
Payment: {paymentMethod}`,
      is_active: true,
      created_by: req.user.id
    };

    const { data: template, error } = await supabase
      .from('templates')
      .insert([defaultSalesTemplate])
      .select(`
        *,
        creator:users!created_by(name, email)
      `)
      .single();

    if (error) {
      console.error('Error creating default sales template:', error);
      return res.status(500).json({ message: 'Error creating default sales template' });
    }

    res.status(201).json({
      message: 'Default sales notification template created successfully',
      template
    });
  } catch (error) {
    console.error('Error creating default sales template:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/templates/active/sms
// @desc    Get all active SMS templates
// @access  Private
router.get('/active/sms', auth, async (req, res) => {
  try {
    const { data: templates, error } = await supabase
      .from('templates')
      .select('*')
      .eq('is_active', true)
      .or('type.eq.sms,sms_body.not.is.null');

    if (error) {
      console.error('Error fetching active SMS templates:', error);
      return res.status(500).json({ message: 'Server error' });
    }

    // Add _id field for frontend compatibility
    const templatesWithId = (templates || []).map(template => ({
      ...template,
      _id: template.id
    }));

    res.json(templatesWithId);
  } catch (error) {
    console.error('Error fetching active SMS templates:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/templates/active/email
// @desc    Get all active Email templates
// @access  Private
router.get('/active/email', auth, async (req, res) => {
  try {
    const { data: templates, error } = await supabase
      .from('templates')
      .select('*')
      .eq('is_active', true)
      .or('type.eq.email,email_body.not.is.null');

    if (error) {
      console.error('Error fetching active Email templates:', error);
      return res.status(500).json({ message: 'Server error' });
    }

    // Add _id field for frontend compatibility
    const templatesWithId = (templates || []).map(template => ({
      ...template,
      _id: template.id
    }));

    res.json(templatesWithId);
  } catch (error) {
    console.error('Error fetching active Email templates:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 