const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const { sendCustomMessage } = require('../utils/smsService');
const dbManager = require('../database-connection-manager');

// Import Supabase client for direct operations
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

// Import messaging service for sending receipts
const MessagingService = require('../utils/messagingService');

// Function to send receipt email using template
const sendReceiptEmail = async (sale, lead) => {
  try {
    const dbManager = require('../database-connection-manager');
    
    // Get receipt template from Supabase
    const templates = await dbManager.query('templates', {
      select: '*',
      eq: { type: 'sale_receipt', is_active: true },
      limit: 1
    });
    
    const template = templates.length > 0 ? templates[0] : null;
    
    if (!template) {
      console.warn('No receipt template found, skipping email');
      return;
    }
    
    // Generate receipt ID
    const receiptId = sale.id.toString().slice(-6).toUpperCase();
    
    // Create processed template with sale variables
    const processedTemplate = {
      subject: template.subject
        .replace(/{leadName}/g, lead.name || 'Customer')
        .replace(/{companyName}/g, 'Focus Models')
        .replace(/{receiptId}/g, receiptId)
        .replace(/{saleDate}/g, new Date(sale.created_at).toLocaleDateString())
        .replace(/{saleTime}/g, new Date(sale.created_at).toLocaleTimeString())
        .replace(/{saleAmount}/g, sale.amount.toString())
        .replace(/{saleAmountFormatted}/g, `£${sale.amount.toFixed(2)}`)
        .replace(/{paymentMethod}/g, sale.payment_method || 'Unknown')
        .replace(/{paymentType}/g, sale.payment_type || 'full_payment'),
        
      email_body: template.email_body
        .replace(/{leadName}/g, lead.name || 'Customer')
        .replace(/{leadEmail}/g, lead.email || '')
        .replace(/{leadPhone}/g, lead.phone || '')
        .replace(/{companyName}/g, 'Focus Models')
        .replace(/{receiptId}/g, receiptId)
        .replace(/{saleDate}/g, new Date(sale.created_at).toLocaleDateString())
        .replace(/{saleTime}/g, new Date(sale.created_at).toLocaleTimeString())
        .replace(/{saleAmount}/g, sale.amount.toString())
        .replace(/{saleAmountFormatted}/g, `£${sale.amount.toFixed(2)}`)
        .replace(/{paymentMethod}/g, sale.payment_method || 'Unknown')
        .replace(/{paymentType}/g, sale.payment_type || 'full_payment')
        .replace(/{saleNotes}/g, sale.notes ? `\n\nNotes: ${sale.notes}` : '')
        .replace(/{currentDate}/g, new Date().toLocaleDateString())
        .replace(/{currentTime}/g, new Date().toLocaleTimeString()),
        
      sms_body: template.sms_body || ''
    };
    
    // Create a temporary message record for the receipt
    const messageData = {
      lead_id: lead.id,
      template_id: template.id,
      type: 'email',
      subject: processedTemplate.subject,
      email_body: processedTemplate.email_body,
      sms_body: processedTemplate.sms_body,
      recipient_email: lead.email,
      recipient_phone: lead.phone,
      sent_by: 'system', // Automatic system email
      booking_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      attachments: []
    };
    
    // Insert message record using Supabase
    const insertedMessages = await dbManager.insert('messages', messageData);
    
    if (insertedMessages && insertedMessages.length > 0) {
      messageData.id = insertedMessages[0].id;
    }
    
    // Send the email using MessagingService
    await MessagingService.sendEmail(messageData);
    
    console.log(`📧 Receipt email sent for sale ${sale.id} to ${lead.email}`);
    
  } catch (error) {
    console.error('Error sending receipt email:', error);
    throw error;
  }
};

// Import booking history function
const addBookingHistoryEntry = async (leadId, action, details, performedBy, performedByName) => {
  try {
    const dbManager = require('../database-connection-manager');
    
    // Get current booking history from Supabase
    const leads = await dbManager.query('leads', {
      select: 'booking_history',
      eq: { id: leadId }
    });

    if (!leads || leads.length === 0) {
      console.warn(`Lead ${leadId} not found for booking history update`);
      return;
    }

    const lead = leads[0];
    const bookingHistory = lead.booking_history ? JSON.parse(lead.booking_history) : [];
    bookingHistory.push({
      action,
      details,
      performedBy,
      performedByName,
      timestamp: new Date().toISOString()
    });

    // Update the lead with new booking history using Supabase
    await dbManager.update('leads', { 
      booking_history: JSON.stringify(bookingHistory) 
    }, { id: leadId });
    
    console.log(`📅 Booking history added: ${action} for lead ${leadId} by ${performedByName}`);
  } catch (error) {
    console.error('Error adding booking history entry:', error);
  }
};

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/sales/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Email configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// SMS sending is handled via BulkSMS in utils/smsService

