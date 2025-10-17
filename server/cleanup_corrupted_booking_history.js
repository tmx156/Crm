const dbManager = require('./database-connection-manager');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://yqpcxvtzdwmfllqjkzyi.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxcGN4dnR6ZHdtZmxscWprenlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5NzUwMjgsImV4cCI6MjA1NTU1MTAyOH0.fkkWUE9fIz7AaqKnpBqUYu-RpIoF6IpEgWElYTXX3Q4'
);

(async () => {
  try {
    console.log('🔧 CLEANUP: Corrupted booking_history fields\n');
    console.log('='.repeat(60));

    // Get all leads with booking_history
    const leads = await dbManager.query('leads', {
      select: 'id, name, booking_history, date_booked',
      limit: 10000
    });

    console.log(`📊 Scanning ${leads.length} leads...\n`);

    let corruptedCount = 0;
    let fixedCount = 0;
    const corruptedLeads = [];

    // Detect corrupted histories
    for (const lead of leads) {
      if (!lead.booking_history) continue;

      let history;
      try {
        history = Array.isArray(lead.booking_history)
          ? lead.booking_history
          : JSON.parse(lead.booking_history);
      } catch (e) {
        console.log(`⚠️  ${lead.name}: Failed to parse booking_history`);
        continue;
      }

      // Check if history contains string entries (corruption indicator)
      const hasStringEntries = history.some(entry => typeof entry === 'string');

      if (hasStringEntries) {
        corruptedCount++;
        corruptedLeads.push({
          id: lead.id,
          name: lead.name,
          date_booked: lead.date_booked,
          originalHistorySize: history.length,
          originalHistory: history
        });
      }
    }

    console.log(`🔍 Found ${corruptedCount} corrupted leads\n`);

    if (corruptedCount === 0) {
      console.log('✅ No corrupted booking histories found!');
      process.exit(0);
    }

    console.log('📋 Corrupted leads:');
    corruptedLeads.forEach((lead, i) => {
      const isOct25 = lead.date_booked?.includes('2025-10-25');
      console.log(`  ${i + 1}. ${lead.name} (${lead.originalHistorySize} entries)${isOct25 ? ' ← OCT 25' : ''}`);
    });

    console.log('\n⚠️  IMPORTANT: This will attempt to reconstruct valid booking_history arrays.');
    console.log('   Corrupted character-split entries will be removed.');
    console.log('   Valid JSON objects will be preserved.\n');

    // DRY RUN - Show what would be fixed
    console.log('🔍 DRY RUN - Analyzing fixes...\n');

    for (const lead of corruptedLeads) {
      const history = lead.originalHistory;

      // Filter out string entries (corrupted data)
      const validEntries = history.filter(entry => typeof entry === 'object' && entry !== null);

      console.log(`  ${lead.name}:`);
      console.log(`    Before: ${history.length} entries (${JSON.stringify(history).length} bytes)`);
      console.log(`    After:  ${validEntries.length} entries (${JSON.stringify(validEntries).length} bytes)`);
      console.log(`    Removed: ${history.length - validEntries.length} corrupted entries`);
      console.log('');
    }

    console.log('\n' + '='.repeat(60));
    console.log('🚀 READY TO FIX');
    console.log('='.repeat(60));
    console.log(`\nThis will fix ${corruptedCount} corrupted leads.`);
    console.log('\nTo proceed, run this script with the --fix flag:');
    console.log('  node server/cleanup_corrupted_booking_history.js --fix\n');

    // Check if --fix flag is provided
    if (process.argv.includes('--fix')) {
      console.log('⚙️  FIXING CORRUPTED DATA...\n');

      for (const lead of corruptedLeads) {
        const history = lead.originalHistory;

        // Filter out string entries (corrupted data)
        const validEntries = history.filter(entry => typeof entry === 'object' && entry !== null);

        // Update the database
        const { error } = await supabase
          .from('leads')
          .update({ booking_history: validEntries })
          .eq('id', lead.id);

        if (error) {
          console.log(`  ❌ ${lead.name}: Failed - ${error.message}`);
        } else {
          fixedCount++;
          console.log(`  ✅ ${lead.name}: Fixed (${history.length} → ${validEntries.length} entries)`);
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log('✅ CLEANUP COMPLETE');
      console.log('='.repeat(60));
      console.log(`\n  Fixed: ${fixedCount}/${corruptedCount} leads`);
      console.log(`\n💡 Test the calendar now - Oct 25th should load much faster!`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Cleanup Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
