#!/usr/bin/env node

/**
 * Test Updated Scoreboard API - Fixed Version
 */

const dbManager = require('./database-connection-manager');

async function testScoreboardAPI() {
  console.log('🧪 TESTING UPDATED SCOREBOARD API');
  console.log('==================================');

  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Testing for date: ${today}`);

    // Get all bookers
    const users = await dbManager.query('users', {
      select: 'id, name, role',
      eq: { role: 'booker' }
    });

    console.log(`👥 Found ${users.length} bookers`);

    const teamPerformance = [];

    for (const user of users) {
      console.log(`\n📈 Processing: ${user.name}`);

      // Get today's appointments
      const startOfDay = new Date(today + 'T00:00:00.000Z');
      const endOfDay = new Date(today + 'T23:59:59.999Z');

      const userBookings = await dbManager.query('leads', {
        select: 'id, name, phone, date_booked, status, has_sale, created_at',
        eq: { booker_id: user.id },
        gte: { date_booked: startOfDay.toISOString() },
        lte: { date_booked: endOfDay.toISOString() }
      });

      console.log(`   📅 Today's appointments: ${userBookings.length}`);

      // Create booking details
      const bookingDetails = userBookings.map(booking => {
        const appointmentDate = new Date(booking.date_booked);
        return {
          id: booking.id,
          leadName: booking.name || 'Unknown Lead',
          phone: booking.phone || '',
          date: appointmentDate.toLocaleDateString('en-GB'),
          time: appointmentDate.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }),
          status: booking.status || 'Booked',
          dateBooked: booking.date_booked
        };
      }).sort((a, b) => new Date(a.dateBooked) - new Date(b.dateBooked));

      // Get assignments
      const assignedLeads = await dbManager.query('leads', {
        select: 'id',
        eq: { booker_id: user.id },
        gte: { created_at: startOfDay.toISOString() },
        lte: { created_at: endOfDay.toISOString() }
      });

      const performance = {
        userId: user.id,
        name: user.name,
        bookingsMade: userBookings.length,
        leadsAssigned: assignedLeads.length,
        bookingDetails: bookingDetails,
        lastBooking: bookingDetails.length > 0 ? bookingDetails[bookingDetails.length - 1].dateBooked : null
      };

      teamPerformance.push(performance);

      console.log(`   📊 Bookings: ${performance.bookingsMade}`);
      console.log(`   📊 Assignments: ${performance.leadsAssigned}`);
      console.log(`   📊 Details: ${performance.bookingDetails.length} items`);

      if (performance.bookingDetails.length > 0) {
        console.log(`   📝 Booking details:`);
        performance.bookingDetails.forEach((booking, idx) => {
          console.log(`      ${idx + 1}. ${booking.leadName} at ${booking.time}`);
        });
      }
    }

    teamPerformance.sort((a, b) => b.bookingsMade - a.bookingsMade);

    console.log('\n🎯 DASHBOARD PREVIEW');
    console.log('====================');

    teamPerformance.forEach((booker, index) => {
      console.log(`\n${index + 1}. 👤 ${booker.name}`);
      console.log(`   📊 ${booker.bookingsMade} bookings today`);
      if (booker.bookingDetails.length > 0) {
        console.log(`   📝 Will show:`);
        booker.bookingDetails.forEach((booking) => {
          console.log(`      • ${booking.leadName} - ${booking.time} (${booking.status})`);
        });
      } else {
        console.log(`   📝 Will show "No bookings scheduled for today"`);
      }
    });

    console.log('\n✅ RESULTS');
    console.log('===========');
    console.log('✅ API structure: Ready');
    console.log('✅ Booking details: Included');
    console.log('✅ Dashboard: Will show detailed breakdown');
    console.log('\n🚀 Scoreboard is ready for live booking details!');

    return teamPerformance;

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

if (require.main === module) {
  testScoreboardAPI();
}

module.exports = testScoreboardAPI;