// Get all sales with filtering and pagination
router.get('/', auth, async (req, res) => {
  try {
    const { dateRange, paymentType } = req.query;

    // Build Supabase query
    let query = supabase
      .from('sales')
      .select('*');

    // ROLE-BASED ACCESS CONTROL
    // Only admins can see all sales, viewers can only see sales they personally created
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
      console.log(`🔒 Sales filtering: User ${req.user.name} (${req.user.role}) can only see sales they personally created`);
    } else {
      console.log(`👑 Admin sales access: User ${req.user.name} can see all sales`);
    }
    
    // Handle date range filtering
    if (dateRange) {
      const now = new Date();
      let startDate, endDate;

      switch (dateRange) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          endDate = new Date(now.setHours(23, 59, 59, 999));
          break;
        case 'this_week':
          const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
          startDate = new Date(startOfWeek.setHours(0, 0, 0, 0));
          endDate = new Date();
          break;
        case 'this_month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
          break;
        case 'last_month':
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
          break;
        case 'this_quarter':
          const quarterStart = Math.floor(now.getMonth() / 3) * 3;
          startDate = new Date(now.getFullYear(), quarterStart, 1);
          endDate = new Date();
          break;
        case 'this_year':
          startDate = new Date(now.getFullYear(), 0, 1);
          endDate = new Date();
          break;
        default:
          break;
      }

      if (startDate && endDate) {
        query = query
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString());
      }
    }

    // Handle payment type filtering
    if (paymentType && paymentType !== 'all') {
      query = query.eq('payment_type', paymentType);
    }

    // Execute query and order by created_at desc
    const { data: salesData, error: salesError } = await query.order('created_at', { ascending: false });

    if (salesError) {
      console.error('Error fetching sales:', salesError);
      return res.status(500).json({ error: 'Failed to fetch sales' });
    }

    // Get user and lead data separately
    const sales = salesData || [];

    if (sales.length > 0) {
      // Get unique user IDs and lead IDs
      const userIds = [...new Set(sales.map(s => s.user_id).filter(id => id))];
      const leadIds = [...new Set(sales.map(s => s.lead_id).filter(id => id))];

      // Fetch users
      const { data: users } = userIds.length > 0 ? await supabase
        .from('users')
        .select('id, name, email')
        .in('id', userIds) : { data: [] };

      // Fetch leads
      const { data: leads } = leadIds.length > 0 ? await supabase
        .from('leads')
        .select('id, name, email, phone, status')
        .in('id', leadIds) : { data: [] };

      // Create lookup maps
      const userMap = (users || []).reduce((acc, user) => {
        acc[user.id] = user;
        return acc;
      }, {});

      const leadMap = (leads || []).reduce((acc, lead) => {
        acc[lead.id] = lead;
        return acc;
      }, {});

      // Flatten the data for frontend compatibility
      const flattenedSales = sales.map(sale => ({
        ...sale,
        user_name: sale.user_id && userMap[sale.user_id] ? userMap[sale.user_id].name : (sale.user_id ? `User ${sale.user_id.slice(-4)}` : 'System'),
        user_email: sale.user_id && userMap[sale.user_id] ? userMap[sale.user_id].email : null,
        lead_name: sale.lead_id && leadMap[sale.lead_id] ? leadMap[sale.lead_id].name : null,
        lead_email: sale.lead_id && leadMap[sale.lead_id] ? leadMap[sale.lead_id].email : null,
        lead_phone: sale.lead_id && leadMap[sale.lead_id] ? leadMap[sale.lead_id].phone : null,
        lead_status: sale.lead_id && leadMap[sale.lead_id] ? leadMap[sale.lead_id].status : null,
        sale_created_at: sale.created_at,
        sale_updated_at: sale.updated_at
      }));

      console.log(`[DEBUG] /api/sales returned ${flattenedSales.length} sales for user ${req.user.name} (${req.user.role})`);
      flattenedSales?.slice(0, 3).forEach(sale => {
        console.log(`   Sale ${sale.id.slice(-8)}: user_name="${sale.user_name}", user_id="${sale.user_id}"`);
      });

      res.json(flattenedSales || []);
    } else {
      console.log(`[DEBUG] /api/sales returned 0 sales for user ${req.user.name} (${req.user.role})`);
      res.json([]);
    }
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// Get sales statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const { dateRange, paymentType } = req.query;

    // Build Supabase query
    let query = supabase.from('sales').select('*');

    // ROLE-BASED ACCESS CONTROL
    // Only admins can see all sales stats, viewers can only see stats for sales they personally created
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
      console.log(`🔒 Sales stats filtering: User ${req.user.name} (${req.user.role}) can only see stats for sales they personally created`);
    } else {
      console.log(`👑 Admin sales stats access: User ${req.user.name} can see all sales stats`);
    }
    
    // Handle date range filtering (same logic as above)
    if (dateRange) {
      const now = new Date();
      let startDate, endDate;

      switch (dateRange) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          endDate = new Date(now.setHours(23, 59, 59, 999));
          break;
        case 'this_week':
          const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
          startDate = new Date(startOfWeek.setHours(0, 0, 0, 0));
          endDate = new Date();
          break;
        case 'this_month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
          break;
        case 'last_month':
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
          break;
        case 'this_quarter':
          const quarterStart = Math.floor(now.getMonth() / 3) * 3;
          startDate = new Date(now.getFullYear(), quarterStart, 1);
          endDate = new Date();
          break;
        case 'this_year':
          startDate = new Date(now.getFullYear(), 0, 1);
          endDate = new Date();
          break;
        default:
          break;
      }

      if (startDate && endDate) {
        query = query
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString());
      }
    }

    // Handle payment type filtering
    if (paymentType && paymentType !== 'all') {
      query = query.eq('payment_type', paymentType);
    }

    // Execute query
    const { data: sales, error: salesError } = await query;

    if (salesError) {
      console.error('Error fetching sales stats:', salesError);
      return res.status(500).json({ error: 'Failed to fetch sales stats' });
    }
    
    // Calculate statistics
    const totalSales = sales?.length || 0;
    const totalRevenue = sales?.reduce((sum, sale) => sum + (sale.amount || 0), 0) || 0;
    const averageSaleValue = totalSales > 0 ? totalRevenue / totalSales : 0;
    const financeAgreements = sales?.filter(sale => sale.payment_type === 'finance').length || 0;
    
    console.log(`[DEBUG] Sales stats for user ${req.user.name} (${req.user.role}): ${totalSales} sales, £${totalRevenue} revenue`);
    
    res.json({
      totalSales,
      totalRevenue,
      averageSaleValue,
      financeAgreements
    });
  } catch (error) {
    console.error('Error fetching sales stats:', error);
    res.status(500).json({ error: 'Failed to fetch sales stats' });
  }
});

