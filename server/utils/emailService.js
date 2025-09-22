require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
console.log('📧 Email Service: Initializing...');
console.log('📧 EMAIL_USER:', process.env.EMAIL_USER);
console.log('📧 EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? '[HIDDEN]' : 'undefined');
const nodemailer = require('nodemailer');

// Create a simple SMTP transporter for Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || process.env.GMAIL_USER,
    pass: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS
  },
  logger: false, // Disable verbose logging for better performance
  debug: false,  // Disable debug mode to speed up email sending
  secure: true,  // Use TLS
  requireTLS: true,
  connectionTimeout: 10000, // 10 seconds
  greetingTimeout: 10000,   // 10 seconds
  socketTimeout: 10000,    // 10 seconds
  tls: {
    rejectUnauthorized: false
  }
});

// Log when the transporter is created
console.log('📧 Email transporter created with service: gmail');

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

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    
    console.log(`✅ [${emailId}] Email sent successfully - ID: ${info.messageId}`);
    
    return { 
      success: true, 
      response: info.response,
      messageId: info.messageId
    };
    

  } catch (error) {
    console.error(`❌ [${emailId}] Email send failed: ${error.message}`);
    
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
