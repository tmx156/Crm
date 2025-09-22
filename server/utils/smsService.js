const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

// SMS Service Configuration - BulkSMS
const SMS_CONFIG = {
  provider: 'bulksms',
  bulksms: {
    username: process.env.BULKSMS_USERNAME,
    password: process.env.BULKSMS_PASSWORD,
    // Replyable sender ID - must be verified in BulkSMS dashboard
    fromNumber: process.env.BULKSMS_FROM_NUMBER || '447786200517'
  }
};

// Initialize BulkSMS client status
let bulksmsConfigured = false;

// Ensure we always send a purely numeric originator (BulkSMS often requires MSISDN without '+')
function sanitizeNumericOriginator(originator) {
  if (!originator) return undefined;
  const digitsOnly = String(originator).replace(/\D/g, '');
  return digitsOnly.length > 0 ? digitsOnly : undefined;
}

// Resolve and sanitize the originator once so we know exactly what we send
const RESOLVED_ORIGINATOR = sanitizeNumericOriginator(SMS_CONFIG.bulksms.fromNumber);

// Enhanced configuration logging
console.log('🔍 SMS Configuration Check:');
console.log('  Provider:', SMS_CONFIG.provider);
console.log('  Username:', SMS_CONFIG.bulksms.username ? '✅ Set' : '❌ NOT SET');
console.log('  Password:', SMS_CONFIG.bulksms.password ? '✅ Set' : '❌ NOT SET');
console.log('  From Number:', SMS_CONFIG.bulksms.fromNumber || '❌ NOT SET');
console.log('  Sender Type: REPLIABLE (dashboard default)');
console.log('  Reply Support: ✅ ENABLED via dashboard settings');

if (SMS_CONFIG.bulksms.username && SMS_CONFIG.bulksms.password) {
  bulksmsConfigured = true;
  const originator = RESOLVED_ORIGINATOR || '(provider default)';
  console.log('✅ BulkSMS client configured');
  console.log(`📨 BulkSMS originator set to: ${originator}`);
} else {
  console.warn('⚠️ BulkSMS credentials not fully configured.');
  console.warn('   Please set BULKSMS_USERNAME and BULKSMS_PASSWORD environment variables.');
  console.warn('   SMS sending will be DISABLED until credentials are provided.');
}

/**
 * Normalize phone numbers to E.164 where possible (UK default +44 for leading 0)
 */
function normalizePhoneE164(rawPhone) {
  if (!rawPhone) return rawPhone;
  let digits = String(rawPhone).trim();
  // Already E.164
  if (digits.startsWith('+')) return digits;
  // Remove non-digits
  digits = digits.replace(/\D/g, '');
  // UK common format: 0XXXXXXXXXX -> +44XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('0')) {
    return '+44' + digits.slice(1);
  }
  // If it looks like 10 digits, check if it's UK mobile (starts with 7)
  if (digits.length === 10 && digits.startsWith('7')) {
    return '+44' + digits; // UK mobile number
  }
  // If it looks like 11 digits starting with 1, check if it's a UK number that was incorrectly formatted as US
  if (digits.length === 11 && digits.startsWith('1') && digits[1] === '7') {
    return '+44' + digits.slice(1); // UK mobile number that was incorrectly formatted as US
  }
  // If it looks like 10 digits (US-style), leave as-is or prepend +1 if desired
  if (digits.length === 10) {
    return '+1' + digits; // safe default; adjust if needed by region
  }
  // If it already includes country code but no '+', attempt to prefix '+'
  if (!digits.startsWith('0')) {
    return '+' + digits;
  }
  return rawPhone;
}

function generateShortId(length = 8) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

/**
 * Create short link using Supabase
 */
async function createShortLinkForContent(content) {
  try {
    let id = generateShortId(8);
    
    // Ensure uniqueness by checking if ID exists
    let attempts = 0;
    while (attempts < 5) {
      const { data: existing } = await supabase
        .from('short_links')
        .select('id')
        .eq('id', id)
        .single();
      
      if (!existing) break; // ID is unique
      id = generateShortId(8);
      attempts++;
    }
    
    // Insert the short link
    const { data, error } = await supabase
      .from('short_links')
      .insert({
        id,
        content,
        created_at: new Date().toISOString()
      });
    
    if (error) {
      console.error('Error creating short link:', error);
      return null;
    }
    
    const base = process.env.PUBLIC_BASE_URL || 'http://localhost:5000';
    return `${base}/c/${id}`;
  } catch (err) {
    console.error('Failed to create short link:', err);
    return null;
  }
}

/**
 * Process template variables
 */
