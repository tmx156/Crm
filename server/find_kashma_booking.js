/**
 * Find Kashmapatel@hotmail.com booking and check its status
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function findBooking() {
  console.log('🔍 Searching for Kashmapatel@hotmail.com booking...\n');

  try {
    // Search for the lead
    const { data: leads, error: searchError } = await supabase
      .from('leads')
      .select('*')
      .eq('email', 'Kashmapatel@hotmail.com')
      .is('deleted_at', null);

    if (searchError) throw searchError;

    if (!leads || leads.length === 0) {
      console.log('❌ No lead found with email Kashmapatel@hotmail.com');

      // Try partial match
      console.log('\n🔍 Trying partial email match...');
      const { data: partialLeads, error: partialError } = await supabase
        .from('leads')
        .select('*')
        .ilike('email', '%kashma%')
        .is('deleted_at', null);

      if (partialError) throw partialError;

      if (partialLeads && partialLeads.length > 0) {
        console.log(`\n✅ Found ${partialLeads.length} lead(s) with similar email:`);
        partialLeads.forEach((lead, i) => {
          console.log(`\n${i + 1}. Lead ID: ${lead.id}`);
          console.log(`   Name: ${lead.name}`);
          console.log(`   Email: ${lead.email}`);
          console.log(`   Status: ${lead.status}`);
          console.log(`   date_booked: ${lead.date_booked || 'NULL'}`);
          console.log(`   booked_at: ${lead.booked_at || 'NULL'}`);
          console.log(`   ever_booked: ${lead.ever_booked || false}`);
          console.log(`   booker_id: ${lead.booker_id || 'NULL'}`);
        });
      }
      return;
    }

    const lead = leads[0];
    console.log('✅ Found the lead!\n');
    console.log('📋 Current Lead Information:');
    console.log('=' .repeat(60));
    console.log(`Lead ID: ${lead.id}`);
    console.log(`Name: ${lead.name}`);
    console.log(`Email: ${lead.email}`);
    console.log(`Phone: ${lead.phone}`);
    console.log(`Status: ${lead.status}`);
    console.log(`date_booked: ${lead.date_booked || 'NULL'}`);
    console.log(`booked_at: ${lead.booked_at || 'NULL'}`);
    console.log(`ever_booked: ${lead.ever_booked || false}`);
    console.log(`booker_id: ${lead.booker_id || 'NULL'}`);
    console.log(`created_at: ${lead.created_at}`);
    console.log(`updated_at: ${lead.updated_at}`);
    console.log('=' .repeat(60));

    // Get booker information
    if (lead.booker_id) {
      console.log('\n👤 Booker Information:');
      const { data: booker, error: bookerError } = await supabase
        .from('users')
        .select('id, name, email, role')
        .eq('id', lead.booker_id)
        .single();

      if (!bookerError && booker) {
        console.log(`   Name: ${booker.name}`);
        console.log(`   Email: ${booker.email}`);
        console.log(`   Role: ${booker.role}`);
      }
    }

    // Check booking history
    if (lead.booking_history) {
      console.log('\n📜 Booking History:');
      try {
        const history = typeof lead.booking_history === 'string'
          ? JSON.parse(lead.booking_history)
          : lead.booking_history;

        if (Array.isArray(history) && history.length > 0) {
          history.slice(-5).forEach((entry, i) => {
            console.log(`\n   ${i + 1}. ${entry.action || 'Unknown action'}`);
            console.log(`      By: ${entry.performed_by_name || 'Unknown'}`);
            console.log(`      At: ${entry.timestamp || 'Unknown time'}`);
            if (entry.details) {
              console.log(`      Details: ${JSON.stringify(entry.details, null, 2)}`);
            }
          });
        } else {
          console.log('   (No booking history entries)');
        }
      } catch (e) {
        console.log('   (Unable to parse booking history)');
      }
    }

    // Check yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStart = new Date(yesterday);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    console.log('\n📅 Yesterday\'s Date Range:');
    console.log(`   Start: ${yesterdayStart.toISOString()}`);
    console.log(`   End: ${yesterdayEnd.toISOString()}`);

    // Check if this lead was booked yesterday
    if (lead.booked_at) {
      const bookedDate = new Date(lead.booked_at);
      const wasBookedYesterday = bookedDate >= yesterdayStart && bookedDate <= yesterdayEnd;

      console.log('\n📊 Booking Timeline:');
      console.log(`   Booked at: ${lead.booked_at}`);
      console.log(`   Was booked yesterday? ${wasBookedYesterday ? '✅ YES' : '❌ NO'}`);

      if (wasBookedYesterday) {
        console.log('\n✅ This booking SHOULD appear in yesterday\'s daily activities!');
      }
    }

    // Provide restoration SQL if needed
    console.log('\n' + '='.repeat(60));
    console.log('🔧 RESTORATION OPTIONS:');
    console.log('='.repeat(60));

    if (lead.status === 'Cancelled' && !lead.date_booked) {
      console.log('\n⚠️  This lead was cancelled and date_booked was cleared.');
      console.log('   To restore for daily activities, we need to:');
      console.log('   1. Keep status as "Cancelled" (correct)');
      console.log('   2. Restore the original date_booked (if we know it)');
      console.log('\n   Unfortunately, we cannot recover the original date_booked');
      console.log('   unless it\'s in the booking_history.');
    } else if (lead.status === 'Cancelled' && lead.date_booked) {
      console.log('\n✅ This lead is correctly configured!');
      console.log('   - Status: Cancelled');
      console.log('   - date_booked: PRESERVED');
      console.log('   - Should appear in daily activities');
    } else if (lead.status !== 'Cancelled') {
      console.log(`\n⚠️  Current status is "${lead.status}", not "Cancelled"`);
    }

    // Find Tim Wilson's user ID
    console.log('\n🔍 Finding Tim Wilson\'s user ID...');
    const { data: timWilson, error: timError } = await supabase
      .from('users')
      .select('id, name, email, role')
      .ilike('name', '%tim%wilson%');

    if (!timError && timWilson && timWilson.length > 0) {
      console.log(`\n✅ Found Tim Wilson:`);
      timWilson.forEach(user => {
        console.log(`   ID: ${user.id}`);
        console.log(`   Name: ${user.name}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Role: ${user.role}`);

        if (lead.booker_id === user.id) {
          console.log('   ✅ This lead is ALREADY assigned to Tim Wilson!');
        } else {
          console.log(`\n   To assign this lead to Tim Wilson, run:`);
          console.log(`   UPDATE leads SET booker_id = ${user.id} WHERE id = ${lead.id};`);
        }
      });
    } else {
      console.log('   ❌ Could not find Tim Wilson in users table');
    }

  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error('Details:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  findBooking()
    .then(() => {
      console.log('\n✅ Search completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Search failed:', error);
      process.exit(1);
    });
}

module.exports = { findBooking };
