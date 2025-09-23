require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
console.log('📧 Email Service: Initializing...');
console.log('📧 EMAIL_USER:', process.env.EMAIL_USER ? '✅ Set' : '❌ NOT SET');
console.log('📧 RESEND_API_KEY:', process.env.RESEND_API_KEY ? '✅ Set' : '❌ NOT SET');

const nodemailer = require('nodemailer');
const { sendEmail: sendEmailViaResend } = require('./resendEmailService');

// Create SMTP transporter optimized for Railway Pro deployment
const transporter = nodemailer.createTransport({
  // Try port 465 with SSL first (more reliable on Railway Pro)
  host: 'smtp.gmail.com',
  port: 465, // Use port 465 with SSL for Railway Pro compatibility
  secure: true, // true for port 465, false for port 587
  auth: {
    user: process.env.EMAIL_USER || process.env.GMAIL_USER,
    pass: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS
  },
  logger: false, // Disable verbose logging for better performance
  debug: false,  // Disable debug mode to speed up email sending
  connectionTimeout: 60000, // 60 seconds - increased for Railway Pro
  greetingTimeout: 30000,   // 30 seconds - increased for Railway Pro
  socketTimeout: 60000,    // 60 seconds - increased for Railway Pro
  tls: {
    rejectUnauthorized: false, // Allow self-signed certificates
    ciphers: 'HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA' // Modern cipher suite
  },
  // Railway Pro optimized settings
  pool: true, // Enable connection pooling for Railway Pro
  maxConnections: 3, // Multiple connections for Railway Pro
  maxMessages: 50, // More messages per connection for Railway Pro
  rateDelta: 10000, // 10 second rate limiting
  rateLimit: 10 // 10 messages per 10 seconds for Railway Pro
});

// Log when the transporter is created
console.log('📧 Email transporter ready');

// Skip automatic verification to prevent startup timeouts
// Verification will happen during actual email sending
console.log('✅ Email transporter created (verification skipped for Railway compatibility)');

/**
 * Send an email using Gmail
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} text - Email plain text body
 * @returns {Promise<{success: boolean, response?: string, error?: string}>}
 */
async function sendEmail(to, subject, text, attachments = []) {
  const emailId = Math.random().toString(36).substring(2, 8);
  console.log(`📧 [${emailId}] Sending email: ${subject} → ${to}`);

  if (!to || !subject || !text) {
    const errorMsg = `📧 [${emailId}] Missing required fields: ${!to ? 'to, ' : ''}${!subject ? 'subject, ' : ''}${!text ? 'body' : ''}`.replace(/, $/, '');
    console.error(errorMsg);
    return { success: false, error: errorMsg };
  }

  // Check if we should use Resend (Railway recommended for non-Pro plans)
  if (process.env.RESEND_API_KEY && !process.env.EMAIL_USER) {
    console.log(`📧 [${emailId}] Using Resend API (Railway recommended)`);
    return await sendEmailViaResend(to, subject, text, attachments);
  }

  try {
    // Validate and filter attachments (async to prevent blocking)
    const fs = require('fs').promises;
    const inputAttachments = Array.isArray(attachments) ? attachments : [];
    const validAttachments = [];
    
    if (inputAttachments.length > 0) {
      for (const att of inputAttachments) {
        if (!att.path || !att.filename) continue;
        
        try {
          const stats = await fs.stat(att.path);
          if (stats.size > 0 && stats.size <= 25 * 1024 * 1024) { // Valid file size
            validAttachments.push(att);
          }
        } catch (validationError) {
          // Skip files with validation errors silently
        }
      }
    }
    
    // Only log attachment issues if there were problems
    if (inputAttachments.length > 0 && validAttachments.length === 0) {
      console.warn(`📧 [${emailId}] All ${inputAttachments.length} attachments were invalid`);
    }
    
    const mailOptions = {
      from: {
        name: 'Avensismodels',
        address: process.env.EMAIL_USER
      },
      to,
      subject,
      text,
      attachments: validAttachments,
      headers: {
        'X-Email-ID': emailId,
        'X-Application': 'CRM System'
      }
    };

    // Railway Pro retry logic with port fallback
    const maxRetries = 3; // Reduced retries since we'll try different ports
    let lastError;
    
    // Try port 465 first (SSL), then fallback to port 587 (STARTTLS)
    const portConfigs = [
      { port: 465, secure: true, name: 'SSL (465)' },
      { port: 587, secure: false, name: 'STARTTLS (587)' }
    ];
    
    for (const config of portConfigs) {
      console.log(`📧 [${emailId}] Trying ${config.name} configuration...`);
      
      // Create transporter with current port configuration
      const testTransporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: config.port,
        secure: config.secure,
        auth: {
          user: process.env.EMAIL_USER || process.env.GMAIL_USER,
          pass: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS
        },
        logger: false,
        debug: false,
        connectionTimeout: 60000,
        greetingTimeout: 30000,
        socketTimeout: 60000,
        tls: {
          rejectUnauthorized: false,
          ciphers: 'HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA'
        },
        pool: false, // Disable pooling for testing
        maxConnections: 1,
        maxMessages: 1
      });
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`📧 [${emailId}] ${config.name} - Attempt ${attempt}/${maxRetries} - Sending email via Railway Pro SMTP...`);
          
          // Test connection first (Railway-compatible verification)
          try {
            await testTransporter.verify();
            console.log(`📧 [${emailId}] ${config.name} - Connection verified`);
          } catch (verifyError) {
            console.log(`📧 [${emailId}] ${config.name} - Connection verification failed: ${verifyError.message}`);
            // Continue anyway - sometimes verification fails but sending works
          }
          
          // Send the email
          const info = await testTransporter.sendMail(mailOptions);
          
          console.log(`✅ [${emailId}] Email sent successfully via ${config.name} - ID: ${info.messageId}`);
          
          return { 
            success: true, 
            response: info.response,
            messageId: info.messageId,
            port: config.port
          };
          
        } catch (error) {
          lastError = error;
          console.warn(`⚠️ [${emailId}] ${config.name} - Attempt ${attempt} failed: ${error.message} (Code: ${error.code})`);
          
          // Don't retry for certain errors
          if (error.code === 'EAUTH' || error.code === 'EENVELOPE' || error.code === 'EINVAL') {
            console.error(`❌ [${emailId}] Authentication, envelope, or invalid error - not retrying ${config.name}`);
            break;
          }
          
          // Special handling for Railway network issues
          if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
            console.log(`📧 [${emailId}] Railway network issue detected on ${config.name} - will retry`);
          }
          
          // Wait before retrying
          if (attempt < maxRetries) {
            const waitTime = Math.min(2000 * attempt, 10000);
            console.log(`📧 [${emailId}] Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }
      
      // Close the test transporter
      testTransporter.close();
      
      // If we get here, this port configuration failed, try the next one
      console.log(`📧 [${emailId}] ${config.name} failed, trying next configuration...`);
    }
    
    // All retries failed
    throw lastError;

  } catch (error) {
    console.error(`❌ [${emailId}] Email send failed after all retries: ${error.message}`);
    
    return { 
      success: false, 
      error: error.message,
      code: error.code,
      command: error.command,
      responseCode: error.responseCode
    };
  }
}

module.exports = {
  sendEmail,
  transporter // Export for testing purposes
};
