const dbManager = require('./database-connection-manager');

(async () => {
  try {
    console.log('🔍 Measuring eventContent rendering impact...\n');
    console.log('='.repeat(60));

    // Get Oct 25th leads
    const allLeads = await dbManager.query('leads', {
      select: 'id, name, booking_history, date_booked',
      limit: 10000
    });

    const oct25Leads = allLeads.filter(l => l.date_booked && l.date_booked.includes('2025-10-25'));

    console.log(`📅 Oct 25th has ${oct25Leads.length} bookings\n`);

    // Simulate the eventContent function for each booking
    let totalProcessingTime = 0;
    let totalHistoryEntriesProcessed = 0;
    let totalSmsFiltered = 0;

    console.log('⏱️  Simulating eventContent function for each booking...\n');

    oct25Leads.forEach((lead, index) => {
      const start = Date.now();

      // This is what happens in eventContent (lines 1833-1867)
      const raw = lead.booking_history || [];
      let history = [];

      try {
        if (Array.isArray(raw)) {
          history = raw;
        } else if (typeof raw === 'string') {
          history = raw.trim() ? JSON.parse(raw) : [];
        }
      } catch (e) {
        // Parse error
      }

      totalHistoryEntriesProcessed += history.length;

      // Filter SMS messages
      const smsMessages = (Array.isArray(history) ? history : [])
        .filter(h => ['SMS_SENT', 'SMS_RECEIVED'].includes(h.action))
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

      totalSmsFiltered += smsMessages.length;

      // Check reply status
      if (smsMessages.length > 0) {
        const mostRecentSms = smsMessages[0];
        const needsReply = mostRecentSms.action === 'SMS_RECEIVED' &&
          (!mostRecentSms.details || mostRecentSms.details.replied !== true);
      }

      const processingTime = Date.now() - start;
      totalProcessingTime += processingTime;

      if (index < 5 || processingTime > 10) {
        console.log(`  ${index + 1}. ${lead.name}`);
        console.log(`     History entries: ${history.length}`);
        console.log(`     SMS messages: ${smsMessages.length}`);
        console.log(`     Processing time: ${processingTime}ms`);
        if (processingTime > 10) {
          console.log(`     ⚠️  SLOW! >10ms per event`);
        }
      }
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 RENDERING IMPACT SUMMARY');
    console.log('='.repeat(60));

    console.log(`\n  Total bookings on Oct 25: ${oct25Leads.length}`);
    console.log(`  Total history entries processed: ${totalHistoryEntriesProcessed}`);
    console.log(`  Total SMS messages filtered: ${totalSmsFiltered}`);
    console.log(`  Total processing time: ${totalProcessingTime}ms`);
    console.log(`  Average per event: ${(totalProcessingTime / oct25Leads.length).toFixed(2)}ms`);

    // Estimate full calendar render impact
    const estimatedRenderCycles = 5; // Calendar typically renders multiple times
    const totalEstimatedTime = totalProcessingTime * estimatedRenderCycles;

    console.log(`\n  Estimated total render time (${estimatedRenderCycles}x renders): ${totalEstimatedTime}ms`);

    if (totalEstimatedTime > 1000) {
      console.log(`\n❌ CRITICAL: eventContent processing adds ${totalEstimatedTime}ms to calendar!`);
    } else if (totalEstimatedTime > 500) {
      console.log(`\n⚠️  WARNING: eventContent processing adds ${totalEstimatedTime}ms to calendar!`);
    } else {
      console.log(`\n✅ eventContent processing time is acceptable (${totalEstimatedTime}ms)`);
    }

    console.log(`\n💡 OPTIMIZATION SUGGESTION:`);
    console.log(`   Pre-calculate SMS status when fetching leads, don't do it in eventContent.`);
    console.log(`   This would reduce processing from ${totalEstimatedTime}ms to near-zero.`);

    console.log('\n' + '='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
