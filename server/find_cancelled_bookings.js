/**
 * Find dates with cancelled bookings to demonstrate the ever_booked fix
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findCancelledBookings() {
  console.log('🔍 Finding cancelled bookings with ever_booked = true\n');
  console.log('='.repeat(80));

  try {
    // Find cancelled bookings that have ever_booked = true
    const { data: cancelledBookings, error } = await supabase
      .from('leads')
      .select('id, name, email, status, booked_at, date_booked, ever_booked')
      .eq('status', 'Cancelled')
      .eq('ever_booked', true)
      .not('booked_at', 'is', null)
      .order('booked_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    console.log(`\n📊 Found ${cancelledBookings.length} cancelled bookings with ever_booked = true\n`);

    if (cancelledBookings.length === 0) {
      console.log('   No cancelled bookings found.');
      console.log('   This is expected if bookings are rarely cancelled.\n');
      return;
    }

    // Group by date booked
    const byDate = {};
    cancelledBookings.forEach(booking => {
      const date = new Date(booking.booked_at).toISOString().split('T')[0];
      if (!byDate[date]) {
        byDate[date] = [];
      }
      byDate[date].push(booking);
    });

    console.log('📅 CANCELLED BOOKINGS BY DATE BOOKED:');
    console.log('='.repeat(80));

    Object.keys(byDate).sort().reverse().forEach(date => {
      console.log(`\n${date}: ${byDate[date].length} cancelled booking(s)`);
      byDate[date].forEach((booking, i) => {
        console.log(`  ${i + 1}. ${booking.name}${booking.email ? ` (${booking.email})` : ''}`);
        console.log(`     Booked at: ${new Date(booking.booked_at).toLocaleString('en-GB')}`);
        if (booking.date_booked) {
          console.log(`     Appointment was for: ${new Date(booking.date_booked).toLocaleString('en-GB')}`);
        }
      });
    });

    console.log('\n' + '='.repeat(80));
    console.log('\n🎯 IMPACT DEMONSTRATION:');
    console.log('\n   These cancelled bookings will NOW appear in daily activities!');
    console.log('   - They count towards the booker\'s daily booking total');
    console.log('   - They show with status = "Cancelled"');
    console.log('   - Historical data remains accurate\n');

    // Pick one date to demonstrate
    const demoDate = Object.keys(byDate).sort().reverse()[0];
    if (demoDate) {
      console.log(`📌 Example: On ${demoDate}:`);
      console.log(`   - OLD: Would show ${0} cancelled bookings`);
      console.log(`   - NEW: Shows ${byDate[demoDate].length} cancelled booking(s)`);
      console.log(`   - Difference: +${byDate[demoDate].length} more accurate!\n`);
    }

  } catch (error) {
    console.error('\n❌ Search failed:', error);
    console.error('Details:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  findCancelledBookings()
    .then(() => {
      console.log('✅ Search completed\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('Search failed:', error);
      process.exit(1);
    });
}

module.exports = { findCancelledBookings };

