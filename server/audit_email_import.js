#!/usr/bin/env node

/**
 * Comprehensive Email Import Audit
 * Tests and fixes everything needed for new emails to be imported
 */

const config = require('./config');
const { ImapFlow } = require('imapflow');
const { createClient } = require('@supabase/supabase-js');
const { simpleParser } = require('mailparser');
const { randomUUID } = require('crypto');

class EmailImportAuditor {
    constructor() {
        this.supabase = createClient(config.supabase.url, config.supabase.anonKey);
        this.client = null;
        this.results = {
            environment: { pass: false, issues: [] },
            database: { pass: false, issues: [] },
            imapConnection: { pass: false, issues: [] },
            messageProcessing: { pass: false, issues: [] },
            liveImport: { pass: false, issues: [] }
        };
    }

    async runFullAudit() {
        console.log('🔍 COMPREHENSIVE EMAIL IMPORT AUDIT');
        console.log('==================================');
        console.log('This will test every aspect of email importing to ensure it works.\n');

        try {
            await this.auditEnvironment();
            await this.auditDatabaseSchema();
            await this.auditIMAPConnection();
            await this.auditMessageProcessing();
            await this.auditLiveImport();

            this.printSummary();
            this.provideFixes();

        } catch (error) {
            console.error('❌ Audit failed:', error.message);
        } finally {
            if (this.client && this.client.usable) {
                await this.client.close();
            }
        }
    }

    async auditEnvironment() {
        console.log('🔧 1. ENVIRONMENT & CONFIGURATION AUDIT');
        console.log('=' .repeat(50));

        const issues = [];

        // Check email credentials
        const EMAIL_USER = config.email.user || config.email.gmailUser;
        const EMAIL_PASS = config.email.password || config.email.gmailPass;
        const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || config.supabase.anonKey;

        console.log(`📧 Email User: ${EMAIL_USER ? '✅ Set' : '❌ Missing'}`);
        console.log(`🔑 Email Password: ${EMAIL_PASS ? '✅ Set' : '❌ Missing'}`);
        console.log(`🗄️ Supabase Key: ${SUPABASE_KEY ? '✅ Set' : '❌ Missing'}`);

        if (!EMAIL_USER) issues.push('EMAIL_USER not configured');
        if (!EMAIL_PASS) issues.push('EMAIL_PASSWORD not configured');
        if (!SUPABASE_KEY) issues.push('SUPABASE_KEY not configured');

        this.results.environment = {
            pass: issues.length === 0,
            issues: issues
        };

        console.log(`\n📊 Environment Status: ${this.results.environment.pass ? '✅ PASS' : '❌ FAIL'}\n`);
    }

    async auditDatabaseSchema() {
        console.log('🗄️ 2. DATABASE SCHEMA AUDIT');
        console.log('=' .repeat(50));

        const issues = [];

        try {
            // Test basic database connection
            const { data: testQuery, error: testError } = await this.supabase
                .from('messages')
                .select('count')
                .limit(1);

            if (testError) {
                issues.push(`Database connection failed: ${testError.message}`);
                console.log('❌ Database connection failed');
            } else {
                console.log('✅ Database connection successful');
            }

            // Test imap_uid column exists
            const { data: schemaTest, error: schemaError } = await this.supabase
                .from('messages')
                .select('id, imap_uid, lead_id, type, content, recipient_email, status, sent_at, created_at, read_status')
                .limit(1);

            if (schemaError && schemaError.message.includes('imap_uid')) {
                issues.push('imap_uid column missing in messages table');
                console.log('❌ imap_uid column missing - CRITICAL FOR DUPLICATE PREVENTION');
            } else if (schemaError) {
                issues.push(`Schema error: ${schemaError.message}`);
                console.log(`❌ Schema error: ${schemaError.message}`);
            } else {
                console.log('✅ imap_uid column exists');
                console.log('✅ All required message fields present');
            }

            // Test leads table
            const { data: leadsTest, error: leadsError } = await this.supabase
                .from('leads')
                .select('id, name, email')
                .limit(5);

            if (leadsError) {
                issues.push(`Leads table error: ${leadsError.message}`);
                console.log('❌ Leads table access failed');
            } else {
                console.log(`✅ Leads table accessible (${leadsTest.length} leads found for testing)`);
            }

        } catch (error) {
            issues.push(`Database audit failed: ${error.message}`);
        }

        this.results.database = {
            pass: issues.length === 0,
            issues: issues
        };

        console.log(`\n📊 Database Status: ${this.results.database.pass ? '✅ PASS' : '❌ FAIL'}\n`);
    }

