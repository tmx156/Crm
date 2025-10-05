#!/usr/bin/env node

/**
 * Test the corrected daily activity dashboard logic
 */

const dbManager = require('./database-connection-manager');

async function testCorrectedDailyActivity() {
  console.log('🧪 TESTING CORRECTED DAILY ACTIVITY LOGIC');
  console.log('==========================================');

  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Today: ${today}`);

    // Test the CORRECTED logic - bookings MADE today (created_at)
    const bookingsMadeToday = await dbManager.query('leads', {
      select: '*',
      gte: { created_at: `${today}T00:00:00.000Z` },
      lte: { created_at: `${today}T23:59:59.999Z` }
    });

    console.log(`\n📈 BOOKINGS MADE TODAY (created_at): ${bookingsMadeToday.length}`);

    if (bookingsMadeToday.length > 0) {
      console.log('📋 Details:');
      bookingsMadeToday.forEach((booking, idx) => {
        const createdTime = new Date(booking.created_at).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', hour12: false
        });
        const appointmentDate = new Date(booking.date_booked).toLocaleDateString('en-GB');
        console.log(`${idx + 1}. ${booking.name}`);
        console.log(`   🕐 Booked at: ${createdTime} (TODAY)`);
        console.log(`   📅 Appointment: ${appointmentDate}`);
        console.log(`   👤 Booker: ${booking.booker_id}`);
        console.log(`   📊 Status: ${booking.status}`);
      });

      // Group by booker
      const bookerGroups = {};
      bookingsMadeToday.forEach(booking => {
        const bookerId = booking.booker_id || 'unassigned';
        if (!bookerGroups[bookerId]) {
          bookerGroups[bookerId] = [];
        }
        bookerGroups[bookerId].push(booking);
      });

      console.log('\n👥 DAILY ACTIVITY BY BOOKER:');
      console.log('============================');

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
        console.log(`👤 ${bookerName}: ${bookings.length} bookings made today`);

        bookings.forEach((booking, idx) => {
          const createdTime = new Date(booking.created_at).toLocaleTimeString('en-GB', {
            hour: '2-digit', minute: '2-digit', hour12: false
          });
          console.log(`   ${idx + 1}. ${booking.name} at ${createdTime}`);
        });
      });
    } else {
      console.log('📭 No bookings were made today');
    }

    console.log('\n🎯 EXPECTED DASHBOARD RESULT:');
    console.log('=============================');
    console.log(`📊 DAILY ADMIN ACTIVITY DASHBOARD: ${bookingsMadeToday.length} bookings`);
    console.log('📋 This shows bookings MADE today (when booking activity happened)');
    console.log('✅ Not appointments scheduled for today');

    // Also show for comparison - appointments scheduled for today
    const appointmentsForToday = await dbManager.query('leads', {
      select: 'id, name, date_booked',
      gte: { date_booked: `${today}T00:00:00.000Z` },
      lte: { date_booked: `${today}T23:59:59.999Z` }
    });

    console.log('\n📅 FOR COMPARISON:');
    console.log('==================');
    console.log(`📅 Appointments scheduled FOR today: ${appointmentsForToday.length}`);
    console.log('(This is different from bookings MADE today)');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
if (require.main === module) {
  testCorrectedDailyActivity();
}

module.exports = testCorrectedDailyActivity;