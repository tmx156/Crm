require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const config = require('./server/config');
const MessagingService = require('./server/utils/messagingService');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

(async () => {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTING BOOKING CONFIRMATION EMAIL SENDING');
  console.log('='.repeat(80) + '\n');

  // 1. Find a recent booking with email
  console.log('1️⃣ Finding a test lead with booking and email...');
  const { data: leads, error: leadError } = await supabase
    .from('leads')
    .select('id, name, email, date_booked')
    .not('email', 'is', null)
    .not('date_booked', 'is', null)
    .order('date_booked', { ascending: false })
    .limit(1);

  if (leadError || !leads || leads.length === 0) {
    console.log('❌ No leads with bookings found');
    process.exit(1);
  }

  const testLead = leads[0];
  console.log(`   ✅ Found lead: ${testLead.name} (${testLead.email})`);
  console.log(`   📅 Booking: ${new Date(testLead.date_booked).toLocaleString()}\n`);

  // 2. Get a test user
  console.log('2️⃣ Finding a test user...');
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('id, name')
    .limit(1);

  if (userError || !users || users.length === 0) {
    console.log('❌ No users found');
    process.exit(1);
  }

  const testUser = users[0];
  console.log(`   ✅ Using user: ${testUser.name} (${testUser.id})\n`);

  // 3. Send test booking confirmation
  console.log('3️⃣ Sending test booking confirmation email...');
  console.log('-'.repeat(80));
  
  try {
    const result = await MessagingService.sendBookingConfirmation(
      testLead.id,
      testUser.id,
      testLead.date_booked,
      {
        sendEmail: true,
        sendSms: false // SMS is disabled anyway
      }
    );

    console.log('\n📊 RESULT:');
    console.log(`   Email Sent: ${result?.emailSent ? '✅ YES' : '❌ NO'}`);
    console.log(`   SMS Sent: ${result?.smsSent ? '✅ YES' : '❌ NO'}`);
    console.log(`   Email Account: ${result?.emailAccount || 'N/A'}`);
    
    if (result?.emailSent) {
      console.log('\n✅ SUCCESS: Booking confirmation email was sent!');
    } else {
      console.log('\n❌ FAILED: Booking confirmation email was not sent');
      console.log(`   Error: ${result?.error || 'Unknown error'}`);
    }

    // 4. Check if message was recorded
    console.log('\n4️⃣ Checking if message was recorded in database...');
    if (result && result.id) {
      const { data: message, error: msgError } = await supabase
        .from('messages')
        .select('*')
        .eq('id', result.id)
        .single();

      if (msgError) {
        console.log(`   ⚠️  Message not found in database: ${msgError.message}`);
      } else {
        console.log(`   ✅ Message recorded in database:`);
        console.log(`      ID: ${message.id}`);
        console.log(`      Status: ${message.status}`);
        console.log(`      Email Status: ${message.email_status || 'N/A'}`);
        console.log(`      Subject: ${message.subject || 'N/A'}`);
        console.log(`      To: ${message.recipient_email || 'N/A'}`);
      }
    } else {
      console.log('   ⚠️  No message ID returned from sendBookingConfirmation');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Stack:', error.stack);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ TEST COMPLETE');
  console.log('='.repeat(80) + '\n');

})().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
