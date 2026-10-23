const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth, adminAuth } = require('../middleware/auth');
const config = require('../config');
const { LeadSheetImporter, phoneVariants, sheetTimestamp, ukTimeToUtc } = require('../utils/leadSheetImporter');

const router = express.Router();

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.serverKey);

// The report is built from the "Model Applications" sheet, the one record of
// every website application with the time it was made and the ad it came from.
// Each row is matched to its CRM lead (email, then phone) for status and
// bookings, so leads that arrived by CSV upload count on the day they applied.
// Nothing is written to the CRM.
const SHEET_ID = process.env.LEAD_SHEET_ID || '11QuB1V2KpKGF5Fj8UNQbLxwMNHmikjM-1Hm3PuBLtvY';
const SHEET_TAB = process.env.LEAD_SHEET_TAB || 'Sheet1';
const SHEET_CACHE_MS = 60 * 1000;
// Sheet columns: created, Name, Age, Email, phone, postcode, Image_url, parent phone, source, note
const COL = { created: 0, name: 1, age: 2, email: 3, phone: 4, postcode: 5, source: 8, note: 9 };
// Days run 8am to 8am UK time, to line up with the ad account's reporting day.
const DAY_START_HOUR = 8;
// Distances are from the studio, the same reference the upload pop-up uses.
const STUDIO_POSTCODE = 'M12 6DA';
const FAR_MILES = 150;
const DAILY_CHART_DAYS = 15;
const MAX_RANGE_DAYS = 120;

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function londonParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

// The UTC instant of 8am UK time on the given calendar day (handles BST/GMT).
function dayStartUtc(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, DAY_START_HOUR));
  const shown = londonParts(guess);
  const offsetHours = shown.hour - DAY_START_HOUR;
  return new Date(guess.getTime() - offsetHours * 3600 * 1000);
}

// The 8am-to-8am day a moment falls in, named by the calendar day it starts on.
function reportDayOf(date) {
  const p = londonParts(date);
  return p.hour < DAY_START_HOUR ? addDays(p.day, -1) : p.day;
}

function haversineMiles(a, b) {
  const R = 3959;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Postcode lookups are cached for the life of the process; postcodes don't move.
const postcodeCache = new Map();

function normalisePostcode(pc) {
  return String(pc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function lookupPostcodes(postcodes) {
  const missing = [...new Set(postcodes.filter(pc => pc && !postcodeCache.has(pc)))];
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    try {
      const resp = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: batch })
      });
      const json = await resp.json();
      for (const item of json.result || []) {
        const r = item.result;
        postcodeCache.set(item.query, r ? { lat: r.latitude, lon: r.longitude, area: r.admin_district || r.region || 'Unknown' } : null);
      }
    } catch (err) {
      console.warn('[LeadReport] Postcode lookup failed:', err.message);
    }
  }
}

let sheetsClient = null;
let sheetCache = { at: 0, rows: [] };

// Every application on the sheet, oldest first, with its UTC submit time.
// Repeat applicants are marked on the sheet and left out, as they aren't new leads.
async function loadApplications() {
  if (Date.now() - sheetCache.at < SHEET_CACHE_MS) return sheetCache.rows;
  if (!sheetsClient) {
    const importer = new LeadSheetImporter(null);
    await importer.authenticate();
    sheetsClient = importer.sheets;
  }
  const resp = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_TAB}'!A2:J`
  });
  const rows = [];
  for (const r of resp.data.values || []) {
    const appliedAt = ukTimeToUtc(sheetTimestamp(r[COL.created]));
    if (!appliedAt || !String(r[COL.name] || '').trim()) continue;
    if (/REPEAT APPLICANT/i.test(String(r[COL.note] || ''))) continue;
    const ageNum = parseInt(r[COL.age]);
    rows.push({
      appliedAt: new Date(appliedAt),
      name: String(r[COL.name]).trim(),
      age: Number.isFinite(ageNum) ? ageNum : null,
      email: String(r[COL.email] || '').trim().toLowerCase(),
      phone: String(r[COL.phone] || '').trim(),
      postcode: String(r[COL.postcode] || '').trim(),
      source: String(r[COL.source] || '').trim()
    });
  }
  sheetCache = { at: Date.now(), rows };
  return rows;
}