    async auditIMAPConnection() {
        console.log('📧 3. IMAP CONNECTION & MESSAGE FETCH AUDIT');
        console.log('=' .repeat(50));

        const issues = [];

        try {
            const EMAIL_USER = config.email.user || config.email.gmailUser;
            const EMAIL_PASS = config.email.password || config.email.gmailPass;

            if (!EMAIL_USER || !EMAIL_PASS) {
                issues.push('Email credentials not configured');
                console.log('❌ Cannot test IMAP - credentials missing');
            } else {
                // Connect to IMAP
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
                console.log('✅ IMAP connection successful');

                await this.client.mailboxOpen('INBOX');
                console.log('✅ INBOX opened');

                // Get mailbox status
                const status = await this.client.status('INBOX', { messages: true, uidNext: true });
                console.log(`✅ Mailbox status: ${status.messages} messages, uidNext: ${status.uidNext}`);

                // Test fetching recent messages
                if (status.messages > 0) {
                    const messagesToFetch = Math.min(status.messages, 3);
                    const startSeq = Math.max(1, status.messages - messagesToFetch + 1);
                    const range = `${startSeq}:${status.messages}`;

                    console.log(`📨 Testing message fetch for range: ${range}`);

                    const messages = [];
                    for await (const message of this.client.fetch(range, {
                        uid: true,
                        envelope: true,
                        internalDate: true,
                        source: true
                    })) {
                        messages.push(message);
                    }

                    if (messages.length > 0) {
                        console.log(`✅ Successfully fetched ${messages.length} messages`);

                        // Test message parsing
                        const testMessage = messages[0];
                        const from = testMessage.envelope?.from?.[0]?.address;
                        const subject = testMessage.envelope?.subject;

                        console.log(`✅ Message parsing: UID ${testMessage.uid}, From: ${from}, Subject: "${subject}"`);

                        // Store a test message for processing audit
                        this.testMessage = testMessage;
                    } else {
                        issues.push('No messages could be fetched');
                        console.log('❌ No messages fetched');
                    }
                } else {
                    console.log('ℹ️ No messages in inbox for testing');
                }
            }

        } catch (error) {
            issues.push(`IMAP connection failed: ${error.message}`);
            console.log(`❌ IMAP connection failed: ${error.message}`);
        }

        this.results.imapConnection = {
            pass: issues.length === 0,
            issues: issues
        };

        console.log(`\n📊 IMAP Status: ${this.results.imapConnection.pass ? '✅ PASS' : '❌ FAIL'}\n`);
    }

