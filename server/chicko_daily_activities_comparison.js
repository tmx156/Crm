#!/usr/bin/env node

/**
 * Chicko's Last Week Report - Using Daily Activities Logic
 * This follows the EXACT same logic as /api/stats/team-performance
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

// Use service role key for admin operations
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

// Get last week's Monday to Friday date range
function getLastWeekDateRange() {
  const today = new Date();
  const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Calculate days to subtract to get to last Monday
  const daysToLastMonday = currentDay + 6; // Go back to last week's Monday
  
  const lastMonday = new Date(today);
  lastMonday.setDate(today.getDate() - daysToLastMonday);
  lastMonday.setHours(0, 0, 0, 0);
  
  const lastFriday = new Date(lastMonday);
  lastFriday.setDate(lastMonday.getDate() + 4); // Monday + 4 days = Friday
  lastFriday.setHours(23, 59, 59, 999);
  
  return {
    monday: lastMonday,
    friday: lastFriday
  };
}

// Format date for display
function formatDate(date) {
  return date.toLocaleDateString('en-GB', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

async function getDailyActivities(userId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // ✅ DAILY ACTIVITY LOGIC: Get bookings made today (using booked_at)
  const { data: bookingsData, error: bookingsError } = await supabase
    .from('leads')
    .select('id, name, phone, date_booked, status, has_sale, created_at, booked_at')
    .eq('booker_id', userId)
    .gte('booked_at', startOfDay.toISOString())
    .lte('booked_at', endOfDay.toISOString());

  if (bookingsError) {
    console.error('Error fetching bookings:', bookingsError);
    return null;
  }

  // Get leads assigned on this date (using created_at)
  const { data: assignedData, error: assignedError } = await supabase
    .from('leads')
    .select('id')
    .eq('booker_id', userId)
    .gte('created_at', startOfDay.toISOString())
    .lte('created_at', endOfDay.toISOString());

  if (assignedError) {
    console.error('Error fetching assigned leads:', assignedError);
    return null;
  }

  const bookings = bookingsData || [];
  const assigned = assignedData || [];

  return {
    date: date.toISOString().split('T')[0],
    dayName: date.toLocaleDateString('en-GB', { weekday: 'long' }),
    leadsAssigned: assigned.length,
    bookingsMade: bookings.length,
    attended: bookings.filter(lead => ['Attended', 'Complete'].includes(lead.status)).length,
    salesMade: bookings.filter(lead => lead.has_sale).length,
    conversionRate: assigned.length > 0 ? Math.round((bookings.length / assigned.length) * 100) : 0,
    showUpRate: bookings.length > 0 ? Math.round((bookings.filter(lead => ['Attended', 'Complete'].includes(lead.status)).length / bookings.length) * 100) : 0,
    bookings: bookings
  };
}

async function generateDailyActivitiesReport() {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('📊 CHICKO\'S LAST WEEK - DAILY ACTIVITIES LOGIC');
    console.log('='.repeat(70) + '\n');

    // Get date range
    const dateRange = getLastWeekDateRange();
    console.log(`📅 Report Period:`);
    console.log(`   From: ${formatDate(dateRange.monday)}`);
    console.log(`   To:   ${formatDate(dateRange.friday)}`);
    console.log();

    // Find Chicko's user ID
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, name, email')
      .ilike('name', '%chicko%');

    if (userError || !users || users.length === 0) {
      console.error('❌ Chicko user not found!');
      return;
    }

    const chicko = users[0];
    console.log(`👤 Booker: ${chicko.name}`);
    console.log(`   Email: ${chicko.email}`);
    console.log(`   ID: ${chicko.id}\n`);

    console.log('─'.repeat(70));
    console.log('📅 DAILY BREAKDOWN (Using Daily Activities Logic)');
    console.log('─'.repeat(70) + '\n');

    let totalAssigned = 0;
    let totalBooked = 0;
    let totalAttended = 0;
    let totalSales = 0;
    const allAttendedLeads = [];

    // Loop through each day from Monday to Friday
    const currentDate = new Date(dateRange.monday);
    while (currentDate <= dateRange.friday) {
      const dailyStats = await getDailyActivities(chicko.id, currentDate);
      
      if (dailyStats) {
        console.log(`${dailyStats.dayName}, ${currentDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}:`);
        console.log(`  Assigned: ${dailyStats.leadsAssigned}`);
        console.log(`  Booked: ${dailyStats.bookingsMade}`);
        console.log(`  Attended: ${dailyStats.attended}`);
        console.log(`  Sales: ${dailyStats.salesMade}`);
        if (dailyStats.leadsAssigned > 0) {
          console.log(`  Conversion Rate: ${dailyStats.conversionRate}%`);
        }
        console.log();

        totalAssigned += dailyStats.leadsAssigned;
        totalBooked += dailyStats.bookingsMade;
        totalAttended += dailyStats.attended;
        totalSales += dailyStats.salesMade;

        // Collect attended leads
        const attendedLeads = dailyStats.bookings.filter(b => ['Attended', 'Complete'].includes(b.status));
        allAttendedLeads.push(...attendedLeads);
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log('─'.repeat(70));
    console.log('📊 WEEK SUMMARY');
    console.log('─'.repeat(70) + '\n');

    console.log(`📊 Total Leads Assigned: ${totalAssigned}`);
    console.log();
    console.log(`✅ Bookings Made: ${totalBooked} (${totalAssigned > 0 ? ((totalBooked/totalAssigned)*100).toFixed(1) : 0}% conversion)`);
    console.log(`🎯 Attended: ${totalAttended} (${totalBooked > 0 ? ((totalAttended/totalBooked)*100).toFixed(1) : 0}% show-up rate)`);
    console.log(`💰 Sales Made: ${totalSales}`);
    console.log();

    if (allAttendedLeads.length > 0) {
      console.log('─'.repeat(70));
      console.log('🎯 LEADS THAT ATTENDED (CAME IN)');
      console.log('─'.repeat(70) + '\n');

      allAttendedLeads.forEach((lead, index) => {
        console.log(`${index + 1}. ${lead.name}`);
        console.log(`   Phone: ${lead.phone}`);
        console.log(`   Status: ${lead.status}`);
        console.log(`   Booked At: ${lead.booked_at ? new Date(lead.booked_at).toLocaleDateString('en-GB') : 'N/A'}`);
        console.log(`   Appointment: ${lead.date_booked ? new Date(lead.date_booked).toLocaleDateString('en-GB') : 'N/A'}`);
        console.log(`   Has Sale: ${lead.has_sale ? 'Yes' : 'No'}`);
        console.log();
      });
    }

    console.log('─'.repeat(70));
    console.log('ℹ️  NOTE: This report uses the DAILY ACTIVITIES logic:');
    console.log('   - Assigned = Leads created (created_at) on that day');
    console.log('   - Booked = Leads with status changed to Booked (booked_at) on that day');
    console.log('   - Attended = Booked leads with status Attended/Complete');
    console.log('─'.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Run the report
generateDailyActivitiesReport();

