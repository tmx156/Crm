const dbManager = require('./database-connection-manager');

(async () => {
  try {
    console.log('🧹 Clearing booking_history for October 26th\n');

    const leads = await dbManager.query('leads', {
      select: 'id, name, date_booked, booking_history',
      gte: { date_booked: '2025-10-26T00:00:00.000Z' },
      lte: { date_booked: '2025-10-26T23:59:59.999Z' },
      limit: 1000
    });

    console.log(`Found ${leads.length} leads\n`);

    for (const lead of leads) {
      const historySize = lead.booking_history ? JSON.stringify(lead.booking_history).length : 0;
      const time = new Date(lead.date_booked).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

      await dbManager.update('leads', { booking_history: [] }, { id: lead.id });
      console.log(`  ✅ ${time} ${lead.name}: Cleared ${(historySize / 1024).toFixed(2)} KB`);
    }

    console.log(`\n✅ Done! Oct 26 should load instantly now.\n`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
