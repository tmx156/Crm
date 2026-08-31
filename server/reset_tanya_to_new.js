const dbManager = require('./database-connection-manager');
const fs = require('fs');
const path = require('path');

/**
 * Reset all Tanya CSV leads to 'New' status
 */

async function resetTanyaToNew() {
  console.log('🔄 Resetting all Tanya leads to "New" status...\n');

  try {
    // Read the CSV to get phone numbers
    const csvPath = path.join('.claude', 'tanya - Sheet1.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.split('\n').slice(1); // Skip header

    const phoneNumbers = [];
    lines.forEach(line => {
      if (line.trim()) {
        const parts = line.split(',');
        const phone = parts[3]; // Phone is the 4th column
        if (phone && phone.trim()) {
          phoneNumbers.push(phone.trim());
        }
      }
    });

    console.log(`Found ${phoneNumbers.length} phone numbers from Tanya CSV\n`);

    const results = {
      total: phoneNumbers.length,
      updated: [],
      failed: [],
      skipped: [],
      notFound: []
    };

    console.log('📋 Resetting Tanya leads to "New" status:');
    console.log('─'.repeat(80));

    for (const phone of phoneNumbers) {
      try {
        // Find the lead by phone
        const cleanPhone = phone.replace(/\D/g, '');
        const leads = await dbManager.query('leads', {
          select: '*',
          ilike: { phone: `%${cleanPhone}%` },
          limit: 1
        });

        if (!leads || leads.length === 0) {
          console.log(`❓ Not found in DB: ${phone}`);
          results.notFound.push(phone);
          continue;
        }

        const lead = leads[0];

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
        console.error(`❌ Error updating phone ${phone}:`, error.message);
        results.failed.push({
          phone: phone,
          reason: error.message
        });
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('📊 UPDATE SUMMARY');
    console.log('═'.repeat(80));
    console.log(`Total Tanya leads: ${results.total}`);
    console.log(`Successfully updated: ${results.updated.length}`);
    console.log(`Skipped (already New): ${results.skipped.length}`);
    console.log(`Not found in DB: ${results.notFound.length}`);
    console.log(`Failed: ${results.failed.length}`);

    if (results.failed.length > 0) {
      console.log('\n❌ Failed updates:');
      results.failed.forEach(fail => {
        console.log(`  - ${fail.name || fail.phone}: ${fail.reason}`);
      });
    }

    // Save results
    const resultsPath = path.join('.claude', 'reset_tanya_results.json');
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
  resetTanyaToNew()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error);
      process.exit(1);
    });
}

module.exports = { resetTanyaToNew };
