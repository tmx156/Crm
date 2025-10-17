const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

async function reset87LeadsToNew() {
  const supabase = createClient(config.supabase.url, config.supabase.anonKey);

  try {
    // Read the unbooked leads report to get the exact leads
    const reportPath = path.join(__dirname, '..', '.claude', 'unbooked_leads_assignments.json');
    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

    // Filter to get ONLY the 87 leads with status "Assigned" (exclude Cancelled and Attended)
    const leadsToReset = reportData.allLeads.filter(lead => lead.status === 'Assigned');

    console.log('\n=== RESETTING 87 LEADS FROM ASSIGNED TO NEW STATUS ===\n');
    console.log(`Total leads identified for reset: ${leadsToReset.length}\n`);

    if (leadsToReset.length !== 87) {
      console.error(`ERROR: Expected 87 leads but found ${leadsToReset.length}. Aborting for safety.`);
      return;
    }

    // Show preview of what will be changed
    console.log('='.repeat(80));
    console.log('PREVIEW - These leads will be reset to "New" status:');
    console.log('='.repeat(80));
    leadsToReset.forEach((lead, idx) => {
      console.log(`${idx + 1}. ${lead.name} (${lead.phone}) - ID: ${lead.leadId}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('CONFIRMATION REQUIRED');
    console.log('='.repeat(80));
    console.log('This will change the status of these 87 leads from "Assigned" to "New".');
    console.log('The leads will then appear in the New Leads folder.');
    console.log('\nType "YES" to proceed or anything else to cancel:');

    // Wait for user confirmation
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question('> ', async (answer) => {
      readline.close();

      if (answer.trim().toUpperCase() !== 'YES') {
        console.log('\n❌ Operation cancelled by user.');
        return;
      }

      console.log('\n✅ Confirmation received. Starting reset...\n');

      // Extract just the IDs
      const leadIds = leadsToReset.map(lead => lead.leadId);

      // Update the leads in batches
      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      console.log('Processing updates...\n');

      for (let i = 0; i < leadIds.length; i++) {
        const leadId = leadIds[i];
        const lead = leadsToReset[i];

        try {
          const { data, error } = await supabase
            .from('leads')
            .update({
              status: 'New',
              assigned_by: null,
              assigned_at: null
            })
            .eq('id', leadId)
            .eq('status', 'Assigned'); // Double-check it's still "Assigned"

          if (error) {
            errorCount++;
            errors.push({ lead: lead.name, error: error.message });
            console.log(`❌ ${i + 1}/${leadIds.length} - Failed: ${lead.name} - ${error.message}`);
          } else {
            successCount++;
            console.log(`✅ ${i + 1}/${leadIds.length} - Reset: ${lead.name}`);
          }
        } catch (err) {
          errorCount++;
          errors.push({ lead: lead.name, error: err.message });
          console.log(`❌ ${i + 1}/${leadIds.length} - Failed: ${lead.name} - ${err.message}`);
        }
      }

      // Summary
      console.log('\n\n' + '='.repeat(80));
      console.log('RESET COMPLETE');
      console.log('='.repeat(80));
      console.log(`✅ Successfully reset: ${successCount} leads`);
      console.log(`❌ Failed: ${errorCount} leads`);

      if (errors.length > 0) {
        console.log('\nErrors encountered:');
        errors.forEach(err => {
          console.log(`  - ${err.lead}: ${err.error}`);
        });
      }

      // Save results
      const results = {
        timestamp: new Date().toISOString(),
        totalAttempted: leadIds.length,
        successCount,
        errorCount,
        errors,
        resetLeads: leadsToReset
      };

      const outputPath = path.join(__dirname, '..', '.claude', 'reset_leads_results.json');
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
      console.log(`\nResults saved to: ${outputPath}`);

      console.log('\n✅ These leads should now appear in the "New Leads" folder in your CRM!');
    });

  } catch (error) {
    console.error('Error:', error);
  }
}

reset87LeadsToNew();
