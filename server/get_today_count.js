/**
 * Get accurate count of bookings made today
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function getTodayCount() {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    console.log(`\n📅 Checking bookings for: ${todayStr}\n`);

    // Get all bookings with ever_booked=true and booked_at today
    const { data: bookings, error } = await supabase
      .from('leads')
      .select('id, name, status, booked_at, ever_booked')
      .eq('ever_booked', true)
      .gte('booked_at', `${todayStr}T00:00:00`)
      .lte('booked_at', `${todayStr}T23:59:59`);

    if (error) throw error;

    const byStatus = {
      booked: bookings.filter(b => b.status === 'Booked').length,
      cancelled: bookings.filter(b => b.status === 'Cancelled').length,
      attended: bookings.filter(b => b.status === 'Attended').length,
      other: bookings.filter(b => !['Booked', 'Cancelled', 'Attended'].includes(b.status)).length
    };

    console.log('📊 BOOKINGS MADE TODAY (with ever_booked=true):');
    console.log('='.repeat(60));
    console.log(`\n   Total: ${bookings.length} booking(s)\n`);
    console.log('   By current status:');
    console.log(`   - Booked:    ${byStatus.booked}`);
    console.log(`   - Cancelled: ${byStatus.cancelled}`);
    console.log(`   - Attended:  ${byStatus.attended}`);
    console.log(`   - Other:     ${byStatus.other}`);
    console.log('\n' + '='.repeat(60));
    console.log(`\n✅ Dashboard should show: ${bookings.length} bookings today\n`);

    // Show last 5 bookings
    console.log('📋 Last 5 bookings made today:');
    const last5 = bookings.slice(-5).reverse();
    last5.forEach((b, i) => {
      const time = new Date(b.booked_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      console.log(`   ${i + 1}. ${b.name} - ${b.status} - ${time}`);
    });
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

getTodayCount().then(() => process.exit(0));

