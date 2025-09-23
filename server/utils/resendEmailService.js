const { Resend } = require('resend');

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send email using Resend API (Railway recommended)
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} text - Email plain text body
 * @param {Array} attachments - Email attachments
 * @returns {Promise<{success: boolean, response?: string, error?: string}>}
 */
async function sendEmail(to, subject, text, attachments = []) {
  const emailId = Math.random().toString(36).substring(2, 8);
  console.log(`📧 [${emailId}] Sending email via Resend: ${subject} → ${to}`);

  if (!to || !subject || !text) {
    const errorMsg = `📧 [${emailId}] Missing required fields: ${!to ? 'to, ' : ''}${!subject ? 'subject, ' : ''}${!text ? 'body' : ''}`.replace(/, $/, '');
    console.error(errorMsg);
    return { success: false, error: errorMsg };
  }

  if (!process.env.RESEND_API_KEY) {
    const errorMsg = `📧 [${emailId}] RESEND_API_KEY not configured`;
    console.error(errorMsg);
    return { success: false, error: errorMsg };
  }

  try {
    // Prepare attachments for Resend
    const resendAttachments = [];
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        if (attachment.path && attachment.filename) {
          try {
            const fs = require('fs');
            const fileBuffer = fs.readFileSync(attachment.path);
            const base64Content = fileBuffer.toString('base64');
            
            resendAttachments.push({
              filename: attachment.filename,
              content: base64Content,
              contentType: getContentType(attachment.filename)
            });
          } catch (fileError) {
            console.warn(`📧 [${emailId}] Failed to read attachment ${attachment.filename}:`, fileError.message);
          }
        }
      }
    }

    // Send email via Resend
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@avensismodels.co.uk',
      to: [to],
      subject: subject,
      text: text,
      attachments: resendAttachments.length > 0 ? resendAttachments : undefined,
      headers: {
        'X-Email-ID': emailId,
        'X-Application': 'CRM System'
      }
    });

    if (error) {
      console.error(`❌ [${emailId}] Resend error:`, error);
      return { success: false, error: error.message };
    }

    console.log(`✅ [${emailId}] Email sent successfully via Resend - ID: ${data.id}`);
    
    return { 
      success: true, 
      response: `Resend ID: ${data.id}`,
      messageId: data.id,
      provider: 'resend'
    };

  } catch (error) {
    console.error(`❌ [${emailId}] Email send failed: ${error.message}`);
    
    return { 
      success: false, 
      error: error.message
    };
  }
}

/**
 * Get content type based on file extension
 * @param {string} filename - File name
 * @returns {string} MIME type
 */
function getContentType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  const mimeTypes = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

module.exports = {
  sendEmail
};
