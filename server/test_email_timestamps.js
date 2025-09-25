#!/usr/bin/env node

/**
 * Email Timestamp Test Script
 * Tests that email timestamps show the actual received time, not processing time
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

class TimestampTester {
  async runTests() {
    console.log('⏰ EMAIL TIMESTAMP TEST');
    console.log('=' .repeat(40));
    console.log('');

    await this.testCurrentTimestamps();
    await this.testAPIResponse();
    await this.showTimestampDifferences();

    console.log('');
    console.log('📋 WHAT TO LOOK FOR:');
    console.log('1. sent_at should be the email received time');
    console.log('2. created_at should be the processing time');
    console.log('3. API should prioritize sent_at for display');
    console.log('4. Processing delay should be minimal (< 5 seconds)');
    console.log('');
    console.log('🧪 TEST: Send yourself a test email now and check the timestamps!');
  }

  async testCurrentTimestamps() {
    console.log('🕐 Testing Current Email Timestamps...');

    try {
      const { data: emails, error } = await supabase
        .from('messages')
        .select('id, type, subject, sent_at, created_at, updated_at')
        .eq('type', 'email')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('❌ Database error:', error.message);
        return;
      }

      if (!emails || emails.length === 0) {
        console.log('   ℹ️ No email messages found in database');
        return;
      }

      console.log(`   📧 Found ${emails.length} recent email messages:`);
      console.log('');

      emails.forEach((email, i) => {
        const sentAt = new Date(email.sent_at);
        const createdAt = new Date(email.created_at);
        const updatedAt = new Date(email.updated_at);

        // Calculate processing delay
        const processingDelayMs = createdAt.getTime() - sentAt.getTime();
        const processingDelaySeconds = Math.round(processingDelayMs / 1000);

        console.log(`   ${i + 1}. ${email.subject || 'No subject'}`);
        console.log(`      ID: ${email.id.substring(0, 8)}...`);
        console.log(`      📧 sent_at:    ${email.sent_at} (Email received time)`);
        console.log(`      🔄 created_at: ${email.created_at} (CRM processing time)`);
        console.log(`      ⏱️  Processing delay: ${processingDelaySeconds}s`);

        if (Math.abs(processingDelaySeconds) < 2) {
          console.log(`      ✅ Timestamps look correct (minimal delay)`);
        } else if (processingDelaySeconds > 60) {
          console.log(`      ⚠️  Large processing delay - might indicate timestamp issue`);
        } else {
          console.log(`      ✅ Processing delay seems reasonable`);
        }
        console.log('');
      });

    } catch (error) {
      console.error('❌ Timestamp test failed:', error.message);
    }
  }

  async testAPIResponse() {
    console.log('🌐 Testing Messages API Response...');

    try {
      // Simulate the API call that the frontend makes
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, lead_id, type, content, subject, sent_at, created_at, read_status')
        .eq('type', 'email')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) {
        console.error('❌ API test error:', error.message);
        return;
      }

      if (!messages || messages.length === 0) {
        console.log('   ℹ️ No messages for API test');
        return;
      }

      console.log(`   📋 Testing API timestamp logic for ${messages.length} messages:`);
      console.log('');

      messages.forEach((row, i) => {
        // Apply the same logic as messages-list.js
        const timestamp = row.sent_at || row.created_at || new Date().toISOString();
        const isUsingSentAt = timestamp === row.sent_at;

        console.log(`   ${i + 1}. ${row.subject || 'No subject'}`);
        console.log(`      API timestamp: ${timestamp}`);
        console.log(`      Source: ${isUsingSentAt ? 'sent_at (✅ correct)' : 'created_at (⚠️ fallback)'}`);
        console.log(`      sent_at:    ${row.sent_at}`);
        console.log(`      created_at: ${row.created_at}`);
        console.log('');
      });

    } catch (error) {
      console.error('❌ API test failed:', error.message);
    }
  }

  async showTimestampDifferences() {
    console.log('📊 Timestamp Difference Analysis...');

    try {
      const { data: emails, error } = await supabase
        .from('messages')
        .select('id, subject, sent_at, created_at')
        .eq('type', 'email')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('❌ Analysis error:', error.message);
        return;
      }

      if (!emails || emails.length === 0) {
        console.log('   ℹ️ No emails for analysis');
        return;
      }

      let identicalCount = 0;
      let smallDifference = 0; // < 10 seconds
      let largeDifference = 0; // > 10 seconds
      let totalProcessingTime = 0;

      emails.forEach(email => {
        const sentTime = new Date(email.sent_at).getTime();
        const createdTime = new Date(email.created_at).getTime();
        const diffMs = Math.abs(createdTime - sentTime);
        const diffSeconds = diffMs / 1000;

        totalProcessingTime += diffMs;

        if (diffMs === 0) {
          identicalCount++;
        } else if (diffSeconds < 10) {
          smallDifference++;
        } else {
          largeDifference++;
        }
      });

      const avgProcessingTime = totalProcessingTime / emails.length / 1000;

      console.log(`   📊 Analysis of ${emails.length} emails:`);
      console.log(`   ⚡ Identical timestamps: ${identicalCount} (${Math.round(identicalCount/emails.length*100)}%)`);
      console.log(`   🟢 Small difference (<10s): ${smallDifference} (${Math.round(smallDifference/emails.length*100)}%)`);
      console.log(`   🔴 Large difference (>10s): ${largeDifference} (${Math.round(largeDifference/emails.length*100)}%)`);
      console.log(`   ⏱️  Average processing time: ${avgProcessingTime.toFixed(2)} seconds`);
      console.log('');

      if (identicalCount === emails.length) {
        console.log('   ⚠️  ALL timestamps are identical - this indicates the old behavior');
        console.log('   💡 After applying fixes, you should see small differences (processing delays)');
      } else if (avgProcessingTime < 10) {
        console.log('   ✅ Processing times look good - emails processed quickly');
      } else {
        console.log('   ⚠️  High processing times detected - investigate email poller performance');
      }

    } catch (error) {
      console.error('❌ Analysis failed:', error.message);
    }
  }
}

// Run the tests
if (require.main === module) {
  const tester = new TimestampTester();
  tester.runTests().catch(console.error);
}

module.exports = TimestampTester;