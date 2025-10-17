const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
const { simpleParser } = require('mailparser');
const { randomUUID } = require('crypto');

// --- Configuration ---
// Using existing Supabase credentials from config
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';

// Email account configurations
const EMAIL_ACCOUNTS = {
  primary: {
    user: process.env.EMAIL_USER || process.env.GMAIL_USER,
    pass: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS,
    name: 'Primary Account'
  },
  secondary: {
    user: process.env.EMAIL_USER_2 || process.env.GMAIL_USER_2,
    pass: process.env.EMAIL_PASSWORD_2 || process.env.GMAIL_PASS_2,
    name: 'Secondary Account'
  }
};

// Backwards compatibility
const EMAIL_USER = EMAIL_ACCOUNTS.primary.user;
const EMAIL_PASS = EMAIL_ACCOUNTS.primary.pass;

// Constants
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 60000; // 1 minute
const BACKUP_SCAN_INTERVAL_MS = 1800000; // 30 minutes (Primary is IDLE, optimized for egress)

// --- EmailPoller Class ---
class EmailPoller {
    constructor(ioInstance, accountKey = 'primary') {
        // Create a unique instance key for each account
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
        this.io = ioInstance; // Socket.IO instance

        // Validate account configuration
        if (!this.accountConfig || !this.accountConfig.user || !this.accountConfig.pass) {
            console.log(`📧 Email poller for ${accountKey} disabled: Account not configured`);
            this.disabled = true;
            return;
        }

        this.disabled = false;
        console.log(`📧 Email poller initialized for ${this.accountConfig.name} (${this.accountConfig.user})`);

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

            // Clean up any existing connection properly
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
            console.log(`✅ [${this.accountConfig.name}] Connected to IMAP successfully`);

            await this.client.mailboxOpen('INBOX');
            console.log(`✅ [${this.accountConfig.name}] INBOX opened successfully`);

            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.isReconnecting = false;

            // Start heartbeat monitoring and initial scan
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
                    // Simple heartbeat
                    await this.client.status('INBOX', { messages: true });
                    console.log(`💓 [${this.accountConfig.name}] Email poller heartbeat OK`);
                    this.startHeartbeat(); // Schedule next heartbeat
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

        if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = null;

        this.scheduleReconnect(RECONNECT_BASE_DELAY_MS);
    }

    handleError(error) {
        console.error(`❌ [${this.accountConfig.name}] IMAP Error:`, error.message);
        this.isConnected = false;
        this.isReconnecting = false;
        this.reconnectAttempts++;

        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(`❌ [${this.accountConfig.name}] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Email polling disabled.`);
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
        try {
            // First, try to clean up Apple Mail MIME boundaries and headers manually
            let cleanedRaw = raw;
            
            // Remove Apple Mail MIME boundaries and headers (but preserve actual content)
            cleanedRaw = cleanedRaw
                .replace(/^--Apple-Mail-[A-F0-9-]+$/gm, '') // Remove boundary lines
                .replace(/^Content-Type:\s*text\/plain[^;]*;?\s*charset=utf-8$/gm, '') // Remove content-type lines
                .replace(/^Content-Transfer-Encoding:\s*quoted-printable$/gm, '') // Remove encoding lines
                .replace(/^Content-Type:\s*text\/html[^;]*;?\s*charset=utf-8$/gm, '') // Remove HTML content-type lines
                .replace(/^Content-Transfer-Encoding:\s*7bit$/gm, '') // Remove 7bit encoding lines
                .replace(/^Content-Transfer-Encoding:\s*base64$/gm, '') // Remove base64 encoding lines
                .replace(/^Content-Disposition:\s*attachment[^;]*;?[^;]*$/gm, '') // Remove attachment lines
                .replace(/^Content-ID:\s*<[^>]+>$/gm, '') // Remove content-id lines
                .replace(/^X-Attachment-Id:\s*[^\r\n]+$/gm, '') // Remove x-attachment-id lines
                .replace(/^\s*$/gm, '') // Remove empty lines
                .trim();

            // If the cleaned content is too short, try parsing the original
            if (cleanedRaw.length < 10) {
                cleanedRaw = raw;
            }

            const parsed = await simpleParser(cleanedRaw);
            let body = parsed.text || '';

            // If no text content, try HTML
            if (!body && parsed.html) {
                body = parsed.html
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<[^>]+>/g, '')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/\s+/g, ' ')
                    .trim();
            }
            
