// Check all recent leads in database
const dbManager = require('./database-connection-manager');

(async () => {
  try {
    console.log('🔍 Checking all leads in database (most recent 20)...\n');

    const allLeads = await dbManager.query('leads', {
      select: 'id, name, status, created_at, updated_at, booker_id',
      order: { created_at: 'desc' },
      limit: 20
    });

    console.log(`📊 Total leads found: ${allLeads.length}\n`);

    if (allLeads.length > 0) {
      console.log('📋 Most recent 20 leads:');
      allLeads.forEach((lead, idx) => {
        const created = new Date(lead.created_at);
        const today = new Date();
        const isToday = created.toDateString() === today.toDateString();

        console.log(`${idx + 1}. ${lead.name || 'Unnamed'}`);
        console.log(`   Created: ${lead.created_at} ${isToday ? '🟢 TODAY' : ''}`);
        console.log(`   Status: ${lead.status || 'N/A'} | Booker: ${lead.booker_id || 'Unassigned'}\n`);
      });

      const todayLeads = allLeads.filter(l => {
        return new Date(l.created_at).toDateString() === new Date().toDateString();
      });

      console.log(`\n🟢 Leads created TODAY (${new Date().toDateString()}): ${todayLeads.length}`);
    } else {
      console.log('⚠️  No leads found in database');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
