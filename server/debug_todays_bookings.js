#!/usr/bin/env node

/**
 * Debug: Check all of today's bookings to see if john wf booking exists
 */

const dbManager = require('./database-connection-manager');

async function debugTodaysBookings() {
  console.log('🔍 DEBUG: All today\'s bookings');
  console.log('==============================');

  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Today: ${today}`);

    // Get ALL leads for today with more details
    const allTodaysLeads = await dbManager.query('leads', {
      select: '*',
      gte: { date_booked: `${today}T00:00:00.000Z` },
      lte: { date_booked: `${today}T23:59:59.999Z` }
    });

    console.log(`📊 Total leads for today: ${allTodaysLeads.length}`);

    allTodaysLeads.forEach((lead, index) => {
      console.log(`\n${index + 1}. 📋 Lead: ${lead.name}`);
      console.log(`   📞 Phone: ${lead.phone}`);
      console.log(`   📅 Date Booked: ${lead.date_booked}`);
      console.log(`   👤 Booker ID: ${lead.booker_id}`);
      console.log(`   📊 Status: ${lead.status}`);
      console.log(`   🆔 Lead ID: ${lead.id}`);
      console.log(`   ⏰ Created: ${lead.created_at}`);
    });

    // Check specifically for john wf bookings
    console.log('\n🔍 Searching for john wf bookings specifically...');
    const johnWfBookings = allTodaysLeads.filter(lead =>
      lead.booker_id === 'ff2fa0a0-027b-45fa-afde-8d0b2faf7a1f'
    );

    console.log(`📊 John wf bookings found: ${johnWfBookings.length}`);
    johnWfBookings.forEach((booking, index) => {
      console.log(`   ${index + 1}. ${booking.name} at ${booking.date_booked}`);
    });

    // Check for the test booking specifically
    console.log('\n🔍 Searching for test booking...');
    const testBookings = allTodaysLeads.filter(lead =>
      lead.name.includes('Test Real-Time Update')
    );

    console.log(`📊 Test bookings found: ${testBookings.length}`);
    testBookings.forEach((booking, index) => {
      console.log(`   ${index + 1}. ${booking.name} - Booker: ${booking.booker_id}`);
    });

  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

// Run the debug
if (require.main === module) {
  debugTodaysBookings();
}

module.exports = debugTodaysBookings;