const processTemplate = (template, lead, bookingDate = null) => {
  let processedTemplate = template;
  
  // Format booking date and time
  const bookingDateTime = bookingDate ? new Date(bookingDate) : null;
  const bookingDateStr = bookingDateTime ? bookingDateTime.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : '';
  const bookingTimeStr = bookingDateTime ? bookingDateTime.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC' // Keep UTC time to match calendar
  }) : '';
  
  // Common variables
  const variables = {
    '{leadName}': lead.name || 'Customer',
    '{leadEmail}': lead.email || '',
    '{leadPhone}': lead.phone || '',
    '{bookingDate}': bookingDateStr,
    '{bookingTime}': bookingTimeStr,
    '{companyName}': 'Modelling Studio CRM',
    '{currentDate}': new Date().toLocaleDateString(),
    '{currentTime}': new Date().toLocaleTimeString()
  };
  
  // Replace variables in template
  Object.keys(variables).forEach(key => {
    const value = variables[key];
    processedTemplate = processedTemplate.replace(new RegExp(key, 'g'), value);
  });
  
  return processedTemplate;
};

/**
 * Get template from Supabase database
 */
const getTemplate = async (type) => {
  try {
    const { data: template, error } = await supabase
      .from('templates')
      .select('*')
      .eq('type', type)
      .eq('is_active', true)
      .single();
    
    if (error) {
      console.error(`Error getting template for type ${type}:`, error);
      return null;
    }
    
    return template;
  } catch (error) {
    console.error(`Error getting template for type ${type}:`, error);
    return null;
  }
};

/**
 * Send SMS message using BulkSMS REST API
 * @param {string} to - Recipient phone number (with country code)
 * @param {string} message - Message content
 * @returns {Promise} - SMS response
 */
// Helper function to track message delivery in database
const trackMessageDelivery = async (messageData) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .upsert({
        id: messageData.id || undefined, // Use existing ID if provided
        lead_id: messageData.leadId,
        type: 'sms',
        status: 'sent',
        sms_body: messageData.message,
        recipient_phone: messageData.to,
        sent_at: new Date().toISOString(),
        delivery_status: messageData.deliveryResult?.success ? 'delivered' : 'failed',
        provider_message_id: messageData.deliveryResult?.messageId,
        delivery_provider: 'bulksms',
        delivery_attempts: 1,
        last_delivery_attempt: new Date().toISOString(),
        delivery_response: messageData.deliveryResult?.fullResponse || null,
        error_message: messageData.deliveryResult?.success ? null : messageData.deliveryResult?.error,
        sent_by: messageData.sentBy || null,
        sent_by_name: messageData.sentByName || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id',
        returning: 'representation'
      });

    if (error) {
      console.error('❌ Failed to track message delivery:', error);
    } else {
      console.log('✅ Message delivery tracked in database:', data?.[0]?.id);
    }

    return { data, error };
  } catch (error) {
    console.error('❌ Error tracking message delivery:', error);
    return { data: null, error };
  }
};

// Export the tracking function for use in routes
module.exports.trackMessageDelivery = trackMessageDelivery;

const sendSMS = async (to, message) => {
  try {
    const normalized = normalizePhoneE164(to);
    console.log(`🔍 DEBUG: Full SMS Sending Process`);
    console.log(`📱 Recipient Number (normalized): ${normalized}`);
    console.log(`📝 Message Length: ${message.length} characters`);
    
    if (!bulksmsConfigured) {
      console.error('❌ BulkSMS client NOT configured');
      throw new Error('BulkSMS client not configured. Please check your credentials.');
    }
    
    // Detailed environment and configuration logging
    console.log('🔐 Configuration Details:', {
      username: SMS_CONFIG.bulksms.username ? 'SET' : 'NOT SET',
      password: SMS_CONFIG.bulksms.password ? 'SET' : 'NOT SET',
      fromNumber: SMS_CONFIG.bulksms.fromNumber || 'NOT SET'
    });

    // Prepare payload with comprehensive logging
    const payload = [{
      to: normalized,
      body: message,
      routingGroup: "STANDARD",
      encoding: "TEXT",
      longMessageMaxParts: 99,
      deliveryReports: "ALL"
    }];

    console.log('📤 Payload Prepared:', JSON.stringify(payload, null, 2));

    // Make API call to BulkSMS with enhanced error handling
    try {
      const response = await axios.post('https://api.bulksms.com/v1/messages', payload, {
        auth: {
          username: SMS_CONFIG.bulksms.username,
          password: SMS_CONFIG.bulksms.password
        },
        headers: { 
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10-second timeout
      });

      console.log('🌐 Full API Response:', JSON.stringify(response.data, null, 2));

      // BulkSMS typically returns an object with id/status
      const resp = Array.isArray(response.data) ? response.data[0] : response.data;
      
      console.log(`✅ SMS API Response Details:`, {
        id: resp?.id,
        type: resp?.type,
        status: resp?.status,
        from: resp?.from
      });

      return {
        success: true,
        provider: 'bulksms',
        messageId: resp?.id || null,
        status: resp?.status?.id || 'submitted',
        fullResponse: resp // Store full response for tracking
      };
    } catch (apiError) {
      console.error('❌ Detailed API Error:', {
        message: apiError.message,
        response: apiError.response?.data,
        status: apiError.response?.status,
        headers: apiError.response?.headers
      });
      
      throw apiError;
    }
  } catch (error) {
    console.error(`❌ Comprehensive SMS Sending Error:`, {
      message: error.message,
      stack: error.stack,
      responseData: error.response?.data,
      responseStatus: error.response?.status
    });
    
    return { 
      success: false, 
      provider: 'bulksms', 
      error: error.message,
      fullError: error
    };
  }
};

/**
 * Send booking confirmation SMS using template
 * @param {Object} lead - Lead object with name, phone, and booking details
 * @param {string} appointmentDate - Appointment date/time
 * @returns {Promise} - SMS response
 */
const sendBookingConfirmation = async (lead, appointmentDate) => {
  try {
    // Get booking confirmation template
    const template = getTemplate('booking_confirmation');
    
    if (!template) {
      console.warn('No booking confirmation template found, using default message');
      const defaultMessage = `Hi ${lead.name}! Your appointment has been confirmed for ${appointmentDate}. We'll see you soon! - Modelling Studio CRM`;
      return sendSMS(lead.phone, defaultMessage);
    }
    
    // Create a concise SMS version
    const bookingDateTime = appointmentDate ? new Date(appointmentDate) : null;
    const bookingDateStr = bookingDateTime ? bookingDateTime.toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }) : '';
    const bookingTimeStr = bookingDateTime ? bookingDateTime.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: 'UTC' // Keep UTC time to match calendar
    }) : '';

    // Concise SMS template
    const conciseSmsBody = `Hi ${lead.name}, your photoshoot is confirmed for ${bookingDateStr} at ${bookingTimeStr}. 

Studio: 60 Higher Ardwick, Manchester, M12 6DA

Bring: 3 outfits, ID, ready hair/makeup. Full details: `;

    // Create a short link for full details
    const url = createShortLinkForContent(template.sms_body || template.content);
    const finalSmsBody = conciseSmsBody + url;

    return sendSMS(lead.phone, finalSmsBody);
  } catch (error) {
    console.error('Error sending booking confirmation:', error);
    // Fallback to default message
    const defaultMessage = `Hi ${lead.name}! Your appointment has been confirmed for ${appointmentDate}. We'll see you soon! - Modelling Studio CRM`;
    return sendSMS(lead.phone, defaultMessage);
  }
};

