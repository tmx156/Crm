const dbManager = require('./database-connection-manager');

(async () => {
  try {
    console.log('🔍 Analyzing Heavy Leads on Oct 25th...\n');

    const leads = await dbManager.query('leads', {
      select: 'id, name, booking_history, date_booked, created_at',
      limit: 10000
    });

    const oct25 = leads.filter(l => l.date_booked?.includes('2025-10-25'));

    // Get the heaviest ones
    const heavy = oct25
      .map(l => {
        const history = l.booking_history || [];
        const historyArray = Array.isArray(history) ? history : JSON.parse(history);
        return {
          name: l.name,
          entries: historyArray.length,
          history: historyArray,
          created: l.created_at
        };
      })
      .filter(l => l.entries > 1000)
      .sort((a, b) => b.entries - a.entries);

    console.log(`Found ${heavy.length} leads with >1000 history entries:\n`);

    heavy.forEach((lead, i) => {
      console.log(`${i + 1}. ${lead.name}: ${lead.entries} entries`);
      console.log(`   Lead created: ${new Date(lead.created).toLocaleDateString()}`);

      // Analyze entry types
      const types = {};
      lead.history.forEach(entry => {
        const type = entry.action || entry.type || 'unknown';
        types[type] = (types[type] || 0) + 1;
      });

      console.log(`   Entry types:`);
      Object.entries(types)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([type, count]) => {
          console.log(`     ${type}: ${count}`);
        });

      // Check if entries are duplicates or loops
      const timestamps = lead.history.map(e => e.timestamp).filter(Boolean);
      const uniqueTimestamps = new Set(timestamps);

      if (timestamps.length > uniqueTimestamps.size) {
        const duplicates = timestamps.length - uniqueTimestamps.size;
        console.log(`   ⚠️  ${duplicates} duplicate timestamps detected!`);
      }

      // Check for rapid-fire entries (potential loop)
      if (timestamps.length > 100) {
        timestamps.sort();
        let rapidEntries = 0;
        for (let i = 1; i < timestamps.length; i++) {
          const prev = new Date(timestamps[i - 1]);
          const curr = new Date(timestamps[i]);
          const diff = curr - prev;
          if (diff < 1000) { // Less than 1 second apart
            rapidEntries++;
          }
        }

        if (rapidEntries > 50) {
          console.log(`   ❌ ${rapidEntries} entries within 1 second of each other!`);
          console.log(`      This looks like a logging loop/bug!`);
        }
      }

      console.log('');
    });

    console.log('\n💡 RECOMMENDATION:');
    console.log('   These leads have abnormally large history arrays.');
    console.log('   Check for:');
    console.log('   1. Logging loops (same action repeated rapidly)');
    console.log('   2. Duplicate entries');
    console.log('   3. Old entries that should be archived');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
