const dbManager = require('./database-connection-manager');
const fs = require('fs');
const path = require('path');

/**
 * Reset status of never-booked Jax leads back to 'New'
 * Leaves booked leads alone
 */

async function resetNeverBookedToNew() {
  console.log('🔄 Resetting never-booked Jax leads to "New" status...\n');

  try {
    // Read the report to get the list of leads
    const reportPath = path.join('.claude', 'csv_leads_check_report.json');
    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

    // Filter for never-booked floating leads (not currently booked and never been booked)
    const neverBookedLeads = reportData.floating.filter(lead => !lead.dbData.everBooked);

    console.log(`Found ${neverBookedLeads.length} leads that have never been booked\n`);

    if (neverBookedLeads.length === 0) {
      console.log('✅ No leads to update!');
      return;
    }

    const results = {
      total: neverBookedLeads.length,
      updated: [],
      failed: [],
      skipped: []
    };

    console.log('📋 Leads to be reset to "New" status:');
    console.log('─'.repeat(80));

    for (const leadInfo of neverBookedLeads) {
      const lead = leadInfo.dbData;

      // Skip if already 'New'
      if (lead.status === 'New') {
        console.log(`⏭️  Skipped (already New): ${lead.name} (${lead.phone})`);
        results.skipped.push({
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          currentStatus: lead.status
        });
        continue;
      }

      try {
        // Update status to 'New'
        const updated = await dbManager.update(
          'leads',
          {
            status: 'New',
            updated_at: new Date().toISOString()
          },
          { id: lead.id }
        );

        if (updated && updated.length > 0) {
          console.log(`✅ Updated: ${lead.name} (${lead.phone}) - ${lead.status} → New`);
          results.updated.push({
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            oldStatus: lead.status,
            newStatus: 'New'
          });
        } else {
          console.log(`❌ Failed: ${lead.name} (${lead.phone}) - No rows updated`);
          results.failed.push({
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            reason: 'No rows updated'
          });
        }

      } catch (error) {
        console.error(`❌ Error updating ${lead.name}:`, error.message);
        results.failed.push({
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          reason: error.message
        });
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('📊 UPDATE SUMMARY');
    console.log('═'.repeat(80));
    console.log(`Total never-booked leads: ${results.total}`);
    console.log(`Successfully updated: ${results.updated.length}`);
    console.log(`Skipped (already New): ${results.skipped.length}`);
    console.log(`Failed: ${results.failed.length}`);

    if (results.failed.length > 0) {
      console.log('\n❌ Failed updates:');
      results.failed.forEach(fail => {
        console.log(`  - ${fail.name} (${fail.phone}): ${fail.reason}`);
      });
    }

    // Save results
    const resultsPath = path.join('.claude', 'reset_jax_never_booked_results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to: ${resultsPath}`);

    console.log('\n✅ Reset complete!');
    return results;

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    throw error;
  }
}

// Run the reset
if (require.main === module) {
  resetNeverBookedToNew()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error);
      process.exit(1);
    });
}

module.exports = { resetNeverBookedToNew };
