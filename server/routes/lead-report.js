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

// Finds the live CRM lead for each application, by email then any stored form
// of the phone number. Deleted leads are removed from the table outright, so an
// application with no lead is one that was deleted or never arrived.
async function matchCrmLeads(apps) {
  const select = 'id, email, phone, status, ever_booked, date_booked';
  const byEmail = new Map();
  const byPhone = new Map();
  const add = l => {
    if (l.email) byEmail.set(l.email.trim().toLowerCase(), l);
    for (const v of phoneVariants(l.phone)) byPhone.set(v, l);
  };
  const find = a => byEmail.get(a.email) || phoneVariants(a.phone).map(v => byPhone.get(v)).find(Boolean) || null;
  if (!apps.length) return [];

  // Most leads reach the CRM within a few days of applying (webhook at once,
  // CSV upload next morning), so one window read covers nearly all of them.
  const times = apps.map(a => a.appliedAt.getTime());
  const windowStart = new Date(Math.min(...times) - 2 * 864e5).toISOString();
  const windowEnd = new Date(Math.max(...times) + 7 * 864e5).toISOString();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('leads')
      .select(select)
      .is('deleted_at', null)
      .gte('created_at', windowStart)
      .lt('created_at', windowEnd)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    data.forEach(add);
    if (data.length < 1000) break;
  }

  // The rest (leads already in the CRM before they applied) are looked up directly.
  const rest = apps.filter(a => !find(a));
  const emails = [...new Set(rest.map(a => a.email).filter(Boolean))];
  const phones = [...new Set(rest.flatMap(a => phoneVariants(a.phone)))];
  for (const [column, values] of [['email', emails], ['phone', phones]]) {
    for (let i = 0; i < values.length; i += 100) {
      const { data, error } = await supabase.from('leads').select(select).is('deleted_at', null).in(column, values.slice(i, i + 100));
      if (error) throw error;
      data.forEach(add);
    }
  }

  return apps.map(a => ({ app: a, lead: find(a) }));
}

// Total sale amount per lead id.
async function loadSales(leadIds) {
  const totals = new Map();
  for (let i = 0; i < leadIds.length; i += 100) {
    const { data, error } = await supabase.from('sales').select('lead_id, amount').in('lead_id', leadIds.slice(i, i + 100));
    if (error) throw error;
    for (const s of data) totals.set(s.lead_id, (totals.get(s.lead_id) || 0) + (Number(s.amount) || 0));
  }
  return totals;
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

    const prevStart = dayStartUtc(addDays(from, -dayCount));
    const chartFrom = addDays(to, -(DAILY_CHART_DAYS - 1));
    const chartStart = dayStartUtc(chartFrom);

    // Only applications whose lead is still in the CRM count anywhere, so a
    // lead deleted from the CRM drops out of every figure.
    const apps = await loadApplications();
    // Someone who applied twice is one lead, counted at their first application.
    const seen = new Set();
    const matched = (await matchCrmLeads(applicationsBetween(apps, prevStart < chartStart ? prevStart : chartStart, endUtc)))
      .filter(m => !m.lead || (!seen.has(m.lead.id) && seen.add(m.lead.id)));
    const inRange = matched.filter(m => m.app.appliedAt >= startUtc && m.app.appliedAt < endUtc);
    const leads = inRange.filter(m => m.lead).reverse();
    const prevLeads = matched.filter(m => m.lead && m.app.appliedAt >= prevStart && m.app.appliedAt < startUtc);

    // Daily counts for the chart: the last N days ending on `to`.
    const chartLeads = matched.filter(m => m.lead && m.app.appliedAt >= chartStart);
    const perDay = countBy(chartLeads, m => reportDayOf(m.app.appliedAt));
    const daily = [];
    for (let d = chartFrom; d <= to; d = addDays(d, 1)) {
      daily.push({ day: d, count: perDay[d] || 0, selected: d >= from && d <= to });
    }

    const salesByLead = await loadSales(leads.map(m => m.lead.id));
    await lookupPostcodes([STUDIO_POSTCODE.replace(' ', ''), ...leads.map(l => normalisePostcode(l.app.postcode))]);
    const studio = postcodeCache.get(STUDIO_POSTCODE.replace(' ', ''));

    const rows = leads.map(({ app, lead }) => {
      const loc = postcodeCache.get(normalisePostcode(app.postcode)) || null;
      const miles = loc && studio ? haversineMiles(studio, loc) : null;
      return {
        id: lead.id,
        key: lead.id,
        name: app.name,
        age: app.age,
        postcode: app.postcode,
        status: lead.status,
        source: sourceOf(app.source),
        area: loc ? loc.area : 'Unknown',
        miles: miles === null ? null : Math.round(miles * 10) / 10,
        createdAt: app.appliedAt.toISOString(),
        booked: isBooked(lead),
        spent: salesByLead.get(lead.id) || 0
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
        notInCrm: inRange.length - rows.length,
        previousTotal: prevLeads.length,
        booked: rows.filter(r => r.booked).length,
        bought: rows.filter(r => r.spent > 0).length,
        revenue: Math.round(rows.reduce((sum, r) => sum + r.spent, 0) * 100) / 100,
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
