const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
const { simpleParser } = require('mailparser');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

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

// Persistent tracking for processed messages
const PROCESSED_MESSAGES_FILE = path.join(__dirname, '../data/processed_email_messages.json');

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
        
        // Initialize persistent tracking
        this.processedMessages = new Set();
        this.loadProcessedMessages();
    }

    // Load processed messages from persistent storage
    loadProcessedMessages() {
        try {
            // Ensure data directory exists
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
            } else {
                console.log(`📧 [${this.accountConfig.name}] No existing processed messages file found, starting fresh`);
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
                    // Check if message was already processed (persistent tracking)
                    if (this.isMessageProcessed(message.uid, null)) {
                        console.log(`📧 ⚠️ Message UID ${message.uid} already processed, skipping`);
                        skippedCount++;
                        continue;
                    }

                    // Check if a lead exists first (to avoid unnecessary processing)
                    const lead = await this.findLead(fromAddr);

                    if (!lead) {
                        console.log(`📧 ⚠️ No lead found for ${fromAddr}, skipping message UID ${message.uid}`);
                        skippedCount++;
                        continue;
                    }

                    // Check again with lead ID
                    if (this.isMessageProcessed(message.uid, lead.id)) {
                        console.log(`📧 ⚠️ Message UID ${message.uid} for lead ${lead.id} already processed, skipping`);
                        skippedCount++;
                        continue;
                    }

                    console.log(`📧 📋 Found lead: ${lead.name} (${lead.email}) for message UID ${message.uid}`);

                    // CRITICAL FIX: The processMessage function now handles the UID check
                    await this.processMessage(message, lead);
                    
                    // Mark as processed
                    this.markMessageProcessed(message.uid, lead.id);
                    
                    processedCount++;
                    console.log(`📧 ✅ Successfully processed message UID ${message.uid}`);
                } catch (processError) {
                    if (processError.message.includes('DUPLICATE_IMAP_UID') || 
                        processError.message.includes('DUPLICATE_CONTENT')) {
                        skippedCount++; // Duplicates are skipped, not errors
                        console.log(`📧 ⚠️ Skipping duplicate message UID ${message.uid}: ${processError.message}`);
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

    /**
     * Decode quoted-printable encoding (=E2=80=99 etc)
     */
    decodeQuotedPrintable(str) {
        if (!str) return '';

        try {
            // Replace =\r\n or =\n (soft line breaks)
            str = str.replace(/=\r?\n/g, '');

            // Decode =XX hex codes
            str = str.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
                return String.fromCharCode(parseInt(hex, 16));
            });

            return str;
        } catch (error) {
            console.error('Error decoding quoted-printable:', error);
            return str;
        }
    }

    /**
     * ENHANCED: Extract complete email content with better parsing
     * Handles all email formats and prevents truncation
     */
    async extractEmailBody(raw) {
        try {
            console.log('📧 Starting email content extraction...');
            
            // Step 1: Parse email using simpleParser with better options
            const parsed = await simpleParser(raw, {
                skipHtmlToText: false,
                skipTextToHtml: true,
                skipImageLinks: true,
                maxHtmlLengthToParse: 1000000 // 1MB limit to prevent truncation
            });
            
            let content = '';
            let extractionMethod = '';

            // Try to get text content first (plain text is preferred)
            if (parsed.text && parsed.text.trim()) {
                content = parsed.text;
                extractionMethod = 'plain_text';
                console.log(`📧 Extracted ${content.length} characters from plain text`);
            }
            // If no text, extract from HTML with improved conversion
            else if (parsed.html) {
                content = this.htmlToText(parsed.html);
                extractionMethod = 'html_conversion';
                console.log(`📧 Extracted ${content.length} characters from HTML conversion`);
            }
            // Try alternative parsing methods
            else if (parsed.textAsHtml) {
                content = this.htmlToText(parsed.textAsHtml);
                extractionMethod = 'text_as_html';
                console.log(`📧 Extracted ${content.length} characters from textAsHtml`);
            }
            // Last resort: try to extract from raw
            else if (raw && typeof raw === 'string') {
                content = raw;
                extractionMethod = 'raw_string';
                console.log(`📧 Using raw string content: ${content.length} characters`);
            } else if (Buffer.isBuffer(raw)) {
                content = raw.toString('utf8');
                extractionMethod = 'buffer_conversion';
                console.log(`📧 Converted buffer to string: ${content.length} characters`);
            }

            console.log(`📧 Content extraction method: ${extractionMethod}`);

            // If still no content after all attempts
            if (!content || content.trim().length === 0) {
                console.warn('📧 No content extracted from email after all methods');
                return 'No content available';
            }

            // Step 2: Decode base64 content if present (enhanced detection)
            const base64Pattern = /----[A-Za-z0-9._]+\r?\n([A-Za-z0-9+/=\r\n]+)----[A-Za-z0-9._]+/;
            const base64Match = content.match(base64Pattern);
            if (base64Match && base64Match[1]) {
                try {
                    const decoded = Buffer.from(base64Match[1].replace(/\r?\n/g, ''), 'base64').toString('utf8');
                    content = decoded;
                    console.log(`📧 Decoded base64 content: ${decoded.length} characters`);
                } catch (e) {
                    console.warn('Failed to decode base64 content:', e.message);
                }
            }

            // Additional base64 detection for standalone base64 content
            const standaloneBase64Pattern = /^([A-Za-z0-9+/=\r\n]+)$/;
            if (standaloneBase64Pattern.test(content.trim()) && content.length > 50) {
                try {
                    const cleanedBase64 = content.replace(/\r?\n/g, '').replace(/\s/g, '');
                    if (cleanedBase64.length > 0 && cleanedBase64.length % 4 === 0) {
                        const decoded = Buffer.from(cleanedBase64, 'base64').toString('utf8');
                        if (decoded.length > 10 && decoded.includes(' ')) { // Valid text should have spaces
                            content = decoded;
                            console.log(`📧 Decoded standalone base64 content: ${decoded.length} characters`);
                        }
                    }
                } catch (e) {
                    console.warn('Failed to decode standalone base64 content:', e.message);
                }
            }

            // Step 3: Decode HTML entities comprehensively
            content = this.decodeHtmlEntities(content);

            // Step 4: Decode quoted-printable encoding (=E2=80=99 etc)
            content = this.decodeQuotedPrintable(content);

            // Step 5: Remove any remaining HTML tags (in case some slipped through)
            content = content.replace(/<[^>]+>/g, ' ');

            // Step 6: Extract customer's response with improved logic
            let lines = content.split(/\r?\n/);
            let customerLines = [];
            let foundCustomerContent = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                // Stop at quoted reply markers but be less aggressive to preserve content
                if (
                    line.match(/^On .+wrote:?/i) ||    // "On [date] [person] wrote:"
                    line.match(/^From:.*Sent:.*To:/i) ||
                    line.match(/^----+ ?Original [Mm]essage ?----+/) ||
                    line.match(/^_{5,}/) ||
                    line.match(/^>+\s{2,}/) ||         // Quoted lines with multiple spaces
                    line.match(/^charset=/i) ||        // MIME artifacts
                    line.match(/^Content-Type:/i) ||
                    line.match(/^Content-Transfer-Encoding:/i)
                ) {
                    // Only break if we've found some customer content first
                    if (foundCustomerContent) {
                        break;
                    }
                    continue;
                }

                // Stop at signature markers but only after customer content
                if (foundCustomerContent && (
                    line.match(/^Sent from/i) ||
                    line.match(/^Get Outlook/i) ||
                    line.match(/^Sent from (my|the)/i) ||
                    line.match(/^(Regards|Kind regards|Best regards|Thanks|Thank you|Cheers|Sincerely)[\s,]*$/i)
                )) {
                    break; // Signature found, stop here
                }

                // Add non-empty lines and mark that we found customer content
                if (line.length > 0) {
                    customerLines.push(lines[i]);
                    foundCustomerContent = true;
                }
            }

            let response = customerLines.join('\n');
            
            // If we didn't find customer content, try a different approach
            if (!foundCustomerContent || response.trim().length < 10) {
                console.log('📧 No customer content found, trying alternative extraction...');
                
                // Try to extract content before any obvious reply markers
                const beforeReplyMatch = content.match(/^([\s\S]*?)(?:\n\s*>|\n\s*On\s+\w+|\n\s*From:)/i);
                if (beforeReplyMatch && beforeReplyMatch[1].trim().length > 10) {
                    response = beforeReplyMatch[1].trim();
                    console.log(`📧 Extracted ${response.length} characters using alternative method`);
                }
            }

            // Step 7: Enhanced MIME artifact cleanup
            response = response.replace(/^Content-Type:.*$/gm, '');
            response = response.replace(/^Content-Transfer-Encoding:.*$/gm, '');
            response = response.replace(/^Content-Disposition:.*$/gm, '');
            response = response.replace(/^--[A-Za-z0-9._-]+$/gm, '');
            response = response.replace(/^--[A-Za-z0-9._-]+--$/gm, '');
            response = response.replace(/^boundary=.*$/gm, '');
            
            // Clean up additional MIME artifacts
            response = response.replace(/^charset=.*$/gm, '');
            response = response.replace(/^MIME-Version:.*$/gm, '');
            response = response.replace(/^X-.*$/gm, '');
            response = response.replace(/^Message-ID:.*$/gm, '');
            response = response.replace(/^Date:.*$/gm, '');
            response = response.replace(/^From:.*$/gm, '');
            response = response.replace(/^To:.*$/gm, '');
            response = response.replace(/^Subject:.*$/gm, '');
            
            // Clean up encoding artifacts
            response = response.replace(/^\s*=\r?\n/gm, ''); // Soft line breaks
            response = response.replace(/^=\r?\n/gm, ''); // Hard line breaks

            // Step 8: Final whitespace cleanup
            response = response.replace(/\n{3,}/g, '\n\n');
            response = response.replace(/[ \t]+/g, ' ');
            response = response.replace(/^\s+|\s+$/gm, '');
            response = response.trim();

            // Final check
            if (!response || response.length < 3) {
                console.warn('📧 Extracted content too short or empty');
                return 'No content available';
            }

            return response;

        } catch (error) {
            console.error('📧 Error extracting email body:', error);
            return 'Error extracting email content';
        }
    }

    /**
     * Convert HTML to plain text with better formatting
     */
    htmlToText(html) {
        if (!html) return '';

        let text = html;

        // Remove style and script tags with their content
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

        // Convert common block elements to newlines
        text = text.replace(/<\/?(div|p|br|h[1-6]|li|tr)[^>]*>/gi, '\n');
        text = text.replace(/<\/td>/gi, '\t');
        text = text.replace(/<hr[^>]*>/gi, '\n---\n');

        // Convert links to readable format
        text = text.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '$2 ($1)');

        // Remove all other HTML tags
        text = text.replace(/<[^>]+>/g, '');

        // Clean up whitespace
        text = text.replace(/\n\s*\n\s*\n/g, '\n\n'); // Max 2 consecutive newlines
        text = text.replace(/[ \t]+/g, ' '); // Multiple spaces to single
        text = text.replace(/^\s+|\s+$/gm, ''); // Trim lines

        return text.trim();
    }

    /**
     * Decode HTML entities comprehensively
     */
    decodeHtmlEntities(str) {
        if (!str) return '';

        const entities = {
            '&nbsp;': ' ',
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&quot;': '"',
            '&#34;': '"',
            '&#39;': "'",
            '&apos;': "'",
            '&#x27;': "'",
            '&ldquo;': '"',
            '&rdquo;': '"',
            '&lsquo;': "'",
            '&rsquo;': "'",
            '&mdash;': '-',
            '&ndash;': '-',
            '&hellip;': '...',
            // Fix common UTF-8 encoding issues
            'â€™': "'",
            'â€œ': '"',
            'â€': '"',
            'â€"': '-',
            'â€"': '-',
            'â€¦': '...',
            'â': ''
        };

        let result = str;
        for (const [entity, char] of Object.entries(entities)) {
            result = result.replace(new RegExp(entity, 'g'), char);
        }

        // Decode numeric entities
        result = result.replace(/&#(\d+);/g, (match, dec) => {
            return String.fromCharCode(dec);
        });
        result = result.replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });

        return result;
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
                              bodyParts.get('1.2') ||
                              bodyParts.get('2') ||
                              bodyParts.get('BODY[TEXT]') ||
                              Array.from(bodyParts.values())[0]; // First available part as fallback

                // Log which body part was used for debugging
                if (bodyContent) {
                    const usedKey = Array.from(bodyParts.entries()).find(([k, v]) => v === bodyContent)?.[0];
                    console.log(`📧 Using body part key: ${usedKey} for UID ${uid}`);
                }
            }

            if (!bodyContent || !Buffer.isBuffer(bodyContent)) {
                console.warn(`⚠️ No valid text content found for email UID ${uid}, trying subject only`);
                bodyContent = Buffer.from(subject || 'No content available');
            } else {
                console.log(`📧 Body content size for UID ${uid}: ${bodyContent.length} bytes`);
            }

            
            // BULLETPROOF DEDUPLICATION - Will be applied after body extraction
            
            // ENHANCED DEDUPLICATION: Multiple checks to prevent duplicates
            console.log(`📧 Checking for duplicates for UID ${uid}, Lead ${lead.id}...`);
            
            // BULLETPROOF DEDUPLICATION - Will be applied after body extraction
        
            // Check 2: Content + timestamp within 5 minutes (backup check)
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const { data: existingByContent, error: contentCheckError } = await this.supabase
                .from('messages')
                .select('id, content, created_at')
                .eq('lead_id', lead.id)
                .eq('recipient_email', fromAddr)
                .gte('created_at', fiveMinutesAgo)
                .limit(5);

            if (contentCheckError) {
                console.warn(`📧 ⚠️ Content check error: ${contentCheckError.message}`);
            } else if (existingByContent && existingByContent.length > 0) {
                // Check if any existing message has similar content
                const bodyPreview = body.substring(0, 100);
                for (const existing of existingByContent) {
                    const existingPreview = existing.content?.substring(0, 100) || '';
                    if (existingPreview === bodyPreview && existingPreview.length > 10) {
                        console.log(`📧 ⚠️ Duplicate found by content similarity: ${existing.id}`);
                        throw new Error('DUPLICATE_CONTENT');
                    }
                }
            }

            console.log(`📧 ✅ No duplicates found for UID ${uid}`);
            
            // Determine actual received date
            const emailReceivedDate = (internalDate && internalDate instanceof Date && !isNaN(internalDate.getTime()))
                ? internalDate.toISOString()
                : (envelope?.date && envelope.date instanceof Date && !isNaN(envelope.date.getTime()))
                ? envelope.date.toISOString()
                : new Date().toISOString();

            const processingDate = new Date().toISOString();

            // Extract email body from bodyContent (now using text-only parts instead of full source)
            const rawBodyString = bodyContent.toString('utf8');
            console.log(`📧 Raw body preview for UID ${uid}:`, rawBodyString.substring(0, 200) + '...');

            let body = await this.extractEmailBody(rawBodyString);
            
            // BULLETPROOF DEDUPLICATION - PREVENTS ALL DUPLICATES
            console.log(`🛡️ BULLETPROOF duplicate check for UID ${uid}, Lead ${lead.id}...`);
            
            // Check 1: IMAP UID (most reliable)
            const { data: existingByUid, error: uidCheckError } = await this.supabase
                .from('messages')
                .select('id, content, created_at')
                .eq('imap_uid', uid.toString())
                .eq('lead_id', lead.id)
                .limit(1);

            if (uidCheckError) throw new Error(`DB_ERROR_UID_CHECK: ${uidCheckError.message}`);
            
            if (existingByUid && existingByUid.length > 0) {
                console.log(`🛡️ BULLETPROOF: Duplicate found by UID: ${existingByUid[0].id}`);
                throw new Error('DUPLICATE_IMAP_UID');
            }

            // Check 2: Content similarity against ALL messages from this lead (BULLETPROOF)
            const { data: allLeadMessages, error: allLeadError } = await this.supabase
                .from('messages')
                .select('id, content, created_at')
                .eq('lead_id', lead.id)
                .eq('recipient_email', fromAddr)
                .eq('type', 'email')
                .limit(50);

            if (allLeadError) {
                console.warn(`🛡️ BULLETPROOF: All lead messages check error: ${allLeadError.message}`);
            } else if (allLeadMessages && allLeadMessages.length > 0) {
                const bodyPreview = body.substring(0, 200);
                for (const existing of allLeadMessages) {
                    const existingPreview = existing.content?.substring(0, 200) || '';
                    if (existingPreview === bodyPreview && existingPreview.length > 20) {
                        console.log(`🛡️ BULLETPROOF: Duplicate found by content similarity: ${existing.id}`);
                        throw new Error('DUPLICATE_CONTENT');
                    }
                }
            }

            // Check 3: Content hash comparison (ULTIMATE PROTECTION)
            const crypto = require('crypto');
            const contentHash = crypto.createHash('md5').update(body).digest('hex');
            const { data: existingByHash, error: hashCheckError } = await this.supabase
                .from('messages')
                .select('id, content')
                .eq('lead_id', lead.id)
                .eq('recipient_email', fromAddr)
                .eq('type', 'email')
                .limit(20);

            if (!hashCheckError && existingByHash && existingByHash.length > 0) {
                for (const existing of existingByHash) {
                    const existingHash = crypto.createHash('md5').update(existing.content || '').digest('hex');
                    if (existingHash === contentHash) {
                        console.log(`🛡️ BULLETPROOF: Duplicate found by content hash: ${existing.id}`);
                        throw new Error('DUPLICATE_CONTENT_HASH');
                    }
                }
            }
            console.log(`📧 Extracted body for UID ${uid} (${body.length} chars):`, body.substring(0, 150) + '...');

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