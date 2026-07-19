const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth, adminAuth } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.serverKey);

function addDays(dateStr, days) {
  // UTC-safe date arithmetic: avoid local-timezone round-tripping through
  // toISOString(), which shifts the date in any non-UTC timezone (e.g. BST).
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const POSTCODE_RE = /^([A-Z]{1,2})(\d[A-Z\d]?)\s*\d[A-Z]{2}$/;

function getArea(postcode) {
  if (!postcode) return 'Unknown';
  const pc = postcode.trim().toUpperCase().replace(/\s+/g, ' ');
  const m = pc.match(POSTCODE_RE);
  if (!m) return 'Unknown';
  return m[1];
}

const SHOWED_STATUSES = ['Arrived', 'Left', 'No Sale'];

const AGE_BRACKETS = ['0-18', '19-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Unknown/Invalid'];

function ageBracket(age) {
  if (age === null || age === undefined) return 'Unknown/Invalid';
  if (age < 0 || age > 100) return 'Unknown/Invalid';
  if (age <= 18) return '0-18';
  if (age <= 24) return '19-24';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  if (age < 65) return '55-64';
  return '65+';
}

async function fetchAllPaginated(table, selectCols, applyFilters) {
  let all = [];
  let from = 0;
  const batchSize = 200;
  while (true) {
    let query = supabase.from(table).select(selectCols);
    query = applyFilters(query);
    const { data, error } = await query.range(from, from + batchSize - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < batchSize) break;
    from += batchSize;
  }
  return all;
}

function emptyBucket() {
  return { leads: 0, sales: 0, revenue: 0 };
}

function withConversionRate(b) {
  return {
    ...b,
    revenue: Math.round(b.revenue * 100) / 100,
    conversionRate: b.leads > 0 ? Math.round((b.sales / b.leads) * 1000) / 10 : null
  };
}

router.get('/summary', auth, adminAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate (YYYY-MM-DD) are required' });
    }

    const startTs = `${startDate}T00:00:00`;
    const endTsExclusive = `${addDays(endDate, 1)}T00:00:00`;

    const leads = await fetchAllPaginated('leads', 'id, age, postcode, created_at, deleted_at', q =>
      q.gte('created_at', startTs).lt('created_at', endTsExclusive).is('deleted_at', null)
    );

    const sales = await fetchAllPaginated('sales', 'id, lead_id, amount, created_at', q =>
      q.gte('created_at', startTs).lt('created_at', endTsExclusive)
    );

    // "Arrived" leads: booked leads whose appointment (date_booked) falls in range
    // and who showed up (Arrived/Left/No Sale) — matches booker-performance.js's
    // on-calendar outcome convention. This, not total leads created, is the
    // denominator for Conversion Rate.
    const arrivedLeads = await fetchAllPaginated('leads', 'id, status, booking_status, date_booked', q =>
      q.gte('date_booked', startTs).lt('date_booked', endTsExclusive)
    );
    const arrivedCount = arrivedLeads.filter(l =>
      SHOWED_STATUSES.includes(l.status) || SHOWED_STATUSES.includes(l.booking_status)
    ).length;

    const leadLookup = {};
    for (const l of leads) leadLookup[l.id] = l;

    const missingLeadIds = [...new Set(
      sales.map(s => s.lead_id).filter(id => id && !leadLookup[id])
    )];
    for (let i = 0; i < missingLeadIds.length; i += 50) {
      const chunk = missingLeadIds.slice(i, i + 50);
      const { data, error } = await supabase
        .from('leads')
        .select('id, age, postcode')
        .in('id', chunk)
        .is('deleted_at', null);
      if (error) throw error;
      for (const l of data || []) leadLookup[l.id] = l;
    }

    const byAgeMap = {};
    for (const b of AGE_BRACKETS) byAgeMap[b] = emptyBucket();

    const byAreaMap = {};

    for (const l of leads) {
      const bracket = ageBracket(l.age);
      byAgeMap[bracket].leads += 1;

      const area = getArea(l.postcode);
      if (!byAreaMap[area]) byAreaMap[area] = emptyBucket();
      byAreaMap[area].leads += 1;
    }

    let totalRevenue = 0;
    for (const s of sales) {
      const lead = s.lead_id ? leadLookup[s.lead_id] : null;
      const amount = parseFloat(s.amount || 0);
      totalRevenue += amount;

      const bracket = lead ? ageBracket(lead.age) : 'Unknown/Invalid';
      byAgeMap[bracket].sales += 1;
      byAgeMap[bracket].revenue += amount;

      const area = lead ? getArea(lead.postcode) : 'Unknown';
      if (!byAreaMap[area]) byAreaMap[area] = emptyBucket();
      byAreaMap[area].sales += 1;
      byAreaMap[area].revenue += amount;
    }

    const byAge = AGE_BRACKETS.map(bracket => withConversionRate({ bracket, ...byAgeMap[bracket] }));

    const allAreas = Object.entries(byAreaMap)
      .map(([area, b]) => withConversionRate({ area, ...b }))
      .sort((a, b) => b.leads - a.leads);
    const byArea = allAreas.slice(0, 12);
    const otherAreas = allAreas.slice(12);
    const otherAreasCount = otherAreas.length;
    const otherAreasLeads = otherAreas.reduce((sum, a) => sum + a.leads, 0);

    const summary = {
      totalLeads: leads.length,
      totalSales: sales.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      arrivedLeads: arrivedCount,
      conversionRate: arrivedCount > 0 ? Math.round((sales.length / arrivedCount) * 1000) / 10 : null
    };

    res.json({
      dateRange: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      summary,
      byAge,
      byArea,
      otherAreasCount,
      otherAreasLeads
    });
  } catch (error) {
    console.error('Lead analytics summary error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
