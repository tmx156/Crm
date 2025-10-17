const dbManager = require('./database-connection-manager');

(async () => {
  try {
    console.log('🔍 Comparing Oct 25th vs Other Days in October...\n');
    console.log('='.repeat(60));

    // Get all October 2025 leads
    const allLeads = await dbManager.query('leads', {
      select: 'id, name, booking_history, date_booked',
      gte: { date_booked: '2025-10-01T00:00:00.000Z' },
      lte: { date_booked: '2025-10-31T23:59:59.999Z' },
      limit: 1000
    });

    console.log(`📊 Total October leads: ${allLeads.length}\n`);

    // Group by day
    const dayStats = {};

    allLeads.forEach(lead => {
      if (!lead.date_booked) return;

      const date = lead.date_booked.split('T')[0];
      const day = parseInt(date.split('-')[2]);

      if (!dayStats[day]) {
        dayStats[day] = {
          count: 0,
          totalHistorySize: 0,
          totalHistoryEntries: 0,
          maxHistorySize: 0,
          maxHistoryLead: null,
          leads: []
        };
      }

      const history = lead.booking_history || [];
      const historyStr = typeof history === 'string' ? history : JSON.stringify(history);
      const historySize = historyStr.length;
      const historyCount = Array.isArray(history) ? history.length : (typeof history === 'string' ? JSON.parse(history).length : 0);

      dayStats[day].count++;
      dayStats[day].totalHistorySize += historySize;
      dayStats[day].totalHistoryEntries += historyCount;
      dayStats[day].leads.push({ name: lead.name, historySize, historyCount });

      if (historySize > dayStats[day].maxHistorySize) {
        dayStats[day].maxHistorySize = historySize;
        dayStats[day].maxHistoryLead = lead.name;
      }
    });

    // Show stats for days with bookings
    console.log('📅 October Daily Statistics:\n');
    console.log('Day | Bookings | History Size | Avg/Lead | Max Entry | Largest Lead');
    console.log('-'.repeat(80));

    Object.keys(dayStats)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach(day => {
        const stats = dayStats[day];
        const avgSize = (stats.totalHistorySize / stats.count / 1024).toFixed(2);
        const totalSize = (stats.totalHistorySize / 1024).toFixed(2);
        const maxSize = (stats.maxHistorySize / 1024).toFixed(2);

        const isOct25 = day === 25;
        const marker = isOct25 ? ' ← OCT 25' : '';

        console.log(
          `${day.toString().padStart(2)} | ` +
          `${stats.count.toString().padStart(8)} | ` +
          `${totalSize.toString().padStart(12)} KB | ` +
          `${avgSize.toString().padStart(8)} KB | ` +
          `${maxSize.toString().padStart(9)} KB | ` +
          `${stats.maxHistoryLead}${marker}`
        );
      });

    // Highlight Oct 25th
    if (dayStats[25]) {
      console.log('\n' + '='.repeat(60));
      console.log('🔍 OCTOBER 25TH DEEP DIVE');
      console.log('='.repeat(60));

      const oct25 = dayStats[25];

      console.log(`\n📊 Statistics:`);
      console.log(`   Bookings: ${oct25.count}`);
      console.log(`   Total history size: ${(oct25.totalHistorySize / 1024).toFixed(2)} KB`);
      console.log(`   Total history entries: ${oct25.totalHistoryEntries}`);
      console.log(`   Average per lead: ${(oct25.totalHistorySize / oct25.count / 1024).toFixed(2)} KB`);
      console.log(`   Average entries per lead: ${Math.round(oct25.totalHistoryEntries / oct25.count)}`);

      console.log(`\n📋 Top 5 Heaviest Leads on Oct 25:`);
      oct25.leads
        .sort((a, b) => b.historySize - a.historySize)
        .slice(0, 5)
        .forEach((lead, i) => {
          console.log(`   ${i + 1}. ${lead.name}`);
          console.log(`      Size: ${(lead.historySize / 1024).toFixed(2)} KB`);
          console.log(`      Entries: ${lead.historyCount}`);
        });

      // Compare to average day
      const otherDays = Object.keys(dayStats).filter(d => d != 25).map(Number);
      const avgDaySize = otherDays.reduce((sum, day) => sum + dayStats[day].totalHistorySize, 0) / otherDays.length;
      const avgDayCount = otherDays.reduce((sum, day) => sum + dayStats[day].count, 0) / otherDays.length;

      console.log(`\n📊 Comparison to Average Day:`);
      console.log(`   Oct 25 bookings: ${oct25.count} vs avg ${avgDayCount.toFixed(1)}`);
      console.log(`   Oct 25 history: ${(oct25.totalHistorySize / 1024).toFixed(2)} KB vs avg ${(avgDaySize / 1024).toFixed(2)} KB`);

      const percentMore = ((oct25.totalHistorySize / avgDaySize - 1) * 100).toFixed(0);
      if (percentMore > 0) {
        console.log(`   Oct 25 is ${percentMore}% HEAVIER than average day!`);
      }

      // Check for specific issues
      console.log(`\n🔎 Potential Issues:`);

      const hasVeryLargeHistory = oct25.leads.some(l => l.historySize > 20000);
      if (hasVeryLargeHistory) {
        console.log(`   ❌ One or more leads have >20KB history`);
      }

      const hasManyEntries = oct25.leads.some(l => l.historyCount > 500);
      if (hasManyEntries) {
        console.log(`   ❌ One or more leads have >500 history entries`);
      }

      if (oct25.count > 20) {
        console.log(`   ⚠️  High number of bookings on this day (${oct25.count})`);
      }

      if (oct25.totalHistorySize > 200000) {
        console.log(`   ❌ Total history size exceeds 200KB (${(oct25.totalHistorySize / 1024).toFixed(2)} KB)`);
      }
    }

    console.log('\n' + '='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
