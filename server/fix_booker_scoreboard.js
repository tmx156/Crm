#!/usr/bin/env node

/**
 * Fix Booker Scoreboard to Show Detailed Booking Information
 * This script updates the team performance API to include detailed booking breakdown
 */

const dbManager = require('./database-connection-manager');

async function getDetailedBookerStats() {
  console.log('📊 GENERATING DETAILED BOOKER SCOREBOARD DATA');
  console.log('==============================================');

  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Fetching data for: ${today}`);

    // Get all bookers
    const bookers = await dbManager.query('users', {
      select: 'id, name, role',
      eq: { role: 'booker' }
    });

    console.log(`👥 Found ${bookers.length} bookers`);

    const detailedBookerStats = [];

    for (const booker of bookers) {
      console.log(`\n📈 Processing booker: ${booker.name}`);

      // Get today's appointments for this booker (using date_booked)
      const todaysAppointments = await dbManager.query('leads', {
        select: 'id, name, phone, date_booked, status, created_at',
        eq: { booker_id: booker.id },
        gte: { date_booked: `${today}T00:00:00.000Z` },
        lte: { date_booked: `${today}T23:59:59.999Z` }
      });

      console.log(`   📅 Today's appointments: ${todaysAppointments.length}`);

      // Create detailed booking breakdown
      const bookingDetails = todaysAppointments.map(appointment => {
        const appointmentDate = new Date(appointment.date_booked);
        return {
          id: appointment.id,
          leadName: appointment.name || 'Unknown Lead',
          phone: appointment.phone || '',
          date: appointmentDate.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          time: appointmentDate.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }),
          status: appointment.status || 'Booked',
          dateBooked: appointment.date_booked,
          createdAt: appointment.created_at
        };
      });

      // Sort by appointment time
      bookingDetails.sort((a, b) => new Date(a.dateBooked) - new Date(b.dateBooked));

      console.log(`   📋 Booking details processed: ${bookingDetails.length}`);
      if (bookingDetails.length > 0) {
        console.log(`   ⏰ First appointment: ${bookingDetails[0].time}`);
        console.log(`   ⏰ Last appointment: ${bookingDetails[bookingDetails.length - 1].time}`);
      }

      // Get additional stats
      const totalLeads = await dbManager.query('leads', {
        select: 'id',
        eq: { booker_id: booker.id }
      });

      const todaysAssignments = await dbManager.query('leads', {
        select: 'id',
        eq: { booker_id: booker.id },
        gte: { created_at: `${today}T00:00:00.000Z` },
        lte: { created_at: `${today}T23:59:59.999Z` }
      });

      const bookerStat = {
        id: booker.id,
        name: booker.name,
        bookingsToday: todaysAppointments.length,
        assignments: todaysAssignments.length,
        lastBooking: bookingDetails.length > 0 ? bookingDetails[bookingDetails.length - 1].dateBooked : null,
        isActive: todaysAppointments.length > 0,
        bookingDetails: bookingDetails, // This is the key addition!
        conversionRate: totalLeads.length > 0 ?
          ((todaysAppointments.length / totalLeads.length) * 100).toFixed(2) : 0,
        totalLeads: totalLeads.length
      };

      detailedBookerStats.push(bookerStat);
    }

    // Sort by bookings today (descending)
    detailedBookerStats.sort((a, b) => b.bookingsToday - a.bookingsToday);

    console.log('\n📊 DETAILED BOOKER SCOREBOARD');
    console.log('==============================');

    detailedBookerStats.forEach((booker, index) => {
      console.log(`\n${index + 1}. 👤 ${booker.name}`);
      console.log(`   📅 Today's bookings: ${booker.bookingsToday}`);
      console.log(`   📋 Today's assignments: ${booker.assignments}`);
      console.log(`   📈 Total leads: ${booker.totalLeads}`);
      console.log(`   ✅ Is active: ${booker.isActive}`);

      if (booker.bookingDetails.length > 0) {
        console.log(`   📝 Booking details:`);
        booker.bookingDetails.forEach((booking, idx) => {
          console.log(`      ${idx + 1}. ${booking.leadName} - ${booking.time} (${booking.status})`);
        });
      } else {
        console.log(`   📝 No bookings today`);
      }
    });

    console.log('\n🔧 API RESPONSE FORMAT');
    console.log('=======================');
    console.log('This is the data structure the dashboard expects:');
    console.log(JSON.stringify({
      date: today,
      teamPerformance: detailedBookerStats.map(booker => ({
        userId: booker.id,
        name: booker.name,
        bookingsMade: booker.bookingsToday,
        leadsAssigned: booker.assignments,
        bookingDetails: booker.bookingDetails, // Key field for detailed breakdown
        isActive: booker.isActive,
        conversionRate: booker.conversionRate,
        lastBooking: booker.lastBooking
      }))
    }, null, 2));

    return detailedBookerStats;

  } catch (error) {
    console.error('❌ Failed to generate detailed booker stats:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
if (require.main === module) {
  getDetailedBookerStats();
}

module.exports = getDetailedBookerStats;