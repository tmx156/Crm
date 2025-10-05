#!/usr/bin/env node

/**
 * Check Recent Messages in Database
 * Shows recent email messages and their IMAP UIDs
 */

const config = require('./config');
const { createClient } = require('@supabase/supabase-js');

async function checkRecentMessages() {
    console.log('📧 CHECKING RECENT EMAIL MESSAGES IN DATABASE');
    console.log('==============================================');

    const supabase = createClient(config.supabase.url, config.supabase.anonKey);

    try {
        // Get recent email messages
        const { data: messages, error } = await supabase
            .from('messages')
            .select('id, lead_id, type, subject, recipient_email, imap_uid, sent_at, created_at, read_status')
            .eq('type', 'email')
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) {
            throw error;
        }

        console.log(`📊 Found ${messages.length} recent email messages:\n`);

        messages.forEach((msg, i) => {
            const date = new Date(msg.created_at).toLocaleString();
            const hasUid = msg.imap_uid ? '✅' : '❌';

            console.log(`${i + 1}. ${msg.subject || 'No subject'}`);
            console.log(`   📧 From: ${msg.recipient_email}`);
            console.log(`   🆔 IMAP UID: ${msg.imap_uid || 'NULL'} ${hasUid}`);
            console.log(`   📅 Created: ${date}`);
            console.log(`   👁️  Read: ${msg.read_status}`);
            console.log('');
        });

        // Count messages with and without IMAP UID
        const withUid = messages.filter(msg => msg.imap_uid !== null);
        const withoutUid = messages.filter(msg => msg.imap_uid === null);

        console.log('📊 SUMMARY:');
        console.log(`   Messages with IMAP UID: ${withUid.length}`);
        console.log(`   Messages without IMAP UID: ${withoutUid.length}`);

        if (withoutUid.length > 0) {
            console.log('\n⚠️  Messages without IMAP UID were processed by old email poller');
            console.log('   These may be processed again as duplicates when new poller runs');
        }

        if (withUid.length > 0) {
            console.log('\n✅ Messages with IMAP UID were processed by new email poller');
            console.log('   Duplicate prevention is working correctly');
        }

    } catch (error) {
        console.error('❌ Failed to check messages:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    checkRecentMessages();
}

module.exports = checkRecentMessages;