#!/usr/bin/env node

/**
 * Check real vs test bookings - identify which are test bookings I created
 */

const dbManager = require('./database-connection-manager');

async function checkRealVsTestBookings() {
  console.log('🔍 CHECKING REAL vs TEST BOOKINGS');
  console.log('==================================');

  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Today: ${today}`);

    // Get all today's bookings
    const allTodaysBookings = await dbManager.query('leads', {
      select: '*',
      gte: { date_booked: `${today}T00:00:00.000Z` },
      lte: { date_booked: `${today}T23:59:59.999Z` }
    });

    console.log(`📊 Total bookings showing: ${allTodaysBookings.length}`);

    // Identify test bookings I created
    const testBookings = allTodaysBookings.filter(booking =>
      booking.name.includes('Test Real-Time') ||
      booking.name.includes('Real-Time Update') ||
      booking.name.includes('Dashboard Test') ||
      booking.email?.includes('test.realtime') ||
      booking.phone?.includes('7700')
    );

    const realBookings = allTodaysBookings.filter(booking =>
      !booking.name.includes('Test Real-Time') &&
      !booking.name.includes('Real-Time Update') &&
      !booking.name.includes('Dashboard Test') &&
      !booking.email?.includes('test.realtime') &&
      !booking.phone?.includes('7700')
    );

    console.log('\n❌ TEST BOOKINGS I CREATED (NEED TO DELETE):');
    console.log('===========================================');
    console.log(`📊 Count: ${testBookings.length}`);

    testBookings.forEach((booking, idx) => {
      console.log(`${idx + 1}. ${booking.name} (${booking.phone}) - ${booking.date_booked}`);
      console.log(`   ID: ${booking.id}`);
    });

    console.log('\n✅ REAL BOOKINGS (LEGITIMATE):');
    console.log('==============================');
    console.log(`📊 Count: ${realBookings.length}`);

    realBookings.forEach((booking, idx) => {
      const time = new Date(booking.date_booked).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      console.log(`${idx + 1}. ${booking.name} at ${time} (${booking.status})`);
    });

    console.log('\n🔧 IMMEDIATE FIX NEEDED:');
    console.log('========================');
    console.log(`❌ Delete ${testBookings.length} test bookings`);
    console.log(`✅ Dashboard should show ${realBookings.length} real bookings`);

    // Delete test bookings
    if (testBookings.length > 0) {
      console.log('\n🗑️ DELETING TEST BOOKINGS...');
      for (const testBooking of testBookings) {
        await dbManager.delete('leads', { id: testBooking.id });
        console.log(`✅ Deleted: ${testBooking.name}`);
      }
      console.log(`✅ All ${testBookings.length} test bookings deleted`);
    }

    console.log('\n🎯 EXPECTED RESULT:');
    console.log('==================');
    console.log(`📊 "Total Bookings Today Since midnight" should show: ${realBookings.length}`);
    console.log(`📊 "DAILY ADMIN ACTIVITY DASHBOARD" should show: ${realBookings.length}`);

  } catch (error) {
    console.error('❌ Check failed:', error);
  }
}

// Run the check
if (require.main === module) {
  checkRealVsTestBookings();
}

module.exports = checkRealVsTestBookings;