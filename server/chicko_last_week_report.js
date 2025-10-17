#!/usr/bin/env node

/**
 * Chicko's Last Week Performance Report
 * Shows leads assigned, bookings, and attendances for last week (Monday-Friday)
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
    friday: lastFriday,
    mondayISO: lastMonday.toISOString(),
    fridayISO: lastFriday.toISOString()
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

async function generateChickoReport() {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('📊 CHICKO\'S LAST WEEK PERFORMANCE REPORT');
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

    if (userError) {
      console.error('❌ Error fetching Chicko:', userError);
      return;
    }

    if (!users || users.length === 0) {
      console.error('❌ Chicko user not found!');
      return;
    }

    const chicko = users[0];
    console.log(`👤 Booker: ${chicko.name}`);
    console.log(`   Email: ${chicko.email}`);
    console.log(`   ID: ${chicko.id}\n`);

    // Query leads assigned to Chicko last week
    const { data: assignedLeads, error: leadsError } = await supabase
      .from('leads')
      .select('id, name, phone, status, date_booked, assigned_at, created_at, booker_id')
      .eq('booker_id', chicko.id)
      .gte('assigned_at', dateRange.mondayISO)
      .lte('assigned_at', dateRange.fridayISO)
      .order('assigned_at', { ascending: true });

    if (leadsError) {
      console.error('❌ Error fetching leads:', leadsError);
      return;
    }

    console.log('─'.repeat(70));
    console.log('📈 RESULTS');
    console.log('─'.repeat(70) + '\n');

    if (!assignedLeads || assignedLeads.length === 0) {
      console.log('⚠️  No leads were assigned to Chicko last week.\n');
      return;
    }

    // Count by status
    const totalAssigned = assignedLeads.length;
    const booked = assignedLeads.filter(lead => lead.status === 'Booked').length;
    const attended = assignedLeads.filter(lead => lead.status === 'Attended').length;
    const cancelled = assignedLeads.filter(lead => lead.status === 'Cancelled').length;
    const noShow = assignedLeads.filter(lead => lead.status === 'No Show').length;
    const other = totalAssigned - booked - attended - cancelled - noShow;

    // Display summary
    console.log(`📊 Total Leads Assigned: ${totalAssigned}`);
    console.log();
    console.log(`✅ Booked:     ${booked} leads`);
    console.log(`🎯 Attended:   ${attended} leads (came in to spend)`);
    console.log(`❌ Cancelled:  ${cancelled} leads`);
    console.log(`⏰ No Show:    ${noShow} leads`);
    console.log(`📋 Other:      ${other} leads`);
    console.log();

    // Calculate conversion rates
    if (totalAssigned > 0) {
      const bookingRate = ((booked / totalAssigned) * 100).toFixed(1);
      const attendanceRate = ((attended / totalAssigned) * 100).toFixed(1);
      const showUpRate = booked > 0 ? ((attended / booked) * 100).toFixed(1) : '0.0';

      console.log('📊 Conversion Rates:');
      console.log(`   Booking Rate:    ${bookingRate}% (${booked} booked / ${totalAssigned} assigned)`);
      console.log(`   Attendance Rate: ${attendanceRate}% (${attended} attended / ${totalAssigned} assigned)`);
      if (booked > 0) {
        console.log(`   Show-up Rate:    ${showUpRate}% (${attended} attended / ${booked} booked)`);
      }
      console.log();
    }

    // Show detailed breakdown by day
    console.log('─'.repeat(70));
    console.log('📅 DAILY BREAKDOWN');
    console.log('─'.repeat(70) + '\n');

    const leadsByDay = {};
    assignedLeads.forEach(lead => {
      const assignedDate = new Date(lead.assigned_at);
      const dayKey = assignedDate.toLocaleDateString('en-GB', { weekday: 'long', month: 'short', day: 'numeric' });
      
      if (!leadsByDay[dayKey]) {
        leadsByDay[dayKey] = [];
      }
      leadsByDay[dayKey].push(lead);
    });

    Object.entries(leadsByDay).forEach(([day, leads]) => {
      const dayBooked = leads.filter(l => l.status === 'Booked').length;
      const dayAttended = leads.filter(l => l.status === 'Attended').length;
      
      console.log(`${day}:`);
      console.log(`  Total: ${leads.length} | Booked: ${dayBooked} | Attended: ${dayAttended}`);
    });
    console.log();

    // Show leads that attended (came in to spend)
    if (attended > 0) {
      console.log('─'.repeat(70));
      console.log('🎯 LEADS THAT CAME IN (ATTENDED)');
      console.log('─'.repeat(70) + '\n');

      const attendedLeads = assignedLeads.filter(lead => lead.status === 'Attended');
      attendedLeads.forEach((lead, index) => {
        console.log(`${index + 1}. ${lead.name}`);
        console.log(`   Phone: ${lead.phone}`);
        console.log(`   Date Booked: ${lead.date_booked ? new Date(lead.date_booked).toLocaleDateString('en-GB') : 'N/A'}`);
        console.log();
      });
    }

    console.log('─'.repeat(70));
    console.log('✅ REPORT COMPLETE');
    console.log('─'.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Run the report
generateChickoReport();

