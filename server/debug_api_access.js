#!/usr/bin/env node

/**
 * Debug API access - test the exact endpoints the dashboard uses
 */

const dbManager = require('./database-connection-manager');

async function debugApiAccess() {
  console.log('🔍 DEBUG: API Access for Dashboard');
  console.log('==================================');

  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Today: ${today}`);

    // Test the exact query the fetchBookerStats function uses
    console.log('\n📊 Testing fetchBookerStats query...');

    // This is the EXACT same query as in Dashboard.js fetchBookerStats
    const todaysLeads = await dbManager.query('leads', {
      select: '*',
      gte: { date_booked: `${today}T00:00:00.000Z` },
      lte: { date_booked: `${today}T23:59:59.999Z` }
    });

    console.log(`✅ Query successful: Found ${todaysLeads.length} leads`);

    if (todaysLeads.length === 0) {
      console.log('❌ No leads found for today - this explains why dashboard shows 0');

      // Check if there are ANY leads in the database
      const allLeads = await dbManager.query('leads', {
        select: 'id, name, date_booked',
        limit: 5
      });

      console.log(`📋 Total leads in database (sample): ${allLeads.length}`);
      allLeads.forEach(lead => {
        console.log(`   - ${lead.name}: ${lead.date_booked}`);
      });

      return;
    }

    // Test the processing logic
    console.log('\n📊 Testing processing logic...');

    const bookers = await dbManager.query('users', {
      select: 'id, name, role',
      eq: { role: 'booker' }
    });

    const bookerMap = {};
    bookers.forEach(booker => {
      bookerMap[booker.id] = booker;
    });

    const bookerStatsMap = {};

    todaysLeads.forEach(lead => {
      const bookerId = lead.booker_id;
      if (!bookerId) {
        console.log(`⚠️ Unassigned lead: ${lead.name}`);
        return;
      }

      if (!bookerStatsMap[bookerId]) {
        const booker = bookerMap[bookerId];
        bookerStatsMap[bookerId] = {
          id: bookerId,
          name: booker?.name || 'Unknown Booker',
          bookingsToday: 0,
          bookingDetails: []
        };
      }

      bookerStatsMap[bookerId].bookingsToday++;

      const appointmentDate = new Date(lead.date_booked);
      const bookingDetail = {
        leadName: lead.name,
        time: appointmentDate.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }),
        status: lead.status,
        phone: lead.phone
      };

      bookerStatsMap[bookerId].bookingDetails.push(bookingDetail);
    });

    const bookerStats = Object.values(bookerStatsMap)
      .sort((a, b) => b.bookingsToday - a.bookingsToday);

    console.log(`✅ Processing successful: ${bookerStats.length} bookers with bookings`);

    bookerStats.forEach((booker, index) => {
      console.log(`   ${index + 1}. ${booker.name}: ${booker.bookingsToday} bookings`);
    });

    // Test what the dashboard should be receiving
    console.log('\n📊 Dashboard should show:');
    console.log(`   Total: ${todaysLeads.length} bookings`);
    console.log(`   Bookers: ${bookerStats.length}`);

    // Check if it's a timezone issue
    console.log('\n🕐 Timezone Debug:');
    const now = new Date();
    console.log(`   Current time: ${now.toISOString()}`);
    console.log(`   Current local time: ${now.toLocaleString()}`);
    console.log(`   Today filter start: ${today}T00:00:00.000Z`);
    console.log(`   Today filter end: ${today}T23:59:59.999Z`);

  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

// Run the debug
if (require.main === module) {
  debugApiAccess();
}

module.exports = debugApiAccess;