// Create a new sale
router.post('/', auth, async (req, res) => {
  try {
    const { leadId, saleAmount, paymentMethod, paymentType, notes } = req.body;

    console.log(`💰 SALE CREATION ATTEMPT:`);
    console.log(`   User: ${req.user.name} (${req.user.role}) - ID: ${req.user.id}`);
    console.log(`   Lead ID: ${leadId}, Amount: £${saleAmount}`);

    // Check if user is a viewer or admin
    if (req.user.role !== 'viewer' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only viewers and admins can create sales' });
    }

    // Verify lead exists using Supabase
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, name, date_booked')
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      console.log('❌ Lead not found:', leadError);
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Generate sale ID
    const { v4: uuidv4 } = require('uuid');
    const saleId = uuidv4();

    // Create the sale
    const saleData = {
      id: saleId,
      lead_id: leadId,
      user_id: req.user.id,
      amount: parseFloat(saleAmount),
      payment_method: paymentMethod,
      payment_type: paymentType || 'full_payment',
      payment_status: 'Pending',
      notes: notes || '',
      status: 'Pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log(`📝 Sale data to be inserted:`);
    console.log(`   ID: ${saleData.id}`);
    console.log(`   User ID: ${saleData.user_id}`);
    console.log(`   Amount: £${saleData.amount}`);

    // Insert sale into Supabase
    const { data: insertedSale, error: insertError } = await supabase
      .from('sales')
      .insert(saleData)
      .select()
      .single();

    if (insertError) {
      console.error('❌ Failed to create sale:', insertError);
      return res.status(500).json({ error: 'Failed to create sale', details: insertError });
    }

    console.log(`✅ Sale inserted successfully with ID: ${insertedSale.id}`);

    // Update lead status to 'Attended' and mark as having a sale
    const { error: updateError } = await supabase
      .from('leads')
      .update({
        status: 'Attended',
        has_sale: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', leadId);

    if (updateError) {
      console.error('⚠️ Failed to update lead status:', updateError);
      // Don't fail the sale creation for this, just log it
    }

    // Add booking history entry
    await addBookingHistoryEntry(
      leadId,
      'SALE_COMPLETED',
      `${req.user.name} completed sale for £${saleAmount.toFixed(2)}`,
      req.user.id,
      req.user.name
    );

    // Get the created sale with user and lead details
    const { data: createdSale, error: fetchError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .single();

    if (fetchError) {
      console.error('⚠️ Failed to fetch created sale:', fetchError);
    }

    // Get user and lead data separately
    let userData = null;
    let leadData = null;

    if (createdSale?.user_id) {
      const { data: user } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('id', createdSale.user_id)
        .single();
      userData = user;
    }

    if (createdSale?.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id, name, email, phone')
        .eq('id', createdSale.lead_id)
        .single();
      leadData = lead;
    }

    // Flatten the data for frontend compatibility
    const flattenedSale = createdSale ? {
      ...createdSale,
      user_name: userData?.name || (createdSale.user_id ? `User ${createdSale.user_id.slice(-4)}` : 'System'),
      user_email: userData?.email,
      lead_name: leadData?.name,
      lead_email: leadData?.email,
      lead_phone: leadData?.phone
    } : insertedSale;

    console.log(`✅ Sale created successfully: ${saleId} for lead ${leadId} by ${req.user.name}`);

    // Send receipt email automatically if lead has email
    if (flattenedSale.lead_email) {
      try {
        // Create proper lead object with email for sendReceiptEmail function
        const leadWithEmail = {
          id: flattenedSale.lead_id,
          name: flattenedSale.lead_name,
          email: flattenedSale.lead_email,
          phone: flattenedSale.lead_phone
        };
        await sendReceiptEmail(flattenedSale, leadWithEmail);
        console.log(`📧 Receipt email sent to ${flattenedSale.lead_email}`);
      } catch (emailError) {
        console.error(`❌ Failed to send receipt email:`, emailError);
        // Don't fail the sale creation if email fails
      }
    }

    // Emit real-time update
    if (global.io) {
      global.io.emit('sale_created', {
        sale: flattenedSale,
        action: 'create',
        timestamp: new Date()
      });
      console.log(`📡 Emitted sale_created event for sale ${saleId}`);
    }

    res.status(201).json({
      message: 'Sale created successfully',
      sale: flattenedSale
    });
  } catch (error) {
    console.error('Error creating sale:', error);
    res.status(500).json({ error: 'Failed to create sale' });
  }
});

// Get sales for a specific date
router.get('/by-date/:date', auth, async (req, res) => {
  try {
    const date = new Date(req.params.date);
    const startOfDay = new Date(date.setHours(0, 0, 0, 0));
    const endOfDay = new Date(date.setHours(23, 59, 59, 999));

    const { data: sales, error: salesError } = await supabase
      .from('sales')
      .select('*')
      .gte('created_at', startOfDay.toISOString())
      .lte('created_at', endOfDay.toISOString())
      .order('created_at', { ascending: false });

    if (salesError) {
      console.error('Error fetching sales by date:', salesError);
      return res.status(500).json({ error: 'Failed to fetch sales' });
    }

    res.json(sales || []);
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// Send receipt via email
router.post('/:saleId/send-receipt/email', auth, async (req, res) => {
  try {
    const { email, subject, message, templateId } = req.body;

    // Fetch sale from Supabase
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', req.params.saleId)
      .single();

    if (saleError || !sale) {
      console.error('Sale not found:', saleError);
      return res.status(404).json({ error: 'Sale not found' });
    }

    let emailSubject, emailBody;

    // If templateId is provided, use the template
    if (templateId) {
      const { data: template, error: templateError } = await supabase
        .from('templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (templateError || !template) {
        console.error('Template not found:', templateError);
        return res.status(404).json({ error: 'Template not found' });
      }

      if (template.type !== 'sale_notification') {
        return res.status(400).json({ error: 'Template is not a sales notification template' });
      }

      // Process template variables
      const receiptId = sale.id.toString().slice(-6).toUpperCase();
      const formattedAmount = `£${sale.amount.toFixed(2)}`;
      
      emailSubject = template.subject
        .replace('{leadName}', 'Customer')
        .replace('{companyName}', 'Modelling Studio CRM')
        .replace('{saleAmount}', sale.amount.toString())
        .replace('{saleAmountFormatted}', formattedAmount)
        .replace('{paymentMethod}', sale.payment_method)
        .replace('{saleDate}', new Date(sale.created_at).toLocaleDateString())
        .replace('{saleTime}', new Date(sale.created_at).toLocaleTimeString())
        .replace('{receiptId}', receiptId)
        .replace('{saleNotes}', sale.notes || '');

      emailBody = (template.email_body || template.content || '')
        .replace(/{leadName}/g, 'Customer')
        .replace(/{leadEmail}/g, '')
        .replace(/{leadPhone}/g, '')
        .replace(/{userName}/g, 'Staff')
        .replace(/{userEmail}/g, '')
        .replace(/{companyName}/g, 'Modelling Studio CRM')
        .replace(/{saleAmount}/g, sale.amount.toString())
        .replace(/{saleAmountFormatted}/g, formattedAmount)
        .replace(/{paymentMethod}/g, sale.payment_method)
        .replace(/{saleDate}/g, new Date(sale.created_at).toLocaleDateString())
        .replace(/{saleTime}/g, new Date(sale.created_at).toLocaleTimeString())
        .replace(/{receiptId}/g, receiptId)
        .replace(/{saleNotes}/g, sale.notes || '')
        .replace(/{currentDate}/g, new Date().toLocaleDateString())
        .replace(/{currentTime}/g, new Date().toLocaleTimeString());
    } else {
      // Use default email content
      const formattedAmount = `£${sale.amount.toFixed(2)}`;
      emailSubject = subject || 'Your Purchase Receipt - Modelling Studio CRM';
      emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Thank you for your purchase!</h1>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Customer:</strong> Customer</p>
            <p><strong>Date:</strong> ${new Date(sale.created_at).toLocaleDateString()}</p>
            <p><strong>Amount:</strong> ${formattedAmount}</p>
            <p><strong>Payment Method:</strong> ${sale.payment_method}</p>
            ${sale.notes ? `<p><strong>Notes:</strong> ${sale.notes}</p>` : ''}
          </div>
          ${message ? `<p>${message}</p>` : ''}
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            This is an automated receipt from Modelling Studio CRM. If you have any questions, please contact us.
          </p>
        </div>
      `;
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email || '',
      subject: emailSubject,
      html: emailBody
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: 'Receipt sent successfully' });
  } catch (error) {
    console.error('Error sending email receipt:', error);
    res.status(500).json({ error: 'Failed to send email receipt' });
  }
});

// Send receipt via SMS (BulkSMS)
router.post('/:saleId/send-receipt/sms', auth, async (req, res) => {
  try {
    const { phone, templateId } = req.body;

    // Fetch sale from Supabase
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', req.params.saleId)
      .single();

    if (saleError || !sale) {
      console.error('Sale not found:', saleError);
      return res.status(404).json({ error: 'Sale not found' });
    }

    let smsMessage;

    // If templateId is provided, use the template
    if (templateId) {
      const { data: template, error: templateError } = await supabase
        .from('templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (templateError || !template) {
        console.error('Template not found:', templateError);
        return res.status(404).json({ error: 'Template not found' });
      }

      if (template.type !== 'sale_notification') {
        return res.status(400).json({ error: 'Template is not a sales notification template' });
      }

      // Process template variables
      const receiptId = sale.id.toString().slice(-6).toUpperCase();
      const formattedAmount = `£${sale.amount.toFixed(2)}`;
      
      smsMessage = (template.sms_body || template.content || '')
        .replace(/{leadName}/g, 'Customer')
        .replace(/{leadEmail}/g, '')
        .replace(/{leadPhone}/g, '')
        .replace(/{userName}/g, 'Staff')
        .replace(/{userEmail}/g, '')
        .replace(/{companyName}/g, 'Modelling Studio CRM')
        .replace(/{saleAmount}/g, sale.amount.toString())
        .replace(/{saleAmountFormatted}/g, formattedAmount)
        .replace(/{paymentMethod}/g, sale.payment_method)
        .replace(/{saleDate}/g, new Date(sale.created_at).toLocaleDateString())
        .replace(/{saleTime}/g, new Date(sale.created_at).toLocaleTimeString())
        .replace(/{receiptId}/g, receiptId)
        .replace(/{saleNotes}/g, sale.notes || '')
        .replace(/{currentDate}/g, new Date().toLocaleDateString())
        .replace(/{currentTime}/g, new Date().toLocaleTimeString());
    } else {
      // Use default SMS content
      const formattedAmount = `£${sale.amount.toFixed(2)}`;
      const receiptId = sale.id.toString().slice(-6).toUpperCase();
      
      smsMessage = `Thank you for your purchase at Modelling Studio CRM!
Amount: ${formattedAmount}
Date: ${new Date(sale.created_at).toLocaleDateString()}
Receipt ID: ${receiptId}`;
    }

    const smsResp = await sendCustomMessage(phone || '', smsMessage);
    if (!smsResp?.success) {
      return res.status(500).json({ error: 'Failed to send SMS receipt', details: smsResp?.error || 'unknown' });
    }

    res.json({ success: true, message: 'SMS receipt sent successfully' });
  } catch (error) {
    console.error('Error sending SMS receipt:', error);
    res.status(500).json({ error: 'Failed to send SMS receipt' });
  }
});

// Get sales summary for reports
router.get('/summary', auth, async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.query;

    // Build Supabase query
    let query = supabase
      .from('sales')
      .select('*');

    // ROLE-BASED ACCESS CONTROL
    // Only admins can see all sales summary, viewers can only see their own sales
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
      console.log(`🔒 Sales summary filtering: User ${req.user.name} (${req.user.role}) can only see their own sales`);
    } else {
      console.log(`👑 Admin sales summary access: User ${req.user.name} can see all sales`);
      // For admins, still allow filtering by specific user if requested
      if (userId && userId !== 'all') {
        query = query.eq('user_id', userId);
      }
    }

    if (startDate && endDate) {
      query = query
        .gte('created_at', startDate)
        .lte('created_at', endDate);
    }

    // Execute query
    const { data: salesData, error: salesError } = await query.order('created_at', { ascending: false });

    if (salesError) {
      console.error('Error fetching sales summary:', salesError);
      return res.status(500).json({ error: 'Failed to fetch sales summary' });
    }

    // Get user data for all sales
    const sales = salesData || [];
    let userMap = {};

    if (sales.length > 0) {
      const userIds = [...new Set(sales.map(s => s.user_id).filter(id => id))];
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, name, email')
          .in('id', userIds);

        userMap = (users || []).reduce((acc, user) => {
          acc[user.id] = user;
          return acc;
        }, {});
      }
    }

    // Flatten the data for processing
    const flattenedSales = sales.map(sale => ({
      ...sale,
      user_name: sale.user_id && userMap[sale.user_id] ? userMap[sale.user_id].name : (sale.user_id ? `User ${sale.user_id.slice(-4)}` : 'System'),
      user_email: sale.user_id && userMap[sale.user_id] ? userMap[sale.user_id].email : null
    }));
    
    const summary = {
      totalSales: flattenedSales?.length || 0,
      totalAmount: flattenedSales?.reduce((sum, sale) => sum + (sale.amount || 0), 0) || 0,
      byUser: {},
      byPaymentMethod: {}
    };

    // Group by user
    console.log(`📊 Processing ${flattenedSales?.length || 0} sales for summary...`);
    flattenedSales?.forEach(sale => {
      const userName = sale.user_name;
      console.log(`   Sale ${sale.id.slice(-8)}: user_name="${sale.user_name}", user_id="${sale.user_id}"`);

      if (!summary.byUser[userName]) {
        summary.byUser[userName] = {
          count: 0,
          amount: 0
        };
      }
      summary.byUser[userName].count++;
      summary.byUser[userName].amount += sale.amount || 0;

      // Group by payment method
      const paymentMethod = sale.payment_method || 'Unknown';
      if (!summary.byPaymentMethod[paymentMethod]) {
        summary.byPaymentMethod[paymentMethod] = {
          count: 0,
          amount: 0
        };
      }
      summary.byPaymentMethod[paymentMethod].count++;
      summary.byPaymentMethod[paymentMethod].amount += sale.amount || 0;
    });

    res.json(summary);
  } catch (error) {
    console.error('Error fetching sales summary:', error);
    res.status(500).json({ error: 'Failed to fetch sales summary' });
  }
});

// Get sale by leadId
router.get('/by-lead/:leadId', auth, async (req, res) => {
  try {
    const dbManager = require('../database-connection-manager');
    
    const sales = await dbManager.query('sales', {
      select: '*',
      eq: { lead_id: req.params.leadId }
    });
    
    const sale = sales.length > 0 ? sales[0] : null;

    if (!sale) {
      // Return 200 with null instead of 404 to avoid console errors
      return res.status(200).json(null);
    }

    res.json(sale);
  } catch (error) {
    console.error('Error fetching sale by leadId:', error);
    res.status(500).json({ error: 'Failed to fetch sale' });
  }
});

// Update existing sale
router.put('/:saleId', auth, async (req, res) => {
  try {
    const { saleAmount, paymentMethod, paymentType, notes } = req.body;
    
    // Check if user is a viewer or admin
    if (req.user.role !== 'viewer' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only viewers and admins can update sales' });
    }

    // Find the sale in Supabase
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', req.params.saleId)
      .single();

    if (saleError || !sale) {
      console.error('Sale not found:', saleError);
      return res.status(404).json({ error: 'Sale not found' });
    }

    // Check if user can edit this sale (admin can edit any, viewer can only edit their own)
    if (req.user.role !== 'admin' && sale.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own sales' });
    }

    // Store old amount for comparison
    const oldAmount = sale.amount;

    // Update the sale
    const updateData = {};
    if (saleAmount !== undefined) updateData.amount = parseFloat(saleAmount);
    if (paymentMethod !== undefined) updateData.payment_method = paymentMethod;
    if (notes !== undefined) updateData.notes = notes;
    updateData.updated_at = new Date().toISOString();

    // Update in Supabase
    const { data: updatedSale, error: updateError } = await supabase
      .from('sales')
      .update(updateData)
      .eq('id', req.params.saleId)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update sale:', updateError);
      return res.status(500).json({ error: 'Failed to update sale' });
    }

    // Log the update in booking history
    if (saleAmount !== undefined && saleAmount !== oldAmount) {
      await addBookingHistoryEntry(
        sale.lead_id,
        'SALE_UPDATE',
        `${req.user.name} updated sale amount from £${oldAmount.toFixed(2)} to £${saleAmount.toFixed(2)}`,
        req.user.id,
        req.user.name
      );
    }

    res.json({ 
      message: 'Sale updated successfully',
      sale: updatedSale 
    });
  } catch (error) {
    console.error('Error updating sale:', error);
    res.status(500).json({ error: 'Failed to update sale' });
  }
});

// Get available sales templates
router.get('/templates/sales', auth, async (req, res) => {
  try {
    const { data: templates, error: templateError } = await supabase
      .from('templates')
      .select('id, name, subject, email_body, sms_body')
      .eq('type', 'sale_notification')
      .eq('is_active', true);

    if (templateError) {
      console.error('Error fetching templates:', templateError);
      return res.status(500).json({ error: 'Failed to fetch templates' });
    }

    // Adapt response to match expected format
    const adaptedTemplates = templates?.map(template => ({
      _id: template.id,
      name: template.name,
      subject: template.subject,
      emailBody: template.email_body,
      smsBody: template.sms_body,
      variables: [] // Would need to extract from content
    })) || [];

    res.json(adaptedTemplates);
  } catch (error) {
    console.error('Error fetching sales templates:', error);
    res.status(500).json({ error: 'Failed to fetch sales templates' });
  }
});

// Delete single sale endpoint
router.delete('/:saleId', auth, async (req, res) => {
  try {
    const { saleId } = req.params;
    
    if (!saleId) {
      return res.status(400).json({ message: 'Sale ID is required' });
    }

    // Use Supabase for consistency
    const dbManager = require('../database-connection-manager');

    // Get sale details before deletion
    const sales = await dbManager.query('sales', {
      select: '*',
      eq: { id: saleId }
    });
    
    const sale = sales.length > 0 ? sales[0] : null;
    
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    // Check if user has permission to delete this sale
    if (req.user.role !== 'admin' && sale.user_id !== req.user.id) {
      return res.status(403).json({ message: 'No permission to delete this sale' });
    }

    // Delete the sale using Supabase
    try {
      await dbManager.delete('sales', {
        eq: { id: saleId }
      });
    } catch (deleteError) {
      console.error('❌ Supabase delete error:', deleteError);
      return res.status(500).json({ message: 'Failed to delete sale', error: deleteError.message });
    }

    console.log(`✅ Sale ${saleId} deleted by ${req.user.name}`);

    // Add booking history entry for the deletion
    if (sale.lead_id) {
      try {
        await addBookingHistoryEntry(
          sale.lead_id,
          'SALE_DELETED',
          `Sale of £${sale.amount} deleted by ${req.user.name}`,
          req.user.id,
          req.user.name
        );
        console.log(`📅 Booking history added for sale deletion ${saleId}`);
      } catch (historyError) {
        console.warn(`⚠️ Failed to add history entry for deleted sale ${saleId}:`, historyError);
        // Don't fail the deletion if history fails
      }
    }

    // Emit real-time update
    if (global.io) {
      global.io.emit('sale_deleted', {
        saleId: saleId,
        action: 'delete',
        timestamp: new Date(),
        deletedBy: req.user.name
      });
      console.log(`📡 Emitted sale_deleted event for sale ${saleId}`);
    }

    res.json({ 
      message: 'Sale deleted successfully',
      deletedSaleId: saleId
    });

  } catch (error) {
    console.error('❌ Single sale deletion error:', error);
    
    // Check if the sale was actually deleted despite the error
    try {
      const dbManager = require('../database-connection-manager');
      const existingSale = await dbManager.query('sales', { eq: { id: saleId } });
      
      if (existingSale.length === 0) {
        // Sale was deleted successfully, but there was an error in cleanup
        console.log(`✅ Sale ${saleId} was deleted successfully despite error in cleanup`);
        return res.json({ 
          message: 'Sale deleted successfully',
          deletedSaleId: saleId,
          warning: 'Some cleanup operations failed but the sale was deleted'
        });
      }
    } catch (checkError) {
      console.error('❌ Error checking if sale was deleted:', checkError);
    }
    
    res.status(500).json({ 
      message: 'Failed to delete sale', 
      error: error.message,
      details: 'The sale could not be deleted from the database'
    });
  }
});

// Bulk delete sales endpoint
router.delete('/bulk-delete', auth, async (req, res) => {
  try {
    const { saleIds } = req.body;
    
    if (!saleIds || !Array.isArray(saleIds) || saleIds.length === 0) {
      return res.status(400).json({ message: 'No sale IDs provided' });
    }

    // Use Supabase for consistency
    const dbManager = require('../database-connection-manager');
    
    const deletedSales = [];
    const errors = [];

    // Process each sale deletion
    for (const saleId of saleIds) {
      try {
        // Get sale details before deletion
        const sales = await dbManager.query('sales', {
          select: '*',
          eq: { id: saleId }
        });
        
        const sale = sales.length > 0 ? sales[0] : null;
        
        if (!sale) {
          errors.push(`Sale ${saleId} not found`);
          continue;
        }

        // Check if user has permission to delete this sale
        if (req.user.role !== 'admin' && sale.user_id !== req.user.id) {
          errors.push(`No permission to delete sale ${saleId}`);
          continue;
        }

        // Delete the sale using Supabase
        try {
          await dbManager.delete('sales', {
            eq: { id: saleId }
          });
        } catch (deleteError) {
          console.error(`❌ Error deleting sale ${saleId}:`, deleteError);
          errors.push(`Failed to delete sale ${saleId}: ${deleteError.message}`);
          continue;
        }

        deletedSales.push(sale);
        console.log(`✅ Sale ${saleId} deleted by ${req.user.name}`);

        // Add booking history entry for the deletion
        if (sale.lead_id) {
          try {
            await addBookingHistoryEntry(
              sale.lead_id,
              'SALE_DELETED',
              `Sale of £${sale.amount} deleted by ${req.user.name}`,
              req.user.id,
              req.user.name
            );
          } catch (historyError) {
            console.warn(`⚠️ Failed to add history entry for deleted sale ${saleId}:`, historyError);
          }
        }

      } catch (error) {
        console.error(`❌ Error deleting sale ${saleId}:`, error);
        errors.push(`Error deleting sale ${saleId}: ${error.message}`);
      }
    }

    // Emit real-time update
    if (global.io && deletedSales.length > 0) {
      global.io.emit('sales_deleted', {
        deletedSales: deletedSales.map(s => s.id),
        action: 'bulk_delete',
        timestamp: new Date(),
        deletedBy: req.user.name
      });
      console.log(`📡 Emitted sales_deleted event for ${deletedSales.length} sales`);
    }

    const responseMessage = deletedSales.length > 0 
      ? `Successfully deleted ${deletedSales.length} sale${deletedSales.length !== 1 ? 's' : ''}`
      : 'No sales were deleted';

    res.json({ 
      message: responseMessage,
      deletedCount: deletedSales.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('❌ Bulk delete error:', error);
    res.status(500).json({ message: 'Failed to delete sales', error: error.message });
  }
});

// Bulk communication to selected sales
router.post('/bulk-communication', auth, async (req, res) => {
  try {
    const { templateId, sales, communicationType, customSubject, customEmailBody, customSmsBody } = req.body;
    
    if (!templateId || !sales || sales.length === 0) {
      return res.status(400).json({ message: 'Template ID and sales data are required' });
    }

    console.log(`📤 Starting bulk communication for ${sales.length} sales with template ${templateId}`);
    
    // Use direct Supabase like the working calendar system
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    
    // Get the template using direct Supabase call (like calendar system)
    const { data: templates, error: templateError } = await supabase
      .from('templates')
      .select('*')
      .eq('id', templateId)
      .eq('is_active', true)
      .limit(1);
    
    if (templateError) {
      console.error('❌ Template fetch error:', templateError);
      return res.status(500).json({ message: 'Error fetching template', error: templateError.message });
    }
    
    if (!templates || templates.length === 0) {
      console.log('❌ Template not found or inactive:', templateId);
      return res.status(404).json({ message: 'Template not found or inactive' });
    }
    
    const template = templates[0];
    console.log(`✅ Using template: ${template.name} (${template.type})`);

    let sentCount = 0;
    const results = [];

    for (const saleData of sales) {
      try {
        console.log(`📊 Processing sale: ${saleData.id}`);
        
        // Get the full sale data using direct Supabase (like calendar system)
        const { data: sale, error: saleError } = await supabase
          .from('sales')
          .select('*')
          .eq('id', saleData.id)
          .single();
        
        if (saleError || !sale) {
          console.log(`⚠️ Sale ${saleData.id} not found:`, saleError);
          results.push({
            saleId: saleData.id,
            error: 'Sale not found'
          });
          continue;
        }
        
        // Get the lead data using direct Supabase
        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .select('name, email, phone')
          .eq('id', sale.lead_id)
          .single();
        
        if (leadError || !lead) {
          console.log(`⚠️ Lead for sale ${saleData.id} not found:`, leadError);
          // Use fallback data from saleData
          const fallbackLead = {
            name: saleData.lead_name || 'Customer',
            email: saleData.lead_email || '',
            phone: saleData.lead_phone || ''
          };
          results.push({
            saleId: saleData.id,
            error: 'Lead not found',
            customerName: fallbackLead.name
          });
          continue;
        }
        
        console.log(`✅ Found lead: ${lead.name} (${lead.email})`);

        // Prepare variables for template replacement
        const variables = {
          '{leadName}': lead.name || 'Customer',
          '{leadEmail}': lead.email || '',
          '{leadPhone}': lead.phone || '',
          '{saleAmount}': sale.amount || '0.00',
          '{saleAmountFormatted}': new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(sale.amount || 0),
          '{paymentMethod}': sale.payment_method || 'Card',
          '{saleDate}': new Date(saleData.sale_date || sale.created_at).toLocaleDateString('en-GB'),
          '{saleTime}': new Date(saleData.sale_date || sale.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          '{receiptId}': sale.id || 'N/A',
          '{saleNotes}': sale.notes || '',
          '{companyName}': 'Modelling Studio CRM',
          '{paymentType}': sale.payment_type || 'full_payment'
        };

        // Add finance-specific variables if applicable
        if (sale.payment_type === 'finance') {
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
        let emailSubject = customSubject || template.subject || '';
        let emailBody = customEmailBody || template.email_body || '';
        let smsBody = customSmsBody || template.sms_body || '';

        Object.entries(variables).forEach(([key, value]) => {
          emailSubject = emailSubject.replace(new RegExp(key, 'g'), value);
          emailBody = emailBody.replace(new RegExp(key, 'g'), value);
          smsBody = smsBody.replace(new RegExp(key, 'g'), value);
        });

        // Use the same approach as calendar system - create a custom template object
        const customTemplate = {
          ...template,
          subject: emailSubject,
          email_body: emailBody,
          sms_body: smsBody,
          send_email: (communicationType === 'email' || communicationType === 'both'),
          send_sms: (communicationType === 'sms' || communicationType === 'both')
        };

        // Use MessagingService.processTemplate like calendar system does
        const MessagingService = require('../utils/messagingService');
        const processedTemplate = MessagingService.processTemplate(customTemplate, lead, req.user, null, null);
        
        console.log(`📧 Processed template for ${lead.name}:`, {
          hasEmail: !!processedTemplate.email_body,
          hasSms: !!processedTemplate.sms_body,
          emailLength: processedTemplate.email_body?.length || 0,
          smsLength: processedTemplate.sms_body?.length || 0
        });

        // Create message record using Supabase (like calendar system)
        const messageId = require('uuid').v4();
        const { data: messageResult, error: messageError } = await supabase
          .from('messages')
          .insert({
            id: messageId,
            lead_id: sale.lead_id,
            template_id: templateId,
            type: (customTemplate.send_email && customTemplate.send_sms) ? 'both' : (customTemplate.send_email ? 'email' : 'sms'),
            content: customTemplate.send_email ? processedTemplate.email_body : processedTemplate.sms_body,
            subject: customTemplate.send_email ? processedTemplate.subject : null,
            email_body: customTemplate.send_email ? processedTemplate.email_body : null,
            sms_body: customTemplate.send_sms ? processedTemplate.sms_body : null,
            recipient_email: customTemplate.send_email ? lead.email : null,
            recipient_phone: customTemplate.send_sms ? lead.phone : null,
            sent_by: req.user.id,
            sent_by_name: req.user.name,
            status: 'pending',
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (messageError) {
          console.error('❌ Message creation error:', messageError);
          results.push({
            saleId: sale.id,
            customerName: lead.name,
            error: 'Failed to create message record'
          });
          continue;
        }

        console.log(`✅ Message record created: ${messageResult.id}`);

        // Send communications using the same approach as calendar
        let emailSent = false;
        let smsSent = false;
        let emailError = null;
        let smsError = null;

        // Send email if requested
        if (customTemplate.send_email && lead.email) {
          try {
            const message = {
              id: messageId,
              recipient_email: lead.email,
              recipient_name: lead.name,
              subject: processedTemplate.subject,
              email_body: processedTemplate.email_body,
              lead_id: sale.lead_id,
              template_id: templateId,
              type: 'email',
              sent_by: req.user.id,
              sent_by_name: req.user.name,
              status: 'pending',
              created_at: new Date().toISOString(),
              channel: 'email',
            };
            
            console.log(`📧 Sending email to ${lead.email}...`);
            const emailResult = await MessagingService.sendEmail(message);
            emailSent = emailResult;
            
            if (emailResult) {
              console.log(`✅ Email sent successfully to ${lead.email}`);
            } else {
              console.log(`❌ Email failed to ${lead.email}`);
            }
          } catch (error) {
            console.error('❌ Email sending error:', error);
            emailError = error.message;
          }
        }

        // Send SMS if requested
        if (customTemplate.send_sms && lead.phone) {
          try {
            const message = {
              id: messageId,
              recipient_phone: lead.phone,
              recipient_name: lead.name,
              sms_body: processedTemplate.sms_body,
              lead_id: sale.lead_id,
              template_id: templateId,
              type: 'sms',
              sent_by: req.user.id,
              sent_by_name: req.user.name,
              status: 'pending',
              created_at: new Date().toISOString(),
              channel: 'sms',
            };
            
            console.log(`📱 Sending SMS to ${lead.phone}...`);
            const smsResult = await MessagingService.sendSMS(message);
            smsSent = smsResult;
            
            if (smsResult) {
              console.log(`✅ SMS sent successfully to ${lead.phone}`);
            } else {
              console.log(`❌ SMS failed to ${lead.phone}`);
            }
          } catch (error) {
            console.error('❌ SMS sending error:', error);
            smsError = error.message;
          }
        }

        // Update message status
        const finalStatus = (emailSent || smsSent) ? 'sent' : 'failed';
        await supabase
          .from('messages')
          .update({ 
            status: finalStatus,
            email_status: customTemplate.send_email ? (emailSent ? 'sent' : 'failed') : null,
            sms_status: customTemplate.send_sms ? (smsSent ? 'sent' : 'failed') : null,
            sent_at: new Date().toISOString()
          })
          .eq('id', messageId);

        results.push({
          saleId: sale.id,
          customerName: lead.name,
          email: lead.email,
          phone: lead.phone,
          emailSent,
          smsSent,
          emailError,
          smsError
        });

        sentCount++;
      } catch (saleError) {
        console.error('Error processing sale:', saleError);
        results.push({
          saleId: saleData.id,
          error: saleError.message
        });
      }
    }

    // Log the communication attempt
    console.log(`📤 Bulk communication completed: ${sentCount} sales processed`);

    res.json({
      message: 'Bulk communication completed',
      sentCount,
      totalSales: sales.length,
      results
    });

  } catch (error) {
    console.error('Bulk communication error:', error);
    res.status(500).json({ message: 'Error sending bulk communications', error: error.message });
  }
});

module.exports = router; 