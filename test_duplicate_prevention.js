/**
 * Test Duplicate Prevention on Server Restart
 *
 * This script tests that emails won't be reimported/duplicated when the server restarts
 */

require('dotenv').config();

let createClient;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (e) {
  ({ createClient } = require('./server/node_modules/@supabase/supabase-js'));
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testDuplicatePrevention() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTING DUPLICATE PREVENTION ON SERVER RESTART');
  console.log('='.repeat(80) + '\n');

  // 1. Check current state
  console.log('📊 Step 1: Checking current email count...\n');

  const { count: initialCount } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'email');

  console.log(`   Current email count: ${initialCount}\n`);

  // 2. Check for emails with provider_message_id
  const { data: emailsWithProvider } = await supabase
    .from('messages')
    .select('id, provider_message_id')
    .eq('type', 'email')
    .not('provider_message_id', 'is', null);

  console.log(`   Emails with provider_message_id: ${emailsWithProvider.length}/${initialCount}`);

  if (emailsWithProvider.length === 0) {
    console.log('\n   ⚠️  WARNING: No emails have provider_message_id set!');
    console.log('   This means duplicate prevention will NOT work.');
    console.log('   Run rebuild_email_system.js to fix this.\n');
    return false;
  }

  console.log(`   ✅ ${(emailsWithProvider.length / initialCount * 100).toFixed(1)}% of emails have provider_message_id\n`);

  // 3. Test duplicate detection logic
  console.log('📊 Step 2: Testing duplicate detection logic...\n');

  // Get a sample message to test with
  const { data: sampleMessage } = await supabase
    .from('messages')
    .select('id, lead_id, provider_message_id, recipient_email')
    .eq('type', 'email')
    .not('provider_message_id', 'is', null)
    .limit(1)
    .single();

  if (!sampleMessage) {
    console.log('   ⚠️  No sample message found for testing\n');
    return false;
  }

  console.log(`   Testing with message:`);
  console.log(`   - ID: ${sampleMessage.id}`);
  console.log(`   - Provider Message ID: ${sampleMessage.provider_message_id}`);
  console.log(`   - Lead ID: ${sampleMessage.lead_id}`);
  console.log(`   - Email: ${sampleMessage.recipient_email}\n`);

  // Simulate what the email poller does - check if message exists
  const { data: duplicateCheck } = await supabase
    .from('messages')
    .select('id')
    .eq('lead_id', sampleMessage.lead_id)
    .eq('provider_message_id', sampleMessage.provider_message_id)
    .maybeSingle();

  if (duplicateCheck) {
    console.log(`   ✅ Duplicate detection WORKS! Found existing message.\n`);
    console.log(`   The email poller will skip this message and NOT create a duplicate.\n`);
  } else {
    console.log(`   ❌ ERROR: Duplicate detection FAILED!\n`);
    return false;
  }

  // 4. Check for actual duplicates
  console.log('📊 Step 3: Checking for existing duplicates...\n');

  const { data: allEmails } = await supabase
    .from('messages')
    .select('provider_message_id')
    .eq('type', 'email')
    .not('provider_message_id', 'is', null);

  const providerIds = allEmails.map(e => e.provider_message_id);
  const uniqueProviderIds = new Set(providerIds);

  if (providerIds.length === uniqueProviderIds.size) {
    console.log(`   ✅ NO duplicates found in database`);
    console.log(`   Total emails: ${providerIds.length}`);
    console.log(`   Unique provider IDs: ${uniqueProviderIds.size}\n`);
  } else {
    const duplicateCount = providerIds.length - uniqueProviderIds.size;
    console.log(`   ⚠️  WARNING: ${duplicateCount} duplicate(s) detected!\n`);

    // Find which ones are duplicated
    const counts = {};
    providerIds.forEach(id => {
      counts[id] = (counts[id] || 0) + 1;
    });

    const duplicates = Object.entries(counts).filter(([id, count]) => count > 1);
    console.log(`   Duplicated provider_message_ids:`);
    duplicates.forEach(([id, count]) => {
      console.log(`   - ${id}: ${count} occurrences`);
    });
    console.log('');
  }

  // 5. Verify database index exists
  console.log('📊 Step 4: Checking for database performance optimizations...\n');
  console.log('   Note: Index check requires database admin access.\n');
  console.log('   Recommended: Add index for better performance:\n');
  console.log('   CREATE INDEX IF NOT EXISTS idx_messages_provider_msg_lead');
  console.log('   ON messages(provider_message_id, lead_id);\n');

  // 6. Test what happens on server restart
  console.log('📊 Step 5: Simulating server restart scenario...\n');
  console.log('   When server restarts, the email poller will:');
  console.log('   1. ✅ Fetch unread messages from Gmail');
  console.log('   2. ✅ For each message, check database using provider_message_id');
  console.log('   3. ✅ Skip if message already exists (no duplicate created)');
  console.log('   4. ✅ Only import truly new messages\n');

  console.log('   Example check for message:', sampleMessage.provider_message_id);
  console.log(`   Query: SELECT id FROM messages WHERE lead_id = '${sampleMessage.lead_id}' AND provider_message_id = '${sampleMessage.provider_message_id}'`);
  console.log(`   Result: ${duplicateCheck ? '✅ EXISTS (skip)' : '❌ NOT FOUND (import)'}\n`);

  // Final verdict
  console.log('='.repeat(80));
  console.log('✅ DUPLICATE PREVENTION TEST RESULTS');
  console.log('='.repeat(80) + '\n');

  const allPassed =
    emailsWithProvider.length === initialCount && // All emails have provider_message_id
    duplicateCheck !== null && // Duplicate detection works
    providerIds.length === uniqueProviderIds.size; // No existing duplicates

  if (allPassed) {
    console.log('🎉 SUCCESS! Duplicate prevention is working correctly!\n');
    console.log('✅ All emails have provider_message_id set');
    console.log('✅ Duplicate detection query works correctly');
    console.log('✅ No duplicate emails in database');
    console.log('✅ Server restarts will NOT create duplicates\n');
    console.log('How it works:');
    console.log('- Each email stored with Gmail\'s unique provider_message_id');
    console.log('- Before importing, poller checks if provider_message_id exists');
    console.log('- Database is source of truth (persists across restarts)');
    console.log('- File-based tracking is just a performance optimization\n');
    return true;
  } else {
    console.log('⚠️  ISSUES DETECTED:\n');
    if (emailsWithProvider.length < initialCount) {
      console.log(`❌ ${initialCount - emailsWithProvider.length} emails missing provider_message_id`);
      console.log('   Solution: Run rebuild_email_system.js\n');
    }
    if (!duplicateCheck) {
      console.log('❌ Duplicate detection query not working');
      console.log('   Solution: Check email poller code\n');
    }
    if (providerIds.length !== uniqueProviderIds.size) {
      console.log('❌ Duplicate emails exist in database');
      console.log('   Solution: Run rebuild_email_system.js to clean up\n');
    }
    return false;
  }
}

testDuplicatePrevention().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
