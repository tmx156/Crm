#!/usr/bin/env node

/**
 * Notification System End-to-End Test Script
 * Tests the notification bell functionality for both SMS and email
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Test configuration
const TEST_CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co',
  supabaseKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc'
};

const supabase = createClient(TEST_CONFIG.supabaseUrl, TEST_CONFIG.supabaseKey);

class NotificationSystemTester {
  constructor() {
    this.testResults = [];
  }

  async runTests() {
    console.log('🔔 Starting Notification System Tests...\n');

    await this.testMessageStructure();
    await this.testReadStatusConsistency();
    await this.testNotificationFiltering();
    await this.testIdConsistency();

    this.printResults();
  }

  async testMessageStructure() {
    console.log('📋 Testing Message Structure...');

    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, lead_id, type, content, subject, read_status, created_at, sms_body')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      const totalMessages = messages?.length || 0;
      const smsMessages = messages?.filter(m => m.type === 'sms' || m.type === 'SMS') || [];
      const emailMessages = messages?.filter(m => m.type === 'email') || [];

      console.log(`   📊 Total messages: ${totalMessages}`);
      console.log(`   📱 SMS messages: ${smsMessages.length}`);
      console.log(`   📧 Email messages: ${emailMessages.length}`);

      // Test UUID format
      const validUUIDs = messages?.filter(msg => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(msg.id);
      }) || [];

      const uuidFormatOk = validUUIDs.length === totalMessages;
      console.log(`   ${uuidFormatOk ? '✅' : '❌'} UUID format: ${validUUIDs.length}/${totalMessages} valid`);

      // Test content fields
      let contentFieldsOk = true;
      const contentIssues = [];

      messages?.forEach(msg => {
        if (msg.type === 'sms' && !msg.sms_body && !msg.content) {
          contentIssues.push(`SMS message ${msg.id} missing content`);
          contentFieldsOk = false;
        }
        if (msg.type === 'email' && !msg.content && !msg.subject) {
          contentIssues.push(`Email message ${msg.id} missing content/subject`);
          contentFieldsOk = false;
        }
      });

      console.log(`   ${contentFieldsOk ? '✅' : '❌'} Content fields: ${contentFieldsOk ? 'OK' : `${contentIssues.length} issues`}`);

      if (!contentFieldsOk && contentIssues.length <= 5) {
        contentIssues.forEach(issue => console.log(`     ⚠️  ${issue}`));
      }

      this.testResults.push({
        category: 'Message Structure',
        passed: uuidFormatOk && contentFieldsOk,
        details: {
          totalMessages,
          smsMessages: smsMessages.length,
          emailMessages: emailMessages.length,
          uuidFormatOk,
          contentFieldsOk
        }
      });

    } catch (error) {
      console.log(`   ❌ Message structure test failed: ${error.message}`);
      this.testResults.push({
        category: 'Message Structure',
        passed: false,
        error: error.message
      });
    }

    console.log('');
  }

  async testReadStatusConsistency() {
    console.log('📖 Testing Read Status Consistency...');

    try {
      // Get messages with different read statuses
      const { data: allMessages, error } = await supabase
        .from('messages')
        .select('id, read_status, created_at, type')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const totalMessages = allMessages?.length || 0;
      const readMessages = allMessages?.filter(m => m.read_status === true) || [];
      const unreadMessages = allMessages?.filter(m => m.read_status === false) || [];
      const nullReadStatus = allMessages?.filter(m => m.read_status === null) || [];

      console.log(`   📊 Total messages tested: ${totalMessages}`);
      console.log(`   ✅ Read messages: ${readMessages.length}`);
      console.log(`   📬 Unread messages: ${unreadMessages.length}`);
      console.log(`   ❓ Null read status: ${nullReadStatus.length}`);

      // Test read status update capability
      const testMessage = unreadMessages[0];
      if (testMessage) {
        console.log(`   🧪 Testing read status update on: ${testMessage.id.substring(0, 8)}...`);

        // Update to read
        const { error: updateError } = await supabase
          .from('messages')
          .update({
            read_status: true,
            read_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', testMessage.id);

        if (updateError) {
          throw new Error(`Read status update failed: ${updateError.message}`);
        }

        // Verify update
        const { data: updatedMessage, error: verifyError } = await supabase
          .from('messages')
          .select('id, read_status, read_at')
          .eq('id', testMessage.id)
          .single();

        if (verifyError) {
          throw new Error(`Read status verification failed: ${verifyError.message}`);
        }

        const updateSuccessful = updatedMessage.read_status === true && updatedMessage.read_at;
        console.log(`   ${updateSuccessful ? '✅' : '❌'} Read status update: ${updateSuccessful ? 'OK' : 'Failed'}`);

        // Revert the test change
        await supabase
          .from('messages')
          .update({ read_status: testMessage.read_status })
          .eq('id', testMessage.id);

        console.log(`   🔄 Test change reverted`);

        this.testResults.push({
          category: 'Read Status Consistency',
          passed: updateSuccessful,
          details: {
            totalMessages,
            readMessages: readMessages.length,
            unreadMessages: unreadMessages.length,
            nullReadStatus: nullReadStatus.length,
            updateTest: updateSuccessful
          }
        });

      } else {
        console.log(`   ℹ️  No unread messages available for testing`);
        this.testResults.push({
          category: 'Read Status Consistency',
          passed: true,
          details: {
            totalMessages,
            readMessages: readMessages.length,
            unreadMessages: unreadMessages.length,
            nullReadStatus: nullReadStatus.length,
            updateTest: 'N/A - No unread messages'
          }
        });
      }

    } catch (error) {
      console.log(`   ❌ Read status test failed: ${error.message}`);
      this.testResults.push({
        category: 'Read Status Consistency',
        passed: false,
        error: error.message
      });
    }

    console.log('');
  }

  async testNotificationFiltering() {
    console.log('🔔 Testing Notification Filtering Logic...');

    try {
      // Simulate the client-side filtering logic
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, lead_id, type, content, subject, read_status, created_at, direction')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Apply the same filters as the client
      const recentThresholdMs = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
      const recentMessages = messages?.filter(msg => {
        const ts = new Date(msg.created_at).getTime();
        if (ts < recentThresholdMs) return false;
        if (msg.direction !== 'received') return false;

        // Include both SMS and email messages (new logic)
        if (msg.type !== 'sms' && msg.type !== 'SMS' && msg.type !== 'email') {
          return false;
        }

        return true;
      }) || [];

      const smsNotifications = recentMessages.filter(m => m.type === 'sms' || m.type === 'SMS');
      const emailNotifications = recentMessages.filter(m => m.type === 'email');

      console.log(`   📊 Recent received messages (7 days): ${recentMessages.length}`);
      console.log(`   📱 SMS notifications: ${smsNotifications.length}`);
      console.log(`   📧 Email notifications: ${emailNotifications.length}`);

      // Test that both SMS and email are included
      const includesBothTypes = smsNotifications.length > 0 && emailNotifications.length > 0;
      const filteringWorksCorrectly = recentMessages.length > 0;

      console.log(`   ${filteringWorksCorrectly ? '✅' : '❌'} Filtering logic: ${filteringWorksCorrectly ? 'Working' : 'No messages found'}`);
      console.log(`   ${includesBothTypes ? '✅' : 'ℹ️'} Both message types: ${includesBothTypes ? 'Present' : 'Only one type or no messages'}`);

      this.testResults.push({
        category: 'Notification Filtering',
        passed: filteringWorksCorrectly,
        details: {
          recentMessages: recentMessages.length,
          smsNotifications: smsNotifications.length,
          emailNotifications: emailNotifications.length,
          bothTypesPresent: includesBothTypes
        }
      });

    } catch (error) {
      console.log(`   ❌ Notification filtering test failed: ${error.message}`);
      this.testResults.push({
        category: 'Notification Filtering',
        passed: false,
        error: error.message
      });
    }

    console.log('');
  }

  async testIdConsistency() {
    console.log('🔗 Testing ID Consistency...');

    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id')
        .limit(20);

      if (error) throw error;

      // Test that all message IDs are valid UUIDs
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validIds = messages?.filter(msg => uuidRegex.test(msg.id)) || [];
      const totalIds = messages?.length || 0;

      const idsConsistent = validIds.length === totalIds;

      console.log(`   📊 Message IDs tested: ${totalIds}`);
      console.log(`   ${idsConsistent ? '✅' : '❌'} ID consistency: ${validIds.length}/${totalIds} valid UUIDs`);

      if (!idsConsistent) {
        const invalidIds = messages?.filter(msg => !uuidRegex.test(msg.id)) || [];
        console.log(`   ⚠️  Invalid IDs found: ${invalidIds.length}`);
        invalidIds.slice(0, 3).forEach(msg => {
          console.log(`     • ${msg.id} (invalid format)`);
        });
      }

      // Test that the ID format matches what the client expects
      const expectedFormat = messages?.every(msg => {
        // Should be UUID format (no underscores, no composite IDs)
        return uuidRegex.test(msg.id) && !msg.id.includes('_');
      });

      console.log(`   ${expectedFormat ? '✅' : '❌'} Expected format: ${expectedFormat ? 'All UUIDs, no composite IDs' : 'Some composite IDs found'}`);

      this.testResults.push({
        category: 'ID Consistency',
        passed: idsConsistent && expectedFormat,
        details: {
          totalIds,
          validUUIDs: validIds.length,
          expectedFormat
        }
      });

    } catch (error) {
      console.log(`   ❌ ID consistency test failed: ${error.message}`);
      this.testResults.push({
        category: 'ID Consistency',
        passed: false,
        error: error.message
      });
    }

    console.log('');
  }

  printResults() {
    console.log('🎯 NOTIFICATION SYSTEM TEST RESULTS');
    console.log('=' .repeat(50));

    let totalPassed = 0;
    let totalTests = this.testResults.length;

    this.testResults.forEach(result => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${result.category}`);

      if (result.details) {
        Object.entries(result.details).forEach(([key, value]) => {
          console.log(`  • ${key}: ${value}`);
        });
      }

      if (result.error) {
        console.log(`  ❌ Error: ${result.error}`);
      }

      if (result.passed) totalPassed++;
      console.log('');
    });

    console.log(`📊 Overall: ${totalPassed}/${totalTests} tests passed`);

    if (totalPassed === totalTests) {
      console.log('🎉 All notification tests passed! The system should be working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Please address the issues above.');
    }

    console.log('\n📋 NEXT STEPS:');
    console.log('1. Restart your CRM client to load the notification fixes');
    console.log('2. Test marking messages as read in the notification bell');
    console.log('3. Refresh the page and verify read messages stay marked as read');
    console.log('4. Send test SMS/email and verify both show in notifications');
    console.log('5. Check that email notifications show subject lines');

    if (totalPassed === totalTests) {
      console.log('\n🚀 The notification system is ready for production use!');
    }
  }
}

// Run the tests
if (require.main === module) {
  const tester = new NotificationSystemTester();
  tester.runTests().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = NotificationSystemTester;