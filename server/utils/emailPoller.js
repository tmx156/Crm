const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
const { simpleParser } = require('mailparser');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';

// Email account configurations from .env - Only primary account
const EMAIL_ACCOUNTS = {
  primary: {
    user: process.env.EMAIL_USER || process.env.GMAIL_USER,
    pass: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS,
    name: 'The Editorial Co'
  }
};

// Constants
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 60000; // 1 minute
const BACKUP_SCAN_INTERVAL_MS = 1800000; // 30 minutes

// Persistent tracking for processed messages
const PROCESSED_MESSAGES_FILE = path.join(__dirname, '../data/processed_email_messages.json');

// --- EmailPoller Class (IMAP) ---
class EmailPoller {
  constructor(ioInstance, accountKey = 'primary') {
    const instanceKey = `EmailPoller_${accountKey}`;

    if (EmailPoller.instances && EmailPoller.instances[instanceKey]) {
      return EmailPoller.instances[instanceKey];
    }

    if (!EmailPoller.instances) {
      EmailPoller.instances = {};
    }
    EmailPoller.instances[instanceKey] = this;

    // Instance State
    this.accountKey = accountKey;
    this.accountConfig = EMAIL_ACCOUNTS[accountKey];
    this.supabase = null;
    this.client = null;
    this.isConnected = false;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.io = ioInstance;

    // Validate account configuration
    if (!this.accountConfig || !this.accountConfig.user || !this.accountConfig.pass) {
      console.log(`📧 Email poller for ${accountKey} disabled: Account not configured`);
      this.disabled = true;
      return;
    }

    this.disabled = false;
    console.log(`📧 IMAP email poller initialized for ${this.accountConfig.name} (${this.accountConfig.user})`);

    // Initialize Supabase client
    this.supabase = this.getSupabase();

    // Initialize persistent tracking
    this.processedMessages = new Set();
    this.loadProcessedMessages();
  }

  // Load processed messages from persistent storage
  loadProcessedMessages() {
    try {
      const dataDir = path.dirname(PROCESSED_MESSAGES_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(PROCESSED_MESSAGES_FILE)) {
        const data = JSON.parse(fs.readFileSync(PROCESSED_MESSAGES_FILE, 'utf8'));
        if (data.processedIds && Array.isArray(data.processedIds)) {
          data.processedIds.forEach(id => this.processedMessages.add(id));
        }
        console.log(`📧 [${this.accountConfig.name}] Loaded ${this.processedMessages.size} processed message IDs`);
      }
    } catch (error) {
      console.error(`📧 [${this.accountConfig.name}] Error loading processed messages:`, error.message);
    }
  }

