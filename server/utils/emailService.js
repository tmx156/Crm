require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

// ========================================
// ✅ EMAIL SENDING ENABLED
// ========================================
const EMAIL_SENDING_DISABLED = false; // Email sending is now ENABLED
// ========================================

console.log('📧 Email Service: Initializing...');
console.log('📧 EMAIL_USER (Primary):', process.env.EMAIL_USER ? '✅ Set' : '❌ NOT SET');
// Secondary email removed - only primary account is used

if (EMAIL_SENDING_DISABLED) {
  console.log('🚫 EMAIL SENDING DISABLED (Temporary kill switch active)');
  console.log('📧 Email poller will still receive emails normally');
} else {
  console.log('✅ EMAIL SENDING ENABLED - Emails will be sent');
}

const nodemailer = require('nodemailer');

// Email account configurations - Only primary account
const EMAIL_ACCOUNTS = {
  primary: {
    user: process.env.EMAIL_USER || process.env.GMAIL_USER,
    pass: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS,
    name: 'Primary Account',
    senderName: 'The Editorial Co' // Display name for primary account
  }
};

/**
 * Create a transporter for a specific email account
 * @param {string} accountKey - 'primary' (only account available)
 * @returns {Object} Nodemailer transporter
 */
function createTransporter(accountKey = 'primary') {
  // Only primary account is supported
  if (accountKey !== 'primary') {
    console.warn(`⚠️ Email account '${accountKey}' not available. Using primary account.`);
    accountKey = 'primary';
  }
  
  const account = EMAIL_ACCOUNTS[accountKey];

  if (!account || !account.user || !account.pass) {
    console.warn(`⚠️ Email account '${accountKey}' not configured properly`);
    return null;
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: account.user,
      pass: account.pass
    },
    logger: false,
    debug: false,
    connectionTimeout: 30000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: {
      rejectUnauthorized: false,
      ciphers: 'HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA'
    },
    pool: false,
    maxConnections: 1,
    maxMessages: 1,
    rateDelta: 1000,
    rateLimit: 1
  });
}

// Create primary transporter (for backwards compatibility)
const transporter = createTransporter('primary');

// Log when the transporter is created
console.log('📧 Email transporters ready');
console.log('✅ Email service initialized (verification skipped for Railway compatibility)');

/**
 * Send an email using Gmail
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} text - Email plain text body
 * @param {Array} attachments - Email attachments (optional)
 * @param {string} accountKey - Email account to use: 'primary' (default: 'primary')
 * @returns {Promise<{success: boolean, response?: string, error?: string}>}
 */
async function sendEmail(to, subject, text, attachments = [], accountKey = 'primary') {
  // Only primary account is supported
  if (accountKey !== 'primary') {
    console.warn(`⚠️ Email account '${accountKey}' not available. Using primary account.`);
    accountKey = 'primary';
  }
  
  const emailId = Math.random().toString(36).substring(2, 8);
  const account = EMAIL_ACCOUNTS[accountKey];

  console.log(`📧 [${emailId}] Sending email via SMTP: ${subject} → ${to}`);

  // 🚫 KILL SWITCH: Return success without sending if disabled
  if (EMAIL_SENDING_DISABLED) {
    console.log(`🚫 [${emailId}] EMAIL SENDING DISABLED - Email NOT sent (kill switch active)`);
    console.log(`📧 [${emailId}] Would have sent to: ${to}`);
    console.log(`📧 [${emailId}] Subject: ${subject}`);
    return {
      success: true,
      disabled: true,
      messageId: `<disabled-${emailId}@localhost>`,
      response: 'Email sending temporarily disabled',
      note: 'Email was not actually sent - kill switch active'
    };
  }

  if (!to || !subject || !text) {
    const errorMsg = `📧 [${emailId}] Missing required fields: ${!to ? 'to, ' : ''}${!subject ? 'subject, ' : ''}${!text ? 'body' : ''}`.replace(/, $/, '');
    console.error(errorMsg);
    return { success: false, error: errorMsg };
  }

  if (!account || !account.user || !account.pass) {
    const errorMsg = `📧 [${emailId}] Email account '${accountKey}' not configured`;
    console.error(errorMsg);
    return { success: false, error: errorMsg };
  }


  try {
    // Validate and filter attachments (async to prevent blocking)
    const fs = require('fs').promises;
    const inputAttachments = Array.isArray(attachments) ? attachments : [];
    const validAttachments = [];

    console.log(`📧 [${emailId}] Processing ${inputAttachments.length} attachments...`);

    if (inputAttachments.length > 0) {
      for (const [idx, att] of inputAttachments.entries()) {
        console.log(`📧 [${emailId}] Attachment ${idx + 1}: ${att.filename} (${att.path ? 'has path' : 'no path'})`);

        if (!att.path || !att.filename) {
          console.log(`📧 [${emailId}] ❌ Skipping attachment ${idx + 1}: missing path or filename`);
          continue;
        }

        try {
          const stats = await fs.stat(att.path);
          if (stats.size > 0 && stats.size <= 25 * 1024 * 1024) { // Valid file size
            validAttachments.push(att);
            console.log(`📧 [${emailId}] ✅ Valid attachment ${idx + 1}: ${att.filename} (${stats.size} bytes)`);
          } else {
            console.log(`📧 [${emailId}] ❌ Invalid file size for ${att.filename}: ${stats.size} bytes`);
          }
        } catch (validationError) {
          console.log(`📧 [${emailId}] ❌ File validation error for ${att.filename}: ${validationError.message}`);
        }
      }
    }

    console.log(`📧 [${emailId}] Valid attachments: ${validAttachments.length}/${inputAttachments.length}`);
    
    // Only log attachment issues if there were problems
    if (inputAttachments.length > 0 && validAttachments.length === 0) {
      console.warn(`📧 [${emailId}] All ${inputAttachments.length} attachments were invalid`);
    }
    
    const mailOptions = {
      from: {
        name: account.senderName || 'The Editorial Co', // Use account-specific sender name
        address: account.user
      },
      to,
      subject,
      text,
      attachments: validAttachments,
      headers: {
        'X-Email-ID': emailId,
        'X-Application': 'CRM System',
        'X-Email-Account': accountKey
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
      
      // Create transporter with current port configuration using selected account
      const testTransporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: config.port,
        secure: config.secure,
        auth: {
          user: account.user,
          pass: account.pass
        },
        logger: false,
        debug: false,
        connectionTimeout: 30000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
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
          
          // Wait before retrying (shorter for serverless)
          if (attempt < maxRetries) {
            const waitTime = Math.min(1000 * attempt, 5000); // Max 5 seconds for serverless
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
  transporter, // Export for testing purposes (primary account)
  createTransporter, // Export to allow creating transporters for specific accounts
  EMAIL_ACCOUNTS // Export account configuration for reference
};
