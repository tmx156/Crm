const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: users } = await supabase.from('users').select('id, name');
  const userMap = {};
  for (const u of users) userMap[u.id] = u.name;

  const startDate = '2026-06-15T00:00:00';
  const endDate = '2026-06-22T00:00:00';

  // 1. ON CALENDAR: leads with date_booked in the period
  const { data: calendarLeads, error: e1 } = await supabase
    .from('leads')
    .select('id, name, status, booking_status, date_booked, booker_id, booked_by, booked_at')
    .gte('date_booked', startDate)
    .lt('date_booked', endDate)
    .order('date_booked', { ascending: true });
  if (e1) { console.error('Calendar error:', e1.message); return; }

  // 2. BOOKINGS MADE: leads with booked_at in the period
  const { data: bookedLeads, error: e2 } = await supabase
    .from('leads')
    .select('id, name, status, booking_status, date_booked, booker_id, booked_by, booked_at')
    .gte('booked_at', startDate)
    .lt('booked_at', endDate)
    .order('booked_at', { ascending: true });
  if (e2) { console.error('Booked error:', e2.message); return; }

  // 3. SALES in the period
  let allSales = [];
  let from = 0;
  while (true) {
    const { data: batch, error: se } = await supabase
      .from('sales')
      .select('id, lead_id, amount, created_at, user_id')
      .gte('created_at', startDate)
      .lt('created_at', endDate)
      .range(from, from + 199);
    if (se) { console.error('Sales error:', se.message); break; }
    allSales = allSales.concat(batch);
    if (batch.length < 200) break;
    from += 200;
  }

  // 4. Find original booker: booked_by → first booking confirmation sent_by → booker_id
  const allLeadIds = [...new Set([
    ...calendarLeads.map(l => l.id),
    ...bookedLeads.map(l => l.id),
    ...allSales.map(s => s.lead_id).filter(Boolean)
  ])];

  const confirmationBookerMap = {};
  for (let i = 0; i < allLeadIds.length; i += 50) {
    const chunk = allLeadIds.slice(i, i + 50);
    const { data: msgs } = await supabase
      .from('messages')
      .select('lead_id, sent_by, created_at')
      .in('lead_id', chunk)
      .like('subject', 'Booking Confirmation %')
      .order('created_at', { ascending: true });

    if (msgs) {
      for (const m of msgs) {
        if (!confirmationBookerMap[m.lead_id] && m.sent_by) {
          confirmationBookerMap[m.lead_id] = m.sent_by;
        }
      }
    }
  }

  const leadLookup = {};
  for (const l of calendarLeads) leadLookup[l.id] = l;
  for (const l of bookedLeads) leadLookup[l.id] = l;

  function getOriginalBooker(lead) {
    if (lead.booked_by) return userMap[lead.booked_by] || 'Unknown';
    const confId = confirmationBookerMap[lead.id];
    if (confId) return userMap[confId] || 'Unknown';
    return userMap[lead.booker_id] || 'Unknown';
  }

  // ON CALENDAR STATS
  const showedStatuses = ['Attended', 'Arrived', 'Left', 'No Sale'];
  const calByBooker = {};
  for (const l of calendarLeads) {
    const bookerName = getOriginalBooker(l);
    if (!calByBooker[bookerName]) calByBooker[bookerName] = { onCal: 0, cancelled: 0, showed: 0, noShow: 0, pending: 0 };
    calByBooker[bookerName].onCal++;
    if (l.status === 'Cancelled') calByBooker[bookerName].cancelled++;
    else if (showedStatuses.includes(l.booking_status) || showedStatuses.includes(l.status)) calByBooker[bookerName].showed++;
    else if (l.booking_status === 'No Show') calByBooker[bookerName].noShow++;
    else calByBooker[bookerName].pending++;
  }

  // BOOKINGS MADE STATS
  const bookingsByBooker = {};
  for (const l of bookedLeads) {
    const bookerName = getOriginalBooker(l);
    if (!bookingsByBooker[bookerName]) bookingsByBooker[bookerName] = { total: 0, thisWeek: 0, future: 0 };
    bookingsByBooker[bookerName].total++;
    if (l.date_booked && l.date_booked >= '2026-06-15' && l.date_booked < '2026-06-22') bookingsByBooker[bookerName].thisWeek++;
    else if (l.date_booked) bookingsByBooker[bookerName].future++;
    else bookingsByBooker[bookerName].total--;
  }

  // SALES STATS
  const salesByBooker = {};
  for (const s of allSales) {
    let bookerName = 'Unknown';
    if (s.lead_id) {
      let lead = leadLookup[s.lead_id];
      if (!lead) {
        const { data: ld } = await supabase.from('leads').select('id, name, booked_by, booker_id').eq('id', s.lead_id).single();
        if (ld) { lead = ld; leadLookup[ld.id] = ld; }
      }
      if (lead) bookerName = getOriginalBooker(lead);
    }
    if (!salesByBooker[bookerName]) salesByBooker[bookerName] = { count: 0, revenue: 0, deals: [] };
    salesByBooker[bookerName].count++;
    salesByBooker[bookerName].revenue += parseFloat(s.amount || 0);
    salesByBooker[bookerName].deals.push(s);
  }

  const allBookers = [...new Set([...Object.keys(calByBooker), ...Object.keys(bookingsByBooker), ...Object.keys(salesByBooker)])].sort();

  console.log('=== BOOKER STATS: June 15-21, 2026 ===\n');
  console.log('Booker          | Bookings | This Wk Appt | Future Appt | On Calendar | Cancelled | Showed | Show Rate | No Show | Pending | Sales | Revenue');
  console.log('-'.repeat(150));

  let totals = { bookings: 0, thisWeek: 0, future: 0, onCal: 0, cancelled: 0, showed: 0, noShow: 0, pending: 0, sales: 0, revenue: 0 };

  for (const b of allBookers) {
    const bk = bookingsByBooker[b] || { total: 0, thisWeek: 0, future: 0 };
    const cal = calByBooker[b] || { onCal: 0, cancelled: 0, showed: 0, noShow: 0, pending: 0 };
    const sl = salesByBooker[b] || { count: 0, revenue: 0 };
    const showRate = cal.onCal > 0 ? ((cal.showed / cal.onCal) * 100).toFixed(1) + '%' : '-';

    console.log(`${b.padEnd(16)}| ${String(bk.total).padEnd(9)}| ${String(bk.thisWeek).padEnd(13)}| ${String(bk.future).padEnd(12)}| ${String(cal.onCal).padEnd(12)}| ${String(cal.cancelled).padEnd(10)}| ${String(cal.showed).padEnd(7)}| ${showRate.padEnd(10)}| ${String(cal.noShow).padEnd(8)}| ${String(cal.pending).padEnd(8)}| ${String(sl.count).padEnd(6)}| £${sl.revenue.toFixed(0)}`);

    totals.bookings += bk.total;
    totals.thisWeek += bk.thisWeek;
    totals.future += bk.future;
    totals.onCal += cal.onCal;
    totals.cancelled += cal.cancelled;
    totals.showed += cal.showed;
    totals.noShow += cal.noShow;
    totals.pending += cal.pending;
    totals.sales += sl.count;
    totals.revenue += sl.revenue;
  }

  const totalShowRate = totals.onCal > 0 ? ((totals.showed / totals.onCal) * 100).toFixed(1) + '%' : '-';
  console.log('-'.repeat(150));
  console.log(`${'TOTAL'.padEnd(16)}| ${String(totals.bookings).padEnd(9)}| ${String(totals.thisWeek).padEnd(13)}| ${String(totals.future).padEnd(12)}| ${String(totals.onCal).padEnd(12)}| ${String(totals.cancelled).padEnd(10)}| ${String(totals.showed).padEnd(7)}| ${totalShowRate.padEnd(10)}| ${String(totals.noShow).padEnd(8)}| ${String(totals.pending).padEnd(8)}| ${String(totals.sales).padEnd(6)}| £${totals.revenue.toFixed(0)}`);

  // DAILY BOOKINGS
  console.log('\n=== DAILY BOOKINGS MADE ===');
  const days = ['2026-06-15','2026-06-16','2026-06-17','2026-06-18','2026-06-19','2026-06-20','2026-06-21'];
  const dayNames = ['Mon 15th','Tue 16th','Wed 17th','Thu 18th','Fri 19th','Sat 20th','Sun 21st'];

  for (let d = 0; d < days.length; d++) {
    const dayLeads = bookedLeads.filter(l => l.booked_at && l.booked_at.startsWith(days[d]));
    const byB = {};
    for (const l of dayLeads) {
      const bn = getOriginalBooker(l);
      byB[bn] = (byB[bn] || 0) + 1;
    }
    const parts = Object.entries(byB).sort((a,b) => b[1] - a[1]).map(([n,c]) => n + ': ' + c).join(', ');
    console.log(`  ${dayNames[d]} | Total: ${dayLeads.length} | ${parts}`);
  }

  // SALES DETAIL
  console.log('\n=== SALES DETAIL ===');
  for (const s of allSales) {
    let leadName = 'Unknown Lead';
    let bookerName = 'Unknown';
    let lead = leadLookup[s.lead_id];
    if (!lead && s.lead_id) {
      const { data: ld } = await supabase.from('leads').select('id, name, booked_by, booker_id').eq('id', s.lead_id).single();
      if (ld) { lead = ld; leadLookup[ld.id] = ld; }
    }
    if (lead) {
      leadName = lead.name;
      bookerName = getOriginalBooker(lead);
    }
    const saleDate = new Date(s.created_at);
    const day = saleDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    console.log(`  ${leadName} | £${parseFloat(s.amount).toFixed(0)} | Original booker: ${bookerName} | ${day}`);
  }

  // DAILY ON-CALENDAR
  console.log('\n=== DAILY ON-CALENDAR ===');
  for (let d = 0; d < days.length; d++) {
    const dayLeads = calendarLeads.filter(l => l.date_booked && l.date_booked.startsWith(days[d]));
    const showed = dayLeads.filter(l => showedStatuses.includes(l.booking_status) || showedStatuses.includes(l.status)).length;
    const noShow = dayLeads.filter(l => l.booking_status === 'No Show').length;
    const cancelled = dayLeads.filter(l => l.status === 'Cancelled').length;
    const pending = dayLeads.length - showed - noShow - cancelled;
    console.log(`  ${dayNames[d]} | On cal: ${dayLeads.length} | Showed: ${showed} | No Show: ${noShow} | Cancelled: ${cancelled} | Pending: ${pending}`);
  }
}

run().catch(e => console.error(e));
