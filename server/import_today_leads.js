const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

/**
 * Step 1: Delete all the leads from the big feb 26 CSV import (created today)
 * Step 2: Revert any existing leads whose dates were wrongly changed to today
 * Step 3: Import ONLY the todaety CSV leads as today
 */

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey);
const TODAY = new Date().toISOString();
const TODAY_START = '2026-03-31T00:00:00.000Z';
const TOMORROW_START = '2026-04-01T00:00:00.000Z';

const TODAETY_CSV = path.join('C:', 'Users', 'Tin', 'Downloads', 'todaety - Sheet1 (63).csv');

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^\d]/g, '');
  if (cleaned.startsWith('44') && cleaned.length > 10) {
    cleaned = '0' + cleaned.slice(2);
  }
  if (cleaned.startsWith('440')) {
    cleaned = cleaned.slice(2);
  }
  if (cleaned.length === 10 && !cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
  }
  return cleaned || null;
}

function parseTodaetyCsv(content) {
  const leads = [];
  const lines = content.split('\n');

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV with quote handling
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
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

    const name = fields[0] || '';
    if (!name) continue;

    const ageStr = (fields[1] || '').replace(/[^\d]/g, '');
    const age = ageStr ? parseInt(ageStr) : null;
    const email = (fields[2] || '').toLowerCase().trim() || null;
    const phone = (fields[3] || '').trim();
    const postcode = (fields[4] || '').trim() || null;
    const imageUrl = (fields[5] || '').trim();
    const parentPhone = (fields[6] || '').trim();

    if (!phone && !email) continue;

    leads.push({
      name,
      age,
      email,
      phone,
      postcode,
      image_url: imageUrl.startsWith('http') ? imageUrl : null,
      parent_phone: (parentPhone && parentPhone.length > 3) ? parentPhone : null
    });
  }
  return leads;
}

async function fetchAllLeadsCreatedToday() {
  // Paginate to get ALL leads created today (could be 3000+)
  const allLeads = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, email, ever_booked, has_sale, booked_at, booking_history, status, booker_id')
      .gte('created_at', TODAY_START)
      .lt('created_at', TOMORROW_START)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allLeads.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return allLeads;
}

async function run() {
  // ============ STEP 1: Clean up the bad import ============
  console.log('=== STEP 1: Cleaning up the big CSV import ===\n');

  const todayLeads = await fetchAllLeadsCreatedToday();
  console.log(`Found ${todayLeads.length} leads with created_at = today`);

  // Separate into "fresh inserts" (no CRM activity) and "modified existing" (have activity)
  const freshInsertIds = [];
  const modifiedExistingIds = [];

  for (const lead of todayLeads) {
    const hasActivity = lead.ever_booked ||
                        lead.has_sale ||
                        lead.booked_at ||
                        lead.booking_history ||
                        (lead.status && lead.status !== 'New') ||
                        lead.booker_id;

    if (hasActivity) {
      modifiedExistingIds.push(lead.id);
    } else {
      freshInsertIds.push(lead.id);
    }
  }

  console.log(`  Fresh inserts to delete: ${freshInsertIds.length}`);
  console.log(`  Modified existing to revert dates: ${modifiedExistingIds.length}`);

  // Delete fresh inserts in batches
  const DELETE_BATCH = 100;
  let deleted = 0;
  for (let i = 0; i < freshInsertIds.length; i += DELETE_BATCH) {
    const batch = freshInsertIds.slice(i, i + DELETE_BATCH);
    const { error } = await supabase
      .from('leads')
      .delete()
      .in('id', batch);

    if (error) {
      console.error(`Error deleting batch at ${i}:`, error.message);
    } else {
      deleted += batch.length;
    }
  }
  console.log(`  Deleted ${deleted} fresh inserts`);

  // Revert dates for modified existing leads
  let reverted = 0;
  for (const id of modifiedExistingIds) {
    const { error } = await supabase
      .from('leads')
      .update({
        created_at: '2026-02-26T00:00:00.000Z',
        updated_at: '2026-03-30T00:00:00.000Z'
      })
      .eq('id', id);

    if (error) {
      console.error(`Error reverting lead ${id}:`, error.message);
    } else {
      reverted++;
    }
  }
  console.log(`  Reverted dates for ${reverted} existing leads\n`);

  // ============ STEP 2: Import todaety CSV ============
  console.log('=== STEP 2: Importing todaety CSV as today ===\n');

  const csvContent = fs.readFileSync(TODAETY_CSV, 'utf-8');
  const todaeyLeads = parseTodaetyCsv(csvContent);
  console.log(`Parsed ${todaeyLeads.length} leads from todaety CSV`);

  // Fetch ALL existing leads for matching (paginate)
  console.log('Fetching all existing leads for matching...');
  const allExisting = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, email')
      .range(offset, offset + 999);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allExisting.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`Found ${allExisting.length} existing leads in DB`);

  // Build lookup maps
  const phoneMap = new Map();
  const emailMap = new Map();
  for (const lead of allExisting) {
    if (lead.phone) {
      const norm = normalizePhone(lead.phone);
      if (norm) phoneMap.set(norm, lead);
    }
    if (lead.email) {
      emailMap.set(lead.email.toLowerCase(), lead);
    }
  }

  let inserted = 0;
  let updated = 0;

  for (const lead of todaeyLeads) {
    const normPhone = normalizePhone(lead.phone);
    const existing = (normPhone && phoneMap.get(normPhone)) ||
                     (lead.email && emailMap.get(lead.email));

    if (existing) {
      // Update existing lead to show as today
      const { error } = await supabase
        .from('leads')
        .update({
          created_at: TODAY,
          updated_at: TODAY
        })
        .eq('id', existing.id);

      if (error) {
        console.error(`Error updating ${lead.name}:`, error.message);
      } else {
        updated++;
      }
    } else {
      // Insert as new lead
      const { error } = await supabase
        .from('leads')
        .insert({
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
          created_at: TODAY,
          updated_at: TODAY
        });

      if (error) {
        console.error(`Error inserting ${lead.name}:`, error.message);
      } else {
        inserted++;
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60));
  console.log(`Cleanup: Deleted ${deleted} wrongly imported leads`);
  console.log(`Cleanup: Reverted ${reverted} existing leads to old dates`);
  console.log(`Import:  Inserted ${inserted} new leads from todaety CSV`);
  console.log(`Import:  Updated ${updated} existing leads to show as today`);
  console.log('Done!');
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
