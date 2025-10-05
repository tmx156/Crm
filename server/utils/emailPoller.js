const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
const { simpleParser } = require('mailparser');
const { randomUUID } = require('crypto');

// --- Configuration ---
// Using existing Supabase credentials from config
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const EMAIL_USER = process.env.EMAIL_USER || process.env.GMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS;

// Constants
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 60000; // 1 minute
const BACKUP_SCAN_INTERVAL_MS = 1800000; // 30 minutes (Primary is IDLE, optimized for egress)

// --- EmailPoller Class ---
class EmailPoller {
    constructor(ioInstance) {
        if (EmailPoller.instance) {
            return EmailPoller.instance;
        }
        EmailPoller.instance = this;

        // Instance State
        this.supabase = null;
        this.client = null;
        this.isConnected = false;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.io = ioInstance; // Socket.IO instance

        // Initialize Supabase client
        this.supabase = this.getSupabase();
    }

    getSupabase() {
        if (!SUPABASE_KEY) {
            throw new Error('❌ Supabase Key is not set in environment variables!');
        }
        return createClient(SUPABASE_URL, SUPABASE_KEY);
    }

    async connect() {
        if (!EMAIL_USER || !EMAIL_PASS) {
            console.log('📧 Email poller disabled: EMAIL_USER or EMAIL_PASSWORD not set');
            return false;
        }

        if (this.isReconnecting) {
            console.log('📧 Connection already in progress, skipping...');
            return false;
        }

        if (this.client && this.client.usable && this.isConnected) {
            console.log('📧 Already connected to IMAP');
            return true;
        }

        try {
            this.isReconnecting = true;

            // Clean up any existing connection properly
            await this.cleanup();

            console.log(`📧 Connecting to IMAP (attempt ${this.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);

            this.client = new ImapFlow({
                host: 'imap.gmail.com',
                port: 993,
                secure: true,
                auth: { user: EMAIL_USER, pass: EMAIL_PASS },
                logger: false,
                socketTimeout: 120000,
                idleTimeout: 240000,
                tls: {
                    rejectUnauthorized: true, // ✅ SECURITY FIX: Ensure certificate validation
                    servername: 'imap.gmail.com',
                    minVersion: 'TLSv1.2'
                },
            });

            // Set up event handlers before connecting
            this.client.on('error', this.handleError.bind(this));
            this.client.on('close', this.handleClose.bind(this));
            this.client.on('exists', this.handleNewEmail.bind(this));

            await this.client.connect();
            console.log('✅ Connected to IMAP successfully');

            await this.client.mailboxOpen('INBOX');
            console.log('✅ INBOX opened successfully');

            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.isReconnecting = false;

            // Start heartbeat monitoring and initial scan
            this.startHeartbeat();
            await this.scanUnprocessedMessages();
            this.startIdleMode();

            return true;
        } catch (error) {
            console.error('❌ IMAP connection failed:', error.message);
            this.isReconnecting = false;
            this.handleError(error);
            return false;
        }
    }

    async cleanup() {
        console.log('📧 Cleaning up existing connection...');
        if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = null;

        if (this.client) {
            try {
                if (this.client.usable) {
                    await this.client.close();
                }
            } catch (e) {
                console.log('⚠️ Error during connection cleanup:', e.message);
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
                    // Simple heartbeat
                    await this.client.status('INBOX', { messages: true });
                    console.log('💓 Email poller heartbeat OK');
                    this.startHeartbeat(); // Schedule next heartbeat
                } catch (error) {
                    console.error('💔 Email poller heartbeat failed:', error.message);
                    this.handleError(error);
                }
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    handleClose() {
        console.log('📧 IMAP connection closed');
        this.isConnected = false;
        this.isReconnecting = false;

        if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = null;

        this.scheduleReconnect(RECONNECT_BASE_DELAY_MS);
    }

    handleError(error) {
        console.error('❌ IMAP Error:', error.message);
        this.isConnected = false;
        this.isReconnecting = false;
        this.reconnectAttempts++;

        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(`❌ Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Email polling disabled.`);
            return;
        }

        let delay;
        if (error.message?.includes('Too many simultaneous connections')) {
            delay = 120000; // 2 minutes
        } else if (error.message?.includes('authentication')) {
            delay = 300000; // 5 minutes
        } else {
            // Exponential backoff
            delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1), 60000);
        }

        console.log(`⏳ Scheduling reconnect in ${delay / 1000} seconds (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        this.scheduleReconnect(delay);
    }

    scheduleReconnect(delay) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

        this.reconnectTimer = setTimeout(async () => {
            console.log('📧 Attempting to reconnect...');
            await this.connect();
        }, delay);
    }

    async handleNewEmail() {
        console.log('📧 handleNewEmail (IDLE exists) triggered! Triggering targeted scan...');
        // The exists event simply means new mail arrived. We use the targeted scan
        // to fetch and process everything new.
        this.scanUnprocessedMessages();
    }

    async startIdleMode() {
        if (!this.isConnected || !this.client?.usable) return;

        console.log('📧 Starting IDLE mode for real-time email monitoring...');

        while (this.isConnected && this.client?.usable && !this.isReconnecting) {
            try {
                // IDLE mode will wait here until a new message arrives or the timeout occurs.
                await this.client.idle();
                console.log('📧 IDLE state ended (new email or timeout)');

                // INCREASED delay to reduce polling frequency and egress
                await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds instead of 2

            } catch (error) {
                console.error('❌ IDLE mode error:', error.message);
                if (!this.client?.usable || !this.isConnected) {
                    console.log('📧 Connection lost during IDLE, will break loop and reconnect...');
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        console.log('📧 IDLE mode ended loop');

        // If connection dropped while in IDLE, trigger the standard error flow
        if (!this.isConnected && !this.isReconnecting) {
            this.handleError(new Error('IDLE mode connection lost'));
        }
    }

    async scanUnprocessedMessages() {
        if (!this.isConnected || !this.client?.usable) {
            console.log('📧 scanUnprocessedMessages: Not connected or client not usable');
            return;
        }

        try {
            console.log('📧 Scanning for unprocessed messages...');

            // Get mailbox status first to determine the range
            const status = await this.client.status('INBOX', { messages: true, uidNext: true });
            console.log(`📧 Mailbox status: ${status.messages} messages, uidNext: ${status.uidNext}`);

            if (status.messages === 0) {
                console.log('📧 No messages in mailbox');
                return;
            }

            // Calculate range: Get last 20 messages or all if less than 20 (balanced for reliability + egress)
            const messagesToFetch = Math.min(status.messages, 20);
            const startSeq = Math.max(1, status.messages - messagesToFetch + 1);
            const range = `${startSeq}:${status.messages}`;

            console.log(`📧 Fetching messages ${range} (${messagesToFetch} messages)`);

            // Fetch the most recent messages using sequence numbers - use async iterator
            console.log(`📧 Executing IMAP fetch for range: ${range}`);

            const messages = [];
            for await (const message of this.client.fetch(range, {
                uid: true,
                envelope: true,
                internalDate: true,
                bodyStructure: true,
                bodyParts: ['1', 'TEXT'] // Fetch only text parts, not full source with attachments
            })) {
                messages.push(message);
            }

            console.log(`📧 Fetched ${messages.length} messages from range ${range}`);

            let processedCount = 0;
            let skippedCount = 0;

            for (const message of messages) {
                const fromAddr = message.envelope?.from?.[0]?.address || 'Unknown';
                const subject = message.envelope?.subject || 'No subject';
                const toAddr = message.envelope?.to?.[0]?.address || 'Unknown';

                console.log(`📧 Processing: UID ${message.uid}, From: ${fromAddr}, To: ${toAddr}, Subject: "${subject}"`);

                try {
                    // Check if a lead exists first (to avoid unnecessary processing)
                    const lead = await this.findLead(fromAddr);

                    if (!lead) {
                        console.log(`📧 ⚠️ No lead found for ${fromAddr}, skipping message UID ${message.uid}`);
                        skippedCount++;
                        continue;
                    }

                    console.log(`📧 📋 Found lead: ${lead.name} (${lead.email}) for message UID ${message.uid}`);

                    // CRITICAL FIX: The processMessage function now handles the UID check
                    await this.processMessage(message, lead);
                    processedCount++;
                    console.log(`📧 ✅ Successfully processed message UID ${message.uid}`);
                } catch (processError) {
                    if (processError.message.includes('DUPLICATE_IMAP_UID')) {
                        skippedCount++; // Duplicates are skipped, not errors
                        console.log(`📧 ⚠️ Skipping duplicate message UID ${message.uid}`);
                    } else if (processError.message.includes('NO_MATCHING_LEAD')) {
                        skippedCount++;
                        console.log(`📧 ⚠️ Skipping message UID ${message.uid} (no lead for ${fromAddr})`);
                    } else {
                        console.error(`📧 ❌ Failed to process message UID ${message.uid}:`, processError.message);
                    }
                }
            }

            console.log(`📧 Scan complete: ${messages.length} messages found, ${processedCount} processed, ${skippedCount} skipped (no lead or duplicate)`);
        } catch (error) {
            console.error('📧 Error scanning messages:', error.message);
        }
    }

    async findLead(email) {
        if (!email) return null;
        
        // ✅ STABILITY FIX: Use only exact, case-insensitive matching
        const { data: leadData, error: leadError } = await this.supabase
            .from('leads')
            .select('*')
            .ilike('email', email.trim())
            .single();

        if (leadError && leadError.code === 'PGRST116') {
            // PGRST116 means 'No rows found'
            return null;
        }
        
        if (leadError) {
            console.error(`❌ Database error finding lead for ${email}:`, leadError.message);
            throw new Error(`DB_ERROR_LEAD_SEARCH: ${leadError.message}`);
        }

        return leadData;
    }

    async extractEmailBody(raw) {
        // ... (body extraction logic remains mostly the same)
        try {
            const parsed = await simpleParser(raw);
            let body = parsed.text || '';

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
                .replace(/^>+.*/gm, '')
                .replace(/On.*wrote:[\s\S]*$/gm, '')
                .replace(/From:.*\nSent:.*\nTo:.*\nSubject:.*/g, '')
                .replace(/\[.*?\]/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            return body || 'No content available';
        } catch (error) {
            console.error('📧 Error extracting email body:', error);
            return 'Error extracting email content';
        }
    }

    async processMessage(message, lead) {
        const startTime = Date.now();
        const { envelope, uid, internalDate, bodyParts } = message;
        const fromAddr = envelope?.from?.[0]?.address;
        const subject = envelope?.subject || '';
        let timeout;
        let isProcessing = true;
        let actualMessageId;

        try {
            timeout = setTimeout(() => {
                isProcessing = false;
                throw new Error(`PROCESSING_TIMEOUT: Message UID ${uid} timed out after 30s.`);
            }, 30000);

            if (!fromAddr) {
                console.warn(`⚠️ Skipping email with missing from address (UID: ${uid})`);
                return;
            }

            // Get text content from bodyParts (optimized to avoid downloading attachments)
            let bodyContent = null;
            if (bodyParts && bodyParts.size > 0) {
                console.log(`📧 Available body parts for UID ${uid}:`, Array.from(bodyParts.keys()));

                // Try different common body part keys
                bodyContent = bodyParts.get('TEXT') ||
                              bodyParts.get('text') ||
                              bodyParts.get('1') ||
                              bodyParts.get('1.1') ||
                              bodyParts.get('BODY[TEXT]') ||
                              Array.from(bodyParts.values())[0]; // First available part as fallback
            }

            if (!bodyContent || !Buffer.isBuffer(bodyContent)) {
                console.warn(`⚠️ No valid text content found for email UID ${uid}, trying subject only`);
                bodyContent = Buffer.from(subject || 'No content available');
            }

            // CRITICAL FIX: Check for duplicate using IMAP_UID
            const { data: existingMessages, error: checkError } = await this.supabase
                .from('messages')
                .select('id')
                .eq('imap_uid', uid.toString()) // Match on UID
                .eq('lead_id', lead.id)
                .limit(1);

            if (checkError) throw new Error(`DB_ERROR_DUPE_CHECK: ${checkError.message}`);
            
            if (existingMessages && existingMessages.length > 0) {
                throw new Error('DUPLICATE_IMAP_UID');
            }
            
            // Determine actual received date
            const emailReceivedDate = (internalDate && internalDate instanceof Date && !isNaN(internalDate.getTime()))
                ? internalDate.toISOString()
                : (envelope?.date && envelope.date instanceof Date && !isNaN(envelope.date.getTime()))
                ? envelope.date.toISOString()
                : new Date().toISOString();

            const processingDate = new Date().toISOString();

            // Extract email body from bodyContent (now using text-only parts instead of full source)
            let body = await this.extractEmailBody(bodyContent.toString('utf8'));

            if (!isProcessing) return; // Check after slow operations

            // Insert to messages table
            actualMessageId = randomUUID();
            const { data: insertedMessage, error: insertError } = await this.supabase
                .from('messages')
                .insert({
                    id: actualMessageId,
                    lead_id: lead.id,
                    type: 'email',
                    subject: subject,
                    content: body,
                    recipient_email: fromAddr,
                    status: 'received',
                    imap_uid: uid.toString(), // ✅ CRITICAL FIX: Store the UID as string
                    sent_at: emailReceivedDate,
                    created_at: processingDate,
                    updated_at: processingDate,
                    read_status: false
                })
                .select('id')
                .single();

            if (insertError || !insertedMessage) {
                throw new Error(`DB_ERROR_INSERT: ${insertError?.message}`);
            }

            // Update booking history (separated for clarity)
            await this.updateLeadHistory(lead, subject, body, emailReceivedDate, processingDate);

            // Emit events (separated for clarity)
            this.emitEvents(lead, actualMessageId, subject, body, emailReceivedDate);

            if (timeout) clearTimeout(timeout);
            isProcessing = false;
            const processingTime = Date.now() - startTime;
            console.log(`✅ Email processed successfully in ${processingTime}ms: "${subject}" from ${fromAddr}`);

        } catch (error) {
            if (timeout) clearTimeout(timeout);
            isProcessing = false;
            throw error;
        }
    }
    
    async updateLeadHistory(lead, subject, body, emailReceivedDate, processingDate) {
        let history = [];
        try {
            history = JSON.parse(lead.booking_history || '[]');
        } catch (e) {
            console.warn('⚠️ Error parsing existing booking history:', e.message);
        }

        history.unshift({
            action: 'EMAIL_RECEIVED',
            timestamp: emailReceivedDate,
            details: {
                subject,
                body: body.substring(0, 150) + '...', // Store a summary in history
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
            console.error('❌ Error updating lead booking history:', updateError.message);
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
            timestamp: emailReceivedDate,
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
function startEmailPoller(socketIoInstance) {
    // Check for critical environment variables before starting
    if (!EMAIL_USER || !EMAIL_PASS || !SUPABASE_KEY) {
        console.error('CRITICAL: Cannot start poller. Missing EMAIL_USER, EMAIL_PASS, or SUPABASE_KEY environment variables.');
        return;
    }
    
    const poller = new EmailPoller(socketIoInstance);
    poller.connect();

    // Set up the recurring backup scan (slower now to avoid conflict)
    setInterval(async () => {
        if (poller.isConnected && poller.client?.usable) {
            console.log('📧 🔄 Scheduled backup email scan starting...');
            try {
                await poller.scanUnprocessedMessages();
                console.log('📧 ✅ Scheduled backup email scan completed');
            } catch (error) {
                console.error('📧 ❌ Scheduled backup email scan failed:', error.message);
            }
        } else {
            console.log('📧 ⚠️ Skipping scheduled scan - not connected');
        }
    }, BACKUP_SCAN_INTERVAL_MS); // 30 minutes

    console.log('📧 ✅ Email poller started with 30-minute recurring backup scans (optimized for egress)');
}

module.exports = { startEmailPoller };