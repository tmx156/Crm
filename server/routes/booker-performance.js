const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth, adminAuth } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.serverKey);

const SHOWED_STATUSES = ['Arrived', 'Left', 'No Sale'];

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

function dateRangeDays(startDate, endDate) {
  const days = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function emptyMetrics() {
  return {
    bookingsMade: 0,
    onCalendar: 0,
    cancelled: 0,
    showed: 0,
    noShow: 0,
    pending: 0,
    showRate: null,
    salesCount: 0,
    revenue: 0
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

    const { data: users, error: usersError } = await supabase.from('users').select('id, name');
    if (usersError) throw usersError;
    const userMap = {};
    for (const u of users || []) userMap[u.id] = u.name;

    // On-calendar leads (date_booked in range)
    const { data: calendarLeads, error: calError } = await supabase
      .from('leads')
      .select('id, name, status, booking_status, date_booked, booker_id, booked_by, booked_at')
      .gte('date_booked', startTs)
      .lt('date_booked', endTsExclusive);
    if (calError) throw calError;

    // Bookings made (booked_at in range)
    const { data: bookedLeads, error: bookedError } = await supabase
      .from('leads')
      .select('id, name, status, booking_status, date_booked, booker_id, booked_by, booked_at')
      .gte('booked_at', startTs)
      .lt('booked_at', endTsExclusive);
    if (bookedError) throw bookedError;

    // Sales (created_at in range), paginated
    let allSales = [];
    let from = 0;
    while (true) {
      const { data: batch, error: salesError } = await supabase
        .from('sales')
        .select('id, lead_id, amount, created_at, user_id')
        .gte('created_at', startTs)
        .lt('created_at', endTsExclusive)
        .range(from, from + 199);
      if (salesError) throw salesError;
      allSales = allSales.concat(batch || []);
      if (!batch || batch.length < 200) break;
      from += 200;
    }

    const leadLookup = {};
    for (const l of calendarLeads || []) leadLookup[l.id] = l;
    for (const l of bookedLeads || []) leadLookup[l.id] = l;

    // Resolve leads referenced only by a sale
    const missingLeadIds = [...new Set(
      allSales.map(s => s.lead_id).filter(id => id && !leadLookup[id])
    )];
    if (missingLeadIds.length > 0) {
      const lookups = await Promise.all(
        missingLeadIds.map(id =>
          supabase.from('leads').select('id, name, booked_by, booker_id').eq('id', id).single()
        )
      );
      for (const { data: ld } of lookups) {
        if (ld) leadLookup[ld.id] = ld;
      }
    }

    // Original booker attribution: booked_by -> booking confirmation sent_by -> booker_id -> unknown
    const allLeadIds = [...new Set(Object.keys(leadLookup))];
    const confirmationBookerMap = {};
    for (let i = 0; i < allLeadIds.length; i += 50) {
      const chunk = allLeadIds.slice(i, i + 50);
      const { data: msgs, error: msgError } = await supabase
        .from('messages')
        .select('lead_id, sent_by, created_at')
        .in('lead_id', chunk)
        .like('subject', 'Booking Confirmation %')
        .order('created_at', { ascending: true });
      if (msgError) throw msgError;
      for (const m of msgs || []) {
        if (!confirmationBookerMap[m.lead_id] && m.sent_by) {
          confirmationBookerMap[m.lead_id] = m.sent_by;
        }
      }
    }

    function getOriginalBookerId(lead) {
      if (lead.booked_by) return lead.booked_by;
      if (confirmationBookerMap[lead.id]) return confirmationBookerMap[lead.id];
      if (lead.booker_id) return lead.booker_id;
      return 'unknown';
    }

    const byBooker = {};
    function ensureBooker(id) {
      if (!byBooker[id]) byBooker[id] = emptyMetrics();
      return byBooker[id];
    }

    // Bookings made — only count leads that currently have an appointment date set.
    // A lead with booked_at but no date_booked (e.g. later cleared/rescheduled to
    // null) isn't a live booking, matching the validated week_report.js logic.
    const liveBookedLeads = (bookedLeads || []).filter(l => !!l.date_booked);
    for (const lead of liveBookedLeads) {
      const bookerId = getOriginalBookerId(lead);
      ensureBooker(bookerId).bookingsMade += 1;
    }

    // On-calendar outcomes
    for (const lead of calendarLeads || []) {
      const bookerId = getOriginalBookerId(lead);
      const m = ensureBooker(bookerId);
      m.onCalendar += 1;
      if (lead.status === 'Cancelled') {
        m.cancelled += 1;
      } else if (SHOWED_STATUSES.includes(lead.booking_status) || SHOWED_STATUSES.includes(lead.status)) {
        m.showed += 1;
      } else if (lead.booking_status === 'No Show') {
        m.noShow += 1;
      } else {
        m.pending += 1;
      }
    }

    // Sales
    const salesDetail = [];
    for (const sale of allSales) {
      const lead = sale.lead_id ? leadLookup[sale.lead_id] : null;
      const bookerId = lead ? getOriginalBookerId(lead) : 'unknown';
      const m = ensureBooker(bookerId);
      const amount = parseFloat(sale.amount || 0);
      m.salesCount += 1;
      m.revenue += amount;
      salesDetail.push({
        id: sale.id,
        leadId: sale.lead_id || null,
        leadName: lead ? lead.name : 'Unknown',
        amount,
        bookerId,
        bookerName: bookerId === 'unknown' ? 'Unknown' : (userMap[bookerId] || 'Unknown'),
        date: sale.created_at
      });
    }
    salesDetail.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Show rates
    for (const id of Object.keys(byBooker)) {
      const m = byBooker[id];
      m.showRate = m.onCalendar > 0 ? Math.round((m.showed / m.onCalendar) * 1000) / 10 : null;
    }

    // Totals
    const totals = emptyMetrics();
    for (const id of Object.keys(byBooker)) {
      const m = byBooker[id];
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

    // Bookers list (only those with activity)
    const bookers = Object.keys(byBooker)
      .filter(id => {
        const m = byBooker[id];
        return m.bookingsMade > 0 || m.onCalendar > 0 || m.salesCount > 0;
      })
      .map(id => ({
        id,
        name: id === 'unknown' ? 'Unknown' : (userMap[id] || 'Unknown')
      }));

    // Daily breakdown (bookings made)
    const days = dateRangeDays(startDate, endDate);
    const daily = days.map(date => {
      const dayLeads = liveBookedLeads.filter(l => l.booked_at && l.booked_at.startsWith(date));
      const byBookerCount = {};
      for (const l of dayLeads) {
        const bookerId = getOriginalBookerId(l);
        byBookerCount[bookerId] = (byBookerCount[bookerId] || 0) + 1;
      }
      return {
        date,
        dayName: new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }),
        bookingsMade: {
          total: dayLeads.length,
          byBooker: byBookerCount
        }
      };
    });

    res.json({
      dateRange: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      bookers,
      totals,
      byBooker,
      daily,
      salesDetail
    });
  } catch (error) {
    console.error('Booker performance summary error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
