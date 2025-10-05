#!/usr/bin/env node

/**
 * Test Script: Create a booking for john wf to test real-time dashboard updates
 */

const dbManager = require('./database-connection-manager');
const { v4: uuidv4 } = require('uuid');

async function createJohnWfBooking() {
  console.log('🧪 TEST: Creating booking for john wf to test real-time updates');
  console.log('=============================================================');

  try {
    // First, let's find john wf's user ID
    const johnWf = await dbManager.query('users', {
      select: 'id, name, email, role',
      eq: { name: 'john wf' }
    });

    if (!johnWf || johnWf.length === 0) {
      console.log('❌ john wf not found in users table');
      console.log('📋 Let me list all bookers to find the correct name...');

      const bookers = await dbManager.query('users', {
        select: 'id, name, email, role',
        eq: { role: 'booker' }
      });

      console.log('👥 Available bookers:');
      bookers.forEach(booker => {
        console.log(`   - ${booker.name} (ID: ${booker.id})`);
      });
      return;
    }

    const johnWfUser = johnWf[0];
    console.log(`✅ Found john wf: ${johnWfUser.name} (ID: ${johnWfUser.id})`);

    // Create a test appointment time for today
    const now = new Date();
    const appointmentTime = new Date();
    appointmentTime.setHours(now.getHours() + 1); // 1 hour from now
    appointmentTime.setMinutes(0);
    appointmentTime.setSeconds(0);
    appointmentTime.setMilliseconds(0);

    console.log(`📅 Appointment time: ${appointmentTime.toISOString()}`);

    // Create a test lead booking using actual schema
    const testLead = {
      id: uuidv4(),
      name: 'Test Real-Time Update Lead',
      email: 'test.realtime@example.com',
      phone: '7700123456',
      postcode: 'M1 1AA',
      date_booked: appointmentTime.toISOString(),
      booker_id: johnWfUser.id,
      status: 'Booked',
      notes: 'Test booking to verify real-time dashboard updates',
      image_url: '',
      is_reschedule: 0,
      parent_phone: '',
      has_sale: 0,
      is_confirmed: 0,
      isreschedule: false,
      is_legacy: false,
      contact_attempts: 0
    };

    console.log('📝 Creating test lead...');
    const createdLead = await dbManager.insert('leads', testLead);

    console.log('✅ Test lead created successfully!');
    console.log(`📋 Lead ID: ${createdLead.id}`);
    console.log(`👤 Booker: ${johnWfUser.name}`);
    console.log(`📞 Phone: ${testLead.phone}`);
    console.log(`📅 Appointment: ${appointmentTime.toLocaleString('en-GB')}`);
    console.log(`📊 Status: ${testLead.status}`);

    console.log('\n🎯 EXPECTED DASHBOARD BEHAVIOR:');
    console.log('===============================');
    console.log('1. ✅ "Total Bookings Today" should increase by 1');
    console.log('2. ✅ "Daily Admin Activity Dashboard" should increase by 1');
    console.log('3. ✅ john wf\'s booking count should increase by 1');
    console.log('4. ✅ New booking should appear in detailed breakdown');
    console.log('5. ✅ Both stats should show identical total counts');

    console.log('\n🔄 VERIFICATION STEPS:');
    console.log('======================');
    console.log('1. Check dashboard at http://localhost:3000');
    console.log('2. Verify both stats updated simultaneously');
    console.log('3. Check john wf\'s detailed booking list');
    console.log('4. Confirm new booking appears with correct time');

  } catch (error) {
    console.error('❌ Failed to create test booking:', error);
  }
}

// Run the test
if (require.main === module) {
  createJohnWfBooking();
}

module.exports = createJohnWfBooking;