function applicationsBetween(apps, startUtc, endUtc) {
  return apps.filter(a => a.appliedAt >= startUtc && a.appliedAt < endUtc);
}

// Finds the CRM lead for each application: email first, then any stored form
// of the phone number. Unmatched applications come back without a lead.
async function matchCrmLeads(apps) {
  const select = 'id, email, phone, status, ever_booked, date_booked, deleted_at';
  const found = [];
  const emails = [...new Set(apps.map(a => a.email).filter(Boolean))];
  for (let i = 0; i < emails.length; i += 100) {
    const { data, error } = await supabase.from('leads').select(select).in('email', emails.slice(i, i + 100));
    if (error) throw error;
    found.push(...data);
  }
  const byEmail = new Map();
  for (const l of found) if (l.email) byEmail.set(l.email.trim().toLowerCase(), l);

  const needPhone = apps.filter(a => !byEmail.has(a.email));
  const phones = [...new Set(needPhone.flatMap(a => phoneVariants(a.phone)))];
  const byPhone = new Map();
  for (let i = 0; i < phones.length; i += 100) {
    const { data, error } = await supabase.from('leads').select(select).in('phone', phones.slice(i, i + 100));
    if (error) throw error;
    for (const l of data) for (const v of phoneVariants(l.phone)) byPhone.set(v, l);
  }

  return apps.map(a => {
    const lead = byEmail.get(a.email) || phoneVariants(a.phone).map(v => byPhone.get(v)).find(Boolean) || null;
    return { app: a, lead: lead && !lead.deleted_at ? lead : null };
  });
}

function sourceOf(source) {
  const src = String(source || '').trim();
  if (!src) return 'Unknown';
  return /^organic$/i.test(src) ? 'Organic' : src;
}

function ageBand(age) {
  const a = Number(age);
  if (!Number.isFinite(a) || a < 16 || a > 99) return 'Not given';
  if (a < 30) return 'Under 30';
  if (a < 40) return '30-39';
  if (a < 50) return '40-49';
  if (a < 60) return '50-59';
  if (a < 70) return '60-69';
  return '70+';
}

const AGE_ORDER = ['Under 30', '30-39', '40-49', '50-59', '60-69', '70+', 'Not given'];
const DISTANCE_BANDS = [
  { label: '0 to 25 mi', max: 25 },
  { label: '26 to 50 mi', max: 50 },
  { label: '51 to 100 mi', max: 100 },
  { label: '101 to 150 mi', max: 150 },
  { label: 'Over 150 mi', max: Infinity }
];

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const k = keyFn(item);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function isBooked(lead) {
  return Boolean(lead.ever_booked || lead.date_booked);
}

