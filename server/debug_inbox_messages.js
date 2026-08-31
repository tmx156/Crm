#!/usr/bin/env node

/**
 * Debug Inbox Messages Script
 * Helps debug why inbox messages aren't being processed
 */

const config = require('./config');
const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');

class InboxDebugger {
    constructor() {
        this.supabase = createClient(config.supabase.url, config.supabase.anonKey);
        this.client = null;
    }

    async debugInbox() {
        console.log('🔍 INBOX DEBUGGING - WHY MESSAGES AREN\'T PROCESSING');
        console.log('====================================================');

        try {
            // Step 1: Connect to IMAP
            console.log('\n📧 Step 1: Connecting to IMAP...');
            await this.connectToIMAP();

            // Step 2: Get inbox status
            console.log('\n📊 Step 2: Getting inbox status...');
            const status = await this.getInboxStatus();

            // Step 3: Fetch recent messages
            console.log('\n📨 Step 3: Analyzing recent inbox messages...');
            const messages = await this.fetchAndAnalyzeMessages(status);

            // Step 4: Check leads in database
            console.log('\n📋 Step 4: Checking leads database...');
            const leads = await this.getLeadsFromDatabase();

            // Step 5: Match messages to leads
            console.log('\n🔍 Step 5: Finding why messages aren\'t matching leads...');
            await this.findMismatchReasons(messages, leads);

            // Step 6: Check database setup
            console.log('\n🗄️ Step 6: Checking database setup...');
            await this.checkDatabaseSetup();

        } catch (error) {
            console.error('❌ Debug failed:', error.message);
        } finally {
            if (this.client && this.client.usable) {
                await this.client.close();
            }
        }
    }

    async connectToIMAP() {
        const EMAIL_USER = config.email.user || config.email.gmailUser;
        const EMAIL_PASS = config.email.password || config.email.gmailPass;

        if (!EMAIL_USER || !EMAIL_PASS) {
            throw new Error('Email credentials not configured in .env file');
        }

        this.client = new ImapFlow({
            host: 'imap.gmail.com',
            port: 993,
            secure: true,
            auth: { user: EMAIL_USER, pass: EMAIL_PASS },
            logger: false,
            socketTimeout: 30000,
            tls: {
                rejectUnauthorized: true,
                servername: 'imap.gmail.com',
                minVersion: 'TLSv1.2'
            }
        });

        await this.client.connect();
        await this.client.mailboxOpen('INBOX');
        console.log(`✅ Connected to IMAP successfully as ${EMAIL_USER}`);
    }

    async getInboxStatus() {
        const status = await this.client.status('INBOX', {
            messages: true,
            uidNext: true,
            recent: true,
            unseen: true
        });

        console.log(`📊 Inbox Status:`);
        console.log(`   📧 Total messages: ${status.messages}`);
        console.log(`   🆔 UID Next: ${status.uidNext}`);
        console.log(`   🆕 Recent: ${status.recent || 0}`);
        console.log(`   👁️ Unseen: ${status.unseen || 0}`);

        return status;
    }

    async fetchAndAnalyzeMessages(status) {
        if (status.messages === 0) {
            console.log('⚠️ No messages in inbox');
            return [];
        }

        // Get last 15 messages for detailed analysis
        const messagesToFetch = Math.min(status.messages, 15);
        const startSeq = Math.max(1, status.messages - messagesToFetch + 1);
        const range = `${startSeq}:${status.messages}`;

        console.log(`📨 Fetching messages ${range} (${messagesToFetch} most recent messages)`);

        console.log(`📨 Executing IMAP fetch for range: ${range}`);

        // Try different fetch approach - collect messages as they come
        const messages = [];

        for await (const message of this.client.fetch(range, {
            uid: true,
            envelope: true,
            internalDate: true,
            flags: true
        })) {
            messages.push(message);
        }

        console.log(`📨 Collected ${messages.length} messages using async iterator`);

        console.log(`\n📨 RECENT INBOX MESSAGES:`);
        console.log('=' .repeat(60));

        messages.forEach((msg, i) => {
            const from = msg.envelope?.from?.[0]?.address || 'Unknown';
            const to = msg.envelope?.to?.[0]?.address || 'Unknown';
            const subject = msg.envelope?.subject || 'No subject';
            const date = msg.internalDate || msg.envelope?.date;
            const flags = Array.isArray(msg.flags) ? msg.flags : (msg.flags ? [msg.flags] : []);
            const isUnread = !flags.includes('\\Seen');

            console.log(`\n${i + 1}. MESSAGE UID ${msg.uid} ${isUnread ? '🆕 UNREAD' : '👁️ READ'}`);
            console.log(`   📧 From: ${from}`);
            console.log(`   📧 To: ${to}`);
            console.log(`   📋 Subject: ${subject}`);
            console.log(`   📅 Date: ${date}`);
            console.log(`   🏷️ Flags: ${flags.join(', ') || 'None'}`);
        });

        return messages;
    }