    async auditMessageProcessing() {
        console.log('⚙️ 4. MESSAGE PROCESSING AUDIT');
        console.log('=' .repeat(50));

        const issues = [];

        if (!this.testMessage) {
            issues.push('No test message available');
            console.log('❌ No test message for processing audit');
        } else {
            try {
                const message = this.testMessage;
                const fromAddr = message.envelope?.from?.[0]?.address;

                console.log(`📧 Testing processing for message from: ${fromAddr}`);

                // Test lead finding
                const { data: leadData, error: leadError } = await this.supabase
                    .from('leads')
                    .select('*')
                    .ilike('email', fromAddr?.trim() || '')
                    .single();

                if (leadError && leadError.code === 'PGRST116') {
                    console.log(`⚠️ No lead found for ${fromAddr} - message would be skipped`);
                    console.log('💡 This is normal if the email sender is not a lead in your CRM');
                } else if (leadError) {
                    issues.push(`Lead lookup error: ${leadError.message}`);
                    console.log(`❌ Lead lookup failed: ${leadError.message}`);
                } else {
                    console.log(`✅ Lead found: ${leadData.name} (${leadData.email})`);

                    // Test duplicate checking
                    const { data: duplicates, error: dupError } = await this.supabase
                        .from('messages')
                        .select('id')
                        .eq('imap_uid', message.uid.toString())
                        .eq('lead_id', leadData.id)
                        .limit(1);

                    if (dupError) {
                        if (dupError.message.includes('imap_uid')) {
                            issues.push('imap_uid column missing - duplicate prevention will fail');
                            console.log('❌ Duplicate checking failed - imap_uid column missing');
                        } else {
                            issues.push(`Duplicate checking error: ${dupError.message}`);
                            console.log(`❌ Duplicate checking failed: ${dupError.message}`);
                        }
                    } else {
                        const isDuplicate = duplicates && duplicates.length > 0;
                        console.log(`✅ Duplicate checking works: ${isDuplicate ? 'Duplicate found' : 'Not a duplicate'}`);
                    }

                    // Test email body extraction
                    if (message.source) {
                        try {
                            const parsed = await simpleParser(message.source.toString('utf8'));
                            const body = parsed.text || parsed.html || 'No content';
                            console.log(`✅ Email body extraction: ${body.length} characters extracted`);
                        } catch (parseError) {
                            issues.push(`Email parsing failed: ${parseError.message}`);
                            console.log(`❌ Email parsing failed: ${parseError.message}`);
                        }
                    }
                }

            } catch (error) {
                issues.push(`Message processing test failed: ${error.message}`);
                console.log(`❌ Message processing test failed: ${error.message}`);
            }
        }

        this.results.messageProcessing = {
            pass: issues.length === 0,
            issues: issues
        };

        console.log(`\n📊 Message Processing Status: ${this.results.messageProcessing.pass ? '✅ PASS' : '❌ FAIL'}\n`);
    }

    async auditLiveImport() {
        console.log('🔄 5. LIVE IMPORT SIMULATION');
        console.log('=' .repeat(50));

        const issues = [];

        try {
            // Simulate the email poller's scanUnprocessedMessages function
            if (!this.client || !this.client.usable) {
                issues.push('IMAP connection not available for live import test');
                console.log('❌ Cannot simulate live import - no IMAP connection');
            } else {
                console.log('📊 Simulating email poller scanUnprocessedMessages...');

                const status = await this.client.status('INBOX', { messages: true, uidNext: true });

                if (status.messages === 0) {
                    console.log('ℹ️ No messages to process in inbox');
                } else {
                    // Get last 5 messages for testing
                    const messagesToFetch = Math.min(status.messages, 5);
                    const startSeq = Math.max(1, status.messages - messagesToFetch + 1);
                    const range = `${startSeq}:${status.messages}`;

                    console.log(`📨 Processing range: ${range}`);

                    const messages = [];
                    for await (const message of this.client.fetch(range, {
                        uid: true,
                        envelope: true,
                        internalDate: true,
                        source: true
                    })) {
                        messages.push(message);
                    }

                    let wouldProcess = 0;
                    let wouldSkip = 0;
                    const unprocessableEmails = new Set();

                    for (const message of messages) {
                        const fromAddr = message.envelope?.from?.[0]?.address || 'Unknown';

                        // Check if lead exists
                        const { data: leadData, error: leadError } = await this.supabase
                            .from('leads')
                            .select('id, name, email')
                            .ilike('email', fromAddr.trim())
                            .single();

                        if (leadError && leadError.code === 'PGRST116') {
                            wouldSkip++;
                            unprocessableEmails.add(fromAddr);
                        } else if (leadError) {
                            issues.push(`Lead lookup failed for ${fromAddr}: ${leadError.message}`);
                        } else {
                            // Check for duplicates
                            const { data: duplicates, error: dupError } = await this.supabase
                                .from('messages')
                                .select('id')
                                .eq('imap_uid', message.uid.toString())
                                .eq('lead_id', leadData.id)
                                .limit(1);

                            if (dupError && dupError.message.includes('imap_uid')) {
                                issues.push('imap_uid column missing');
                            } else if (dupError) {
                                issues.push(`Duplicate check failed: ${dupError.message}`);
                            } else {
                                const isDuplicate = duplicates && duplicates.length > 0;
                                if (isDuplicate) {
                                    console.log(`   UID ${message.uid}: Would skip (duplicate) from ${leadData.name}`);
                                } else {
                                    console.log(`   UID ${message.uid}: Would process from ${leadData.name}`);
                                    wouldProcess++;
                                }
                            }
                        }
                    }

                    console.log(`\n📊 Live Import Simulation Results:`);
                    console.log(`   ✅ Messages that would be processed: ${wouldProcess}`);
                    console.log(`   ⚠️ Messages that would be skipped: ${wouldSkip}`);

                    if (unprocessableEmails.size > 0) {
                        console.log(`\n📝 Email addresses without leads (create these to process their emails):`);
                        Array.from(unprocessableEmails).forEach(email => {
                            console.log(`   - ${email}`);
                        });
                    }

                    if (wouldProcess === 0) {
                        if (wouldSkip > 0) {
                            console.log('\n⚠️ No emails would be processed - all senders need leads in CRM');
                        } else {
                            console.log('\nℹ️ All emails already processed or no new emails');
                        }
                    } else {
                        console.log(`\n✅ Live import would process ${wouldProcess} new emails`);
                    }
                }
            }

        } catch (error) {
            issues.push(`Live import simulation failed: ${error.message}`);
            console.log(`❌ Live import simulation failed: ${error.message}`);
        }

        this.results.liveImport = {
            pass: issues.length === 0,
            issues: issues
        };

        console.log(`\n📊 Live Import Status: ${this.results.liveImport.pass ? '✅ PASS' : '❌ FAIL'}\n`);
    }

