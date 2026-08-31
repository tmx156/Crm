#!/usr/bin/env node

/**
 * Monitor New Emails
 * Watches for new emails being added to the database in real-time
 */

const config = require('./config');
const { createClient } = require('@supabase/supabase-js');

class EmailMonitor {
    constructor() {
        this.supabase = createClient(config.supabase.url, config.supabase.anonKey);
        this.lastCheckTime = new Date().toISOString();
        this.isRunning = false;
    }

    async startMonitoring() {
        console.log('👁️  EMAIL IMPORT MONITOR STARTED');
        console.log('==============================');
        console.log(`⏰ Monitoring started at: ${new Date().toLocaleString()}`);
        console.log('📧 Watching for new emails being imported to the CRM...');
        console.log('💡 Send an email to avensismodels.co.uk.crm.bookings@gmail.com to test');
        console.log('⏹️  Press Ctrl+C to stop\n');

        this.isRunning = true;

        // Initial count
        await this.showCurrentStats();

        // Monitor every 5 seconds
        const interval = setInterval(async () => {
            if (!this.isRunning) {
                clearInterval(interval);
                return;
            }
            await this.checkForNewEmails();
        }, 5000);

        // Handle shutdown
        process.on('SIGINT', () => {
            console.log('\n👁️  Stopping email monitor...');
            this.isRunning = false;
            clearInterval(interval);
            process.exit(0);
        });
    }

    async showCurrentStats() {
        try {
            const { data: totalEmails, error: totalError } = await this.supabase
                .from('messages')
                .select('count')
                .eq('type', 'email');

            if (totalError) throw totalError;

            const { data: todayEmails, error: todayError } = await this.supabase
                .from('messages')
                .select('count')
                .eq('type', 'email')
                .gte('created_at', new Date().toISOString().split('T')[0]);

            if (todayError) throw todayError;

            console.log(`📊 Current email count: ${totalEmails.length} total, ${todayEmails.length} today`);

        } catch (error) {
            console.error('❌ Error getting stats:', error.message);
        }
    }

    async checkForNewEmails() {
        try {
            // Check for emails created since last check
            const { data: newEmails, error } = await this.supabase
                .from('messages')
                .select('id, lead_id, type, subject, recipient_email, imap_uid, sent_at, created_at, read_status')
                .eq('type', 'email')
                .gte('created_at', this.lastCheckTime)
                .order('created_at', { ascending: true });

            if (error) throw error;

            if (newEmails && newEmails.length > 0) {
                newEmails.forEach((email, i) => {
                    const time = new Date(email.created_at).toLocaleString();
                    console.log(`\n🆕 NEW EMAIL IMPORTED!`);
                    console.log(`   📧 From: ${email.recipient_email}`);
                    console.log(`   📋 Subject: ${email.subject || 'No subject'}`);
                    console.log(`   🆔 IMAP UID: ${email.imap_uid || 'Not set'}`);
                    console.log(`   ⏰ Imported at: ${time}`);
                    console.log(`   👁️  Read status: ${email.read_status}`);
                });

                // Get lead names for the new emails
                const leadIds = [...new Set(newEmails.map(e => e.lead_id))];
                const { data: leads, error: leadsError } = await this.supabase
                    .from('leads')
                    .select('id, name, email')
                    .in('id', leadIds);

                if (!leadsError && leads) {
                    console.log(`\n📋 Associated leads:`);
                    leads.forEach(lead => {
                        console.log(`   - ${lead.name} (${lead.email})`);
                    });
                }

                // Update last check time
                this.lastCheckTime = new Date().toISOString();
                console.log(`\n👁️  Continuing to monitor for more emails...\n`);
            }

        } catch (error) {
            console.error('❌ Error checking for new emails:', error.message);
        }
    }
}

// Run the monitor
if (require.main === module) {
    const monitor = new EmailMonitor();
    monitor.startMonitoring().catch(error => {
        console.error('❌ Monitor failed:', error);
        process.exit(1);
    });
}

module.exports = EmailMonitor;