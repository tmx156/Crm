require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
console.log('📧 Email Service: Initializing...');
console.log('📧 EMAIL_USER:', process.env.EMAIL_USER ? '✅ Set' : '❌ NOT SET');
const nodemailer = require('nodemailer');

// Create SMTP transporter optimized for Railway deployment
const transporter = nodemailer.createTransport({
  // Use explicit SMTP configuration instead of 'gmail' service for better Railway compatibility
  host: 'smtp.gmail.com',
  port: 587, // Use port 587 with STARTTLS for Railway compatibility
  secure: false, // false for port 587, true for port 465
  auth: {
    user: process.env.EMAIL_USER || process.env.GMAIL_USER,
    pass: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS
  },
  logger: false, // Disable verbose logging for better performance
  debug: false,  // Disable debug mode to speed up email sending
  requireTLS: true, // Require TLS encryption
  connectionTimeout: 30000, // 30 seconds - Railway optimized
  greetingTimeout: 15000,   // 15 seconds - Railway optimized
  socketTimeout: 30000,    // 30 seconds - Railway optimized
  tls: {
    rejectUnauthorized: false, // Allow self-signed certificates
    ciphers: 'SSLv3' // Use SSLv3 for Railway compatibility
  },
  // Railway-optimized connection settings
  pool: false, // Disable connection pooling for Railway
  maxConnections: 1, // Single connection for Railway
  maxMessages: 1, // One message per connection for Railway
  rateDelta: 1000, // Faster rate limiting for Railway
  rateLimit: 1 // One message per second for Railway
});

// Log when the transporter is created
console.log('📧 Email transporter ready');

// Verify connection configuration
transporter.verify(function(error, success) {
  if (error) {
    console.error('❌ Email transporter verification failed:', error);
  } else {
    console.log('✅ Email transporter is ready to send messages');
  }
});

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

    // Railway-optimized retry logic for email sending
    const maxRetries = 5; // Increased retries for Railway
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📧 [${emailId}] Attempt ${attempt}/${maxRetries} - Sending email via Railway SMTP...`);
        
        // Send the email
        const info = await transporter.sendMail(mailOptions);
        
        console.log(`✅ [${emailId}] Email sent successfully - ID: ${info.messageId}`);
        
        return { 
          success: true, 
          response: info.response,
          messageId: info.messageId
        };
        
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ [${emailId}] Attempt ${attempt} failed: ${error.message} (Code: ${error.code})`);
        
        // Don't retry for certain errors
        if (error.code === 'EAUTH' || error.code === 'EENVELOPE' || error.code === 'EINVAL') {
          console.error(`❌ [${emailId}] Authentication, envelope, or invalid error - not retrying`);
          break;
        }
        
        // Special handling for Railway network issues
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
          console.log(`📧 [${emailId}] Railway network issue detected - will retry`);
        }
        
        // Wait before retrying (Railway-optimized backoff)
        if (attempt < maxRetries) {
          const waitTime = Math.min(2000 * attempt, 15000); // Railway-optimized: 2s, 4s, 6s, 8s, max 15s
          console.log(`📧 [${emailId}] Waiting ${waitTime}ms before retry (Railway network optimization)...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
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
