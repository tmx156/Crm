const dbManager = require('./database-connection-manager');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://yqpcxvtzdwmfllqjkzyi.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxcGN4dnR6ZHdtZmxscWprenlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5NzUwMjgsImV4cCI6MjA1NTU1MTAyOH0.fkkWUE9fIz7AaqKnpBqUYu-RpIoF6IpEgWElYTXX3Q4'
);

(async () => {
  try {
    console.log('🧹 Clearing booking_history for October 25th leads ONLY\n');
    console.log('='.repeat(60));

    // Get ONLY Oct 25th leads directly with date filter
    const oct25Leads = await dbManager.query('leads', {
      select: 'id, name, date_booked, booking_history',
      gte: { date_booked: '2025-10-25T00:00:00.000Z' },
      lte: { date_booked: '2025-10-25T23:59:59.999Z' },
      limit: 1000
    });

    console.log(`📅 Found ${oct25Leads.length} leads on October 25th\n`);

    if (oct25Leads.length === 0) {
      console.log('✅ No leads found on Oct 25th');
      process.exit(0);
    }

    console.log('📋 Leads that will have booking_history cleared:');
    oct25Leads.forEach((lead, i) => {
      const historySize = lead.booking_history
        ? JSON.stringify(lead.booking_history).length
        : 0;
      const time = new Date(lead.date_booked).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      });
      console.log(`  ${i + 1}. ${time} - ${lead.name} (${(historySize / 1024).toFixed(2)} KB history)`);
    });

    const totalHistorySize = oct25Leads.reduce((sum, lead) => {
      return sum + (lead.booking_history ? JSON.stringify(lead.booking_history).length : 0);
    }, 0);

    console.log(`\n📊 Total booking_history to clear: ${(totalHistorySize / 1024).toFixed(2)} KB`);

    console.log('\n' + '='.repeat(60));
    console.log('⚠️  IMPORTANT: This will clear booking_history ONLY for Oct 25 leads.');
    console.log('   All other days will remain untouched.');
    console.log('='.repeat(60));

    // Check if --clear flag is provided
    if (!process.argv.includes('--clear')) {
      console.log('\n🔍 DRY RUN - No changes made.');
      console.log('\nTo proceed with clearing, run:');
      console.log('  node server/clear_oct25_booking_history.js --clear\n');
      process.exit(0);
    }

    // Execute the clearing
    console.log('\n⚙️  CLEARING booking_history for Oct 25 leads...\n');

    let clearedCount = 0;
    let failedCount = 0;

    for (const lead of oct25Leads) {
      const { error } = await supabase
        .from('leads')
        .update({ booking_history: [] })
        .eq('id', lead.id);

      if (error) {
        console.log(`  ❌ ${lead.name}: Failed - ${error.message}`);
        failedCount++;
      } else {
        console.log(`  ✅ ${lead.name}: History cleared`);
        clearedCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ CLEARING COMPLETE');
    console.log('='.repeat(60));
    console.log(`\n  Cleared: ${clearedCount}/${oct25Leads.length} leads`);
    if (failedCount > 0) {
      console.log(`  Failed: ${failedCount}`);
    }
    console.log(`  Data freed: ${(totalHistorySize / 1024).toFixed(2)} KB`);

    console.log('\n💡 October 25th should now load instantly!');
    console.log('   Other days are completely untouched.\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
