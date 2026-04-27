const { google } = require('googleapis');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const GmailEmailExtractor = require('./gmailEmailExtractor');
const { getSupabaseClient } = require('../config/supabase-client');
const { getAuthedClient } = require('./gmailClient');
const supabaseStorage = require('./supabaseStorage');

const POLL_INTERVAL_MS = parseInt(process.env.GMAIL_POLL_INTERVAL_MS) || 180000;
const VERBOSE_LOGGING = process.env.VERBOSE_GMAIL_LOGGING === 'true';
const GMAIL_EMAIL = process.env.GMAIL_EMAIL || process.env.GMAIL_USER || '';

class GmailPoller {
  constructor(ioInstance) {
    if (GmailPoller._instance) return GmailPoller._instance;
    GmailPoller._instance = this;

    this.supabase = getSupabaseClient();
    this.gmail = null;
    this.isRunning = false;
    this.pollTimer = null;
    this.cleanupTimer = null;
    this.io = ioInstance;
    this.processedMessages = new Map();
    this.processedMessagesFile = path.join(__dirname, '../data/processed_gmail_messages.json');
    this.retryAttempts = 3;
    this.retryDelay = 2000;
    this.maxProcessedMessages = 10000;
    this.messageRetentionDays = 30;
    this.pollCount = 0;
    this.accountEmail = GMAIL_EMAIL;

    this.disabled = false;
    this.loadProcessedMessages().catch(err => {
      console.error('📧 Failed to load processed messages:', err.message);
    });
  }

  log(message, force = false) {
    if (force || VERBOSE_LOGGING) console.log(message);
  }

  async loadProcessedMessages() {
    try {
      const { data: dbMessages, error } = await this.supabase
        .from('processed_gmail_messages')
        .select('gmail_message_id, processed_at')
        .eq('account_key', 'primary')
        .gte('processed_at', new Date(Date.now() - this.messageRetentionDays * 24 * 60 * 60 * 1000).toISOString());

      if (!error && dbMessages && dbMessages.length > 0) {
        dbMessages.forEach(msg => {
          this.processedMessages.set(msg.gmail_message_id, new Date(msg.processed_at).getTime());
        });
        this.log(`📧 Loaded ${this.processedMessages.size} processed IDs from database`);
        return;
      }

      if (fs.existsSync(this.processedMessagesFile)) {
        const data = JSON.parse(fs.readFileSync(this.processedMessagesFile, 'utf8'));
        const cutoffTime = Date.now() - (this.messageRetentionDays * 24 * 60 * 60 * 1000);
        if (data.processedIds && Array.isArray(data.processedIds)) {
          data.processedIds.forEach(item => {
            if (Array.isArray(item) && item.length === 2) {
              if (item[1] > cutoffTime) this.processedMessages.set(item[0], item[1]);
            } else if (typeof item === 'string') {
              this.processedMessages.set(item, Date.now());
            }
          });
        }
        this.log(`📧 Migrated ${this.processedMessages.size} IDs from file to database`);
        await this.saveProcessedMessagesToDB();
      }
    } catch (error) {
      console.error('📧 Error loading processed messages:', error.message);
    }
  }

  async saveProcessedMessagesToDB() {
    try {
      const records = Array.from(this.processedMessages.entries())
        .slice(-1000)
        .map(([gmail_message_id, timestamp]) => ({
          account_key: 'primary',
          gmail_message_id,
          processed_at: new Date(timestamp).toISOString()
        }));

      if (records.length === 0) return;

      const { error } = await this.supabase
        .from('processed_gmail_messages')
        .upsert(records, { onConflict: 'account_key,gmail_message_id', ignoreDuplicates: true });

      if (error) console.error('📧 Error saving to database:', error.message);
    } catch (error) {
      console.error('📧 Error in DB save:', error.message);
    }
  }

