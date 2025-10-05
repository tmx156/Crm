#!/usr/bin/env node

/**
 * Create another test booking for john wf to test real-time updates
 */

const dbManager = require('./database-connection-manager');
const { v4: uuidv4 } = require('uuid');

async function createAnotherJohnWfBooking() {
  console.log('🧪 TEST: Creating ANOTHER booking for john wf');
  console.log('=============================================');

  try {
    const johnWfId = 'ff2fa0a0-027b-45fa-afde-8d0b2faf7a1f';

    // Create appointment time for 2 hours from now
    const now = new Date();
    const appointmentTime = new Date();
    appointmentTime.setHours(now.getHours() + 2);
    appointmentTime.setMinutes(30);
    appointmentTime.setSeconds(0);
    appointmentTime.setMilliseconds(0);

    console.log(`📅 Appointment time: ${appointmentTime.toISOString()}`);

    const testLead = {
      id: uuidv4(),
      name: 'Second Real-Time Test Lead',
      email: 'test.realtime2@example.com',
      phone: '7700654321',
      postcode: 'M2 2BB',
      date_booked: appointmentTime.toISOString(),
      booker_id: johnWfId,
      status: 'Booked',
      notes: 'Second test booking to verify real-time dashboard updates',
      image_url: '',
      is_reschedule: 0,
      parent_phone: '',
      has_sale: 0,
      is_confirmed: 0,
      isreschedule: false,
      is_legacy: false,
      contact_attempts: 0
    };

    console.log('📝 Creating second test lead...');
    const createdLead = await dbManager.insert('leads', testLead);

    console.log('✅ Second test lead created successfully!');
    console.log(`👤 Booker: john wf`);
    console.log(`📞 Phone: ${testLead.phone}`);
    console.log(`📅 Appointment: ${appointmentTime.toLocaleString('en-GB')}`);
    console.log(`📊 Status: ${testLead.status}`);

    console.log('\n🎯 EXPECTED DASHBOARD BEHAVIOR:');
    console.log('===============================');
    console.log('📈 "Total Bookings Today" should now show: 24 (was 23)');
    console.log('📈 "Daily Admin Activity Dashboard" should now show: 24 (was 23)');
    console.log('👤 john wf should now have: 3 bookings (was 2)');
    console.log('   1. Michaela Gilchrist-Thompson at 15:00');
    console.log('   2. Test Real-Time Update Lead at 03:00');
    console.log('   3. Second Real-Time Test Lead at ' + appointmentTime.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', hour12: false}));

    console.log('\n🔄 VERIFICATION:');
    console.log('================');
    console.log('1. Check http://localhost:3000 dashboard');
    console.log('2. Verify both stats updated to 24');
    console.log('3. Check john wf shows 3 bookings');
    console.log('4. Confirm new booking appears in detailed list');

  } catch (error) {
    console.error('❌ Failed to create second test booking:', error);
  }
}

// Run the test
if (require.main === module) {
  createAnotherJohnWfBooking();
}

module.exports = createAnotherJohnWfBooking;