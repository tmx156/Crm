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
    // Past appointments left at their default state with no outcome ever written down.
    // These are inside noShow (see below) - reported alongside it so a blank diary is
    // visibly a blank diary rather than passing as a recorded miss.
    unrecorded: 0,
    // Cancelled records superseded by a later live booking of the same customer: the
    // appointment was moved, not lost. Excluded from every other figure, surfaced here
    // so the suppression is auditable.
    rebookingShells: 0,
    // Return visits by customers who already bought, moved to a later date to be shot
    // again. Excluded from that later week; the turn-up is credited in the week of the
    // sale instead.
    reshoots: 0,
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
    const LEAD_FIELDS = 'id, name, phone, email, status, booking_status, date_booked, booker_id, booked_by, booked_at';
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
          supabase.from('leads').select(LEAD_FIELDS).eq('id', id).single()
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

    // Rebooking shells.
    //
    // Moving an appointment ought to change one lead's date_booked. In practice much of
    // the team cancels the lead and books a brand new record for the same customer,
    // usually within minutes - 19 times in August under one booker alone. Since
    // cancellations now keep their date_booked, the abandoned record sits on the calendar
    // as a lost appointment while its replacement counts as a fresh booking: one customer
    // and one appointment scored as two bookings and a cancellation. That reads as a
    // collapsing show rate caused entirely by how the booking was entered.
    //
    // A cancelled record is treated as a shell when the same customer has a later booking
    // that is not cancelled. Matched on the last 10 digits of the phone (the field is
    // written with and without country code and with stray spaces), falling back to email.
    // Name is deliberately not a fallback here - it is far too weak to justify deleting a
    // cancellation, and the same-name collisions are real.
    //
    // The sibling is looked up across all time rather than within the window: an
    // appointment moved into next month has its replacement outside the reporting range,
    // and scoring the shell as a loss in that case is the exact error being corrected.
    function customerKey(lead) {
      const digits = String(lead.phone || '').replace(/\D/g, '');
      if (digits.length >= 10) return 'p:' + digits.slice(-10);
      const email = String(lead.email || '').trim().toLowerCase();
      return email ? 'e:' + email : null;
    }

    // A phone number identifies a household, not a person. Couples and families book on
    // one number constantly here - Gary and Yvonne Dale, Dougie and Ruby Huyton, Rhys and
    // Scarlet Hardy - so contact details alone would let one person's cancellation be
    // written off by a different person's booking. Paul lost a real cancellation that way:
    // Sofia Hannah's, erased by Thea Griffiths' appointment on the same number.
    //
    // The forename settles it. A rebooking of the same customer always keeps it, while the
    // household cases differ on it every time. Titles are stripped so "Miss Susan Savage"
    // still matches "Susan Savage", and a bare forename matches its fuller version so
    // "Elizabeth" still matches "Elizabeth Donnelly".
    const NAME_TITLES = new Set(['mr', 'mrs', 'miss', 'ms', 'dr', 'mx', 'prof']);
    function forename(lead) {
      const tokens = String(lead.name || '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t && !NAME_TITLES.has(t));
      return tokens[0] || null;
    }
    function samePerson(a, b) {
      const fa = forename(a);
      const fb = forename(b);
      // An unreadable name is not evidence of anything - fall back to the contact match
      // rather than refusing every suppression on a record with a blank name.
      if (!fa || !fb) return true;
      return fa === fb;
    }

    const rebookingShells = new Set();
    {
      const windowLeads = Object.values(leadLookup);
      const cancelledLeads = windowLeads.filter(l => l.status === 'Cancelled' && customerKey(l));
      const phones = [...new Set(
        cancelledLeads.map(l => l.phone).filter(p => String(p || '').replace(/\D/g, '').length >= 10)
      )];
      const emails = [...new Set(
        cancelledLeads.filter(l => !customerKey(l).startsWith('p:')).map(l => l.email).filter(Boolean)
      )];

      const siblings = [];
      for (let i = 0; i < phones.length; i += 100) {
        const { data, error } = await supabase
          .from('leads')
          .select('id, name, phone, email, status, booked_at, booked_by, booker_id')
          .in('phone', phones.slice(i, i + 100));
        if (error) throw error;
        siblings.push(...(data || []));
      }
      for (let i = 0; i < emails.length; i += 100) {
        const { data, error } = await supabase
          .from('leads')
          .select('id, name, phone, email, status, booked_at, booked_by, booker_id')
          .in('email', emails.slice(i, i + 100));
        if (error) throw error;
        siblings.push(...(data || []));
      }

      // Live bookings per (booker, customer). Keyed by booker as well as customer so one
      // booker's cancellation is never written off by a different booker's rebooking -
      // that is a lost appointment for the first booker, and a real one.
      const liveByCustomer = {};
      for (const s of siblings) {
        if (s.status === 'Cancelled' || !s.booked_at) continue;
        const key = customerKey(s);
        if (!key) continue;
        (liveByCustomer[getBookingCreditId(s) + '|' + key] ||= []).push(s);
      }

      // Both records have to belong to the same reshuffle. A customer who cancels in
      // August and comes back of their own accord in October lost the August appointment,
      // and erasing it would hand the booker a cancellation for free.
      //
      // Measured on the gap between the two bookings rather than their order: a third of
      // the pairs in the data are entered the other way round - the replacement is booked
      // first and the stale record cancelled a moment later - and an order-dependent rule
      // silently misses those. Across July-September every genuine pair sits within 13
      // days and none at all fall between 14 and 30, so the threshold is nowhere near the
      // real cases on either side.
      const REBOOK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

      for (const lead of cancelledLeads) {
        if (!lead.booked_at) continue;
        const live = liveByCustomer[getBookingCreditId(lead) + '|' + customerKey(lead)];
        if (!live) continue;
        const shellTs = new Date(lead.booked_at).getTime();
        if (live.some(s => samePerson(s, lead) &&
              Math.abs(new Date(s.booked_at).getTime() - shellTs) <= REBOOK_WINDOW_MS)) {
          rebookingShells.add(lead.id);
        }
      }

      // Duplicates where BOTH copies were cancelled.
      //
      // The pair above needs a surviving booking to prove the appointment moved. When the
      // customer is lost, both copies are cancelled and neither proves anything - so one
      // lost customer is charged as two lost appointments. Six of James's nineteen are
      // this shape, and they are visibly one appointment: Leona Mercer twice at 15 Aug
      // 16:30, Elizabeth twice at 15 Aug 17:00, Marianne Hewitt at 17:00 and 17:30.
      //
      // Collapsed only when the copies sit on the same calendar day (or one never got a
      // date at all), which is what makes them the same appointment rather than two
      // genuine attempts a fortnight apart. The earliest is kept and carries the
      // cancellation; the rest are suppressed.
      const cancelledByCustomer = {};
      for (const lead of cancelledLeads) {
        if (!lead.booked_at || rebookingShells.has(lead.id)) continue;
        (cancelledByCustomer[getBookingCreditId(lead) + '|' + customerKey(lead)] ||= []).push(lead);
      }
      const dayOf = (l) => (l.date_booked ? String(l.date_booked).slice(0, 10) : null);
      for (const group of Object.values(cancelledByCustomer)) {
        if (group.length < 2) continue;
        group.sort((a, b) => new Date(a.booked_at) - new Date(b.booked_at));
        for (let i = 1; i < group.length; i++) {
          const dup = group[i];
          const twin = group.slice(0, i).find(k =>
            samePerson(k, dup) &&
            Math.abs(new Date(dup.booked_at).getTime() - new Date(k.booked_at).getTime()) <= REBOOK_WINDOW_MS &&
            (dayOf(k) === dayOf(dup) || !dayOf(k) || !dayOf(dup))
          );
          if (twin) rebookingShells.add(dup.id);
        }
      }
    }

    // Reshoots.
    //
    // A customer who buys is often moved to a later day to be shot again. That later date
    // is a return visit on an appointment already kept, not a new appointment - so it must
    // not be counted again in the week it was moved to, and the turn-up belongs to the week
    // they actually came in and bought.
    //
    // Moving them does not leave a reschedule entry (none of the twelve cases in the data
    // have one), so the appointment date they attended is gone. The sale is the surviving
    // evidence: it is stamped when the money was taken, which is while the customer was in
    // the building. The earliest sale therefore dates the visit.
    //
    // Detected as: the lead has a sale, and its current date_booked falls after that sale.
    // Nobody pays for a shoot that has not happened, so a booking sitting later than its
    // own sale is by definition a second visit.
    const RESHOOT_MIN_GAP_MS = 12 * 60 * 60 * 1000;
    const earliestSaleByLead = {};
    {
      const ids = [...new Set([
        ...Object.keys(leadLookup),
        ...allSales.map(s => s.lead_id).filter(Boolean)
      ])];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase
          .from('sales')
          .select('lead_id, created_at')
          .in('lead_id', ids.slice(i, i + 200));
        if (error) throw error;
        for (const r of data || []) {
          if (!r.lead_id || !r.created_at) continue;
          const ts = new Date(r.created_at).getTime();
          if (earliestSaleByLead[r.lead_id] === undefined || ts < earliestSaleByLead[r.lead_id]) {
            earliestSaleByLead[r.lead_id] = ts;
          }
        }
      }
    }

    const reshootMoves = new Set();
    for (const [id, lead] of Object.entries(leadLookup)) {
      const sale = earliestSaleByLead[id];
      if (sale === undefined || !lead.date_booked) continue;
      if (new Date(lead.date_booked).getTime() - sale >= RESHOOT_MIN_GAP_MS) reshootMoves.add(id);
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
    // A rebooking shell is not a booking either - the booker took this customer once and
    // moved them, so counting the abandoned record inflates the day's total by the number
    // of times the diary was reshuffled.
    const liveBookedLeads = (bookedLeads || []).filter(l => !rebookingShells.has(l.id));
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
    //
    // Rescheduling is a move, not an outcome. It is never scored for or against anybody:
    // the appointment simply leaves the week it was in - date_booked carries it out, so
    // that week loses it with nothing left behind - and lands in the week it now sits in,
    // where it is scored on what actually happens like any other appointment. `rescheduled`
    // below is therefore a tag counting how many of this week's appointments arrived by
    // being moved, NOT a bucket held apart from the show rate. Holding them apart is what
    // the old code did, and because nothing ever clears booking_status='Reschedule' it was
    // a permanent exemption rather than a deferral - 39 of 41 cross-week moves still carried
    // the flag and 10 already had dates in the past, so those appointments happened and
    // were never going to be scored in any week at all.
    const nowTs = Date.now();
    for (const lead of calendarLeads || []) {
      const bookerId = getAppointmentCreditId(lead);
      const m = ensureBooker(bookerId);
      // The moment the appointment time passes it is scored. No grace period: Confirmed and
      // Unconfirmed are just a booked lead with a phone call attached - neither records
      // anything about whether the customer walked in - so a slot that arrives and produces
      // no outcome is a no-show. It counts against the booker until somebody records what
      // actually happened, at which point it moves to Showed in the same week.
      const slotHasBeen = new Date(lead.date_booked).getTime() < nowTs;
      const turnedUp = provenTurnUp.has(lead.id) ||
        SHOWED_STATUSES.includes(lead.booking_status) ||
        SHOWED_STATUSES.includes(lead.status);

      // The abandoned half of a cancel-and-rebook. The customer still has an appointment
      // with this booker, so this record is a duplicate of it, not a lost slot. Kept out
      // of onCalendar as well - it was never an independent appointment. Evidence that
      // someone actually turned up against this record overrides the suppression: a
      // cancellation carrying a sale or an Arrived marker is a real attended appointment
      // that happens to share a phone number with a later booking.
      if (rebookingShells.has(lead.id) && !turnedUp) {
        m.rebookingShells += 1;
        continue;
      }

      // The reshoot slot. The appointment it belongs to was kept on the day of the sale
      // and is credited in that week below, so counting this date too would score one
      // visit twice - and score it in a week the customer had already bought in.
      if (reshootMoves.has(lead.id)) {
        m.reshoots += 1;
        continue;
      }

      m.onCalendar += 1;

      // Tag, not a bucket - this appointment is also counted in exactly one of the
      // outcomes below, and the show rate is blind to how it got to this week.
      if (lead.booking_status === 'Reschedule') m.rescheduled += 1;

      if (turnedUp && slotHasBeen) {
        // Turning up is not something a later status change can undo - once they walked
        // in, they walked in - so this outranks a cancellation recorded afterwards.
        m.showed += 1;
      } else if (!slotHasBeen) {
        // Nothing that has not happened yet can be an outcome. A turn-up marker on a
        // future slot is either a mis-click or a leftover from the appointment this one
        // replaced: one lead was marked Attended and corrected five hours later, and its
        // rebooking a week into the future still scored as a turn-up, inventing the whole
        // of that week's show rate.
        if (lead.status === 'Cancelled') m.cancelled += 1;
        else m.pending += 1;
      } else if (lead.status === 'Cancelled') {
        // Final outcome wins. Reschedules often go on to cancel (120 of the 259 leads
        // carrying a Reschedule marker are cancelled), and in that case the marker is
        // just stale history - the booking ended as a cancellation and is scored as one.
        m.cancelled += 1;
      } else {
        // The date has passed with nobody recorded as turning up. A stale Reschedule
        // marker lands here too: the flag says the appointment was moved, but it was
        // moved to this date, and this date has now been and gone. Treating the marker as
        // a permanent exemption meant a rescheduled appointment was never scored in any
        // week, whatever happened on the day - 39 of 41 cross-week moves still carried it
        // and 10 already had dates in the past.
        m.noShow += 1;
        if (lead.booking_status !== 'No Show') m.unrecorded += 1;
      }
    }

    // Credit the kept appointment back to the week it was actually kept in.
    //
    // The reshoot slot was skipped above, and the visit it replaced no longer has a
    // date_booked of its own - the move overwrote it. Without this the customer walks in,
    // buys, and leaves no turn-up anywhere: the week they came in loses a show it earned
    // and the show rate drops for making a sale.
    //
    // Dated on the earliest sale, which is the visit itself. Later sales against the same
    // lead are further purchases at the reshoot and count as revenue in their own weeks;
    // they must not each buy another turn-up, so this is once per lead.
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    const endMs = new Date(`${addDays(endDate, 1)}T00:00:00`).getTime();
    for (const leadId of reshootMoves) {
      const sale = earliestSaleByLead[leadId];
      if (sale < startMs || sale >= endMs) continue;
      const lead = leadLookup[leadId];
      if (!lead) continue;
      const m = ensureBooker(getAppointmentCreditId(lead));
      m.onCalendar += 1;
      m.showed += 1;
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
      totals.unrecorded += m.unrecorded;
      totals.rebookingShells += m.rebookingShells;
      totals.reshoots += m.reshoots;
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