  async saveProcessedMessages() {
    try {
      await this.saveProcessedMessagesToDB();

      const processedIds = Array.from(this.processedMessages.entries());
      const data = {
        lastUpdated: new Date().toISOString(),
        processedIds: processedIds.slice(-1000),
        count: processedIds.length
      };

      const dataDir = path.dirname(this.processedMessagesFile);
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(this.processedMessagesFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('📧 Error saving processed messages:', error.message);
    }
  }

  async markMessageProcessed(messageId) {
    this.processedMessages.set(messageId, Date.now());
    if (this.processedMessages.size >= this.maxProcessedMessages) this.cleanupOldProcessedMessages();
    if (this.processedMessages.size % 10 === 0) await this.saveProcessedMessages();
  }

  isMessageProcessed(messageId) {
    return this.processedMessages.has(messageId);
  }

  cleanupOldProcessedMessages() {
    const cutoffTime = Date.now() - (this.messageRetentionDays * 24 * 60 * 60 * 1000);
    let cleanedCount = 0;
    for (const [id, timestamp] of this.processedMessages) {
      if (timestamp < cutoffTime) { this.processedMessages.delete(id); cleanedCount++; }
    }
    if (this.processedMessages.size > this.maxProcessedMessages) {
      const sorted = [...this.processedMessages.entries()].sort((a, b) => b[1] - a[1]);
      this.processedMessages = new Map(sorted.slice(0, this.maxProcessedMessages));
      cleanedCount += sorted.length - this.maxProcessedMessages;
    }
    if (cleanedCount > 0) {
      this.log(`🧹 Cleaned up ${cleanedCount} old processed message IDs`);
      this.saveProcessedMessages();
    }
  }

  async getGmailClient() {
    try {
      // Load tokens from gmail_accounts table in Supabase
      const oauth2Client = await getAuthedClient(this.accountEmail);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      // Verify connection
      await gmail.users.getProfile({ userId: 'me' });
      return gmail;
    } catch (error) {
      if (error.message?.includes('No Gmail tokens found')) {
        console.error(`❌ No Gmail tokens for ${this.accountEmail}. Visit /api/gmail/auth-url to connect.`);
      } else if (error.message?.includes('invalid_grant') || error.code === 401) {
        console.error(`❌ Gmail OAuth token expired for ${this.accountEmail}. Re-authenticate at /api/gmail/auth-url`);
      }
      throw error;
    }
  }

  async start() {
    if (this.isRunning) return;

    try {
      this.pollCount++;
      this.gmail = await this.getGmailClient();
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      this.accountEmail = profile.data.emailAddress;
      console.log(`✅ Gmail poller connected to ${this.accountEmail}`);
      this.isRunning = true;
      await this.scanNewMessages();
      this.startPolling();
      console.log(`✅ Gmail poller started (polling every ${POLL_INTERVAL_MS / 1000}s)`);
    } catch (error) {
      console.error('❌ Failed to start Gmail poller:', error.message);
      this.isRunning = false;
      this.disabled = true;
    }
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);

    this.pollTimer = setInterval(async () => {
      if (this.isRunning && !this.disabled) {
        try {
          await this.scanNewMessages();
          this.saveProcessedMessages();
        } catch (error) {
          console.error('❌ Gmail polling error:', error.message);
        }
      }
    }, POLL_INTERVAL_MS);

    this.cleanupTimer = setInterval(() => {
      if (this.isRunning && !this.disabled) this.cleanupOldProcessedMessages();
    }, 60 * 60 * 1000);
  }

  async scanNewMessages() {
    if (!this.gmail || !this.isRunning || this.disabled) return;

    try {
      const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
      const query = `in:inbox (is:unread OR after:${sevenDaysAgo})`;

      let allMessages = [];
      let pageToken = null;

      do {
        const response = await this.gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 500,
          pageToken
        });
        allMessages = allMessages.concat(response.data.messages || []);
        pageToken = response.data.nextPageToken;
        if (allMessages.length > 10000) break;
      } while (pageToken);

