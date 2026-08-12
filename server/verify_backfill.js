require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.serverKey);

function parseHistory(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return []; } }
  return Array.isArray(raw) ? raw : [];
}

function recoverCancellationOldDate(history) {
  for (const entry of [...history].reverse()) {
    if (entry.action !== 'CANCELLATION') continue;
    const oldDate = entry.details?.oldDate;
    if (!oldDate) continue;
    const d = new Date(oldDate);
    if (Number.isNaN(d.getTime())) continue;
    return d.toISOString();
  }
  return null;
}

function isoDay(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadBackups() {
  const root = path.join(__dirname, '..');
  const files = fs.readdirSync(root).filter(f => f.startsWith('backfill_date_booked_') && f.endsWith('.json'));
  const rows = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
    for (const row of data.rows || []) {
      rows.push({ ...row, backupFile: f, range: data.range });
    }
  }
  // dedupe by id (last backup wins)
  const byId = new Map();
  for (const r of rows) byId.set(r.id, r);
  return [...byId.values()];
}

async function run() {
  const backedUp = loadBackups();
  console.log(`\n=== BACKFILL VERIFICATION ===`);
  console.log(`Backup files cover ${backedUp.length} unique lead IDs\n`);

  let ok = 0;
  let mismatch = 0;
  let missing = 0;
  let wrongStatus = 0;
  const problems = [];

  for (const b of backedUp) {
    const { data: lead, error } = await supabase
      .from('leads')
      .select('id, name, status, date_booked, booking_history')
      .eq('id', b.id)
      .single();

    if (error || !lead) {
      missing++;
      problems.push({ name: b.name, issue: 'lead not found' });
      continue;
    }

    if (lead.status !== 'Cancelled') {
      wrongStatus++;
      problems.push({ name: b.name, issue: `status is ${lead.status}, expected Cancelled` });
    }

    const expected = b.date_booked_after;
    const actual = lead.date_booked;

    if (!actual) {
      mismatch++;
      problems.push({ name: b.name, issue: 'date_booked still null after backfill' });
      continue;
    }

    // Compare timestamps (allow 1s tolerance for serialization)
    const diff = Math.abs(new Date(actual).getTime() - new Date(expected).getTime());
    if (diff > 1000) {
      mismatch++;
      problems.push({
        name: b.name,
        issue: `date mismatch: backup=${expected}, db=${actual}`
      });
      continue;
    }

    // Cross-check against source booking_history
    const fromHistory = recoverCancellationOldDate(parseHistory(lead.booking_history));
    if (fromHistory) {
      const histDiff = Math.abs(new Date(fromHistory).getTime() - new Date(actual).getTime());
      if (histDiff > 1000) {
        mismatch++;
        problems.push({
          name: b.name,
          issue: `db date doesn't match booking_history oldDate: history=${fromHistory}, db=${actual}`
        });
        continue;
      }
    }

    ok++;
  }

  console.log('--- Backup vs database ---');
  console.log(`OK (matches backup + history): ${ok}`);
  console.log(`Mismatch: ${mismatch}`);
  console.log(`Missing leads: ${missing}`);
  console.log(`Wrong status: ${wrongStatus}`);

  if (problems.length) {
    console.log('\nProblems:');
    for (const p of problems.slice(0, 20)) {
      console.log(`  ${p.name}: ${p.issue}`);
    }
    if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`);
  }

  // Sanity: any cancelled+null left in August ranges with recoverable history?
  console.log('\n--- Remaining gaps in August ---');
  const augustStart = '2026-08-01';
  const augustEnd = '2026-08-31';

  const { data: stillWiped } = await supabase
    .from('leads')
    .select('id, name, status, date_booked, booked_at, booking_history, booked_by')
    .eq('status', 'Cancelled')
    .is('date_booked', null)
    .not('booked_at', 'is', null)
    .limit(2000);

  let recoverableInAugust = 0;
  const missed = [];
  for (const l of stillWiped || []) {
    const rec = recoverCancellationOldDate(parseHistory(l.booking_history));
    if (!rec) continue;
    const day = isoDay(rec);
    if (day >= augustStart && day <= augustEnd) {
      recoverableInAugust++;
      missed.push({ name: l.name, appt: day, booked_at: l.booked_at?.slice(0, 10) });
    }
  }

  console.log(`Cancelled + wiped with recoverable August appt still missing: ${recoverableInAugust}`);
  if (missed.length) {
    for (const m of missed.slice(0, 15)) {
      console.log(`  ${m.name}: appt ${m.appt}, booked ${m.booked_at}`);
    }
  }

  // Spot check: backfilled dates should all belong to cancelled leads
  const ids = backedUp.map(b => b.id);
  let sampleChecked = 0;
  let nonCancelledInSample = 0;
  for (let i = 0; i < ids.length; i += Math.max(1, Math.floor(ids.length / 10))) {
    const id = ids[i];
    const { data } = await supabase.from('leads').select('status, date_booked').eq('id', id).single();
    sampleChecked++;
    if (data?.status !== 'Cancelled') nonCancelledInSample++;
  }

  console.log('\n--- Safety checks ---');
  console.log(`Sampled ${sampleChecked} backfilled leads — all Cancelled: ${nonCancelledInSample === 0 ? 'YES' : 'NO'}`);
  console.log(`Only CANCELLATION oldDate used (no message guessing): YES (by script design)`);
  console.log(`Non-August appointments were not in Aug backfill scope: check missed list above`);

  const verdict = mismatch === 0 && missing === 0 && wrongStatus === 0 && recoverableInAugust === 0;
  console.log(`\n=== VERDICT: ${verdict ? 'BACKFILL LOOKS CORRECT' : 'ISSUES FOUND — REVIEW ABOVE'} ===\n`);
}

run().catch(err => { console.error(err); process.exit(1); });
