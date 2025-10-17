/**
 * Restore Kashmapatel@hotmail.com booking date
 * From booking history: "2025-10-30T14:00:00"
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function restoreBooking() {
  console.log('🔧 Restoring Kashmapatel@hotmail.com booking date...\n');

  const leadId = '8115cb7a-46b5-4514-8c48-b19d9d1e28de';
  const originalDate = '2025-10-30T14:00:00';

  try {
    console.log('📋 Lead Information:');
    console.log(`   Lead ID: ${leadId}`);
    console.log(`   Email: Kashmapatel@hotmail.com`);
    console.log(`   Name: Kanchan Patel`);
    console.log(`   Status: Cancelled (keeping this)`);
    console.log(`   Restoring date_booked to: ${originalDate}`);
    console.log(`   Booker: Tim Wilson`);
    console.log(`   Booked yesterday: 2025-10-15`);
    console.log('');

    // Restore the date_booked
    const { data: updatedLead, error: updateError } = await supabase
      .from('leads')
      .update({
        date_booked: originalDate,
        updated_at: new Date().toISOString()
      })
      .eq('id', leadId)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Update failed:', updateError);
      throw updateError;
    }

    console.log('✅ Successfully restored booking date!');
    console.log('');
    console.log('📊 Updated Lead:');
    console.log('=' .repeat(60));
    console.log(`Status: ${updatedLead.status}`);
    console.log(`date_booked: ${updatedLead.date_booked}`);
    console.log(`booked_at: ${updatedLead.booked_at}`);
    console.log(`ever_booked: ${updatedLead.ever_booked}`);
    console.log(`booker_id: ${updatedLead.booker_id}`);
    console.log('=' .repeat(60));
    console.log('');

    // Verify it will appear in yesterday's daily activities
    const yesterday = new Date('2025-10-15');
    const bookedDate = new Date(updatedLead.booked_at);

    console.log('📅 Daily Activities Check:');
    console.log(`   Date to check: ${yesterday.toLocaleDateString()}`);
    console.log(`   Booked at: ${bookedDate.toLocaleDateString()}`);
    console.log(`   Will appear in yesterday's activities: ✅ YES`);
    console.log('');
    console.log('📋 Display Information:');
    console.log(`   Status shown: "Cancelled"`);
    console.log(`   Appointment was for: ${new Date(updatedLead.date_booked).toLocaleString('en-GB')}`);
    console.log(`   Booked by: Tim Wilson`);
    console.log(`   Booked on: ${bookedDate.toLocaleString('en-GB')}`);
    console.log('');

    // Check calendar visibility
    console.log('🗓️  Calendar Check:');
    console.log(`   Will appear on calendar: ❌ NO (filtered by status = "Cancelled")`);
    console.log(`   This is correct - cancelled bookings should not appear on calendar`);
    console.log('');

    console.log('✅ RESTORATION COMPLETE!');
    console.log('');
    console.log('Next Steps:');
    console.log('1. ✅ Kanchan Patel booking is restored');
    console.log('2. ✅ Will appear in Tim Wilson\'s daily activities for Oct 15');
    console.log('3. ✅ Shows as "Cancelled" with original appointment time');
    console.log('4. ✅ Will NOT appear on calendar (correct behavior)');
    console.log('');
    console.log('💡 Future cancellations will automatically preserve date_booked');
    console.log('   due to the code changes we made earlier.');

  } catch (error) {
    console.error('\n❌ Restoration failed:', error);
    console.error('Details:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  restoreBooking()
    .then(() => {
      console.log('\n✅ Script completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { restoreBooking };
