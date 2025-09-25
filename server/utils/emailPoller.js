const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');

// Global state with enhanced connection management
let client = null;
let isConnected = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let isReconnecting = false;
let lastHeartbeat = null;
let heartbeatTimer = null;
let io = null;

// Supabase configuration
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';

// Singleton pattern to ensure only one connection
class EmailPoller {
  constructor() {
    if (EmailPoller.instance) {
      return EmailPoller.instance;
    }
    EmailPoller.instance = this;
    this.supabase = null;
    return this;
  }

  getSupabase() {
    if (!this.supabase) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
    }
    return this.supabase;
  }

  async connect() {
    const user = process.env.EMAIL_USER || process.env.GMAIL_USER;
    const pass = process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS;

    if (!user || !pass) {
      console.log('📧 Email poller disabled: EMAIL_USER or EMAIL_PASSWORD not set');
      return false;
    }

    if (isReconnecting) {
      console.log('📧 Connection already in progress, skipping...');
      return false;
    }

    if (client && client.usable && isConnected) {
      console.log('📧 Already connected to Gmail IMAP');
      return true;
    }

    try {
      isReconnecting = true;

      // Clean up any existing connection properly
      await this.cleanup();

      console.log(`📧 Connecting to Gmail IMAP (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})...`);

      client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user, pass },
        logger: false, // Disable verbose logging
        socketTimeout: 120000,  // 2 minutes (shorter for faster failure detection)
        idleTimeout: 240000,    // 4 minutes (shorter for more reliable reconnects)
        emitLogs: false,
        tls: {
          rejectUnauthorized: false,
          servername: 'imap.gmail.com',
          minVersion: 'TLSv1.2' // Ensure secure TLS
        },
        // Connection pool settings for reliability
        maxIdleTime: 300000, // 5 minutes
        connectionTimeout: 60000, // 1 minute connection timeout
      });

      // Set up event handlers before connecting
      client.on('error', this.handleError.bind(this));
      client.on('close', this.handleClose.bind(this));
      client.on('exists', this.handleNewEmail.bind(this));

      await client.connect();
      console.log('✅ Connected to Gmail IMAP successfully');

      await client.mailboxOpen('INBOX');
      console.log('✅ INBOX opened successfully');

      isConnected = true;
      reconnectAttempts = 0; // Reset on successful connection
      isReconnecting = false;
      lastHeartbeat = Date.now();

      // Start heartbeat monitoring
      this.startHeartbeat();

      // Initial scan and IDLE mode
      await this.scanUnprocessedMessages();
      this.startIdleMode();

      return true;
    } catch (error) {
      console.error('❌ Gmail IMAP connection failed:', error.message);
      isReconnecting = false;
      this.handleError(error);
      return false;
    }
  }

  async cleanup() {
    console.log('📧 Cleaning up existing connection...');

    // Clear heartbeat timer
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }

    // Close existing client connection
    if (client) {
      try {
        if (client.usable) {
          await client.close();
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for cleanup
      } catch (e) {
        console.log('⚠️ Error during connection cleanup:', e.message);
      }
      client = null;
    }

    isConnected = false;
  }

  startHeartbeat() {
    // Clear existing heartbeat
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
    }

    heartbeatTimer = setTimeout(async () => {
      if (isConnected && client?.usable) {
        try {
          // Simple heartbeat - check mailbox status
          await client.status('INBOX', { messages: true });
          lastHeartbeat = Date.now();
          console.log('💓 Email poller heartbeat OK');
          this.startHeartbeat(); // Schedule next heartbeat
        } catch (error) {
          console.error('💔 Email poller heartbeat failed:', error.message);
          this.handleError(error);
        }
      }
    }, 60000); // Heartbeat every minute
  }

  handleClose() {
    console.log('📧 IMAP connection closed');
    isConnected = false;
    isReconnecting = false;

    // Clear heartbeat
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }

    this.scheduleReconnect(5000);
  }

  handleError(error) {
    console.error('❌ IMAP Error:', error.message);
    isConnected = false;
    isReconnecting = false;

    reconnectAttempts++;

    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts (${maxReconnectAttempts}) reached. Email polling disabled.`);
      return;
    }

    if (error.message?.includes('Too many simultaneous connections')) {
      console.log('⏳ Hit Gmail connection limit, waiting 2 minutes before retry...');
      this.scheduleReconnect(120000); // Wait 2 minutes
    } else if (error.message?.includes('authentication')) {
      console.error('❌ Authentication error. Please check EMAIL_USER and EMAIL_PASSWORD');
      this.scheduleReconnect(300000); // Wait 5 minutes for auth errors
    } else {
      // Exponential backoff for other errors
      const delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000);
      console.log(`⏳ Scheduling reconnect in ${delay/1000} seconds (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
      this.scheduleReconnect(delay);
    }
  }

  scheduleReconnect(delay) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    
    reconnectTimer = setTimeout(async () => {
      console.log('📧 Attempting to reconnect...');
      await this.connect();
    }, delay);
  }

  async handleNewEmail() {
    if (!isConnected || !client?.usable) return;

    try {
      const status = await client.status('INBOX', { messages: true, uidNext: true });
      console.log('📧 New email detected. Status:', status);
      
      // Fetch only new messages
      const fromUid = Math.max(1, status.uidNext - 5);
      for await (let message of client.fetch(`${fromUid}:*`, { 
        uid: true,
        envelope: true,
        internalDate: true,
        source: true
      })) {
        await this.processMessage(message);
      }
    } catch (error) {
      console.error('📧 Error handling new email:', error);
      this.handleError(error);
    }
  }

  async startIdleMode() {
    console.log('📧 Starting IDLE mode for real-time email monitoring...');

    while (isConnected && client?.usable && !isReconnecting) {
      try {
        console.log('📧 Entering IDLE state...');

        // Set a timeout for IDLE to prevent hanging
        const idleTimeout = setTimeout(() => {
          if (client?.usable) {
            console.log('📧 IDLE timeout - refreshing connection...');
            try {
              client.close();
            } catch (e) {
              console.log('⚠️ Error closing IDLE connection:', e.message);
            }
          }
        }, 240000); // 4 minutes timeout

        await client.idle();

        clearTimeout(idleTimeout);
        console.log('📧 IDLE state ended normally');

        // Small delay before next IDLE cycle to prevent rapid cycling
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error('❌ IDLE mode error:', error.message);

        // Check if this is a connection error
        if (!client?.usable || !isConnected) {
          console.log('📧 Connection lost during IDLE, will reconnect...');
          break;
        }

        // Wait before retrying IDLE
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    console.log('📧 IDLE mode ended');

    // If we exit IDLE due to connection issues, trigger reconnection
    if (!isConnected && !isReconnecting) {
      console.log('📧 IDLE mode ended due to connection issues, triggering reconnect...');
      this.handleError(new Error('IDLE mode connection lost'));
    }
  }

  async scanUnprocessedMessages() {
    if (!isConnected || !client?.usable) return;

    try {
      const status = await client.status('INBOX', { messages: true, uidNext: true });
      const fromUid = Math.max(1, status.uidNext - 30); // Check last 30 messages
      
      for await (let message of client.fetch(`${fromUid}:*`, { 
        uid: true,
        envelope: true,
        internalDate: true,
        source: true
      })) {
        await this.processMessage(message);
      }
    } catch (error) {
      console.error('📧 Error scanning messages:', error);
    }
  }

  async extractEmailBody(raw) {
    try {
      // Parse email using mailparser
      const parsed = await simpleParser(raw);
      
      // Get text content
      let body = parsed.text || '';
      
      // If no text content but HTML exists, use HTML
      if (!body && parsed.html) {
        body = parsed.html
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      // Clean up quoted replies
      body = body
        .replace(/^>+.*/gm, '') // Remove quoted text
        .replace(/On.*wrote:[\s\S]*$/gm, '') // Remove "On ... wrote:" sections
        .replace(/From:.*\nSent:.*\nTo:.*\nSubject:.*/g, '') // Remove email headers
        .replace(/\[.*?\]/g, '') // Remove square brackets
        .replace(/\n{3,}/g, '\n\n') // Reduce multiple newlines
        .trim();

      return body || 'No content available';
    } catch (error) {
      console.error('📧 Error extracting email body:', error);
      return 'Error extracting email content';
    }
  }

  async processMessage(message) {
    const supabase = this.getSupabase();
    const startTime = Date.now();

    try {
      const { envelope, uid, internalDate, source } = message;
      const fromAddr = envelope?.from?.[0]?.address;
      const subject = envelope?.subject || '';

      // Use email's actual received date with better fallback logic
      let emailReceivedDate;
      let processingDate = new Date().toISOString();

      if (internalDate && internalDate instanceof Date && !isNaN(internalDate.getTime())) {
        // Use IMAP internal date (when email was received by server)
        emailReceivedDate = internalDate.toISOString();
        console.log(`📧 Using IMAP internal date: ${emailReceivedDate}`);
      } else if (envelope?.date && envelope.date instanceof Date && !isNaN(envelope.date.getTime())) {
        // Fallback to envelope date (when email was sent)
        emailReceivedDate = envelope.date.toISOString();
        console.log(`📧 Using envelope date: ${emailReceivedDate}`);
      } else {
        // Last resort: use current time but log warning
        emailReceivedDate = processingDate;
        console.warn(`⚠️ No valid email date found, using current time: ${emailReceivedDate}`);
      }

      console.log(`📧 Processing email from ${fromAddr}: "${subject}" (UID: ${uid}, Date: ${emailReceivedDate})`);

      // Validate required fields
      if (!fromAddr) {
        console.warn(`⚠️ Skipping email with no from address (UID: ${uid})`);
        return;
      }

      if (!source || source.length === 0) {
        console.warn(`⚠️ Skipping email with no content (UID: ${uid}, from: ${fromAddr})`);
        return;
      }

      // Extract body with error handling
      let body;
      try {
        const rawEmail = source.toString('utf8');
        body = await this.extractEmailBody(rawEmail);

        // Save raw email for debugging (with size limit)
        if (rawEmail.length < 1024 * 1024) { // Only save emails < 1MB
          try {
            const debugDir = path.join(__dirname, '..', 'email_debug_logs');
            fs.mkdirSync(debugDir, { recursive: true });
            fs.writeFileSync(path.join(debugDir, `email_${uid}_${Date.now()}.txt`), rawEmail);
          } catch (debugError) {
            console.warn('⚠️ Failed to save debug email:', debugError.message);
          }
        }
      } catch (bodyError) {
        console.error('❌ Failed to extract email body:', bodyError.message);
        body = 'Error extracting email content';
      }

      // Find matching lead with better error handling
      let lead;
      try {
        const { data: leadData, error: leadError } = await supabase
          .from('leads')
          .select('*')
          .eq('email', fromAddr)
          .single();

        if (leadError) {
          if (leadError.code === 'PGRST116') {
            console.log(`📧 No matching lead found for email: ${fromAddr}`);
          } else {
            console.error(`❌ Database error finding lead for ${fromAddr}:`, leadError.message);
          }
          return;
        }

        lead = leadData;
        console.log(`✅ Found matching lead: ${lead.name} (ID: ${lead.id})`);
      } catch (dbError) {
        console.error(`❌ Failed to query leads for ${fromAddr}:`, dbError.message);
        return;
      }

      // Check if we've already processed this email
      const { data: existingMessages, error: checkError } = await supabase
        .from('messages')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('type', 'email')
        .eq('created_at', dateIso);

      if (checkError) {
        console.error('❌ Error checking for existing message:', checkError.message);
        return;
      }

      if (existingMessages && existingMessages.length > 0) {
        console.log('📧 Email already processed, skipping');
        return;
      }

      // Add to messages table with proper timestamp separation
      const { randomUUID } = require('crypto');
      const messageId = randomUUID();
      const { data: insertedMessage, error: insertError } = await supabase
        .from('messages')
        .insert({
          id: messageId,
          lead_id: lead.id,
          type: 'email',
          subject: subject,
          content: body,
          recipient_email: fromAddr,
          status: 'received',
          sent_at: emailReceivedDate, // When the email was actually received
          created_at: processingDate,  // When CRM processed the email
          updated_at: processingDate,  // When CRM last updated the record
          read_status: false
        })
        .select('id')
        .single();

      if (insertError || !insertedMessage) {
        console.error('❌ Error inserting message:', insertError?.message);
        return;
      }

      const actualMessageId = insertedMessage.id;
      console.log(`📧 Email inserted with ID: ${actualMessageId}`);

      // Update booking history
      let history = [];
      try {
        history = JSON.parse(lead.booking_history || '[]');
      } catch (e) {}

      history.unshift({
        action: 'EMAIL_RECEIVED',
        timestamp: emailReceivedDate, // Use email's actual received date
        details: {
          subject,
          body,
          direction: 'received',
          channel: 'email',
          read: false
        }
      });

      const { error: updateError } = await supabase
        .from('leads')
        .update({
          booking_history: JSON.stringify(history),
          updated_at: processingDate // Use processing date for lead update
        })
        .eq('id', lead.id);

      if (updateError) {
        console.error('❌ Error updating lead booking history:', updateError.message);
      }

      // Emit events
      if (io) {
          const rooms = [];
        if (lead.booker_id) rooms.push(`user_${lead.booker_id}`);
          rooms.push('admins');

          const payload = {
            messageId: actualMessageId,  // Include the actual message UUID
            leadId: lead.id,
            leadName: lead.name,
            content: subject || body.slice(0, 120),
            timestamp: emailReceivedDate, // Use email's actual received date for UI
            direction: 'received',
            channel: 'email',
            subject,
            body
          };

        rooms.forEach(room => {
          io.to(room).emit('email_received', payload);
          io.to(room).emit('message_received', payload);
          io.to(room).emit('lead_updated', {
            type: 'LEAD_UPDATED',
            data: { lead: { ...lead, booking_history: history } }
          });
        });
      }

      const processingTime = Date.now() - startTime;
      console.log(`✅ Email processed successfully in ${processingTime}ms: "${subject}" from ${fromAddr}`);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Error processing message after ${processingTime}ms:`, error.message);
      console.error(`📧 Failed message details: UID=${message.uid}, from=${message.envelope?.from?.[0]?.address}, subject="${message.envelope?.subject}"`);

      // Log stack trace only for unexpected errors
      if (!error.message.includes('lead found') && !error.message.includes('already processed')) {
        console.error('📧 Full error stack:', error.stack);
      }
    }
  }
}

// Export a function that ensures singleton usage
function startEmailPoller(socketIoInstance) {
  io = socketIoInstance;
  const poller = new EmailPoller();
  poller.connect();
}

module.exports = { startEmailPoller };