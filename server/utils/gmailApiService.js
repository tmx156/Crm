/**
 * Centralized Gmail API Service
 * Handles both sending and receiving emails via Gmail API
 * Replaces SMTP for sending and IMAP for polling
 */

const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const fs = require('fs').promises;
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

// Cache for Gmail clients per account
const gmailClients = new Map();

/**
 * Get Gmail API client for an email account
 * @param {string} email - Email address
 * @returns {Promise<Object>} Gmail API client
 */
async function getGmailClient(email) {
  // Check cache first
  if (gmailClients.has(email)) {
    const cached = gmailClients.get(email);
    // Verify it's still valid
    try {
      await cached.gmail.users.getProfile({ userId: 'me' });
      return cached;
    } catch (error) {
      // Token expired, remove from cache
      gmailClients.delete(email);
    }
  }

  // Get OAuth tokens from database
  const { data: account, error } = await supabase
    .from('gmail_accounts')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error || !account) {
    throw new Error(`No OAuth tokens found for ${email}. Please authenticate via /api/gmail/auth-url`);
  }

  // Create OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );

  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    token_type: account.token_type || 'Bearer',
    expiry_date: account.expiry_date
  });

  // Handle token refresh
  oauth2Client.on('tokens', async (tokens) => {
    console.log(`📧 [${email}] OAuth tokens refreshed`);

    const updateData = {
      access_token: tokens.access_token,
      updated_at: new Date().toISOString()
    };

    if (tokens.refresh_token) {
      updateData.refresh_token = tokens.refresh_token;
    }
    if (tokens.expiry_date) {
      updateData.expiry_date = tokens.expiry_date;
    }

    await supabase
      .from('gmail_accounts')
      .update(updateData)
      .eq('email', email);
  });

  // Create Gmail client
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Cache the client
  gmailClients.set(email, { gmail, oauth2Client });

  return { gmail, oauth2Client };
}

/**
 * Send email using Gmail API
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} text - Email body (plain text)
 * @param {string} html - Email body (HTML, optional)
 * @param {Array} attachments - Array of {filename, path} or {filename, content}
 * @param {string} fromEmail - Sender email (must match authenticated account)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendEmail(to, subject, text, html = null, attachments = [], fromEmail = null) {
  const emailId = Math.random().toString(36).substring(2, 8);
  
  try {
    // Determine which account to use
    const accountEmail = fromEmail || process.env.EMAIL_USER || process.env.GMAIL_USER;
    
    if (!accountEmail) {
      throw new Error('No email account configured');
    }

    console.log(`📧 [${emailId}] Sending email via Gmail API: ${subject} → ${to}`);

    // Get Gmail client
    const { gmail } = await getGmailClient(accountEmail);

    // Build email message
    const messageParts = [];
    
    // Headers
    messageParts.push(`To: ${to}`);
    messageParts.push(`From: ${accountEmail}`);
    messageParts.push(`Subject: ${subject}`);
    messageParts.push(`Content-Type: multipart/mixed; boundary="boundary123"`);
    messageParts.push('');

    // Body
    messageParts.push('--boundary123');
    if (html) {
      messageParts.push('Content-Type: multipart/alternative; boundary="alt123"');
      messageParts.push('');
      messageParts.push('--alt123');
      messageParts.push('Content-Type: text/plain; charset=utf-8');
      messageParts.push('');
      messageParts.push(text);
      messageParts.push('--alt123');
      messageParts.push('Content-Type: text/html; charset=utf-8');
      messageParts.push('');
      messageParts.push(html);
      messageParts.push('--alt123--');
    } else {
      messageParts.push('Content-Type: text/plain; charset=utf-8');
      messageParts.push('');
      messageParts.push(text);
    }

    // Attachments
    for (const attachment of attachments) {
      messageParts.push('--boundary123');
      messageParts.push(`Content-Type: application/octet-stream; name="${attachment.filename}"`);
      messageParts.push('Content-Transfer-Encoding: base64');
      messageParts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
      messageParts.push('');

      let content;
      if (attachment.path) {
        content = await fs.readFile(attachment.path);
      } else if (attachment.content) {
        content = Buffer.from(attachment.content);
      } else {
        console.warn(`📧 [${emailId}] Skipping attachment ${attachment.filename}: no path or content`);
        continue;
      }

      messageParts.push(content.toString('base64'));
    }

    messageParts.push('--boundary123--');

    // Encode message
    const message = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send via Gmail API
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    console.log(`✅ [${emailId}] Email sent successfully via Gmail API`);
    console.log(`   Message ID: ${response.data.id}`);

    return {
      success: true,
      messageId: response.data.id,
      response: `Gmail API: ${response.data.id}`
    };

  } catch (error) {
    console.error(`❌ [${emailId}] Gmail API send failed:`, error.message);
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
}

/**
 * Get all messages from Gmail (for repolling)
 * @param {string} email - Email account
 * @param {Object} options - Options {maxResults, query, includeSpamTrash}
 * @returns {Promise<Array>} Array of message objects
 */
async function getAllMessages(email, options = {}) {
  try {
    const { gmail } = await getGmailClient(email);

    const {
      maxResults = 500,
      query = '',
      includeSpamTrash = false
    } = options;

    const allMessages = [];
    let pageToken = null;

    do {
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: Math.min(maxResults, 500), // Gmail API limit
        pageToken: pageToken,
        includeSpamTrash: includeSpamTrash
      });

      if (response.data.messages) {
        allMessages.push(...response.data.messages);
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken && allMessages.length < maxResults);

    return allMessages;
  } catch (error) {
    console.error(`❌ Error getting messages for ${email}:`, error.message);
    throw error;
  }
}

/**
 * Get full message details including attachments
 * @param {string} email - Email account
 * @param {string} messageId - Gmail message ID
 * @returns {Promise<Object>} Full message object
 */
async function getMessage(email, messageId) {
  try {
    const { gmail } = await getGmailClient(email);

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    return response.data;
  } catch (error) {
    console.error(`❌ Error getting message ${messageId}:`, error.message);
    throw error;
  }
}

/**
 * Extract attachments from Gmail message
 * @param {string} email - Email account
 * @param {string} messageId - Gmail message ID
 * @returns {Promise<Array>} Array of attachment objects
 */
async function getAttachments(email, messageId) {
  try {
    const { gmail } = await getGmailClient(email);
    const message = await getMessage(email, messageId);

    const attachments = [];
    const parts = message.payload.parts || [];

    for (const part of parts) {
      if (part.filename && part.body.attachmentId) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: messageId,
          id: part.body.attachmentId
        });

        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size,
          data: attachment.data.data,
          attachmentId: part.body.attachmentId
        });
      }

      // Check nested parts (for multipart messages)
      if (part.parts) {
        for (const nestedPart of part.parts) {
          if (nestedPart.filename && nestedPart.body.attachmentId) {
            const attachment = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: messageId,
              id: nestedPart.body.attachmentId
            });

            attachments.push({
              filename: nestedPart.filename,
              mimeType: nestedPart.mimeType,
              size: nestedPart.body.size,
              data: attachment.data.data,
              attachmentId: nestedPart.body.attachmentId
            });
          }
        }
      }
    }

    return attachments;
  } catch (error) {
    console.error(`❌ Error getting attachments for ${messageId}:`, error.message);
    return [];
  }
}

module.exports = {
  getGmailClient,
  sendEmail,
  getAllMessages,
  getMessage,
  getAttachments
};

