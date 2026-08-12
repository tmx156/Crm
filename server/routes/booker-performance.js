const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth, adminAuth } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.serverKey);

// Values that mean "the lead turned up". 'Attended' only ever appears on leads.status,
// the other three only on leads.booking_status - both columns are checked below, so
// this single list covers each. Omitting 'Attended' silently bucketed 260 genuine
// turn-ups as Pending and dragged every show rate toward zero.
const SHOWED_STATUSES = ['Arrived', 'Left', 'No Sale', 'Attended'];

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
    counted: 0,
    rescheduled: 0,
    cancelledDateWiped: 0,
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
    // Validate before building timestamps. Without this an unparseable date reached
    // Postgres and came back as a 500 with the raw driver error shown to the user.
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
      return res.status(400).json({ message: 'Dates must be in YYYY-MM-DD format' });
    }
    for (const [label, value] of [['startDate', startDate], ['endDate', endDate]]) {
      const dt = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== value) {
        return res.status(400).json({ message: `${label} is not a real date` });
      }
    }
    // A reversed range silently returned zeros everywhere, which reads as a quiet week
    // rather than a bad input.
    if (startDate > endDate) {
      return res.status(400).json({ message: 'Start date must be on or before the end date' });
    }

    const startTs = `${startDate}T00:00:00`;
    const endTsExclusive = `${addDays(endDate, 1)}T00:00:00`;

    const { data: users, error: usersError } = await supabase.from('users').select('id, name');
    if (usersError) throw usersError;
    const userMap = {};
    for (const u of users || []) userMap[u.id] = u.name;

    // PostgREST caps an unbounded select at 1000 rows and returns no error when it
    // truncates, so both lead queries have to page explicitly or a busy month silently
    // reports low.
    const LEAD_FIELDS = 'id, name, status, booking_status, date_booked, booker_id, booked_by, booked_at';
    async function fetchLeadsByDate(field) {
      const out = [];
      let offset = 0;
      while (true) {
        const { data: batch, error } = await supabase
          .from('leads')
          .select(LEAD_FIELDS)
          .gte(field, startTs)
          .lt(field, endTsExclusive)
          .order('id', { ascending: true })
          .range(offset, offset + 499);
        if (error) throw error;
        out.push(...(batch || []));
        if (!batch || batch.length < 500) return out;
        offset += 500;
      }
    }

    // On-calendar leads (date_booked in range) and bookings made (booked_at in range)
    const calendarLeads = await fetchLeadsByDate('date_booked');
    const bookedLeads = await fetchLeadsByDate('booked_at');

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

    // Shared back-office accounts. They send confirmations and record sales on everyone's
    // behalf, so they must never take booking credit from the booker who did the work -
    // admin@crm.com alone sent the most recent confirmation on 19 of one week's 119
    // appointments while making only 9 bookings of its own in six weeks.
    const OPS_ACCOUNT_EMAILS = ['admin@crm.com'];
    const { data: opsUsers, error: opsError } = await supabase
      .from('users').select('id').in('email', OPS_ACCOUNT_EMAILS);
    if (opsError) throw opsError;
    const opsAccountIds = new Set((opsUsers || []).map(u => u.id));

    // Who most recently rebooked each lead.
    //
    // booked_by records who took the booking *originally* and is deliberately preserved
    // through reschedules. That breaks when a lead is rebooked months later by someone
    // else: a booker who has since left keeps the turn-up and the sale, while the person
    // who actually put the customer in the chair gets nothing. Rebooking leaves no trace
    // in the activity log (only the date moves, and date changes are not logged), so the
    // booking confirmation is the only evidence of who did it.
    //
    // Matched case-insensitively: the app has written both "Booking Confirmation " and
    // "Booking confirmation" over its life, and the old exact-match pattern silently
    // missed every message in the newer style.
    // A confirmation only counts as a rebooking if it lands well after the original
    // booking. Re-sending a confirmation a few hours later (the customer never got the
    // first one) is not rebooking, and treating it as such moved a booking from the
    // person who took it to the person who chased it.
    const REBOOK_MIN_GAP_MS = 24 * 60 * 60 * 1000;

    // ...and even then, only when the original booker has left. A confirmation is weak
    // evidence: it cannot distinguish "I moved this appointment" from "I confirmed it the
    // day before", and the reschedule columns that could have settled it are dead
    // (is_reschedule is 0 on all 7,131 booked leads). Applying it to everyone took real
    // sales off active bookers - Paul lost a lead he booked in July because someone else
    // sent the confirmation the day before the appointment.
    //
    // Restricting it to departed bookers targets the actual problem: a booker who left
    // months ago still holding turn-ups and sales that a current booker earned, with no
    // way to correct it. An active booker keeps everything they booked.
    const activityWindowStart = `${addDays(endDate, -30)}T00:00:00`;
    const { data: activeRows, error: activeError } = await supabase
      .from('leads')
      .select('booked_by')
      .not('booked_by', 'is', null)
      .gte('booked_at', activityWindowStart)
      .lt('booked_at', endTsExclusive);
    if (activeError) throw activeError;
    const activeBookerIds = new Set((activeRows || []).map(r => r.booked_by));

    const allLeadIds = [...new Set(Object.keys(leadLookup))];
    const lastRebookedBy = {};
    const anyConfirmationSender = {};
    for (let i = 0; i < allLeadIds.length; i += 50) {
      const chunk = allLeadIds.slice(i, i + 50);
      const { data: msgs, error: msgError } = await supabase
        .from('messages')
        .select('lead_id, sent_by, created_at')
        .in('lead_id', chunk)
        .ilike('subject', '%booking confirmation%')
        .order('created_at', { ascending: true });
      if (msgError) throw msgError;
      // Ascending order means the last qualifying write per lead wins.
      for (const m of msgs || []) {
        if (!m.sent_by) continue;
        anyConfirmationSender[m.lead_id] = m.sent_by;
        if (opsAccountIds.has(m.sent_by)) continue;
        const lead = leadLookup[m.lead_id];
        const bookedAt = lead && lead.booked_at ? new Date(lead.booked_at).getTime() : null;
        const sentAt = new Date(m.created_at).getTime();
        if (bookedAt === null || sentAt - bookedAt >= REBOOK_MIN_GAP_MS) {
          lastRebookedBy[m.lead_id] = m.sent_by;
        }
      }
    }

    // Who took the booking. This is fixed at the moment the booking happens and can never
    // move afterwards - a rebooking later is a separate event, not a rewrite of history.
    // Keeping this on booked_by is also what makes Bookings Made agree with the dashboard.
    function getBookingCreditId(lead) {
      if (lead.booked_by) return lead.booked_by;
      if (lead.booker_id) return lead.booker_id;
      if (anyConfirmationSender[lead.id]) return anyConfirmationSender[lead.id];
      return 'unknown';
    }

    // Who owns the appointment as it now stands - used for turn-up outcomes and sales.
    // A booker who rebooked the lead did the work that put the customer in the chair, so
    // they take it from the original booker (who may have left months ago).
    function getAppointmentCreditId(lead) {
      const original = getBookingCreditId(lead);
      const rebooker = lastRebookedBy[lead.id];
      if (rebooker && rebooker !== original && !activeBookerIds.has(original)) return rebooker;
      return original;
    }

    const byBooker = {};
    function ensureBooker(id) {
      if (!byBooker[id]) byBooker[id] = emptyMetrics();
      return byBooker[id];
    }

    // Bookings made = every booking taken in the window, full stop. Cancelling a booking
    // wipes its date_booked, so filtering on "still has an appointment date" quietly threw
    // away ~19% of all bookings ever made (1,342 leads) and undercounted this metric by a
    // quarter in a typical week. The booker still made the booking; the customer cancelled.
    // Counting only surviving bookings also made this disagree with the dashboard.
    const liveBookedLeads = bookedLeads || [];
    for (const lead of liveBookedLeads) {
      const bookerId = getBookingCreditId(lead);
      const m = ensureBooker(bookerId);
      m.bookingsMade += 1;
      // Cancelled with the date wiped: counts as a booking, but can never be placed on a
      // calendar week, so the show rate below cannot see it. Surfaced so that blind spot
      // is visible rather than silently flattering the rate.
      if (!lead.date_booked) m.cancelledDateWiped += 1;
    }

    // Two independent proofs that a person was actually in the building. Either one
    // outranks whatever the lead currently says, because turning up is not something a
    // later status change can undo - once they walked in, they walked in.
    //
    //   1. A sale attached to the appointment. Checked across all time, not just the
    //      reporting window, since a sale is often recorded days after the appointment.
    //   2. The activity log showing the lead was moved to a turn-up status at some point,
    //      even if that status has since been overwritten by a cancellation or reschedule.
    const calendarLeadIds = [...new Set((calendarLeads || []).map(l => l.id))];
    const provenTurnUp = new Set();
    for (let i = 0; i < calendarLeadIds.length; i += 200) {
      const chunk = calendarLeadIds.slice(i, i + 200);

      const { data: saleRows, error: saleLookupError } = await supabase
        .from('sales')
        .select('lead_id')
        .in('lead_id', chunk);
      if (saleLookupError) throw saleLookupError;
      for (const r of saleRows || []) if (r.lead_id) provenTurnUp.add(r.lead_id);

      const { data: histRows, error: histError } = await supabase
        .from('booker_activity_log')
        .select('lead_id')
        .in('lead_id', chunk)
        .eq('activity_type', 'status_change')
        .in('new_value', SHOWED_STATUSES);
      if (histError) throw histError;
      for (const r of histRows || []) if (r.lead_id) provenTurnUp.add(r.lead_id);
    }

    // On-calendar outcomes, in priority order. An appointment left at its default 'Booked'
    // state after its date has passed is a no-show: the CRM cannot tell "nobody came" apart
    // from "nobody wrote it down", and treating the blank as neutral would let an unkept
    // diary hide every miss. So `pending` means exactly one thing - the slot is still to come.
    const nowTs = Date.now();
    for (const lead of calendarLeads || []) {
      const bookerId = getAppointmentCreditId(lead);
      const m = ensureBooker(bookerId);
      m.onCalendar += 1;
      const slotHasBeen = new Date(lead.date_booked).getTime() < nowTs;
      if (provenTurnUp.has(lead.id)) {
        m.showed += 1;
      } else if (SHOWED_STATUSES.includes(lead.booking_status) || SHOWED_STATUSES.includes(lead.status)) {
        m.showed += 1;
      } else if (lead.status === 'Cancelled') {
        // Final outcome wins. Reschedules often go on to cancel (120 of the 259 leads
        // carrying a Reschedule marker are cancelled), and in that case the marker is
        // just stale history - the booking ended as a cancellation and is scored as one.
        m.cancelled += 1;
      } else if (lead.booking_status === 'Reschedule') {
        // Moved, not missed. Still live, so it is scored in whichever week its date_booked
        // now points at and must not also count against the week it moved out of. Never a
        // no-show: the customer did not fail to attend, the appointment stopped existing
        // on that date.
        m.rescheduled += 1;
      } else if (lead.booking_status === 'No Show' || slotHasBeen) {
        m.noShow += 1;
      } else {
        m.pending += 1;
      }
    }

    // Sales
    const salesDetail = [];
    for (const sale of allSales) {
      const lead = sale.lead_id ? leadLookup[sale.lead_id] : null;
      const bookerId = lead ? getAppointmentCreditId(lead) : 'unknown';
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

    // Show rate = of every appointment that has had its chance, how many put a person in
    // the building. Only appointments still to come are left out.
    for (const id of Object.keys(byBooker)) {
      const m = byBooker[id];
      m.counted = m.showed + m.noShow + m.cancelled;
      m.showRate = m.counted > 0 ? Math.round((m.showed / m.counted) * 1000) / 10 : null;
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
      totals.rescheduled += m.rescheduled;
      totals.cancelledDateWiped += m.cancelledDateWiped;
      totals.counted += m.showed + m.noShow + m.cancelled;
      totals.salesCount += m.salesCount;
      totals.revenue += m.revenue;
    }
    totals.showRate = totals.counted > 0 ? Math.round((totals.showed / totals.counted) * 1000) / 10 : null;

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
        const bookerId = getBookingCreditId(l);
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
