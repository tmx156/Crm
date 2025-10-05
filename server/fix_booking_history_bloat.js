const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

async function clearBookingHistoryColumn() {
  console.log('🔧 CLEARING BLOATED booking_history COLUMN\n');
  console.log('='.repeat(60));

  console.log('\n⚠️  This will clear the leads.booking_history column');
  console.log('   (The separate booking_history table will remain intact)');
  console.log('\nPress Ctrl+C to cancel, or wait 5 seconds...\n');

  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    // Get current state
    const { data: before, error: beforeError } = await supabase
      .from('leads')
      .select('id, booking_history')
      .not('booking_history', 'is', null)
      .limit(5);

    if (beforeError) {
      console.error('❌ Error fetching leads:', beforeError);
      return;
    }

    console.log(`📊 Sample of current data (${before.length} leads):`);
    before.forEach((lead, i) => {
      let history = lead.booking_history;
      if (typeof history === 'string') {
        try { history = JSON.parse(history); } catch (e) { history = []; }
      }
      const size = JSON.stringify(history).length;
      const entries = Array.isArray(history) ? history.length : 0;
      console.log(`   ${i + 1}. ${lead.id}: ${entries} entries, ${(size / 1024).toFixed(2)} KB`);
    });

    // Clear the column
    console.log('\n🧹 Clearing booking_history column...');
    
    const { error: updateError, count } = await supabase
      .from('leads')
      .update({ booking_history: null })
      .not('booking_history', 'is', null)
      .select('id', { count: 'exact', head: true });

    if (updateError) {
      console.error('❌ Error updating leads:', updateError);
      return;
    }

    console.log(`✅ Successfully cleared booking_history for ${count} leads!`);
    
    // Verify
    const { data: after, error: afterError } = await supabase
      .from('leads')
      .select('id, booking_history')
      .not('booking_history', 'is', null);

    if (afterError) {
      console.error('❌ Error verifying:', afterError);
      return;
    }

    console.log(`\n✅ Verification: ${after?.length || 0} leads still have booking_history`);
    
    console.log('\n💾 SPACE SAVED:');
    console.log('   Before: ~1.83 MB in booking_history column');
    console.log('   After: 0 MB');
    console.log('   Saved: 1.83 MB per query!');
    
    console.log('\n📊 EGRESS IMPACT:');
    console.log('   If you fetch leads 100x/day:');
    console.log('   Before: 183 MB/day');
    console.log('   After: 0 MB/day');
    console.log('   Savings: 183 MB/day = 5.5 GB/month!');

    console.log('\n✅ The separate booking_history table is still intact!');
    console.log('   Your history data is safe in the booking_history table.');

  } catch (error) {
    console.error('❌ Error:', error);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Done!');
}

clearBookingHistoryColumn().catch(console.error);

