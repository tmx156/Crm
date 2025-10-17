const dbManager = require('./database-connection-manager');

(async () => {
  try {
    console.log('Fetching leads...\n');

    const leads = await dbManager.query('leads', {
      select: 'id, name, status, booked_at, date_booked, assigned_at, booker_id, has_sale',
      limit: 200
    });

    console.log('=== TOTAL LEADS SAMPLED:', leads.length, '===\n');

    // Group by status
    const statusCounts = {};
    leads.forEach(lead => {
      const status = lead.status || 'Unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    console.log('=== LEADS BY STATUS ===');
    Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`  ${status}: ${count} leads`);
      });

    // Count bookings different ways
    const byStatusBooked = leads.filter(l => l.status === 'Booked').length;
    const byBookedAt = leads.filter(l => l.booked_at !== null).length;
    const byDateBooked = leads.filter(l => l.date_booked !== null).length;

    console.log('\n=== BOOKING COUNT COMPARISON ===');
    console.log(`  Leads with status = "Booked": ${byStatusBooked}`);
    console.log(`  Leads with booked_at timestamp: ${byBookedAt}`);
    console.log(`  Leads with date_booked: ${byDateBooked}`);

    const difference = byBookedAt - byStatusBooked;
    console.log(`\n  ⚠️  DIFFERENCE: ${difference} bookings would be MISSED`);
    console.log(`      if we only count status="Booked"!`);

    // Show examples
    console.log('\n=== EXAMPLES: Leads with booked_at BUT status != "Booked" ===');
    const examples = leads.filter(l => l.booked_at && l.status !== 'Booked').slice(0, 10);

    examples.forEach(lead => {
      console.log(`  ${lead.id.substring(0, 8)}... | Status: ${lead.status.padEnd(15)} | booked_at: ${lead.booked_at ? 'YES' : 'NO'} | has_sale: ${lead.has_sale}`);
    });

    console.log('\n=== STATUS PROGRESSION ANALYSIS ===');
    const progressedLeads = leads.filter(l => l.booked_at && l.status !== 'Booked');
    const progressionCounts = {};
    progressedLeads.forEach(l => {
      progressionCounts[l.status] = (progressionCounts[l.status] || 0) + 1;
    });

    console.log('Leads that were booked (have booked_at) but moved to other status:');
    Object.entries(progressionCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
