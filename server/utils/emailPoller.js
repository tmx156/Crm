const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');

// Global state
let client = null;
let isConnected = false;
let reconnectTimer = null;
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

    if (client && client.usable) {
      console.log('📧 Already connected to Gmail IMAP');
      return true;
    }

    try {
      // Close any existing connection
      if (client) {
        try { 
          await client.close();
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for connection to fully close
        } catch (e) {
          console.log('📧 Error closing existing connection:', e.message);
        }
        client = null;
      }

      client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
        auth: { user, pass },
        logger: false, // Disable verbose logging
        socketTimeout: 300000,  // 5 minutes
        idleTimeout: 300000,    // 5 minutes
        emitLogs: false,
        tls: {
          rejectUnauthorized: false,
          servername: 'imap.gmail.com'
        }
      });

      await client.connect();
      console.log('📧 Connected to Gmail IMAP');
      
      await client.mailboxOpen('INBOX');
      console.log('📧 INBOX opened');
      
      isConnected = true;
      
      // Set up event handlers
      client.on('exists', this.handleNewEmail.bind(this));
      client.on('error', this.handleError.bind(this));
      client.on('close', () => {
        console.log('📧 IMAP connection closed');
        isConnected = false;
        this.scheduleReconnect(5000);
      });

      // Initial scan and IDLE mode
      await this.scanUnprocessedMessages();
      this.startIdleMode();
      
      return true;
    } catch (error) {
      console.error('📧 Connection error:', error.message);
      this.handleError(error);
      return false;
    }
  }

  handleError(error) {
    console.error('📧 IMAP Error:', error.message);
    isConnected = false;
    
    if (error.message?.includes('Too many simultaneous connections')) {
      console.log('📧 Hit Gmail connection limit, waiting longer before retry...');
      this.scheduleReconnect(60000); // Wait 1 minute
    } else {
      this.scheduleReconnect(5000); // Wait 5 seconds
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
    while (isConnected && client?.usable) {
      try {
        await client.idle();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay between IDLE cycles
      } catch (error) {
        console.error('📧 IDLE mode error:', error);
        break;
      }
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
    try {
      const { envelope, uid, internalDate, source } = message;
      const fromAddr = envelope?.from?.[0]?.address;
      const subject = envelope?.subject || '';
      const dateIso = internalDate?.toISOString() || new Date().toISOString();

      console.log(`📧 Processing email: ${fromAddr} - ${subject}`);

      // Extract body
      const rawEmail = source.toString('utf8');
      const body = await this.extractEmailBody(rawEmail);

      // Save raw email for debugging
      const debugDir = path.join(__dirname, '..', 'email_debug_logs');
      fs.mkdirSync(debugDir, { recursive: true });
      fs.writeFileSync(path.join(debugDir, `email_${uid}_${Date.now()}.txt`), rawEmail);

      // Find matching lead
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('*')
        .eq('email', fromAddr)
        .single();

      if (leadError || !lead) {
        console.log(`📧 No matching lead found for ${fromAddr}`);
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

      // Add to messages table
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
          sent_at: dateIso,
          created_at: dateIso,
          updated_at: dateIso,
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
        timestamp: dateIso,
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
          updated_at: dateIso
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
            timestamp: dateIso,
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

      console.log(`📧 Email processed successfully: ${subject}`);

    } catch (error) {
      console.error('📧 Error processing message:', error);
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