// @route   GET /api/lead-report?from=YYYY-MM-DD&to=YYYY-MM-DD
// @desc    Website lead breakdown; from/to name 8am-to-8am days (inclusive)
// @access  Admin
router.get('/', auth, adminAuth, async (req, res) => {
  try {
    const today = reportDayOf(new Date());
    const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    let from = isDay(req.query.from) ? req.query.from : today;
    let to = isDay(req.query.to) ? req.query.to : from;
    if (to < from) [from, to] = [to, from];
    if (addDays(from, MAX_RANGE_DAYS) < to) from = addDays(to, -MAX_RANGE_DAYS);

    const startUtc = dayStartUtc(from);
    const endUtc = dayStartUtc(addDays(to, 1));
    let dayCount = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) dayCount++;

    const apps = await loadApplications();
    const leads = await matchCrmLeads(applicationsBetween(apps, startUtc, endUtc).reverse());
    const prevStart = dayStartUtc(addDays(from, -dayCount));
    const prevLeads = applicationsBetween(apps, prevStart, startUtc);

    // Daily counts for the chart: the last N days ending on `to`.
    const chartFrom = addDays(to, -(DAILY_CHART_DAYS - 1));
    const chartLeads = applicationsBetween(apps, dayStartUtc(chartFrom), endUtc);
    const perDay = countBy(chartLeads, a => reportDayOf(a.appliedAt));
    const daily = [];
    for (let d = chartFrom; d <= to; d = addDays(d, 1)) {
      daily.push({ day: d, count: perDay[d] || 0, selected: d >= from && d <= to });
    }

    await lookupPostcodes([STUDIO_POSTCODE.replace(' ', ''), ...leads.map(l => normalisePostcode(l.app.postcode))]);
    const studio = postcodeCache.get(STUDIO_POSTCODE.replace(' ', ''));

    const rows = leads.map(({ app, lead }, i) => {
      const loc = postcodeCache.get(normalisePostcode(app.postcode)) || null;
      const miles = loc && studio ? haversineMiles(studio, loc) : null;
      return {
        id: lead ? lead.id : null,
        key: lead ? lead.id : `sheet-${i}`,
        name: app.name,
        age: app.age,
        postcode: app.postcode,
        status: lead ? lead.status : 'Not in CRM',
        source: sourceOf(app.source),
        area: loc ? loc.area : 'Unknown',
        miles: miles === null ? null : Math.round(miles * 10) / 10,
        createdAt: app.appliedAt.toISOString(),
        booked: lead ? isBooked(lead) : false
      };
    });

    const distances = rows.filter(r => r.miles !== null).map(r => r.miles).sort((a, b) => a - b);
    const ages = rows.map(r => Number(r.age)).filter(a => Number.isFinite(a) && a >= 16 && a <= 99);
    const avg = list => list.length ? Math.round(list.reduce((s, x) => s + x, 0) / list.length * 10) / 10 : null;

    const distanceBands = DISTANCE_BANDS.map((band, i) => {
      const min = i === 0 ? -Infinity : DISTANCE_BANDS[i - 1].max;
      return { label: band.label, count: distances.filter(d => d > min && d <= band.max).length };
    });

    const ageCounts = countBy(rows, r => ageBand(r.age));
    const sourceCounts = countBy(rows, r => r.source);
    const areaCounts = countBy(rows.filter(r => r.area !== 'Unknown'), r => r.area);
    const hourCounts = countBy(rows.filter(r => r.createdAt), r => londonParts(new Date(r.createdAt)).hour);

    res.json({
      range: { from, to, days: dayCount, startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString(), today },
      summary: {
        total: rows.length,
        inCrm: rows.filter(r => r.id).length,
        previousTotal: prevLeads.length,
        booked: rows.filter(r => r.booked).length,
        located: distances.length,
        avgMiles: avg(distances),
        medianMiles: distances.length ? distances[Math.floor(distances.length / 2)] : null,
        minMiles: distances.length ? distances[0] : null,
        maxMiles: distances.length ? distances[distances.length - 1] : null,
        within50: distances.filter(d => d <= 50).length,
        within150: distances.filter(d => d <= FAR_MILES).length,
        over150: distances.filter(d => d > FAR_MILES).length,
        avgAge: avg(ages)
      },
      distanceBands,
      ages: AGE_ORDER.filter(k => ageCounts[k]).map(k => ({ label: k, count: ageCounts[k] })),
      sources: Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
      areas: Object.entries(areaCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, count]) => ({ label, count })),
      hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: hourCounts[h] || 0 })),
      daily,
      leads: rows
    });
  } catch (error) {
    console.error('[LeadReport] Error:', error);
    res.status(500).json({ message: 'Failed to build lead report', error: error.message });
  }
});

module.exports = router;
module.exports._internal = { dayStartUtc, reportDayOf, addDays };