    async getLeadsFromDatabase() {
        const { data: leads, error } = await this.supabase
            .from('leads')
            .select('id, name, email, phone')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            throw new Error(`Failed to fetch leads: ${error.message}`);
        }

        console.log(`\n📋 DATABASE LEADS (showing first 50):`);
        console.log('=' .repeat(60));

        if (leads.length === 0) {
            console.log('❌ NO LEADS FOUND IN DATABASE!');
            console.log('💡 This is why emails aren\'t being processed');
            console.log('💡 The email poller only processes emails from existing leads');
        } else {
            leads.forEach((lead, i) => {
                console.log(`   ${i + 1}. ${lead.name} - ${lead.email}`);
            });
            console.log(`\n📊 Total leads: ${leads.length}`);
        }

        return leads;
    }

    async findMismatchReasons(messages, leads) {
        console.log(`\n🔍 ANALYZING WHY MESSAGES AREN'T PROCESSED:`);
        console.log('=' .repeat(60));

        if (leads.length === 0) {
            console.log('❌ MAIN ISSUE: No leads in database');
            console.log('💡 Solution: Create leads for the email addresses you want to track');
            return;
        }

        const leadEmails = new Set(leads.map(lead => lead.email.toLowerCase()));
        let matchCount = 0;
        let noMatchCount = 0;
        const unmatchedSenders = new Set();

        messages.forEach((msg, i) => {
            const from = msg.envelope?.from?.[0]?.address?.toLowerCase() || '';
            const hasMatch = leadEmails.has(from);

            console.log(`\n${i + 1}. UID ${msg.uid}: ${from}`);

            if (hasMatch) {
                const matchingLead = leads.find(lead => lead.email.toLowerCase() === from);
                console.log(`   ✅ WOULD BE PROCESSED - Lead: ${matchingLead.name} (ID: ${matchingLead.id})`);
                matchCount++;
            } else {
                console.log(`   ❌ SKIPPED - No lead exists for this email address`);
                unmatchedSenders.add(from);
                noMatchCount++;
            }
        });

        console.log(`\n📊 PROCESSING SUMMARY:`);
        console.log(`   ✅ Messages that would be processed: ${matchCount}`);
        console.log(`   ❌ Messages being skipped: ${noMatchCount}`);

        if (unmatchedSenders.size > 0) {
            console.log(`\n📝 UNMATCHED EMAIL ADDRESSES (create leads for these):`);
            Array.from(unmatchedSenders).forEach(email => {
                console.log(`   - ${email}`);
            });

            console.log(`\n💡 TO FIX: Create leads in your CRM with these email addresses`);
            console.log(`   Then the email poller will process their messages automatically`);
        }

        return { matchCount, noMatchCount };
    }

    async checkDatabaseSetup() {
        console.log(`\n🗄️ DATABASE SETUP CHECK:`);
        console.log('=' .repeat(60));

        try {
            // Check if imap_uid column exists
            const { data, error } = await this.supabase
                .from('messages')
                .select('id, imap_uid, lead_id, type, created_at')
                .eq('type', 'email')
                .order('created_at', { ascending: false })
                .limit(5);

            if (error && error.message.includes('does not exist')) {
                console.log('❌ CRITICAL: imap_uid column missing in messages table');
                console.log('💡 This will cause duplicate processing and the "not iterable" error');
                console.log('\n📝 RUN THIS SQL IN SUPABASE:');
                console.log('   ALTER TABLE messages ADD COLUMN IF NOT EXISTS imap_uid TEXT;');
                console.log('   CREATE INDEX IF NOT EXISTS idx_messages_imap_uid_lead_id ON messages(imap_uid, lead_id);');
                return;
            }

            if (error) {
                console.log(`⚠️ Database error: ${error.message}`);
                return;
            }

            console.log('✅ imap_uid column exists in messages table');

            // Check recent email messages
            if (data && data.length > 0) {
                console.log(`\n📧 Recent email messages in database:`);
                data.forEach((msg, i) => {
                    console.log(`   ${i + 1}. ID: ${msg.id}, IMAP UID: ${msg.imap_uid || 'NULL'}, Lead: ${msg.lead_id}`);
                });

                const withUid = data.filter(msg => msg.imap_uid !== null);
                console.log(`\n📊 Messages with IMAP UID: ${withUid.length}/${data.length}`);

                if (withUid.length === 0) {
                    console.log('ℹ️ No messages have IMAP UID yet (normal for new setup)');
                }
            } else {
                console.log('ℹ️ No email messages in database yet');
            }

        } catch (schemaError) {
            console.log(`❌ Database check failed: ${schemaError.message}`);
        }
    }
}

// Run the debugger
if (require.main === module) {
    const inboxDebugger = new InboxDebugger();
    inboxDebugger.debugInbox().catch(error => {
        console.error('❌ Debug script failed:', error);
        process.exit(1);
    });
}

module.exports = InboxDebugger;