  // Save processed messages to persistent storage
  saveProcessedMessages() {
    try {
      const data = {
        lastUpdated: new Date().toISOString(),
        processedIds: Array.from(this.processedMessages)
      };

      const dataDir = path.dirname(PROCESSED_MESSAGES_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(PROCESSED_MESSAGES_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`📧 [${this.accountConfig.name}] Error saving processed messages:`, error.message);
    }
  }

  // Mark message as processed
  markMessageProcessed(uid, leadId) {
    const key = `${this.accountKey}_${uid}_${leadId}`;
    this.processedMessages.add(key);
    this.saveProcessedMessages();
  }

  // Check if message was already processed
  isMessageProcessed(uid, leadId) {
    const key = `${this.accountKey}_${uid}_${leadId}`;
    return this.processedMessages.has(key);
  }

  getSupabase() {
    if (!SUPABASE_KEY) {
      throw new Error('❌ Supabase Key is not set in environment variables!');
    }
    return createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  async connect() {
    if (this.disabled) {
      console.log(`📧 Email poller for ${this.accountKey} is disabled`);
      return false;
    }

    if (!this.accountConfig.user || !this.accountConfig.pass) {
      console.log(`📧 Email poller for ${this.accountKey} disabled: Account not configured`);
      return false;
    }

    if (this.isReconnecting) {
      console.log(`📧 [${this.accountConfig.name}] Connection already in progress, skipping...`);
      return false;
    }

    if (this.client && this.client.usable && this.isConnected) {
      console.log(`📧 [${this.accountConfig.name}] Already connected to IMAP`);
      return true;
    }

    try {
      this.isReconnecting = true;

      // Clean up any existing connection
      await this.cleanup();

      console.log(`📧 [${this.accountConfig.name}] Connecting to IMAP (attempt ${this.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);

      this.client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: this.accountConfig.user, pass: this.accountConfig.pass },
        logger: false,
        socketTimeout: 120000,
        idleTimeout: 240000,
        tls: {
          rejectUnauthorized: true,
          servername: 'imap.gmail.com',
          minVersion: 'TLSv1.2'
        },
      });

      // Set up event handlers
      this.client.on('error', this.handleError.bind(this));
      this.client.on('close', this.handleClose.bind(this));
      this.client.on('exists', this.handleNewEmail.bind(this));

      await this.client.connect();
      console.log(`✅ [${this.accountConfig.name}] Connected to IMAP successfully`);

      await this.client.mailboxOpen('INBOX');
      console.log(`✅ [${this.accountConfig.name}] INBOX opened successfully`);

      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      // Start heartbeat and initial scan
      this.startHeartbeat();
      await this.scanUnprocessedMessages();
      this.startIdleMode();

      return true;
    } catch (error) {
      console.error(`❌ [${this.accountConfig.name}] IMAP connection failed:`, error.message);
      this.isReconnecting = false;
      this.handleError(error);
      return false;
    }
  }

  async cleanup() {
    console.log(`📧 [${this.accountConfig.name}] Cleaning up existing connection...`);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;

    if (this.client) {
      try {
        if (this.client.usable) {
          await this.client.close();
        }
      } catch (e) {
        console.log(`⚠️ [${this.accountConfig.name}] Error during connection cleanup:`, e.message);
      }
      this.client = null;
    }
    this.isConnected = false;
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);

    this.heartbeatTimer = setTimeout(async () => {
      if (this.isConnected && this.client?.usable) {
        try {
          await this.client.status('INBOX', { messages: true });
          console.log(`💓 [${this.accountConfig.name}] Email poller heartbeat OK`);
          this.startHeartbeat();
        } catch (error) {
          console.error(`💔 [${this.accountConfig.name}] Email poller heartbeat failed:`, error.message);
          this.handleError(error);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  handleClose() {
    console.log(`📧 [${this.accountConfig.name}] IMAP connection closed`);
    this.isConnected = false;
    this.isReconnecting = false;
    this.scheduleReconnect();
  }

  handleError(error) {
    console.error(`❌ [${this.accountConfig.name}] IMAP error:`, error.message);
    this.isConnected = false;
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.isReconnecting) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`❌ [${this.accountConfig.name}] Max reconnection attempts reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = RECONNECT_BASE_DELAY_MS * this.reconnectAttempts;

    console.log(`📧 [${this.accountConfig.name}] Scheduling reconnect in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  handleNewEmail() {
    console.log(`📧 [${this.accountConfig.name}] New email detected, scanning...`);
    this.scanUnprocessedMessages();
  }

  async startIdleMode() {
    if (!this.isConnected || !this.client?.usable) return;

    try {
      await this.client.idle();
      console.log(`📧 [${this.accountConfig.name}] IDLE mode started - listening for new emails`);
    } catch (error) {
      console.error(`❌ [${this.accountConfig.name}] Failed to start IDLE mode:`, error.message);
    }
  }

  async scanUnprocessedMessages() {
    if (!this.isConnected || !this.client?.usable) {
      return;
    }

    try {
      const status = await this.client.status('INBOX', { messages: true, uidNext: true });
      const totalMessages = status.messages;

      if (totalMessages === 0) {
        return;
      }

      // Fetch last 50 messages
      const fetchRange = Math.max(1, totalMessages - 49);
      const range = `${fetchRange}:${totalMessages}`;

      console.log(`📧 [${this.accountConfig.name}] Scanning messages ${range} (${totalMessages} total)`);

      let processedCount = 0;
      let skippedCount = 0;

      for await (const message of this.client.fetch(range, {
        uid: true,
        envelope: true,
        bodyStructure: true,
        source: true
      })) {
        try {
          await this.processMessage(message);
          processedCount++;
        } catch (error) {
          if (error.message.includes('DUPLICATE') || error.message.includes('NO_MATCHING_LEAD')) {
            skippedCount++;
          } else {
            console.error(`❌ [${this.accountConfig.name}] Error processing message ${message.uid}:`, error.message);
          }
        }
      }

      console.log(`📧 [${this.accountConfig.name}] Scan complete: ${processedCount} processed, ${skippedCount} skipped`);

      // Restart IDLE mode
      if (this.isConnected && this.client?.usable) {
        await this.startIdleMode();
      }
    } catch (error) {
      console.error(`❌ [${this.accountConfig.name}] Error scanning messages:`, error.message);
    }
  }

  extractEmail(header) {
    if (!header) return null;
    const match = header.match(/<(.+?)>/) || header.match(/([^\s]+@[^\s]+)/);
    return match ? match[1] : header.trim();
  }

  async findLead(email) {
    if (!email) return null;

    const { data: leadData, error: leadError } = await this.supabase
      .from('leads')
      .select('*')
      .ilike('email', email.trim())
      .single();

    if (leadError && leadError.code === 'PGRST116') {
      return null;
    }

    if (leadError) {
      console.error(`❌ Database error finding lead for ${email}:`, leadError.message);
      throw new Error(`DB_ERROR_LEAD_SEARCH: ${leadError.message}`);
    }

    return leadData;
  }

  async processMessage(message) {
    try {
      const uid = message.uid;
      const envelope = message.envelope;

      const fromEmail = this.extractEmail(envelope.from[0]?.address || envelope.from[0]);

      if (!fromEmail) {
        console.warn(`⚠️ [${this.accountConfig.name}] Skipping message ${uid}: No from address`);
        return;
      }

      // Find lead
      const lead = await this.findLead(fromEmail);

      if (!lead) {
        console.log(`📧 [${this.accountConfig.name}] No lead found for ${fromEmail}, skipping`);
        throw new Error('NO_MATCHING_LEAD');
      }

      // Check if already processed
      if (this.isMessageProcessed(uid, lead.id)) {
        console.log(`📧 [${this.accountConfig.name}] Message ${uid} already processed, skipping`);
        throw new Error('DUPLICATE_MESSAGE_ID');
      }

      console.log(`📧 [${this.accountConfig.name}] Processing: UID ${uid}, From: ${fromEmail}, Subject: "${envelope.subject}"`);

      // Parse email
      const parsed = await simpleParser(message.source);

      const subject = parsed.subject || 'No subject';
      const body = parsed.text || parsed.html || 'No content';
      const date = parsed.date || new Date();

      // Check for duplicate content
      const crypto = require('crypto');
      const contentHash = crypto.createHash('md5').update(body).digest('hex');

      const { data: existingByHash } = await this.supabase
        .from('messages')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('type', 'email')
        .limit(20);

      if (existingByHash && existingByHash.length > 0) {
        for (const existing of existingByHash) {
          const existingContent = await this.supabase
            .from('messages')
            .select('content')
            .eq('id', existing.id)
            .single();

          if (existingContent.data) {
            const existingHash = crypto.createHash('md5').update(existingContent.data.content || '').digest('hex');
            if (existingHash === contentHash) {
              console.log(`📧 [${this.accountConfig.name}] Duplicate content found, skipping`);
              throw new Error('DUPLICATE_CONTENT');
            }
          }
        }
      }

      // Process attachments
      const attachments = [];
      if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
          attachments.push({
            filename: att.filename || 'attachment',
            mimeType: att.contentType,
            size: att.size || 0
          });
        }
      }

      // Insert message to database
      const dbMessageId = randomUUID();
      const { error: insertError } = await this.supabase
        .from('messages')
        .insert({
          id: dbMessageId,
          lead_id: lead.id,
          type: 'email',
          subject: subject,
          content: body,
          recipient_email: fromEmail,
          status: 'received',
          sent_at: date.toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          read_status: false,
          metadata: attachments.length > 0 ? JSON.stringify({ attachments }) : null
        });

      if (insertError) {
        throw new Error(`DB_ERROR_INSERT: ${insertError.message}`);
      }

      if (attachments.length > 0) {
        console.log(`📎 [${this.accountConfig.name}] Found ${attachments.length} attachments`);
      }

      // Update lead history
      await this.updateLeadHistory(lead, subject, body, date);

      // Emit socket events
      this.emitEvents(lead, dbMessageId, subject, body, date);

      // Mark as processed
      this.markMessageProcessed(uid, lead.id);

      console.log(`✅ [${this.accountConfig.name}] Message ${uid} processed successfully`);
    } catch (error) {
      throw error;
    }
  }

  async updateLeadHistory(lead, subject, body, emailReceivedDate) {
    let history = [];
    try {
      history = JSON.parse(lead.booking_history || '[]');
    } catch (e) {
      console.warn('⚠️ Error parsing existing booking history:', e.message);
    }

    history.unshift({
      action: 'EMAIL_RECEIVED',
      timestamp: emailReceivedDate.toISOString(),
      details: {
        subject,
        body: body.substring(0, 150) + '...',
        direction: 'received',
        channel: 'email',
        read: false
      }
    });

    const { error: updateError } = await this.supabase
      .from('leads')
      .update({
        booking_history: JSON.stringify(history),
        updated_at: new Date().toISOString()
      })
      .eq('id', lead.id);

    if (updateError) {
      console.error(`❌ Error updating lead history:`, updateError.message);
    }
  }

  emitEvents(lead, messageId, subject, body, emailReceivedDate) {
    if (!this.io) return;

    const rooms = [];
    if (lead.booker_id) rooms.push(`user_${lead.booker_id}`);
    rooms.push('admins');

    const payload = {
      messageId,
      leadId: lead.id,
      leadName: lead.name,
      content: subject || body.slice(0, 120),
      timestamp: emailReceivedDate.toISOString(),
      direction: 'received',
      channel: 'email',
      subject,
      body
    };

    rooms.forEach(room => {
      this.io.to(room).emit('email_received', payload);
      this.io.to(room).emit('message_received', payload);
      this.io.to(room).emit('lead_updated', {
        type: 'LEAD_UPDATED',
        data: { lead }
      });
    });
  }
}

// --- Export Function ---
function startEmailPoller(socketIoInstance, accountKeys = ['primary']) {
  if (!SUPABASE_KEY) {
    console.error('CRITICAL: Cannot start poller. Missing SUPABASE_KEY environment variable.');
    return [];
  }

  const pollers = [];

  // Start a poller for each configured account
  for (const accountKey of accountKeys) {
    const account = EMAIL_ACCOUNTS[accountKey];

    if (!account || !account.user || !account.pass) {
      console.log(`📧 Skipping ${accountKey} email poller: Account not configured`);
      continue;
    }

    console.log(`📧 Starting IMAP email poller for ${account.name} (${account.user})...`);

    const poller = new EmailPoller(socketIoInstance, accountKey);
    poller.connect();

    // Set up recurring backup scan
    setInterval(async () => {
      if (poller.isConnected && poller.client?.usable) {
        console.log(`📧 [${account.name}] 🔄 Scheduled backup email scan starting...`);
        try {
          await poller.scanUnprocessedMessages();
          console.log(`📧 [${account.name}] ✅ Scheduled backup email scan completed`);
        } catch (error) {
          console.error(`📧 [${account.name}] ❌ Scheduled backup email scan failed:`, error.message);
        }
      } else {
        console.log(`📧 [${account.name}] ⚠️ Skipping scheduled scan - not connected`);
      }
    }, BACKUP_SCAN_INTERVAL_MS);

    pollers.push(poller);
    console.log(`📧 ✅ [${account.name}] IMAP email poller started with 30-minute recurring backup scans`);
  }

  if (pollers.length === 0) {
    console.error('❌ No email pollers started - no accounts configured');
  }

  return pollers;
}

module.exports = { startEmailPoller, EmailPoller, EMAIL_ACCOUNTS };
