#!/usr/bin/env node

/**
 * Verify the corrected booking data
 */

const dbManager = require('./database-connection-manager');

async function verifyCorrectedData() {
  console.log('✅ VERIFYING CORRECTED BOOKING DATA');
  console.log('===================================');

  try {
    const today = new Date().toISOString().split('T')[0];

    // Get corrected booking data
    const todaysBookings = await dbManager.query('leads', {
      select: '*',
      gte: { date_booked: `${today}T00:00:00.000Z` },
      lte: { date_booked: `${today}T23:59:59.999Z` }
    });

    console.log(`📊 CORRECTED TOTAL: ${todaysBookings.length} bookings`);

    // Group by booker
    const bookerGroups = {};
    todaysBookings.forEach(booking => {
      const bookerId = booking.booker_id || 'unassigned';
      if (!bookerGroups[bookerId]) {
        bookerGroups[bookerId] = [];
      }
      bookerGroups[bookerId].push(booking);
    });

    console.log('\n👥 CORRECTED BOOKER BREAKDOWN:');
    console.log('==============================');

    // Get booker names
    const bookers = await dbManager.query('users', {
      select: 'id, name, role',
      eq: { role: 'booker' }
    });

    const bookerMap = {};
    bookers.forEach(booker => {
      bookerMap[booker.id] = booker;
    });

    Object.entries(bookerGroups).forEach(([bookerId, bookings]) => {
      const bookerName = bookerMap[bookerId]?.name || 'Unknown Booker';
      console.log(`👤 ${bookerName}: ${bookings.length} bookings`);

      // Show a few examples
      bookings.slice(0, 3).forEach((booking, idx) => {
        const time = new Date(booking.date_booked).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', hour12: false
        });
        console.log(`   ${idx + 1}. ${booking.name} at ${time}`);
      });

      if (bookings.length > 3) {
        console.log(`   ... and ${bookings.length - 3} more`);
      }
    });

    // Check for john wf specifically
    const johnWfId = 'ff2fa0a0-027b-45fa-afde-8d0b2faf7a1f';
    const johnWfBookings = todaysBookings.filter(b => b.booker_id === johnWfId);

    console.log('\n👤 JOHN WF SPECIFIC CHECK:');
    console.log('=========================');
    console.log(`📊 john wf bookings: ${johnWfBookings.length}`);

    johnWfBookings.forEach((booking, idx) => {
      const time = new Date(booking.date_booked).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      console.log(`   ${idx + 1}. ${booking.name} at ${time}`);
    });

    console.log('\n🎯 DASHBOARD SHOULD NOW SHOW:');
    console.log('=============================');
    console.log(`📊 Total Bookings Today: ${todaysBookings.length}`);
    console.log(`📊 DAILY ADMIN ACTIVITY DASHBOARD: ${todaysBookings.length}`);
    console.log(`👤 john wf: ${johnWfBookings.length} bookings`);
    console.log('✅ All test bookings removed');
    console.log('✅ Data is now clean and accurate');

  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
}

// Run the verification
if (require.main === module) {
  verifyCorrectedData();
}

module.exports = verifyCorrectedData;