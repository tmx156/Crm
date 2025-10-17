const dbManager = require('./database-connection-manager');

(async () => {
  try {
    console.log('🔍 Comparing Fast vs Slow Loading Leads on Oct 25th\n');
    console.log('='.repeat(60));

    // Get all Oct 25 leads
    const oct25Leads = await dbManager.query('leads', {
      select: 'id, name, date_booked, booking_history, image_url, notes, status, is_confirmed, booking_status, has_sale, phone, email, postcode, age, created_at, updated_at, booker_id',
      gte: { date_booked: '2025-10-25T00:00:00.000Z' },
      lte: { date_booked: '2025-10-25T23:59:59.999Z' },
      limit: 1000
    });

    console.log(`📊 Total leads on Oct 25: ${oct25Leads.length}\n`);

    // The 3 that load fast
    const fastLeads = ['Amy blundell', 'Misti', 'Stewart Carlton'];

    console.log('⚡ FAST LOADING LEADS (First 3 shown):');
    oct25Leads
      .filter(l => fastLeads.includes(l.name))
      .forEach(lead => {
        console.log(`\n  ${lead.name}:`);
        console.log(`    Time: ${new Date(lead.date_booked).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
        console.log(`    Image URL: ${lead.image_url ? (lead.image_url.substring(0, 50) + '...') : 'NONE'}`);
        console.log(`    Image size: ${lead.image_url?.length || 0} chars`);
        console.log(`    Notes: ${lead.notes ? (lead.notes.length + ' chars') : 'NONE'}`);
        console.log(`    Status: ${lead.status}`);
        console.log(`    Confirmed: ${lead.is_confirmed}`);
        console.log(`    Booking status: ${lead.booking_status || 'NONE'}`);
        console.log(`    Has sale: ${lead.has_sale || false}`);
        console.log(`    Total data size: ${JSON.stringify(lead).length} bytes`);
      });

    console.log('\n\n🐌 SLOW LOADING LEADS (Sample of others):');
    const slowLeads = oct25Leads
      .filter(l => !fastLeads.includes(l.name))
      .slice(0, 5);

    slowLeads.forEach(lead => {
      console.log(`\n  ${lead.name}:`);
      console.log(`    Time: ${new Date(lead.date_booked).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
      console.log(`    Image URL: ${lead.image_url ? (lead.image_url.substring(0, 50) + '...') : 'NONE'}`);
      console.log(`    Image size: ${lead.image_url?.length || 0} chars`);
      console.log(`    Notes: ${lead.notes ? (lead.notes.length + ' chars') : 'NONE'}`);
      console.log(`    Status: ${lead.status}`);
      console.log(`    Confirmed: ${lead.is_confirmed}`);
      console.log(`    Booking status: ${lead.booking_status || 'NONE'}`);
      console.log(`    Has sale: ${lead.has_sale || false}`);
      console.log(`    Total data size: ${JSON.stringify(lead).length} bytes`);
    });

    // Compare averages
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 COMPARISON');
    console.log('='.repeat(60));

    const fast = oct25Leads.filter(l => fastLeads.includes(l.name));
    const slow = oct25Leads.filter(l => !fastLeads.includes(l.name));

    const avgFastSize = fast.reduce((sum, l) => sum + JSON.stringify(l).length, 0) / fast.length;
    const avgSlowSize = slow.reduce((sum, l) => sum + JSON.stringify(l).length, 0) / slow.length;

    console.log(`\nFast leads (${fast.length}):`);
    console.log(`  Average data size: ${avgFastSize.toFixed(0)} bytes`);
    console.log(`  Average image URL: ${(fast.reduce((sum, l) => sum + (l.image_url?.length || 0), 0) / fast.length).toFixed(0)} chars`);
    console.log(`  Average notes: ${(fast.reduce((sum, l) => sum + (l.notes?.length || 0), 0) / fast.length).toFixed(0)} chars`);

    console.log(`\nSlow leads (${slow.length}):`);
    console.log(`  Average data size: ${avgSlowSize.toFixed(0)} bytes`);
    console.log(`  Average image URL: ${(slow.reduce((sum, l) => sum + (l.image_url?.length || 0), 0) / slow.length).toFixed(0)} chars`);
    console.log(`  Average notes: ${(slow.reduce((sum, l) => sum + (l.notes?.length || 0), 0) / slow.length).toFixed(0)} chars`);

    // Check if it's a rendering order issue
    console.log('\n\n⏰ LOADING ORDER (by time slot):');
    oct25Leads
      .sort((a, b) => new Date(a.date_booked) - new Date(b.date_booked))
      .forEach((lead, i) => {
        const time = new Date(lead.date_booked).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const isFast = fastLeads.includes(lead.name);
        console.log(`  ${i + 1}. ${time} - ${lead.name} ${isFast ? '⚡ FAST' : '🐌 SLOW'}`);
      });

    // Check calendar API response time simulation
    console.log('\n\n' + '='.repeat(60));
    console.log('💡 HYPOTHESIS:');
    console.log('='.repeat(60));

    if (fast.length === 3 && fast[0].date_booked < slow[0]?.date_booked) {
      console.log('The fast leads are the FIRST 3 chronologically!');
      console.log('This suggests the calendar is loading events SEQUENTIALLY,');
      console.log('and something is blocking/delaying the rest.');
    }

    console.log('\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
