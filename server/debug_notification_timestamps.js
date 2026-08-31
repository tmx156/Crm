#!/usr/bin/env node

/**
 * Debug Notification Timestamps
 * Check timestamp formats and timezone issues causing "1 hour ago" problem
 */

const config = require('./config');
const { createClient } = require('@supabase/supabase-js');

async function debugNotificationTimestamps() {
    console.log('🕐 NOTIFICATION TIMESTAMP DEBUG');
    console.log('==============================');

    const supabase = createClient(config.supabase.url, config.supabase.anonKey);

    try {
        // Get recent messages to see their timestamp formats
        const { data: messages, error } = await supabase
            .from('messages')
            .select('id, type, sent_at, created_at, updated_at, recipient_phone, recipient_email')
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) throw error;

        console.log('\n📊 Recent Message Timestamps:');
        console.log('==============================');

        const now = new Date();
        console.log(`Current time: ${now.toISOString()} (${now.toLocaleString()})`);
        console.log(`System timezone offset: ${now.getTimezoneOffset()} minutes\n`);

        messages.forEach((msg, i) => {
            console.log(`${i + 1}. ${msg.type.toUpperCase()} (${msg.id.substr(0, 8)}...)`);

            // Parse timestamps
            const sentAt = new Date(msg.sent_at);
            const createdAt = new Date(msg.created_at);

            console.log(`   📧 Recipient: ${msg.recipient_phone || msg.recipient_email}`);
            console.log(`   📅 sent_at: ${msg.sent_at}`);
            console.log(`   📅 created_at: ${msg.created_at}`);

            // Show parsed dates
            console.log(`   🕐 sent_at parsed: ${sentAt.toLocaleString()}`);
            console.log(`   🕐 created_at parsed: ${createdAt.toLocaleString()}`);

            // Calculate time differences (same logic as frontend)
            const diffMs = now - sentAt;
            const diffMins = Math.floor(diffMs / (1000 * 60));
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

            console.log(`   ⏱️  Time since sent_at: ${diffMs}ms (${diffMins} mins, ${diffHours} hours)`);

            // Simulate frontend time formatting logic
            let formattedTime = 'Just now';
            if (diffMins < 1) {
                formattedTime = 'Just now';
            } else if (diffMins < 60) {
                formattedTime = `${diffMins} min ago`;
            } else if (diffHours < 24) {
                formattedTime = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            } else {
                formattedTime = sentAt.toLocaleDateString();
            }

            console.log(`   🎯 Frontend would show: "${formattedTime}"`);

            // Check timezone issues
            const sentAtUTC = new Date(msg.sent_at + (msg.sent_at.endsWith('Z') ? '' : 'Z'));
            const diffMsUTC = now - sentAtUTC;
            const diffMinsUTC = Math.floor(diffMsUTC / (1000 * 60));

            if (Math.abs(diffMins - diffMinsUTC) > 30) {
                console.log(`   ⚠️  TIMEZONE ISSUE: UTC diff = ${diffMinsUTC} mins vs local = ${diffMins} mins`);
            }

            console.log('');
        });

        // Test specific timestamp scenarios
        console.log('\n🧪 TIMESTAMP SCENARIOS:');
        console.log('=======================');

        const testTimestamps = [
            new Date().toISOString(), // Current time
            new Date(Date.now() - 30000).toISOString(), // 30 seconds ago
            new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
            new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
            '2025-09-25T19:51:41', // Missing Z (timezone issue)
            '2025-09-25T19:51:41.000Z', // With Z
        ];

        testTimestamps.forEach((timestamp, i) => {
            console.log(`Test ${i + 1}: ${timestamp}`);

            const date = new Date(timestamp);
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / (1000 * 60));
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

            let formattedTime;
            if (diffMins < 1) {
                formattedTime = 'Just now';
            } else if (diffMins < 60) {
                formattedTime = `${diffMins} min ago`;
            } else if (diffHours < 24) {
                formattedTime = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            } else {
                formattedTime = date.toLocaleDateString();
            }

            console.log(`   Parsed: ${date.toLocaleString()}`);
            console.log(`   Diff: ${diffMins} mins, ${diffHours} hours`);
            console.log(`   Shows: "${formattedTime}"`);

            // Check if missing Z causes issues
            if (!timestamp.endsWith('Z') && timestamp.includes('T')) {
                const withZ = new Date(timestamp + 'Z');
                const diffMsWithZ = now - withZ;
                const diffMinsWithZ = Math.floor(diffMsWithZ / (1000 * 60));

                if (Math.abs(diffMins - diffMinsWithZ) > 30) {
                    console.log(`   ⚠️  TIMEZONE ISSUE: Without Z = ${diffMins} mins, With Z = ${diffMinsWithZ} mins`);
                }
            }

            console.log('');
        });

    } catch (error) {
        console.error('❌ Debug failed:', error.message);
        process.exit(1);
    }
}

// Run the debug
if (require.main === module) {
    debugNotificationTimestamps();
}

module.exports = debugNotificationTimestamps;