/**
 * Send appointment reminder SMS using template
 * @param {Object} lead - Lead object with name, phone, and booking details
 * @param {string} appointmentDate - Appointment date/time
 * @returns {Promise} - SMS response
 */
const sendAppointmentReminder = async (lead, appointmentDate) => {
  try {
    // Get appointment reminder template
    const template = getTemplate('appointment_reminder');
    
    if (!template) {
      console.warn('No appointment reminder template found, using default message');
      const defaultMessage = `Hi ${lead.name}! Just a reminder about your appointment tomorrow at ${appointmentDate}. See you there! - Modelling Studio CRM`;
      return sendSMS(lead.phone, defaultMessage);
    }
    
    // Process template with variables
    const processedMessage = processTemplate(template.sms_body || template.content, lead, appointmentDate);
    
    return sendSMS(lead.phone, processedMessage);
  } catch (error) {
    console.error('Error sending appointment reminder:', error);
    // Fallback to default message
    const defaultMessage = `Hi ${lead.name}! Just a reminder about your appointment tomorrow at ${appointmentDate}. See you there! - Modelling Studio CRM`;
    return sendSMS(lead.phone, defaultMessage);
  }
};

/**
 * Send lead status update SMS
 * @param {Object} lead - Lead object with name and phone
 * @param {string} status - New status
 * @returns {Promise} - SMS response
 */
const sendStatusUpdate = async (lead, status) => {
  const message = `Hi ${lead.name}! Your lead status has been updated to: ${status}. We'll keep you informed of any changes. - Modelling Studio CRM`;
  return sendSMS(lead.phone, message);
};

/**
 * Send custom SMS message
 * @param {string} phoneNumber - Recipient phone number
 * @param {string} message - Custom message
 * @returns {Promise} - SMS response
 */
const sendCustomMessage = async (phoneNumber, message) => {
  return sendSMS(phoneNumber, message);
};

/**
 * Get SMS provider status
 * @returns {Object} - Status of SMS provider
 */

const getSMSStatus = async () => {
  return {
    configuredProvider: SMS_CONFIG.provider,
    bulksms: {
      available: bulksmsConfigured,
      configured: bulksmsConfigured
    }
  };
};

/**
 * Test SMS service
 * @param {string} phoneNumber - Test phone number
 * @returns {Promise} - Test result
 */
const testSMSService = async (phoneNumber) => {
  const testMessage = 'This is a test message from your CRM system via BulkSMS.';
  return sendSMS(phoneNumber, testMessage);
};

module.exports = {
  sendSMS,
  sendBookingConfirmation,
  sendAppointmentReminder,
  sendStatusUpdate,
  sendCustomMessage,
  getSMSStatus,
  testSMSService
}; 