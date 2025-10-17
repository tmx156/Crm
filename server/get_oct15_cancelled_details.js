/**
 * Get detailed information about the 5 cancelled bookings from Oct 15, 2025
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function getOct15CancelledDetails() {
  console.log('📋 DETAILED INFORMATION: 5 Cancelled Bookings from Oct 15, 2025\n');
  console.log('='.repeat(80));

  try {
    // Get Oct 15 date range
    const oct15 = new Date('2025-10-15');
    oct15.setHours(0, 0, 0, 0);
    const startOfDay = oct15.toISOString();
    const endOfDay = new Date(oct15);
    endOfDay.setHours(23, 59, 59, 999);
    const endOfDayStr = endOfDay.toISOString();

    // Get cancelled bookings from Oct 15
    const { data: cancelledBookings, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'Cancelled')
      .eq('ever_booked', true)
      .gte('booked_at', startOfDay)
      .lte('booked_at', endOfDayStr)
      .order('booked_at', { ascending: true });

    if (error) throw error;

    console.log(`\n📊 Found ${cancelledBookings.length} cancelled booking(s) from Oct 15, 2025\n`);

    if (cancelledBookings.length === 0) {
      console.log('No cancelled bookings found for Oct 15, 2025\n');
      return;
    }

    // Get users to map booker names
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, email');

    if (usersError) throw usersError;

    const usersMap = {};
    users.forEach(user => {
      usersMap[user.id] = user;
    });

    // Display each cancelled booking
    cancelledBookings.forEach((booking, i) => {
      console.log(`\n${i + 1}. ${booking.name || 'Unknown'}`);
      console.log('─'.repeat(80));
      console.log(`   📧 Email: ${booking.email || 'N/A'}`);
      console.log(`   📱 Phone: ${booking.phone || 'N/A'}`);
      console.log(`   📍 Postcode: ${booking.postcode || 'N/A'}`);
      console.log(`   🎂 Age: ${booking.age || 'N/A'}`);
      
      console.log(`\n   📅 BOOKING TIMELINE:`);
      console.log(`      Created: ${booking.created_at ? new Date(booking.created_at).toLocaleString('en-GB') : 'N/A'}`);
      console.log(`      Booked at: ${booking.booked_at ? new Date(booking.booked_at).toLocaleString('en-GB') : 'N/A'}`);
      if (booking.date_booked) {
        console.log(`      Appointment was for: ${new Date(booking.date_booked).toLocaleString('en-GB')}`);
      }
      console.log(`      Updated: ${booking.updated_at ? new Date(booking.updated_at).toLocaleString('en-GB') : 'N/A'}`);
      
      console.log(`\n   👤 PEOPLE:`);
      if (booking.booker_id && usersMap[booking.booker_id]) {
        console.log(`      Booker: ${usersMap[booking.booker_id].name} (${usersMap[booking.booker_id].email})`);
      } else {
        console.log(`      Booker: N/A`);
      }
      
      if (booking.created_by_user_id && usersMap[booking.created_by_user_id]) {
        console.log(`      Created by: ${usersMap[booking.created_by_user_id].name}`);
      }
      
      if (booking.updated_by_user_id && usersMap[booking.updated_by_user_id]) {
        console.log(`      Updated by: ${usersMap[booking.updated_by_user_id].name}`);
      }

      console.log(`\n   📊 STATUS INFO:`);
      console.log(`      Current status: ${booking.status}`);
      console.log(`      Ever booked: ${booking.ever_booked ? 'Yes ✅' : 'No'}`);
      console.log(`      Has sale: ${booking.has_sale ? 'Yes' : 'No'}`);
      console.log(`      Confirmed: ${booking.is_confirmed ? 'Yes' : 'No'}`);

      if (booking.notes) {
        console.log(`\n   📝 NOTES:`);
        console.log(`      ${booking.notes.substring(0, 200)}${booking.notes.length > 200 ? '...' : ''}`);
      }

      // Parse booking history if available
      if (booking.booking_history) {
        try {
          const history = JSON.parse(booking.booking_history);
          if (Array.isArray(history) && history.length > 0) {
            console.log(`\n   📜 BOOKING HISTORY (${history.length} entries):`);
            // Show last 5 entries
            const recentHistory = history.slice(-5);
            recentHistory.forEach((entry, idx) => {
              const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-GB') : 'N/A';
              console.log(`      ${idx + 1}. ${entry.action} - ${timestamp}`);
              if (entry.performedByName) {
                console.log(`         By: ${entry.performedByName}`);
              }
              if (entry.details && Object.keys(entry.details).length > 0) {
                const details = JSON.stringify(entry.details).substring(0, 100);
                console.log(`         Details: ${details}${details.length >= 100 ? '...' : ''}`);
              }
            });
          }
        } catch (e) {
          console.log(`\n   📜 BOOKING HISTORY: Unable to parse`);
        }
      }

      console.log('');
    });

    console.log('\n' + '='.repeat(80));
    console.log('\n🎯 KEY INSIGHTS:\n');
    
    // Group by booker
    const byBooker = {};
    cancelledBookings.forEach(booking => {
      const bookerId = booking.booker_id;
      if (bookerId && usersMap[bookerId]) {
        const bookerName = usersMap[bookerId].name;
        if (!byBooker[bookerName]) {
          byBooker[bookerName] = [];
        }
        byBooker[bookerName].push(booking.name);
      }
    });

    console.log('   Cancelled bookings by booker:');
    Object.keys(byBooker).forEach(bookerName => {
      console.log(`   - ${bookerName}: ${byBooker[bookerName].length} cancelled (${byBooker[bookerName].join(', ')})`);
    });

    console.log('\n   These bookings:');
    console.log('   ✅ Will appear in Oct 15 daily activities');
    console.log('   ✅ Count towards the booker\'s daily total');
    console.log('   ✅ Show with status = "Cancelled"');
    console.log('   ✅ Preserve historical accuracy\n');

  } catch (error) {
    console.error('\n❌ Query failed:', error);
    console.error('Details:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  getOct15CancelledDetails()
    .then(() => {
      console.log('✅ Query completed\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('Query failed:', error);
      process.exit(1);
    });
}

module.exports = { getOct15CancelledDetails };

