const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

async function clearBookerAssignments() {
  const supabase = createClient(config.supabase.url, config.supabase.anonKey);

  try {
    // Get all 100 leads (87 + 13) from the CSV
    const resetResultsPath = path.join(__dirname, '..', '.claude', 'reset_leads_results.json');
    const importResultsPath = path.join(__dirname, '..', '.claude', 'import_13_leads_results.json');

    const resetData = JSON.parse(fs.readFileSync(resetResultsPath, 'utf-8'));
    const importData = JSON.parse(fs.readFileSync(importResultsPath, 'utf-8'));

    const resetLeadIds = resetData.resetLeads.map(lead => lead.leadId);
    const importLeadIds = importData.importedLeads.map(lead => lead.id);

    const allLeadIds = [...resetLeadIds, ...importLeadIds];

    console.log('\n=== CLEARING BOOKER ASSIGNMENTS FROM 100 LEADS ===\n');
    console.log(`Total leads to process: ${allLeadIds.length}\n`);

    // Fetch all leads with their booker information
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, name, phone, booker_id')
      .in('id', allLeadIds);

    if (leadsError) {
      console.error('Error fetching leads:', leadsError);
      return;
    }

    const leadsWithBookers = leads.filter(l => l.booker_id);

    console.log(`Found ${leads.length} leads in database`);
    console.log(`Leads with bookers: ${leadsWithBookers.length}`);
    console.log(`Leads without bookers: ${leads.length - leadsWithBookers.length}\n`);

    if (leadsWithBookers.length === 0) {
      console.log('✅ No bookers assigned to any leads. Nothing to clear!');
      return;
    }

    // Show preview
    console.log('='.repeat(80));
    console.log('PREVIEW - These leads will have booker_id cleared:');
    console.log('='.repeat(80));
    leadsWithBookers.slice(0, 10).forEach((lead, idx) => {
      console.log(`${idx + 1}. ${lead.name} (${lead.phone})`);
    });
    if (leadsWithBookers.length > 10) {
      console.log(`... and ${leadsWithBookers.length - 10} more`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('CONFIRMATION REQUIRED');
    console.log('='.repeat(80));
    console.log(`This will clear booker_id from ${leadsWithBookers.length} leads.`);
    console.log('The leads will become truly unassigned.');
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

      console.log('\n✅ Confirmation received. Starting to clear booker assignments...\n');

      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      console.log('Processing updates...\n');

      for (let i = 0; i < leadsWithBookers.length; i++) {
        const lead = leadsWithBookers[i];

        try {
          const { data, error } = await supabase
            .from('leads')
            .update({
              booker_id: null
            })
            .eq('id', lead.id);

          if (error) {
            errorCount++;
            errors.push({ lead: lead.name, error: error.message });
            console.log(`❌ ${i + 1}/${leadsWithBookers.length} - Failed: ${lead.name} - ${error.message}`);
          } else {
            successCount++;
            console.log(`✅ ${i + 1}/${leadsWithBookers.length} - Cleared booker: ${lead.name}`);
          }
        } catch (err) {
          errorCount++;
          errors.push({ lead: lead.name, error: err.message });
          console.log(`❌ ${i + 1}/${leadsWithBookers.length} - Failed: ${lead.name} - ${err.message}`);
        }
      }

      // Summary
      console.log('\n\n' + '='.repeat(80));
      console.log('CLEAR BOOKER ASSIGNMENTS COMPLETE');
      console.log('='.repeat(80));
      console.log(`✅ Successfully cleared: ${successCount} leads`);
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
        totalAttempted: leadsWithBookers.length,
        successCount,
        errorCount,
        errors,
        clearedLeads: leadsWithBookers
      };

      const outputPath = path.join(__dirname, '..', '.claude', 'clear_bookers_results.json');
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
      console.log(`\nResults saved to: ${outputPath}`);

      console.log('\n✅ All leads are now truly unassigned and ready for reassignment!');
    });

  } catch (error) {
    console.error('Error:', error);
  }
}

clearBookerAssignments();
