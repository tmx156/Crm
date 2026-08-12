require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.serverKey);

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonday(d) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getRange(preset) {
  const now = new Date();
  if (preset === 'thisWeek') {
    const monday = getMonday(now);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { preset, start: toISO(monday), end: toISO(sunday) };
  }
  if (preset === 'lastWeek') {
    const thisMonday = getMonday(now);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);
    return { preset, start: toISO(lastMonday), end: toISO(lastSunday) };
  }
  if (preset === 'thisMonth') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { preset, start: toISO(first), end: toISO(last) };
  }
  throw new Error(`Unknown preset: ${preset}. Use thisWeek, lastWeek, or thisMonth.`);
}

function parseHistory(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return []; } }
  return Array.isArray(raw) ? raw : [];
}

function isoDay(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function inRange(ts, range) {
  const day = isoDay(ts);
  return day && day >= range.start && day <= range.end;
}

function recoverCancellationOldDate(history) {
  for (const entry of [...history].reverse()) {
    if (entry.action !== 'CANCELLATION') continue;
    const oldDate = entry.details?.oldDate;
    if (!oldDate) continue;
    const d = new Date(oldDate);
    if (Number.isNaN(d.getTime())) continue;
    return {
      date: d.toISOString(),
      source: 'booking_history CANCELLATION oldDate',
      raw: oldDate
    };
  }
  return null;
}

async function fetchPaginated(build) {
  const out = [];
  let offset = 0;
  while (true) {
    const { data, error } = await build(offset, offset + 499);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 500) break;
    offset += 500;
  }
  return out;
}

async function runPreset(range, dryRun) {
  console.log(`\n=== BACKFILL: ${range.preset} (${range.start} to ${range.end}) ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE UPDATE'}\n`);

  const { data: users } = await supabase.from('users').select('id, name');
  const userMap = Object.fromEntries((users || []).map(u => [u.id, u.name]));

  const allWiped = await fetchPaginated((from, to) =>
    supabase.from('leads')
      .select('id, name, status, date_booked, booked_at, booked_by, booker_id, booking_history, updated_at')
      .eq('status', 'Cancelled')
      .is('date_booked', null)
      .not('booked_at', 'is', null)
      .order('booked_at', { ascending: true })
      .range(from, to)
  );

  const candidates = [];
  for (const lead of allWiped) {
    const rec = recoverCancellationOldDate(parseHistory(lead.booking_history));
    if (!rec || !inRange(rec.date, range)) continue;
    if (lead.status !== 'Cancelled' || lead.date_booked) continue;

    const bookerId = lead.booked_by || lead.booker_id || 'unknown';
    candidates.push({
      id: lead.id,
      name: lead.name,
      booker: userMap[bookerId] || bookerId,
      booked_at: lead.booked_at,
      date_booked_before: lead.date_booked,
      date_booked_after: rec.date,
      appt_day: isoDay(rec.date),
      source: rec.source,
      cancellation_raw: rec.raw,
      updated_at_before: lead.updated_at
    });
  }

  console.log(`Eligible: ${candidates.length}`);
  const byBooker = {};
  for (const c of candidates) byBooker[c.booker] = (byBooker[c.booker] || 0) + 1;
  console.log('By booker:', byBooker);

  const backupPath = path.join(__dirname, `../backfill_date_booked_${range.preset}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    range,
    count: candidates.length,
    rows: candidates
  }, null, 2));
  console.log(`Backup: ${backupPath}`);

  if (candidates.length === 0) {
    console.log('Nothing to update.\n');
    return { updated: 0, failed: 0, candidates: 0 };
  }

  if (dryRun) {
    console.log('Sample rows:');
    for (const c of candidates.slice(0, 8)) {
      console.log(`  ${c.appt_day} | ${c.name} (${c.booker})`);
    }
    if (candidates.length > 8) console.log(`  ... and ${candidates.length - 8} more`);
    console.log('');
    return { updated: 0, failed: 0, candidates: candidates.length, dryRun: true };
  }

  let updated = 0;
  let failed = 0;
  const errors = [];

  for (const c of candidates) {
    const { data, error } = await supabase
      .from('leads')
      .update({ date_booked: c.date_booked_after })
      .eq('id', c.id)
      .eq('status', 'Cancelled')
      .is('date_booked', null)
      .select('id');

    if (error || !data?.length) {
      failed++;
      errors.push({ name: c.name, error: error?.message || 'no row updated' });
    } else {
      updated++;
    }
  }

  console.log(`Updated: ${updated}, Failed: ${failed}`);
  if (errors.length) errors.forEach(e => console.log(`  FAIL ${e.name}: ${e.error}`));
  console.log('');
  return { updated, failed, candidates: candidates.length };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const presets = process.argv.includes('--all')
    ? ['thisWeek', 'thisMonth']
    : process.argv.filter(a => a.startsWith('--preset=')).map(a => a.split('=')[1]);

  if (!presets.length) {
    console.log('Usage: node backfill_wiped_date_booked.js --preset=thisWeek [--dry-run]');
    console.log('       node backfill_wiped_date_booked.js --all [--dry-run]');
    process.exit(1);
  }

  const totals = { updated: 0, failed: 0, candidates: 0 };
  for (const preset of presets) {
    const range = getRange(preset);
    const result = await runPreset(range, dryRun);
    totals.updated += result.updated || 0;
    totals.failed += result.failed || 0;
    totals.candidates += result.candidates || 0;
  }

  console.log('=== TOTAL ===');
  console.log(`Candidates: ${totals.candidates}, Updated: ${totals.updated}, Failed: ${totals.failed}`);
  if (dryRun) console.log('Re-run without --dry-run to apply.');
}

main().catch(err => { console.error(err); process.exit(1); });
