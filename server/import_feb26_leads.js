const dbManager = require('./database-connection-manager');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

/**
 * Import leads from "Online Leads - feb 26 (1).csv"
 * - New leads get inserted with today's date
 * - Existing leads (matched by phone or email) get their created_at/updated_at set to today
 */

const CSV_PATH = path.join('C:', 'Users', 'Tin', 'Downloads', 'Online Leads - feb 26 (1).csv');
const TODAY = new Date().toISOString();

function normalizePhone(phone) {
  if (!phone) return null;
  // Remove all non-digit characters
  let cleaned = phone.replace(/[^\d]/g, '');
  // Handle UK formats
  if (cleaned.startsWith('44') && cleaned.length > 10) {
    cleaned = '0' + cleaned.slice(2);
  }
  if (cleaned.startsWith('440')) {
    cleaned = cleaned.slice(2);
  }
  // Ensure starts with 0
  if (cleaned.length === 10 && !cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
  }
  return cleaned || null;
}

function parseCSV(content) {
  const leads = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Parse CSV respecting quoted fields
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());

    // Skip separator rows (empty, "2nd", "3rd", etc.)
    const firstCol = fields[0] || '';
    if (!firstCol) continue;
    if (/^\d+(st|nd|rd|th)$/i.test(firstCol)) continue;

    // Skip header-like rows (all empty except first)
    const name = fields[1] || '';
    if (!name) continue;

    // Skip rows where first col is a date timestamp (duplicates marked in the CSV)
    if (/^\d{2}\/\d{2}\/\d{4}/.test(firstCol)) continue;

    // Must have at least call-attempts pattern like "1x", "2x", etc.
    if (!/^\d+x$/i.test(firstCol)) continue;

    const email = (fields[3] || '').toLowerCase().trim();
    const phone = fields[4] || '';
    const postcode = fields[5] || '';
    const imageUrl = fields[6] || '';
    const parentPhone = fields[7] || '';
    const source = fields[8] || '';
    const ageStr = (fields[2] || '').replace(/[^\d]/g, '');
    const age = ageStr ? parseInt(ageStr) : null;

    // Skip rows without phone AND email
    if (!phone && !email) continue;

    // Collect notes from remaining columns
    const notesCols = fields.slice(9).filter(n => n && n.trim());
    const notes = notesCols.join(' | ');

    leads.push({
      name: name.trim(),
      age,
      email: email || null,
      phone: phone.trim(),
      postcode: postcode.trim() || null,
      image_url: imageUrl.startsWith('http') ? imageUrl : null,
      parent_phone: (parentPhone && parentPhone !== 'n/a' && parentPhone.length > 3) ? parentPhone.trim() : null,
      source,
      notes: notes || null
    });
  }

  return leads;
}

async function importLeads() {
  console.log('Reading CSV file...');
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const leads = parseCSV(content);
  console.log(`Parsed ${leads.length} leads from CSV\n`);

  // Fetch all existing leads from the DB for matching
  console.log('Fetching existing leads from database...');
  const existingLeads = await dbManager.query('leads', {
    select: 'id, name, phone, email, created_at'
  });
  console.log(`Found ${existingLeads.length} existing leads in database\n`);

  // Build lookup maps
  const phoneMap = new Map();
  const emailMap = new Map();
  for (const lead of existingLeads) {
    if (lead.phone) {
      const normPhone = normalizePhone(lead.phone);
      if (normPhone) phoneMap.set(normPhone, lead);
    }
    if (lead.email) {
      emailMap.set(lead.email.toLowerCase(), lead);
    }
  }

  const results = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  // Process in batches
  const BATCH_SIZE = 20;
  const toInsert = [];
  const toUpdate = [];

  for (const lead of leads) {
    const normPhone = normalizePhone(lead.phone);
    const existing = (normPhone && phoneMap.get(normPhone)) ||
                     (lead.email && emailMap.get(lead.email));

    if (existing) {
      toUpdate.push(existing.id);
    } else {
      toInsert.push(lead);
    }
  }

  console.log(`To insert: ${toInsert.length} new leads`);
  console.log(`To update: ${toUpdate.length} existing leads (set to today's date)\n`);

  // Insert new leads in batches
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const records = batch.map(lead => ({
      id: uuidv4(),
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      postcode: lead.postcode,
      image_url: lead.image_url,
      parent_phone: lead.parent_phone,
      age: lead.age,
      booker_id: null,
      status: 'New',
      date_booked: null,
      is_confirmed: 0,
      booking_status: null,
      notes: lead.notes,
      created_at: TODAY,
      updated_at: TODAY
    }));

    try {
      const inserted = await dbManager.insert('leads', records);
      if (inserted) {
        results.inserted += inserted.length;
        console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${inserted.length} leads`);
      }
    } catch (error) {
      console.error(`Error inserting batch at index ${i}:`, error.message);
      results.failed += batch.length;
      results.errors.push(error.message);
    }
  }

  // Update existing leads in batches (set created_at and updated_at to today)
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    for (const leadId of batch) {
      try {
        await dbManager.update('leads', {
          created_at: TODAY,
          updated_at: TODAY
        }, { id: leadId });
        results.updated++;
      } catch (error) {
        console.error(`Error updating lead ${leadId}:`, error.message);
        results.failed++;
        results.errors.push(error.message);
      }
    }
    console.log(`Updated batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} leads`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('IMPORT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total parsed from CSV: ${leads.length}`);
  console.log(`New leads inserted:    ${results.inserted}`);
  console.log(`Existing leads updated (date set to today): ${results.updated}`);
  console.log(`Failed:                ${results.failed}`);
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    [...new Set(results.errors)].forEach(e => console.log(`  - ${e}`));
  }
  console.log('\nDone!');
  return results;
}

if (require.main === module) {
  importLeads()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { importLeads };
