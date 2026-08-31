const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

async function resetWilsonToNew() {
  const supabase = createClient(config.supabase.url, config.supabase.anonKey);

  try {
    console.log('\n=== RESETTING WILSON TO NEW STATUS ===\n');

    // Find Tim Wilson
    const { data: leads, error: searchError } = await supabase
      .from('leads')
      .select('*')
      .ilike('name', '%Tim%Wilson%');

    if (searchError) {
      console.error('❌ Error searching for Wilson:', searchError);
      return;
    }

    if (!leads || leads.length === 0) {
      console.log('❌ Wilson not found in database');
      return;
    }

    const wilson = leads[0];
    console.log('📋 Found lead:', wilson.name);
    console.log('📅 Current status:', wilson.status);
    console.log('📝 Current date_booked:', wilson.date_booked);
    console.log('📝 Current booking_history length:', wilson.booking_history?.length || 0);

    // Reset Wilson to New status and wipe booking history
    const { data, error: updateError } = await supabase
      .from('leads')
      .update({
        status: 'New',
        date_booked: null,
        is_confirmed: 0,
        booking_status: null,
        booking_history: []
      })
      .eq('id', wilson.id)
      .select();

    if (updateError) {
      console.error('❌ Error updating Wilson:', updateError);
      return;
    }

    console.log('\n✅ Reset Wilson to New status');
    console.log('✅ Wiped booking history');
    console.log('✅ Cleared date_booked');

    // Verify the update
    const { data: updated, error: verifyError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', wilson.id)
      .single();

    if (verifyError) {
      console.error('❌ Error verifying update:', verifyError);
      return;
    }

    console.log('\n📋 Updated lead:');
    console.log('   Name:', updated.name);
    console.log('   Status:', updated.status);
    console.log('   Date Booked:', updated.date_booked);
    console.log('   Booking History:', updated.booking_history);

    console.log('\n✅ Wilson has been reset to New status!');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

resetWilsonToNew();
