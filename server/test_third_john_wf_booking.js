#!/usr/bin/env node

/**
 * Create a third test booking for john wf to trigger real-time dashboard update
 */

const dbManager = require('./database-connection-manager');
const { v4: uuidv4 } = require('uuid');

async function createThirdJohnWfBooking() {
  console.log('🧪 TEST: Creating THIRD booking for john wf to trigger dashboard refresh');
  console.log('====================================================================');

  try {
    const johnWfId = 'ff2fa0a0-027b-45fa-afde-8d0b2faf7a1f';

    // Create appointment time for 3 hours from now
    const now = new Date();
    const appointmentTime = new Date();
    appointmentTime.setHours(now.getHours() + 3);
    appointmentTime.setMinutes(45);
    appointmentTime.setSeconds(0);
    appointmentTime.setMilliseconds(0);

    console.log(`📅 Appointment time: ${appointmentTime.toISOString()}`);

    const testLead = {
      id: uuidv4(),
      name: 'Third Dashboard Test Lead',
      email: 'test.realtime3@example.com',
      phone: '7700987654',
      postcode: 'M3 3CC',
      date_booked: appointmentTime.toISOString(),
      booker_id: johnWfId,
      status: 'Booked',
      notes: 'Third test booking to trigger dashboard refresh and verify real-time updates',
      image_url: '',
      is_reschedule: 0,
      parent_phone: '',
      has_sale: 0,
      is_confirmed: 0,
      isreschedule: false,
      is_legacy: false,
      contact_attempts: 0
    };

    console.log('📝 Creating third test lead...');
    const createdLead = await dbManager.insert('leads', testLead);

    console.log('✅ Third test lead created successfully!');
    console.log(`👤 Booker: john wf`);
    console.log(`📞 Phone: ${testLead.phone}`);
    console.log(`📅 Appointment: ${appointmentTime.toLocaleString('en-GB')}`);
    console.log(`📊 Status: ${testLead.status}`);

    console.log('\n🎯 EXPECTED DASHBOARD UPDATE:');
    console.log('=============================');
    console.log('📈 "Total Bookings Today" should now show: 25 (was 24)');
    console.log('📈 "Daily Admin Activity Dashboard" should now show: 25 (was 24)');
    console.log('👤 john wf should now have: 4 bookings (was 3)');
    console.log('   1. Test Real-Time Update Lead at 03:00');
    console.log('   2. Second Real-Time Test Lead at 04:30');
    console.log('   3. Third Dashboard Test Lead at ' + appointmentTime.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', hour12: false}));
    console.log('   4. Michaela Gilchrist-Thompson at 15:00');

    console.log('\n⚡ SOCKET UPDATE SHOULD TRIGGER:');
    console.log('===============================');
    console.log('1. lead_created event emitted');
    console.log('2. stats_update_needed event emitted');
    console.log('3. booking_activity event emitted');
    console.log('4. Dashboard should automatically refresh');
    console.log('5. Both stats should update to 25 immediately');

    console.log('\n🔄 VERIFICATION:');
    console.log('================');
    console.log('Watch the dashboard at http://localhost:3000');
    console.log('It should update immediately to show the new booking count!');

  } catch (error) {
    console.error('❌ Failed to create third test booking:', error);
  }
}

// Run the test
if (require.main === module) {
  createThirdJohnWfBooking();
}

module.exports = createThirdJohnWfBooking;