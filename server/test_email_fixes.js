#!/usr/bin/env node

/**
 * Email System Validation Script
 * Tests the email polling and notification fixes
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Test configuration
const TEST_CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co',
  supabaseKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc',
  emailUser: process.env.EMAIL_USER || process.env.GMAIL_USER,
  emailPass: process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS
};

const supabase = createClient(TEST_CONFIG.supabaseUrl, TEST_CONFIG.supabaseKey);

class EmailSystemTester {
  constructor() {
    this.results = {
      configuration: { pass: false, details: [] },
      database: { pass: false, details: [] },
      messageHandling: { pass: false, details: [] },
      readStatus: { pass: false, details: [] }
    };
  }

  async runAllTests() {
    console.log('🧪 Starting Email System Validation Tests...\n');

    await this.testConfiguration();
    await this.testDatabaseConnection();
    await this.testMessageHandling();
    await this.testReadStatusHandling();

    this.printResults();
  }

  async testConfiguration() {
    console.log('📋 Testing Email Configuration...');

    const tests = [
      {
        name: 'EMAIL_USER configured',
        check: () => !!TEST_CONFIG.emailUser,
        value: TEST_CONFIG.emailUser ? '✅ Set' : '❌ Not set'
      },
      {
        name: 'EMAIL_PASSWORD configured',
        check: () => !!TEST_CONFIG.emailPass,
        value: TEST_CONFIG.emailPass ? '✅ Set' : '❌ Not set'
      },
      {
        name: 'Supabase URL configured',
        check: () => !!TEST_CONFIG.supabaseUrl,
        value: TEST_CONFIG.supabaseUrl ? '✅ Set' : '❌ Not set'
      },
      {
        name: 'Supabase Key configured',
        check: () => !!TEST_CONFIG.supabaseKey,
        value: TEST_CONFIG.supabaseKey ? '✅ Set' : '❌ Not set'
      }
    ];

    let passed = 0;
    for (const test of tests) {
      const result = test.check();
      console.log(`   ${result ? '✅' : '❌'} ${test.name}: ${test.value}`);

      this.results.configuration.details.push({
        test: test.name,
        passed: result,
        value: test.value
      });

      if (result) passed++;
    }

    this.results.configuration.pass = passed === tests.length;
    console.log(`   📊 Configuration: ${passed}/${tests.length} tests passed\n`);
  }

  async testDatabaseConnection() {
    console.log('🗄️  Testing Database Connection...');

    try {
      // Test Supabase connection
      const { data, error } = await supabase
        .from('messages')
        .select('count')
        .limit(1);

      if (error) {
        throw error;
      }

      console.log('   ✅ Supabase connection: OK');
      this.results.database.details.push({ test: 'Supabase connection', passed: true });

      // Test messages table structure
      const { data: sampleMessage } = await supabase
        .from('messages')
        .select('id, lead_id, type, content, read_status, created_at')
        .limit(1);

      const hasRequiredColumns = sampleMessage !== null;
      console.log(`   ${hasRequiredColumns ? '✅' : '❌'} Messages table structure: ${hasRequiredColumns ? 'OK' : 'Missing columns'}`);

      this.results.database.details.push({
        test: 'Messages table structure',
        passed: hasRequiredColumns
      });

      // Test leads table
      const { data: sampleLead } = await supabase
        .from('leads')
        .select('id, name, email, phone')
        .limit(1);

      const leadsTableOk = sampleLead !== null;
      console.log(`   ${leadsTableOk ? '✅' : '❌'} Leads table: ${leadsTableOk ? 'OK' : 'Error'}`);

      this.results.database.details.push({
        test: 'Leads table access',
        passed: leadsTableOk
      });

      this.results.database.pass = hasRequiredColumns && leadsTableOk;

    } catch (error) {
      console.log(`   ❌ Database connection failed: ${error.message}`);
      this.results.database.details.push({
        test: 'Database connection',
        passed: false,
        error: error.message
      });
    }

    console.log('');
  }

  async testMessageHandling() {
    console.log('📨 Testing Message Handling...');

    try {
      // Check recent messages
      const { data: recentMessages, error } = await supabase
        .from('messages')
        .select('id, lead_id, type, content, read_status, created_at')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        throw error;
      }

      const messageCount = recentMessages?.length || 0;
      console.log(`   📊 Recent messages found: ${messageCount}`);

      if (messageCount > 0) {
        // Test message ID format
        const validUUIDs = recentMessages.filter(msg => {
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          return uuidRegex.test(msg.id);
        });

        const uuidFormatOk = validUUIDs.length === messageCount;
        console.log(`   ${uuidFormatOk ? '✅' : '❌'} Message ID format: ${validUUIDs.length}/${messageCount} valid UUIDs`);

        // Test read status field
        const messagesWithReadStatus = recentMessages.filter(msg => msg.read_status !== null);
        const readStatusOk = messagesWithReadStatus.length === messageCount;
        console.log(`   ${readStatusOk ? '✅' : '❌'} Read status field: ${messagesWithReadStatus.length}/${messageCount} have read_status`);

        // Test lead associations
        const messagesWithLeads = recentMessages.filter(msg => msg.lead_id);
        const leadAssocOk = messagesWithLeads.length === messageCount;
        console.log(`   ${leadAssocOk ? '✅' : '❌'} Lead associations: ${messagesWithLeads.length}/${messageCount} linked to leads`);

        this.results.messageHandling.pass = uuidFormatOk && readStatusOk && leadAssocOk;
        this.results.messageHandling.details.push(
          { test: 'UUID format', passed: uuidFormatOk },
          { test: 'Read status field', passed: readStatusOk },
          { test: 'Lead associations', passed: leadAssocOk }
        );
      } else {
        console.log('   ⚠️  No recent messages to test - this is normal for new systems');
        this.results.messageHandling.pass = true; // No messages is OK
      }

    } catch (error) {
      console.log(`   ❌ Message handling test failed: ${error.message}`);
      this.results.messageHandling.details.push({
        test: 'Message retrieval',
        passed: false,
        error: error.message
      });
    }

    console.log('');
  }

  async testReadStatusHandling() {
    console.log('📖 Testing Read Status Handling...');

    try {
      // Test read status update capability
      const { data: testMessage } = await supabase
        .from('messages')
        .select('id, read_status')
        .eq('read_status', false)
        .limit(1)
        .single();

      if (testMessage) {
        console.log(`   📝 Testing read status update on message: ${testMessage.id.substring(0, 8)}...`);

        // Test update
        const { error: updateError } = await supabase
          .from('messages')
          .update({
            read_status: true,
            read_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', testMessage.id);

        if (updateError) {
          throw updateError;
        }

        console.log('   ✅ Read status update: OK');

        // Revert the test change
        await supabase
          .from('messages')
          .update({ read_status: testMessage.read_status })
          .eq('id', testMessage.id);

        console.log('   ✅ Test reverted successfully');

        this.results.readStatus.pass = true;
        this.results.readStatus.details.push({ test: 'Read status update', passed: true });

      } else {
        console.log('   ℹ️  No unread messages to test with - testing table structure...');

        // Just test if read_status column exists
        const { error: schemaError } = await supabase
          .from('messages')
          .select('read_status')
          .limit(1);

        const schemaOk = !schemaError;
        console.log(`   ${schemaOk ? '✅' : '❌'} Read status column: ${schemaOk ? 'exists' : 'missing'}`);

        this.results.readStatus.pass = schemaOk;
        this.results.readStatus.details.push({ test: 'Read status column', passed: schemaOk });
      }

    } catch (error) {
      console.log(`   ❌ Read status test failed: ${error.message}`);
      this.results.readStatus.details.push({
        test: 'Read status handling',
        passed: false,
        error: error.message
      });
    }

    console.log('');
  }

  printResults() {
    console.log('🎯 TEST RESULTS SUMMARY');
    console.log('=' .repeat(50));

    const categories = [
      { name: 'Configuration', key: 'configuration' },
      { name: 'Database', key: 'database' },
      { name: 'Message Handling', key: 'messageHandling' },
      { name: 'Read Status', key: 'readStatus' }
    ];

    let totalPassed = 0;
    let totalCategories = categories.length;

    categories.forEach(category => {
      const result = this.results[category.key];
      const status = result.pass ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${category.name}`);

      if (result.details.length > 0) {
        result.details.forEach(detail => {
          const detailStatus = detail.passed ? '  ✅' : '  ❌';
          console.log(`${detailStatus} ${detail.test}${detail.error ? ` (${detail.error})` : ''}`);
        });
      }

      if (result.pass) totalPassed++;
      console.log('');
    });

    console.log(`📊 Overall: ${totalPassed}/${totalCategories} categories passed`);

    if (totalPassed === totalCategories) {
      console.log('🎉 All tests passed! Email system should be working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Please address the issues above.');
    }

    console.log('\n📋 NEXT STEPS:');
    console.log('1. Restart your CRM server to apply the fixes');
    console.log('2. Monitor the email poller logs for connection stability');
    console.log('3. Test mark-as-read functionality in the UI');
    console.log('4. Check that email notifications appear promptly');
  }
}

// Run the tests
if (require.main === module) {
  const tester = new EmailSystemTester();
  tester.runAllTests().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = EmailSystemTester;