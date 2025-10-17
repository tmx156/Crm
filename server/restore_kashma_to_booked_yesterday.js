/**
 * Restore Kanchan Patel booking to "Booked" status for yesterday
 * This will make it appear in yesterday's stats with the other bookings
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function restoreToBooked() {
  console.log('🔧 Restoring Kanchan Patel to Booked status...\n');

  const leadId = '8115cb7a-46b5-4514-8c48-b19d9d1e28de';
  const timWilsonId = 'fa93b65b-e40d-4181-b047-59d39b7054f0';

  try {
    // Get current state
    console.log('📋 Current State:');
    const { data: currentLead, error: fetchError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (fetchError) throw fetchError;

    console.log(`   Name: ${currentLead.name}`);
    console.log(`   Email: ${currentLead.email}`);
    console.log(`   Current Status: ${currentLead.status}`);
    console.log(`   date_booked: ${currentLead.date_booked}`);
    console.log(`   booked_at: ${currentLead.booked_at}`);
    console.log('');

    // Update to Booked status
    console.log('🔄 Updating to Booked status...');
    const { data: updatedLead, error: updateError } = await supabase
      .from('leads')
      .update({
        status: 'Booked',
        date_booked: '2025-10-30T14:00:00', // Keep original appointment
        booked_at: '2025-10-15T15:11:14.961366+00:00', // Keep original booking time (yesterday)
        ever_booked: true,
        booker_id: timWilsonId,
        updated_at: new Date().toISOString()
      })
      .eq('id', leadId)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Update failed:', updateError);
      throw updateError;
    }

    console.log('✅ Successfully restored to Booked status!');
    console.log('');
    console.log('📊 Updated Lead:');
    console.log('='.repeat(80));
    console.log(`   Name: ${updatedLead.name}`);
    console.log(`   Email: ${updatedLead.email}`);
    console.log(`   Status: ${updatedLead.status} ✅`);
    console.log(`   date_booked: ${updatedLead.date_booked}`);
    console.log(`   booked_at: ${updatedLead.booked_at}`);
    console.log(`   ever_booked: ${updatedLead.ever_booked}`);
    console.log(`   booker_id: ${updatedLead.booker_id}`);
    console.log('='.repeat(80));
    console.log('');

    // Verify it will appear in yesterday's stats
    const bookedDate = new Date(updatedLead.booked_at);
    console.log('📅 Verification:');
    console.log(`   Booked on: ${bookedDate.toLocaleDateString('en-GB')} at ${bookedDate.toLocaleTimeString('en-GB')}`);
    console.log(`   Appointment for: ${new Date(updatedLead.date_booked).toLocaleDateString('en-GB')} at ${new Date(updatedLead.date_booked).toLocaleTimeString('en-GB')}`);
    console.log('');
    console.log('✅ This booking will now appear in Tim Wilson\'s stats for Oct 15, 2025');
    console.log('✅ Status: Booked (active booking)');
    console.log('✅ Will show on calendar for Oct 30, 2025 at 14:00');
    console.log('');

    // Check today's count for Tim Wilson
    console.log('📊 Checking yesterday\'s booking count for Tim Wilson...');
    const yesterday = new Date('2025-10-15');
    const startOfDay = new Date(yesterday);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(yesterday);
    endOfDay.setHours(23, 59, 59, 999);

    const { data: yesterdayBookings, error: countError } = await supabase
      .from('leads')
      .select('id, name, status, booked_at')
      .eq('booker_id', timWilsonId)
      .gte('booked_at', startOfDay.toISOString())
      .lte('booked_at', endOfDay.toISOString());

    if (countError) throw countError;

    console.log(`   Total bookings for Oct 15: ${yesterdayBookings.length}`);
    console.log('');

    const bookedCount = yesterdayBookings.filter(b => b.status === 'Booked').length;
    const cancelledCount = yesterdayBookings.filter(b => b.status === 'Cancelled').length;

    console.log(`   Status breakdown:`);
    console.log(`     - Booked: ${bookedCount}`);
    console.log(`     - Cancelled: ${cancelledCount}`);
    console.log(`     - Other: ${yesterdayBookings.length - bookedCount - cancelledCount}`);
    console.log('');

    console.log('='.repeat(80));
    console.log('✅ RESTORATION COMPLETE!');
    console.log('='.repeat(80));
    console.log('');
    console.log('Next Steps:');
    console.log('1. ✅ Kanchan Patel is now BOOKED (not cancelled)');
    console.log('2. ✅ Will appear in Tim Wilson\'s stats for Oct 15, 2025');
    console.log('3. ✅ Will show on calendar for Oct 30, 2025 at 14:00');
    console.log('4. 🔄 Refresh the Daily Activities page to see the change');
    console.log('');

  } catch (error) {
    console.error('\n❌ Restoration failed:', error);
    console.error('Details:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  restoreToBooked()
    .then(() => {
      console.log('✅ Script completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { restoreToBooked };
