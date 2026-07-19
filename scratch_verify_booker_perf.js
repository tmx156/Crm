// Verification-only script: exercises the exact same aggregation logic as
// server/routes/booker-performance.js directly against Supabase (no HTTP, no auth),
// to cross-check the new route's output against the already-validated week_report.js numbers.
const { createClient } = require('@supabase/supabase-js');
const config = require('./server/config');
const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.serverKey);

const SHOWED_STATUSES = ['Arrived', 'Left', 'No Sale'];

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function emptyMetrics() {
  return { bookingsMade: 0, onCalendar: 0, cancelled: 0, showed: 0, noShow: 0, pending: 0, showRate: null, salesCount: 0, revenue: 0 };
}

async function run() {
  const startDate = '2026-07-06';
  const endDate = '2026-07-12';
  const startTs = `${startDate}T00:00:00`;
  const endTsExclusive = `${addDays(endDate, 1)}T00:00:00`;

  const { data: users } = await supabase.from('users').select('id, name');
  const userMap = {};
  for (const u of users) userMap[u.id] = u.name;

  const { data: calendarLeads } = await supabase
    .from('leads')
    .select('id, name, status, booking_status, date_booked, booker_id, booked_by, booked_at')
    .gte('date_booked', startTs).lt('date_booked', endTsExclusive);

  const { data: bookedLeads } = await supabase
    .from('leads')
    .select('id, name, status, booking_status, date_booked, booker_id, booked_by, booked_at')
    .gte('booked_at', startTs).lt('booked_at', endTsExclusive);

  let allSales = [];
  let from = 0;
  while (true) {
    const { data: batch } = await supabase.from('sales').select('id, lead_id, amount, created_at, user_id')
      .gte('created_at', startTs).lt('created_at', endTsExclusive).range(from, from + 199);
    allSales = allSales.concat(batch || []);
    if (!batch || batch.length < 200) break;
    from += 200;
  }

  const leadLookup = {};
  for (const l of calendarLeads) leadLookup[l.id] = l;
  for (const l of bookedLeads) leadLookup[l.id] = l;
  const missingLeadIds = [...new Set(allSales.map(s => s.lead_id).filter(id => id && !leadLookup[id]))];
  for (const id of missingLeadIds) {
    const { data: ld } = await supabase.from('leads').select('id, name, booked_by, booker_id').eq('id', id).single();
    if (ld) leadLookup[ld.id] = ld;
  }

  const allLeadIds = Object.keys(leadLookup);
  const confirmationBookerMap = {};
  for (let i = 0; i < allLeadIds.length; i += 50) {
    const chunk = allLeadIds.slice(i, i + 50);
    const { data: msgs } = await supabase.from('messages').select('lead_id, sent_by, created_at')
      .in('lead_id', chunk).like('subject', 'Booking Confirmation %').order('created_at', { ascending: true });
    for (const m of msgs || []) {
      if (!confirmationBookerMap[m.lead_id] && m.sent_by) confirmationBookerMap[m.lead_id] = m.sent_by;
    }
  }

  function getOriginalBookerId(lead) {
    if (lead.booked_by) return lead.booked_by;
    if (confirmationBookerMap[lead.id]) return confirmationBookerMap[lead.id];
    if (lead.booker_id) return lead.booker_id;
    return 'unknown';
  }

  const byBooker = {};
  function ensure(id) { if (!byBooker[id]) byBooker[id] = emptyMetrics(); return byBooker[id]; }

  const liveBookedLeads = bookedLeads.filter(l => !!l.date_booked);
  for (const lead of liveBookedLeads) ensure(getOriginalBookerId(lead)).bookingsMade += 1;

  for (const lead of calendarLeads) {
    const m = ensure(getOriginalBookerId(lead));
    m.onCalendar += 1;
    if (lead.status === 'Cancelled') m.cancelled += 1;
    else if (SHOWED_STATUSES.includes(lead.booking_status) || SHOWED_STATUSES.includes(lead.status)) m.showed += 1;
    else if (lead.booking_status === 'No Show') m.noShow += 1;
    else m.pending += 1;
  }

  for (const sale of allSales) {
    const lead = sale.lead_id ? leadLookup[sale.lead_id] : null;
    const bookerId = lead ? getOriginalBookerId(lead) : 'unknown';
    const m = ensure(bookerId);
    m.salesCount += 1;
    m.revenue += parseFloat(sale.amount || 0);
  }

  const totals = emptyMetrics();
  for (const id of Object.keys(byBooker)) {
    const m = byBooker[id];
    m.showRate = m.onCalendar > 0 ? Math.round((m.showed / m.onCalendar) * 1000) / 10 : null;
    totals.bookingsMade += m.bookingsMade;
    totals.onCalendar += m.onCalendar;
    totals.cancelled += m.cancelled;
    totals.showed += m.showed;
    totals.noShow += m.noShow;
    totals.pending += m.pending;
    totals.salesCount += m.salesCount;
    totals.revenue += m.revenue;
  }
  totals.showRate = totals.onCalendar > 0 ? Math.round((totals.showed / totals.onCalendar) * 1000) / 10 : null;

  console.log('=== TOTALS ===');
  console.log(totals);
  console.log('\n=== BY BOOKER (name-resolved) ===');
  for (const id of Object.keys(byBooker)) {
    const name = id === 'unknown' ? 'Unknown' : (userMap[id] || 'Unknown');
    console.log(name, byBooker[id]);
  }
}

run().catch(e => console.error(e));
