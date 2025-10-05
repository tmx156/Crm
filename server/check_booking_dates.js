#!/usr/bin/env node

/**
 * Check booking dates - created_at vs date_booked vs booked_at
 */

const dbManager = require('./database-connection-manager');

async function checkBookingDates() {
  console.log('🔍 CHECKING BOOKING DATES');
  console.log('=========================');

  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Today: ${today}`);

    // Get all leads with date fields to see the difference
    const allLeads = await dbManager.query('leads', {
      select: 'id, name, created_at, date_booked, booked_at, updated_at',
      limit: 50
    });

    console.log(`📊 Sample of ${allLeads.length} leads with date fields:`);
    console.log('=======================================================');

    allLeads.slice(0, 10).forEach((lead, idx) => {
      console.log(`\n${idx + 1}. ${lead.name}`);
      console.log(`   📅 created_at: ${lead.created_at}`);
      console.log(`   📅 date_booked: ${lead.date_booked}`);
      console.log(`   📅 booked_at: ${lead.booked_at}`);
      console.log(`   📅 updated_at: ${lead.updated_at}`);
    });

    // Check what's different between the columns
    console.log('\n🔍 ANALYZING DATE DIFFERENCES:');
    console.log('==============================');

    // 1. Leads created today (when booking was made)
    const leadsCreatedToday = await dbManager.query('leads', {
      select: '*',
      gte: { created_at: `${today}T00:00:00.000Z` },
      lte: { created_at: `${today}T23:59:59.999Z` }
    });

    console.log(`📈 Leads CREATED today (created_at): ${leadsCreatedToday.length}`);

    // 2. Leads booked FOR today (appointment date)
    const leadsBookedForToday = await dbManager.query('leads', {
      select: '*',
      gte: { date_booked: `${today}T00:00:00.000Z` },
      lte: { date_booked: `${today}T23:59:59.999Z` }
    });

    console.log(`📅 Leads booked FOR today (date_booked): ${leadsBookedForToday.length}`);

    // 3. Check booked_at column if it exists
    const leadsWithBookedAt = allLeads.filter(lead => lead.booked_at);
    console.log(`📊 Leads with booked_at data: ${leadsWithBookedAt.length}`);

    if (leadsWithBookedAt.length > 0) {
      const leadsBookedAtToday = await dbManager.query('leads', {
        select: '*',
        gte: { booked_at: `${today}T00:00:00.000Z` },
        lte: { booked_at: `${today}T23:59:59.999Z` }
      });
      console.log(`📝 Leads booked today (booked_at): ${leadsBookedAtToday.length}`);
    }

    console.log('\n📋 LEADS CREATED TODAY (Bookings made today):');
    console.log('=============================================');

    leadsCreatedToday.forEach((lead, idx) => {
      const createdTime = new Date(lead.created_at).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const appointmentTime = new Date(lead.date_booked).toLocaleString('en-GB');
      console.log(`${idx + 1}. ${lead.name}`);
      console.log(`   🕐 Created: ${createdTime} (TODAY)`);
      console.log(`   📅 Appointment: ${appointmentTime}`);
      console.log(`   👤 Booker: ${lead.booker_id}`);
    });

    console.log('\n📋 LEADS BOOKED FOR TODAY (Appointments today):');
    console.log('===============================================');

    leadsBookedForToday.slice(0, 5).forEach((lead, idx) => {
      const createdDate = new Date(lead.created_at).toLocaleDateString('en-GB');
      const appointmentTime = new Date(lead.date_booked).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      console.log(`${idx + 1}. ${lead.name}`);
      console.log(`   📅 Created: ${createdDate}`);
      console.log(`   🕐 Appointment: ${appointmentTime} (TODAY)`);
    });

    console.log('\n🎯 DASHBOARD SHOULD SHOW:');
    console.log('=========================');
    console.log('❓ Which do you want to track?');
    console.log(`📈 Bookings MADE today: ${leadsCreatedToday.length} (created_at)`);
    console.log(`📅 Appointments FOR today: ${leadsBookedForToday.length} (date_booked)`);

    console.log('\n💡 RECOMMENDATION:');
    console.log('==================');
    console.log('For "Daily Admin Activity Dashboard" you probably want:');
    console.log('📈 Bookings MADE today (created_at) - shows daily booking activity');
    console.log('Not appointments scheduled for today');

  } catch (error) {
    console.error('❌ Check failed:', error);
  }
}

// Run the check
if (require.main === module) {
  checkBookingDates();
}

module.exports = checkBookingDates;