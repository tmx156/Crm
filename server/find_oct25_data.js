const dbManager = require('./database-connection-manager');

(async () => {
  try {
    console.log('🔍 Searching for October 25th data in all date fields...\n');

    // Check all leads for Oct 25th in ANY year
    const allLeads = await dbManager.query('leads', {
      select: 'id, name, status, booked_at, created_at, date_booked, updated_at',
      limit: 10000
    });

    console.log(`📊 Total leads in database: ${allLeads.length}\n`);

    // Find Oct 25th in different fields
    const oct25InBooked = allLeads.filter(l => l.booked_at?.includes('-10-25'));
    const oct25InCreated = allLeads.filter(l => l.created_at?.includes('-10-25'));
    const oct25InDateBooked = allLeads.filter(l => l.date_booked?.includes('-10-25'));

    console.log(`Leads with booked_at on Oct 25th (any year): ${oct25InBooked.length}`);
    console.log(`Leads with created_at on Oct 25th (any year): ${oct25InCreated.length}`);
    console.log(`Leads with date_booked on Oct 25th (any year): ${oct25InDateBooked.length}`);

    if (oct25InBooked.length > 0) {
      console.log('\n📅 Bookings MADE on Oct 25th (booked_at):');
      const statusCount = {};
      oct25InBooked.forEach(l => {
        const status = l.status || 'Unknown';
        statusCount[status] = (statusCount[status] || 0) + 1;
      });
      Object.entries(statusCount).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });

      console.log('\nSample (first 5):');
      oct25InBooked.slice(0, 5).forEach(l => {
        console.log(`  - ${l.name} (${l.status}) - booked_at: ${l.booked_at}`);
      });
    }

    if (oct25InDateBooked.length > 0) {
      console.log('\n📅 Appointments SCHEDULED for Oct 25th (date_booked):');
      const statusCount = {};
      oct25InDateBooked.forEach(l => {
        const status = l.status || 'Unknown';
        statusCount[status] = (statusCount[status] || 0) + 1;
      });
      Object.entries(statusCount).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