      if (allMessages.length === 0) return;

      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < allMessages.length; i++) {
        const message = allMessages[i];
        if (this.isMessageProcessed(message.id)) { skippedCount++; continue; }

        let processed = false;
        let lastError = null;

        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
          try {
            const fullMessage = await this.gmail.users.messages.get({
              userId: 'me', id: message.id, format: 'full'
            });

            const result = await this.processMessage(fullMessage.data);
            if (result === 'processed') { await this.markMessageProcessed(message.id); processedCount++; processed = true; break; }
            if (result === 'skipped' || result === 'duplicate') { await this.markMessageProcessed(message.id); skippedCount++; processed = true; break; }
          } catch (error) {
            lastError = error;
            if (attempt < this.retryAttempts) {
              await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
            }
          }
        }

        if (!processed && lastError) {
          errorCount++;
          console.error(`❌ Error processing message ${message.id}:`, lastError.message);
        }

        if (i < allMessages.length - 1) await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (processedCount > 0 || errorCount > 0) {
        this.log(`📧 Scan: ${processedCount} new, ${skippedCount} skipped, ${errorCount} errors`, true);
      }
    } catch (error) {
      console.error('❌ Error scanning messages:', error.message);
    }
  }

  async processMessage(message) {
    const messageId = message.id;
    const headers = message.payload.headers;
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const from = getHeader('From');
    const to = getHeader('To');
    const subject = getHeader('Subject') || '(No Subject)';
    const date = getHeader('Date');

    const extractEmail = (str) => {
      if (!str) return '';
      const match = str.match(/<([^>]+)>/);
      return match ? match[1] : str.trim();
    };

    const fromEmail = extractEmail(from);
    const toEmail = extractEmail(to);
    const accountEmail = (this.accountEmail || '').toLowerCase();

    // Only process emails sent TO our account
    const isToUs = toEmail.toLowerCase() === accountEmail ||
                   toEmail.toLowerCase().includes(`<${accountEmail}>`);
    if (!isToUs) {
      const cc = (getHeader('Cc') || '').toLowerCase();
      const bcc = (getHeader('Bcc') || '').toLowerCase();
      if (!cc.includes(accountEmail) && !bcc.includes(accountEmail)) return 'skipped';
    }

    // Only process emails from existing CRM leads
    const lead = await this.findLead(fromEmail);
    if (!lead) return 'skipped';

    // Check for duplicates in database
    const { data: existing } = await this.supabase
      .from('messages')
      .select('id')
      .eq('gmail_message_id', messageId)
      .limit(1);

    if (existing && existing.length > 0) return 'duplicate';

    // Extract email content (HTML + text + embedded images)
    const extractor = new GmailEmailExtractor(this.gmail);
    const emailContent = await extractor.extractEmailContent(message, messageId);

    const bodyText = emailContent.text || '';
    let htmlBody = emailContent.html || null;
    const rawEmbeddedImages = emailContent.embeddedImages || [];

    // Upload embedded images to Supabase Storage and replace CID refs in HTML
    const embeddedImages = [];
    for (const img of rawEmbeddedImages) {
      if (img.dataUrl) {
        try {
          const base64Data = img.dataUrl.split(',')[1];
          if (!base64Data) continue;
          const buffer = Buffer.from(base64Data, 'base64');
          const ext = img.mimetype ? img.mimetype.split('/')[1] || 'jpg' : 'jpg';
          const fileName = `email-images/${messageId}/${img.contentId || Date.now()}.${ext}`;
          const tempDir = path.join(__dirname, '../uploads/temp_email_attachments');
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          const tempPath = path.join(tempDir, `${Date.now()}_${img.contentId || 'img'}.${ext}`);
          fs.writeFileSync(tempPath, buffer);
          const result = await supabaseStorage.uploadFile(tempPath, fileName, img.mimetype || 'image/jpeg');
          try { fs.unlinkSync(tempPath); } catch (e) {}
          if (result.success) {
            embeddedImages.push({ contentId: img.contentId, url: result.url, mimetype: img.mimetype, is_embedded: true });
            // Replace cid: references in HTML with the public URL
            if (htmlBody && img.contentId) {
              htmlBody = htmlBody.replace(new RegExp(`cid:${img.contentId.replace(/[<>]/g, '')}`, 'g'), result.url);
            }
          }
        } catch (e) {
          this.log(`⚠️ Failed to upload embedded image: ${e.message}`);
        }
      }
    }

    // Download and upload regular attachments to Supabase Storage
    const attachments = await this.extractAndUploadAttachments(message, messageId);

    // Combine all into one attachments array for storage
    const allAttachments = [...attachments, ...embeddedImages];

    const recordId = randomUUID();
    const emailReceivedDate = date ? new Date(date).toISOString() : new Date().toISOString();

    const { error: insertError } = await this.supabase
      .from('messages')
      .insert({
        id: recordId,
        lead_id: lead.id,
        type: 'email',
        subject,
        content: bodyText || '(No content)',
        email_body: htmlBody,
        recipient_email: fromEmail,
        status: 'delivered',
        gmail_message_id: messageId,
        gmail_account_key: 'primary',
        attachments: allAttachments.length > 0 ? allAttachments : null,
        sent_at: emailReceivedDate,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        read_status: false
      })
      .select('id')
      .single();

    if (insertError) throw new Error(`DB insert error: ${insertError.message}`);

    await this.routeReplyToOriginalSender(lead, subject, fromEmail, recordId);
    await this.updateLeadHistory(lead, subject, bodyText || '(No content)', emailReceivedDate);
    this.emitEvents(lead, recordId, subject, bodyText || '(No content)', emailReceivedDate, htmlBody, embeddedImages);

    this.log(`✅ Email: "${subject.substring(0, 40)}..." from ${fromEmail}`, true);
    return 'processed';
  }

  async extractAndUploadAttachments(message, messageId) {
    const attachments = [];
    const parts = message.payload?.parts || [];

    const findAttachmentParts = (parts) => {
      if (!parts) return [];
      const found = [];
      for (const part of parts) {
        if (part.parts) found.push(...findAttachmentParts(part.parts));
        const filename = part.filename;
        const attachmentId = part.body?.attachmentId;
        const mimeType = part.mimeType;
        if (filename && attachmentId && mimeType && !mimeType.startsWith('text/') && !mimeType.startsWith('multipart/')) {
          // Skip inline images (handled separately as embedded images)
          const disposition = (part.headers || []).find(h => h.name.toLowerCase() === 'content-disposition')?.value || '';
          if (disposition.toLowerCase().includes('inline') && mimeType.startsWith('image/')) continue;
          found.push({ filename, attachmentId, mimeType, size: part.body?.size || 0 });
        }
      }
      return found;
    };

    const attachmentParts = findAttachmentParts(parts);
    if (attachmentParts.length === 0) return attachments;

    for (const att of attachmentParts) {
      try {
        const response = await this.gmail.users.messages.attachments.get({
          userId: 'me', messageId, id: att.attachmentId
        });
        const base64 = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
        const buffer = Buffer.from(base64, 'base64');

        const ext = path.extname(att.filename) || '';
        const baseName = path.basename(att.filename, ext);
        const storageName = `email-attachments/${messageId}/${baseName}_${Date.now()}${ext}`;

        const tempDir = path.join(__dirname, '../uploads/temp_email_attachments');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempPath = path.join(tempDir, `${Date.now()}_${att.filename}`);
        fs.writeFileSync(tempPath, buffer);

        const result = await supabaseStorage.uploadFile(tempPath, storageName, att.mimeType);
        try { fs.unlinkSync(tempPath); } catch (e) {}

        if (result.success) {
          attachments.push({
            filename: att.filename,
            url: result.url,
            size: att.size || buffer.length,
            mimetype: att.mimeType
          });
          this.log(`✅ Uploaded attachment: ${att.filename}`);
        }
      } catch (e) {
        console.error(`❌ Error uploading attachment ${att.filename}:`, e.message);
      }
    }
    return attachments;
  }

  async findLead(email) {
    if (!email) return null;
    const emailLower = email.trim().toLowerCase();

    // Exact match (case-insensitive)
    const { data: lead } = await this.supabase
      .from('leads')
      .select('*')
      .ilike('email', emailLower)
      .limit(1)
      .maybeSingle();

    return lead || null;
  }

  async updateLeadHistory(lead, subject, body, emailReceivedDate) {
    let history = [];
    try { history = JSON.parse(lead.booking_history || '[]'); } catch (e) {}

    history.unshift({
      action: 'EMAIL_RECEIVED',
      timestamp: emailReceivedDate,
      details: { subject, body: body.substring(0, 150), direction: 'received', channel: 'email', read: false }
    });

    await this.supabase
      .from('leads')
      .update({ booking_history: JSON.stringify(history), updated_at: new Date().toISOString() })
      .eq('id', lead.id);
  }

  emitEvents(lead, messageId, subject, body, emailReceivedDate, htmlBody = null, embeddedImages = []) {
    if (!this.io) return;

    const rooms = [];
    if (lead.booker_id) rooms.push(`user_${lead.booker_id}`);
    rooms.push('admins');

    const payload = {
      messageId,
      leadId: lead.id,
      leadName: lead.name,
      content: subject || body.slice(0, 120),
      timestamp: emailReceivedDate,
      direction: 'received',
      channel: 'email',
      subject,
      body,
      email_body: htmlBody,
      embedded_images: embeddedImages
    };

    rooms.forEach(room => {
      this.io.to(room).emit('email_received', payload);
      this.io.to(room).emit('message_received', payload);
      this.io.to(room).emit('lead_updated', { type: 'LEAD_UPDATED', data: { lead } });
    });
  }

  async routeReplyToOriginalSender(lead, subject, fromEmail, messageId) {
    try {
      const normalizedSubject = subject.replace(/^(re|fwd?|fw):\s*/i, '').trim().toLowerCase();
      if (!normalizedSubject) return;

      const { data: sentMessages } = await this.supabase
        .from('messages')
        .select('id, sent_by, sent_by_name, subject, sent_at')
        .eq('lead_id', lead.id)
        .eq('type', 'email')
        .not('sent_by', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(10);

      if (!sentMessages || sentMessages.length === 0) return;

      const matchingMessage = sentMessages.find(msg => {
        const msgSubject = (msg.subject || '').replace(/^(re|fwd?|fw):\s*/i, '').trim().toLowerCase();
        return msgSubject === normalizedSubject || normalizedSubject.includes(msgSubject) || msgSubject.includes(normalizedSubject);
      });

      if (!matchingMessage?.sent_by) return;

      this.log(`📧 Reply routed to original sender ${matchingMessage.sent_by_name}`, true);

      if (this.io) {
        this.io.to(`user_${matchingMessage.sent_by}`).emit('email_reply_received', {
          messageId,
          leadId: lead.id,
          leadName: lead.name,
          replyFrom: fromEmail,
          subject,
          originalMessageId: matchingMessage.id,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('❌ Reply routing error:', error.message);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    this.saveProcessedMessages();
    console.log('📧 Gmail poller stopped');
  }
}

function startGmailPoller(socketIoInstance) {
  const email = GMAIL_EMAIL;
  if (!email) {
    console.error('❌ Gmail poller not started: Set GMAIL_EMAIL or GMAIL_USER in .env');
    return null;
  }

  console.log(`📧 Starting Gmail poller for ${email} (tokens loaded from database)...`);
  const poller = new GmailPoller(socketIoInstance);
  poller.start();
  return poller;
}

module.exports = { startGmailPoller, GmailPoller };
