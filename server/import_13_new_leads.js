const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const config = require('./config');

async function import13NewLeads() {
  const supabase = createClient(config.supabase.url, config.supabase.anonKey);

  try {
    // The 13 new leads data from CSV
    const newLeads = [
      {
        name: "Diane mcgranaghan",
        age: 42,
        email: "Dianemc171@gmail.com",
        phone: "7783301985",
        postcode: "Bt82 8pu",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8475.jpeg",
        parent_phone: ""
      },
      {
        name: "Femi Taylor",
        age: 43,
        email: "femiclaire@mac.com",
        phone: "7940543031",
        postcode: "IV327HP",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8499.jpeg",
        parent_phone: ""
      },
      {
        name: "Maria Fuentes",
        age: 36,
        email: "mariafuentes8@hotmail.com",
        phone: "7900800427",
        postcode: "Bt205QN",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8500.jpeg",
        parent_phone: ""
      },
      {
        name: "Siobhan Robb",
        age: 46,
        email: "Siobhanrobb7007@gmail.com",
        phone: "7359631785",
        postcode: "Bt414jw",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8502.jpeg",
        parent_phone: ""
      },
      {
        name: "Richard Edwards",
        age: 62,
        email: "ededs0077@live.co.uk",
        phone: "7703722122",
        postcode: "PL2 3QJ",
        image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/inbound3717942970737084957.jpg",
        parent_phone: ""
      },
      {
        name: "Dennise Sweeny",
        age: 63,
        email: "denise.sweeney5@btinternet.com",
        phone: "7956900884",
        postcode: "Ab123we",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8544.jpeg",
        parent_phone: ""
      },
      {
        name: "Ruth Foster",
        age: 66,
        email: "Flowergardenflorists@gmail.com",
        phone: "7494775753",
        postcode: "TS122er",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8548.jpeg",
        parent_phone: ""
      },
      {
        name: "Emma Williamson",
        age: 52,
        email: "Ladymissemma@gmail.com",
        phone: "7887933639",
        postcode: "DD24HL",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8551.jpeg",
        parent_phone: ""
      },
      {
        name: "Samantha Miller",
        age: 62,
        email: "sam.s.miller@btopenworld.com",
        phone: "7715993456",
        postcode: "Dd51lx",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8572.jpeg",
        parent_phone: ""
      },
      {
        name: "Debbie",
        age: 53,
        email: "debrastephen07@aol.com",
        phone: "7719875340",
        postcode: "Ab422ut",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8574.jpeg",
        parent_phone: ""
      },
      {
        name: "Paul Hunter",
        age: 67,
        email: "Paul.Hunter59.ph@gmail.com",
        phone: "7708244157",
        postcode: "G830AD",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8575.jpeg",
        parent_phone: ""
      },
      {
        name: "Valerie",
        age: 58,
        email: "Vallewis31@icloud.com",
        phone: "7709686649",
        postcode: "Cw113je",
        image_url: "https://matchmodels.co.uk/wp-content/uploads/gravity_forms/19-3e8969fea69a89cf99ccdf98b2669697/2025/10/IMG_8576.jpeg",
        parent_phone: ""
      },
      {
        name: "Susan Anne Gough",
        age: 58,
        email: "suegough1@gmail.com",
        phone: "7713982838",
        postcode: "SK2 5DB",
        image_url: "https://modelhunt.co.uk/wp-content/uploads/gravity_forms/22-9f92bc9dde920de6e53428008f0deb33/2025/10/inbound3449152831762215327.jpg",
        parent_phone: ""
      }
    ];

    console.log('\n=== IMPORTING 13 NEW LEADS TO CRM ===\n');
    console.log(`Total leads to import: ${newLeads.length}\n`);

    // Show preview
    console.log('='.repeat(80));
    console.log('PREVIEW - These leads will be imported:');
    console.log('='.repeat(80));
    newLeads.forEach((lead, idx) => {
      console.log(`${idx + 1}. ${lead.name} (${lead.phone}) - ${lead.email}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('CONFIRMATION REQUIRED');
    console.log('='.repeat(80));
    console.log('This will import these 13 leads as NEW leads in your CRM.');
    console.log('They will appear in the "New Leads" folder.');
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

      console.log('\n✅ Confirmation received. Starting import...\n');

      let successCount = 0;
      let errorCount = 0;
      const errors = [];
      const importedLeads = [];

      for (let i = 0; i < newLeads.length; i++) {
        const leadData = newLeads[i];

        try {
          // Check for duplicates by phone
          const { data: phoneDuplicates, error: phoneError } = await supabase
            .from('leads')
            .select('id, name, phone')
            .eq('phone', leadData.phone)
            .is('deleted_at', null);

          if (phoneError) {
            throw new Error(`Error checking phone duplicate: ${phoneError.message}`);
          }

          if (phoneDuplicates && phoneDuplicates.length > 0) {
            errorCount++;
            const errMsg = `Duplicate phone found: ${leadData.name} (${leadData.phone})`;
            errors.push(errMsg);
            console.log(`⚠️ ${i + 1}/${newLeads.length} - Skipped: ${errMsg}`);
            continue;
          }

          // Prepare lead data
          const leadToInsert = {
            id: uuidv4(),
            name: leadData.name,
            phone: leadData.phone,
            email: leadData.email,
            postcode: leadData.postcode,
            image_url: leadData.image_url,
            parent_phone: leadData.parent_phone || null,
            age: leadData.age,
            booker_id: null,
            status: 'New',
            date_booked: null,
            is_confirmed: 0,
            booking_status: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          // Insert the lead
          const { data, error } = await supabase
            .from('leads')
            .insert([leadToInsert])
            .select();

          if (error) {
            errorCount++;
            errors.push({ lead: leadData.name, error: error.message });
            console.log(`❌ ${i + 1}/${newLeads.length} - Failed: ${leadData.name} - ${error.message}`);
          } else {
            successCount++;
            importedLeads.push(leadToInsert);
            console.log(`✅ ${i + 1}/${newLeads.length} - Imported: ${leadData.name} (${leadData.phone})`);
          }
        } catch (err) {
          errorCount++;
          errors.push({ lead: leadData.name, error: err.message });
          console.log(`❌ ${i + 1}/${newLeads.length} - Failed: ${leadData.name} - ${err.message}`);
        }
      }

      // Summary
      console.log('\n\n' + '='.repeat(80));
      console.log('IMPORT COMPLETE');
      console.log('='.repeat(80));
      console.log(`✅ Successfully imported: ${successCount} leads`);
      console.log(`❌ Failed/Skipped: ${errorCount} leads`);

      if (errors.length > 0) {
        console.log('\nErrors/Warnings:');
        errors.forEach(err => {
          if (typeof err === 'string') {
            console.log(`  - ${err}`);
          } else {
            console.log(`  - ${err.lead}: ${err.error}`);
          }
        });
      }

      // Save results
      const results = {
        timestamp: new Date().toISOString(),
        totalAttempted: newLeads.length,
        successCount,
        errorCount,
        errors,
        importedLeads
      };

      const outputPath = path.join(__dirname, '..', '.claude', 'import_13_leads_results.json');
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
      console.log(`\nResults saved to: ${outputPath}`);

      console.log('\n✅ These leads should now appear in the "New Leads" folder in your CRM!');
    });

  } catch (error) {
    console.error('Error:', error);
  }
}

import13NewLeads();
