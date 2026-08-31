const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

// Simple CSV parser
function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',');

  return lines.slice(1).map(line => {
    const values = line.split(',');
    const record = {};
    headers.forEach((header, i) => {
      record[header.trim()] = values[i]?.trim() || '';
    });
    return record;
  });
}

async function importCRM2Leads() {
  try {
    console.log('📂 Reading CRM2 CSV file...');

    // Read CSV file
    const csvPath = path.join(__dirname, '../.claude/CRM2 - Sheet1.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');

    // Parse CSV
    const records = parseCSV(csvContent);

    console.log(`📊 Found ${records.length} leads in CSV`);

    // Check which leads already exist
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('email, phone');

    const existingEmails = new Set(existingLeads?.map(l => l.email?.toLowerCase()) || []);
    const existingPhones = new Set(existingLeads?.map(l => l.phone?.replace(/\D/g, '')) || []);

    const leadsToImport = [];
    const skipped = [];

    for (const record of records) {
      // Clean phone number
      let phone = record.phone?.toString().trim();
      if (phone === '#ERROR!') {
        console.log(`⚠️  Skipping ${record.Name} - Invalid phone number`);
        skipped.push({ name: record.Name, reason: 'Invalid phone number' });
        continue;
      }

      // Normalize phone number (remove spaces, +44, 0 prefix)
      phone = phone?.replace(/\s/g, '').replace(/^\+44/, '0').replace(/^44/, '0') || '';
      const phoneDigits = phone.replace(/\D/g, '');

      // Check for duplicates
      const email = record.Email?.toLowerCase().trim();
      if (existingEmails.has(email)) {
        console.log(`⏭️  Skipping ${record.Name} - Email already exists: ${email}`);
        skipped.push({ name: record.Name, reason: 'Duplicate email' });
        continue;
      }

      if (existingPhones.has(phoneDigits)) {
        console.log(`⏭️  Skipping ${record.Name} - Phone already exists: ${phone}`);
        skipped.push({ name: record.Name, reason: 'Duplicate phone' });
        continue;
      }

      // Prepare lead data
      const leadData = {
        id: uuidv4(),
        name: record.Name?.trim() || 'Unknown',
        age: parseInt(record.Age) || null,
        email: email || null,
        phone: phone || null,
        postcode: record.postcode?.toUpperCase().trim() || null,
        image_url: record.Image_url?.trim() || null,
        status: 'New',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      leadsToImport.push(leadData);
      existingEmails.add(email); // Prevent duplicates within this import
      existingPhones.add(phoneDigits);
    }

    console.log(`\n📥 Importing ${leadsToImport.length} new leads...`);
    console.log(`⏭️  Skipped ${skipped.length} duplicate/invalid leads\n`);

    if (leadsToImport.length === 0) {
      console.log('✅ No new leads to import');
      return;
    }

    // Import in batches of 50
    const batchSize = 50;
    let imported = 0;
    let failed = 0;

    for (let i = 0; i < leadsToImport.length; i += batchSize) {
      const batch = leadsToImport.slice(i, i + batchSize);

      const { data, error } = await supabase
        .from('leads')
        .insert(batch)
        .select('id, name');

      if (error) {
        console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error.message);
        failed += batch.length;
      } else {
        imported += data.length;
        console.log(`✅ Batch ${Math.floor(i / batchSize) + 1}: Imported ${data.length} leads`);
      }
    }

    console.log(`\n✨ Import Complete!`);
    console.log(`   ✅ Successfully imported: ${imported} leads`);
    console.log(`   ⏭️  Skipped (duplicates): ${skipped.length} leads`);
    console.log(`   ❌ Failed: ${failed} leads`);

    if (skipped.length > 0) {
      console.log(`\n📋 Skipped leads:`);
      skipped.slice(0, 10).forEach(s => {
        console.log(`   - ${s.name}: ${s.reason}`);
      });
      if (skipped.length > 10) {
        console.log(`   ... and ${skipped.length - 10} more`);
      }
    }

  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

// Run import
importCRM2Leads();
