/**
 * Verify Kashmapatel@hotmail.com appears in yesterday's daily activities
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyDailyActivities() {
  console.log('🔍 Verifying daily activities for yesterday (Oct 15, 2025)...\n');

  try {
    // Yesterday's date range
    const yesterday = new Date('2025-10-15');
    const startOfDay = new Date(yesterday);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(yesterday);
    endOfDay.setHours(23, 59, 59, 999);

    console.log('📅 Date Range:');
    console.log(`   Start: ${startOfDay.toISOString()}`);
    console.log(`   End: ${endOfDay.toISOString()}`);
    console.log('');

    // Get Tim Wilson's ID
    const { data: timWilson, error: timError } = await supabase
      .from('users')
      .select('id, name')
      .eq('email', 'tim@crm.com')
      .single();

    if (timError) throw timError;

    console.log(`👤 Checking Tim Wilson's activities (ID: ${timWilson.id})`);
    console.log('');

    // Query bookings made yesterday by Tim Wilson (mimics the API endpoint)
    const { data: bookings, error: bookingsError } = await supabase
      .from('leads')
      .select('id, name, email, phone, status, date_booked, booked_at, ever_booked')
      .eq('booker_id', timWilson.id)
      .gte('booked_at', startOfDay.toISOString())
      .lte('booked_at', endOfDay.toISOString());

    if (bookingsError) throw bookingsError;

    console.log(`📊 Found ${bookings.length} booking(s) made by Tim Wilson yesterday:`);
    console.log('='.repeat(80));

    if (bookings.length === 0) {
      console.log('   ⚠️  No bookings found!');
    } else {
      bookings.forEach((booking, i) => {
        const appointmentDate = booking.date_booked ? new Date(booking.date_booked) : null;
        const bookedDate = new Date(booking.booked_at);

        console.log(`\n${i + 1}. ${booking.name} (${booking.email})`);
        console.log(`   Status: ${booking.status}`);
        console.log(`   Phone: ${booking.phone}`);
        console.log(`   Booked at: ${bookedDate.toLocaleString('en-GB')}`);

        if (appointmentDate) {
          console.log(`   Appointment: ${appointmentDate.toLocaleString('en-GB')}`);
        } else {
          console.log(`   Appointment: NULL ❌`);
        }

        console.log(`   ever_booked: ${booking.ever_booked ? 'true ✅' : 'false'}`);

        // Check if this is Kashma
        if (booking.email === 'Kashmapatel@hotmail.com') {
          console.log(`   🎯 THIS IS KASHMA PATEL!`);

          if (booking.status === 'Cancelled' && appointmentDate) {
            console.log(`   ✅ CORRECT: Cancelled booking with preserved date_booked`);
            console.log(`   ✅ Will display as "Cancelled - was for ${appointmentDate.toLocaleString('en-GB')}"`);
          } else if (booking.status === 'Cancelled' && !appointmentDate) {
            console.log(`   ❌ PROBLEM: date_booked is NULL - won't display properly`);
          }
        }
      });
    }

    console.log('\n' + '='.repeat(80));

    // Specifically check for Kashma
    const kashmaBooking = bookings.find(b => b.email === 'Kashmapatel@hotmail.com');

    if (kashmaBooking) {
      console.log('\n✅ VERIFICATION RESULT: KASHMA PATEL FOUND!');
      console.log('   The booking WILL appear in yesterday\'s daily activities');
      console.log('   Display will show:');
      console.log(`     - Lead Name: ${kashmaBooking.name}`);
      console.log(`     - Status: ${kashmaBooking.status}`);
      if (kashmaBooking.date_booked) {
        const appt = new Date(kashmaBooking.date_booked);
        console.log(`     - Appointment: ${appt.toLocaleDateString('en-GB')} at ${appt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`);
      }
    } else {
      console.log('\n❌ VERIFICATION RESULT: KASHMA PATEL NOT FOUND');
      console.log('   This should not happen! Let\'s check if she exists at all...');

      // Double-check if Kashma exists
      const { data: kashmaLead, error: kashmaError } = await supabase
        .from('leads')
        .select('*')
        .eq('email', 'Kashmapatel@hotmail.com')
        .single();

      if (!kashmaError && kashmaLead) {
        console.log('\n   Lead exists in database:');
        console.log(`     Status: ${kashmaLead.status}`);
        console.log(`     date_booked: ${kashmaLead.date_booked || 'NULL'}`);
        console.log(`     booked_at: ${kashmaLead.booked_at || 'NULL'}`);
        console.log(`     booker_id: ${kashmaLead.booker_id}`);
        console.log(`     ever_booked: ${kashmaLead.ever_booked}`);

        if (kashmaLead.booker_id !== timWilson.id) {
          console.log(`\n   ⚠️  Problem: Assigned to different booker (${kashmaLead.booker_id}), not Tim Wilson`);
        }

        const bookedDate = kashmaLead.booked_at ? new Date(kashmaLead.booked_at) : null;
        if (!bookedDate || bookedDate < startOfDay || bookedDate > endOfDay) {
          console.log(`\n   ⚠️  Problem: booked_at (${kashmaLead.booked_at}) is not within yesterday's range`);
        }
      }
    }

    console.log('\n✅ Verification complete!');

  } catch (error) {
    console.error('\n❌ Verification failed:', error);
    console.error('Details:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  verifyDailyActivities()
    .then(() => {
      console.log('\n✅ Script completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { verifyDailyActivities };
