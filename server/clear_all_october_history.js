const dbManager = require('./database-connection-manager');

(async () => {
  try {
    console.log('🧹 Clearing ALL October 2025 booking_history\n');
    console.log('='.repeat(60));

    const allOctLeads = await dbManager.query('leads', {
      select: 'id, name, date_booked, booking_history',
      gte: { date_booked: '2025-10-01T00:00:00.000Z' },
      lte: { date_booked: '2025-10-31T23:59:59.999Z' },
      limit: 1000
    });

    console.log(`\nFound ${allOctLeads.length} October bookings\n`);

    // Group by day
    const byDay = {};
    allOctLeads.forEach(lead => {
      const day = lead.date_booked.split('T')[0];
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(lead);
    });

    console.log('October booking distribution:');
    Object.keys(byDay).sort().forEach(day => {
      const totalHistory = byDay[day].reduce((sum, l) => {
        return sum + (l.booking_history ? JSON.stringify(l.booking_history).length : 0);
      }, 0);
      console.log(`  ${day}: ${byDay[day].length} bookings, ${(totalHistory / 1024).toFixed(2)} KB history`);
    });

    const totalHistorySize = allOctLeads.reduce((sum, l) => {
      return sum + (l.booking_history ? JSON.stringify(l.booking_history).length : 0);
    }, 0);

    console.log(`\nTotal history to clear: ${(totalHistorySize / 1024).toFixed(2)} KB`);
    console.log('\n' + '='.repeat(60));
    console.log('Starting cleanup...\n');

    let cleared = 0;
    for (const lead of allOctLeads) {
      await dbManager.update('leads', { booking_history: [] }, { id: lead.id });
      cleared++;
      if (cleared % 10 === 0) {
        console.log(`  Progress: ${cleared}/${allOctLeads.length}...`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ COMPLETE');
    console.log('='.repeat(60));
    console.log(`\nCleared: ${cleared}/${allOctLeads.length} leads`);
    console.log(`Data freed: ${(totalHistorySize / 1024).toFixed(2)} KB`);
    console.log('\n🚀 ALL October dates should now load instantly!\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
