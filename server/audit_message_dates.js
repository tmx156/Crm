#!/usr/bin/env node

/**
 * Audit Message Dates
 * Checks date/time issues in email and SMS notifications
 */

const config = require('./config');
const { createClient } = require('@supabase/supabase-js');

class MessageDateAuditor {
    constructor() {
        this.supabase = createClient(config.supabase.url, config.supabase.anonKey);
    }

    async auditMessageDates() {
        console.log('📅 MESSAGE DATE/TIME AUDIT');
        console.log('==========================');
        console.log('Checking for incorrect dates in email and SMS notifications\n');

        await this.checkEmailDates();
        await this.checkSMSDates();
        await this.checkTimezoneIssues();
    }

    async checkEmailDates() {
        console.log('📧 EMAIL DATE AUDIT');
        console.log('=' .repeat(40));

        try {
            const { data: emails, error } = await this.supabase
                .from('messages')
                .select('id, subject, recipient_email, sent_at, created_at, updated_at, type')
                .eq('type', 'email')
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) throw error;

            console.log(`📊 Checking ${emails.length} recent emails:\n`);

            emails.forEach((email, i) => {
                const sentAt = new Date(email.sent_at);
                const createdAt = new Date(email.created_at);
                const now = new Date();

                console.log(`${i + 1}. ${email.subject || 'No subject'}`);
                console.log(`   📧 From: ${email.recipient_email}`);
                console.log(`   📅 sent_at: ${email.sent_at} (${sentAt.toLocaleString()})`);
                console.log(`   📅 created_at: ${email.created_at} (${createdAt.toLocaleString()})`);

                // Check for future dates
                const isFuture = sentAt > now || createdAt > now;
                if (isFuture) {
                    console.log(`   ⚠️  WARNING: Date is in the future!`);
                }

                // Check for year 2025 (suspicious)
                const year = sentAt.getFullYear();
                if (year > 2024) {
                    console.log(`   ⚠️  WARNING: Year ${year} seems incorrect`);
                }

                // Check time difference between sent and created
                const timeDiff = Math.abs(createdAt - sentAt) / 1000; // seconds
                if (timeDiff > 300) { // More than 5 minutes difference
                    console.log(`   ⚠️  WARNING: Large time gap (${Math.round(timeDiff/60)} minutes) between sent and created`);
                }

                console.log('');
            });

        } catch (error) {
            console.error('❌ Email date audit failed:', error.message);
        }
    }

    async checkSMSDates() {
        console.log('📱 SMS DATE AUDIT');
        console.log('=' .repeat(40));

        try {
            const { data: sms, error } = await this.supabase
                .from('messages')
                .select('id, content, recipient_phone, sent_at, created_at, updated_at, type, status')
                .eq('type', 'sms')
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) throw error;

            console.log(`📊 Checking ${sms.length} recent SMS messages:\n`);

            sms.forEach((message, i) => {
                const sentAt = new Date(message.sent_at);
                const createdAt = new Date(message.created_at);
                const now = new Date();

                console.log(`${i + 1}. SMS to ${message.recipient_phone}`);
                console.log(`   📱 Content: ${message.content?.substring(0, 50)}...`);
                console.log(`   📅 sent_at: ${message.sent_at} (${sentAt.toLocaleString()})`);
                console.log(`   📅 created_at: ${message.created_at} (${createdAt.toLocaleString()})`);
                console.log(`   📊 Status: ${message.status}`);

                // Check for future dates
                const isFuture = sentAt > now || createdAt > now;
                if (isFuture) {
                    console.log(`   ⚠️  WARNING: Date is in the future!`);
                }

                // Check for year 2025 (suspicious)
                const year = sentAt.getFullYear();
                if (year > 2024) {
                    console.log(`   ⚠️  WARNING: Year ${year} seems incorrect`);
                }

                // Check time difference
                const timeDiff = Math.abs(createdAt - sentAt) / 1000; // seconds
                if (timeDiff > 300) { // More than 5 minutes difference
                    console.log(`   ⚠️  WARNING: Large time gap (${Math.round(timeDiff/60)} minutes) between sent and created`);
                }

                console.log('');
            });

        } catch (error) {
            console.error('❌ SMS date audit failed:', error.message);
        }
    }

    async checkTimezoneIssues() {
        console.log('🌍 TIMEZONE & DATE FORMATTING AUDIT');
        console.log('=' .repeat(40));

        const now = new Date();
        const utcNow = new Date().toISOString();
        const localNow = now.toLocaleString();

        console.log(`Current system time:`);
        console.log(`   🕐 Local: ${localNow}`);
        console.log(`   🌍 UTC/ISO: ${utcNow}`);
        console.log(`   📍 Timezone offset: ${now.getTimezoneOffset()} minutes`);
        console.log('');

        // Check if there are timezone conversion issues
        try {
            const { data: recentMessages, error } = await this.supabase
                .from('messages')
                .select('sent_at, created_at, type')
                .order('created_at', { ascending: false })
                .limit(5);

            if (error) throw error;

            console.log('Recent message timestamps:');
            recentMessages.forEach((msg, i) => {
                const sent = new Date(msg.sent_at);
                const created = new Date(msg.created_at);

                console.log(`${i + 1}. ${msg.type.toUpperCase()}`);
                console.log(`   sent_at: ${msg.sent_at} → ${sent.toLocaleString()}`);
                console.log(`   created_at: ${msg.created_at} → ${created.toLocaleString()}`);

                // Check if dates are stored as UTC but displayed as local
                const sentUTC = sent.toISOString();
                const createdUTC = created.toISOString();

                if (msg.sent_at === sentUTC) {
                    console.log(`   ✅ sent_at is properly stored as ISO/UTC`);
                } else {
                    console.log(`   ⚠️  sent_at might have timezone issues`);
                }

                console.log('');
            });

        } catch (error) {
            console.error('❌ Timezone audit failed:', error.message);
        }
    }
}

// Run the audit
if (require.main === module) {
    const auditor = new MessageDateAuditor();
    auditor.auditMessageDates().catch(error => {
        console.error('❌ Message date audit failed:', error);
        process.exit(1);
    });
}

module.exports = MessageDateAuditor;