            // If still no body and we have clean text, use it directly
            if (!body && cleanedRaw.trim()) {
                body = cleanedRaw.trim();
            }

            // Additional cleanup for Apple Mail artifacts and MIME boundaries
            body = body
                .replace(/^--Apple-Mail-[A-F0-9-]+$/gm, '') // Remove boundary lines
                .replace(/^Content-Type:\s*text\/plain[^;]*;?\s*charset=utf-8$/gm, '') // Remove content-type lines
                .replace(/^Content-Transfer-Encoding:\s*quoted-printable$/gm, '') // Remove encoding lines
                .replace(/^Content-Type:\s*text\/html[^;]*;?\s*charset=utf-8$/gm, '') // Remove HTML content-type lines
                .replace(/^Content-Transfer-Encoding:\s*7bit$/gm, '') // Remove 7bit encoding lines
                .replace(/^Content-Transfer-Encoding:\s*base64$/gm, '') // Remove base64 encoding lines
                .replace(/^Content-Disposition:\s*attachment[^;]*;?[^;]*$/gm, '') // Remove attachment lines
                .replace(/^Content-ID:\s*<[^>]+>$/gm, '') // Remove content-id lines
                .replace(/^X-Attachment-Id:\s*[^\r\n]+$/gm, '') // Remove x-attachment-id lines
                .replace(/^>+.*/gm, '') // Remove quoted replies
                .replace(/On.*wrote:[\s\S]*$/gm, '') // Remove "On X wrote:" signatures
                .replace(/From:.*\nSent:.*\nTo:.*\nSubject:.*/g, '') // Remove email headers
                .replace(/\[.*?\]/g, '') // Remove brackets content
                .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
                .replace(/^\s+|\s+$/g, '') // Trim whitespace
                .trim();

            return body || 'No content available';
        } catch (error) {
            console.error('📧 Error extracting email body:', error);
            // Fallback: try to extract text manually from raw content
            try {
                const lines = raw.split('\n');
                let contentLines = [];
                let inContent = false;
                
                for (const line of lines) {
                    // Skip MIME headers and boundaries
                    if (line.includes('Content-Type:') || 
                        line.includes('Content-Transfer-Encoding:') ||
                        line.includes('--Apple-Mail-') ||
                        line.includes('Content-Disposition:') ||
                        line.includes('Content-ID:')) {
                        continue;
                    }
                    
                    // Start collecting content after headers
                    if (line.trim() === '' && !inContent) {
                        inContent = true;
                        continue;
                    }
                    
                    if (inContent && line.trim()) {
                        contentLines.push(line);
                    }
                }
                
                const fallbackContent = contentLines.join('\n').trim();
                return fallbackContent || 'No content available';
            } catch (fallbackError) {
                console.error('📧 Fallback extraction also failed:', fallbackError);
                return 'Error extracting email content';
            }
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

        console.log(`📧 Starting email poller for ${account.name} (${account.user})...`);

        const poller = new EmailPoller(socketIoInstance, accountKey);
        poller.connect();

        // Set up the recurring backup scan for this account
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
        }, BACKUP_SCAN_INTERVAL_MS); // 30 minutes

        pollers.push(poller);
        console.log(`📧 ✅ [${account.name}] Email poller started with 30-minute recurring backup scans`);
    }

    if (pollers.length === 0) {
        console.error('❌ No email pollers started - no accounts configured');
    }

    return pollers;
}

module.exports = { startEmailPoller, EmailPoller, EMAIL_ACCOUNTS };