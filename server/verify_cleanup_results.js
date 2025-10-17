const dbManager = require('./database-connection-manager');

(async () => {
  try {
    const leads = await dbManager.query('leads', {
      select: 'name, booking_history',
      limit: 10000
    });

    const tariq = leads.find(l => l.name === 'TARIQ Darr');
    const claire = leads.find(l => l.name === 'Claire Pammenter');

    console.log('TARIQ Darr:');
    if (tariq) {
      const history = Array.isArray(tariq.booking_history) ? tariq.booking_history : JSON.parse(tariq.booking_history);
      console.log(`  Total entries: ${history.length}`);

      // Check if corrupted
      const stringEntries = history.filter(e => typeof e === 'string');
      const objectEntries = history.filter(e => typeof e === 'object');

      console.log(`  String entries (corrupted): ${stringEntries.length}`);
      console.log(`  Object entries (valid): ${objectEntries.length}`);

      if (stringEntries.length > 0) {
        console.log('  ❌ STILL CORRUPTED! First 5 string entries:');
        stringEntries.slice(0, 5).forEach((e, i) => console.log(`    ${i + 1}. "${e}"`));
      } else {
        console.log('  ✅ Clean! All entries are objects.');
      }
    }

    console.log('\nClaire Pammenter:');
    if (claire) {
      const history = Array.isArray(claire.booking_history) ? claire.booking_history : JSON.parse(claire.booking_history);
      console.log(`  Total entries: ${history.length}`);

      const stringEntries = history.filter(e => typeof e === 'string');
      const objectEntries = history.filter(e => typeof e === 'object');

      console.log(`  String entries (corrupted): ${stringEntries.length}`);
      console.log(`  Object entries (valid): ${objectEntries.length}`);

      if (stringEntries.length > 0) {
        console.log('  ❌ STILL CORRUPTED!');
      } else {
        console.log('  ✅ Clean! All entries are objects.');
        // Check what types of entries they have
        const types = {};
        objectEntries.forEach(e => {
          const type = e.action || 'unknown';
          types[type] = (types[type] || 0) + 1;
        });
        console.log('  Entry types:');
        Object.entries(types).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
          console.log(`    ${type}: ${count}`);
        });
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