    printSummary() {
        console.log('🎯 AUDIT SUMMARY');
        console.log('=' .repeat(50));

        const categories = [
            { name: 'Environment & Config', key: 'environment' },
            { name: 'Database Schema', key: 'database' },
            { name: 'IMAP Connection', key: 'imapConnection' },
            { name: 'Message Processing', key: 'messageProcessing' },
            { name: 'Live Import', key: 'liveImport' }
        ];

        let totalPassed = 0;
        categories.forEach(category => {
            const result = this.results[category.key];
            const status = result.pass ? '✅ PASS' : '❌ FAIL';
            console.log(`${status} ${category.name}`);
            if (result.pass) totalPassed++;
        });

        console.log(`\n📊 Overall Score: ${totalPassed}/${categories.length} categories passed`);

        if (totalPassed === categories.length) {
            console.log('\n🎉 ALL TESTS PASSED! Email import should work perfectly.');
        } else {
            console.log('\n⚠️ Some issues found. See fixes below.');
        }
    }

    provideFixes() {
        console.log('\n🔧 REQUIRED FIXES');
        console.log('=' .repeat(50));

        let hasIssues = false;

        Object.entries(this.results).forEach(([category, result]) => {
            if (result.issues.length > 0) {
                hasIssues = true;
                console.log(`\n❌ ${category.toUpperCase()} ISSUES:`);
                result.issues.forEach((issue, i) => {
                    console.log(`   ${i + 1}. ${issue}`);
                });

                // Provide specific fixes
                if (category === 'database' && result.issues.some(i => i.includes('imap_uid'))) {
                    console.log('\n   💡 FIX: Run this SQL in Supabase:');
                    console.log('   ALTER TABLE messages ADD COLUMN IF NOT EXISTS imap_uid TEXT;');
                    console.log('   CREATE INDEX IF NOT EXISTS idx_messages_imap_uid_lead_id ON messages(imap_uid, lead_id);');
                }
            }
        });

        if (!hasIssues) {
            console.log('✅ No fixes needed - everything is working correctly!');
            console.log('\n🚀 NEXT STEPS:');
            console.log('1. Restart your CRM server');
            console.log('2. Send a test email to verify live processing');
            console.log('3. Monitor logs for successful email imports');
        }
    }
}

// Run the audit
if (require.main === module) {
    const auditor = new EmailImportAuditor();
    auditor.runFullAudit().catch(error => {
        console.error('❌ Audit script failed:', error);
        process.exit(1);
    });
}

module.exports = EmailImportAuditor;