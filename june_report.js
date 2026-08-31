const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: users } = await supabase.from('users').select('id, name, role');
  const userMap = {};
  for (const u of users) userMap[u.id] = u.name;

  const startDate = '2026-06-08T00:00:00';
  const endDate = '2026-06-15T00:00:00';

  // ON CALENDAR: leads with date_booked in the period
  const { data: calendarLeads, error: e1 } = await supabase
    .from('leads')
    .select('id, name, status, booking_status, date_booked, booker_id, booked_at')
    .gte('date_booked', startDate)
    .lt('date_booked', endDate)
    .order('date_booked', { ascending: true });

  if (e1) { console.error('Calendar error:', e1.message); return; }

  // BOOKINGS MADE: leads with booked_at in the period
  const { data: bookedLeads, error: e2 } = await supabase
    .from('leads')
    .select('id, name, status, booking_status, date_booked, booker_id, booked_at')
    .gte('booked_at', startDate)
    .lt('booked_at', endDate)
    .order('booked_at', { ascending: true });

  if (e2) { console.error('Booked error:', e2.message); return; }

  // SALES in the period
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

  // Find original booker via first booking confirmation email
  const allLeadIds = [...new Set([
    ...calendarLeads.map(l => l.id),
    ...bookedLeads.map(l => l.id),
    ...allSales.map(s => s.lead_id).filter(Boolean)
  ])];

  const originalBookerMap = {};
  for (let i = 0; i < allLeadIds.length; i += 50) {
    const chunk = allLeadIds.slice(i, i + 50);
    const { data: msgs } = await supabase
      .from('messages')
      .select('lead_id, user_id, created_at')
      .in('lead_id', chunk)
      .like('subject', 'Booking Confirmation %')
      .order('created_at', { ascending: true });

    if (msgs) {
      for (const m of msgs) {
        if (!originalBookerMap[m.lead_id]) {
          originalBookerMap[m.lead_id] = m.user_id;
        }
      }
    }
  }

  function getOriginalBooker(lead) {
    const origId = originalBookerMap[lead.id];
    if (origId) return userMap[origId] || 'Unknown';
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
    if (l.date_booked >= '2026-06-08' && l.date_booked < '2026-06-15') bookingsByBooker[bookerName].thisWeek++;
    else bookingsByBooker[bookerName].future++;
  }

  // SALES STATS
  const salesByBooker = {};
  for (const s of allSales) {
    let bookerName = 'Unknown';
    if (s.lead_id) {
      const origId = originalBookerMap[s.lead_id];
      if (origId) bookerName = userMap[origId] || 'Unknown';
      else {
        const lead = calendarLeads.find(l => l.id === s.lead_id) || bookedLeads.find(l => l.id === s.lead_id);
        if (lead) bookerName = userMap[lead.booker_id] || 'Unknown';
        else bookerName = userMap[s.user_id] || 'Unknown';
      }
    }
    if (!salesByBooker[bookerName]) salesByBooker[bookerName] = { count: 0, revenue: 0, deals: [] };
    salesByBooker[bookerName].count++;
    salesByBooker[bookerName].revenue += parseFloat(s.amount || 0);
    salesByBooker[bookerName].deals.push(s);
  }

  // Combine all booker names
  const allBookers = [...new Set([...Object.keys(calByBooker), ...Object.keys(bookingsByBooker), ...Object.keys(salesByBooker)])].sort();

  console.log('=== BOOKER STATS: June 8-14, 2026 ===\n');
  console.log('Booker | Bookings Made | This Week Appt | Future Appt | On Calendar | Cancelled | Showed Up | Show Rate | No Show | Pending | Sales | Revenue');
  console.log('-'.repeat(140));

  let totals = { bookings: 0, thisWeek: 0, future: 0, onCal: 0, cancelled: 0, showed: 0, noShow: 0, pending: 0, sales: 0, revenue: 0 };

  for (const b of allBookers) {
    const bk = bookingsByBooker[b] || { total: 0, thisWeek: 0, future: 0 };
    const cal = calByBooker[b] || { onCal: 0, cancelled: 0, showed: 0, noShow: 0, pending: 0 };
    const sl = salesByBooker[b] || { count: 0, revenue: 0 };
    const showRate = cal.onCal > 0 ? ((cal.showed / cal.onCal) * 100).toFixed(1) + '%' : '0.0%';

    console.log(`${b} | ${bk.total} | ${bk.thisWeek} | ${bk.future} | ${cal.onCal} | ${cal.cancelled} | ${cal.showed} | ${showRate} | ${cal.noShow} | ${cal.pending} | ${sl.count} | £${sl.revenue.toFixed(0)}`);

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

  const totalShowRate = totals.onCal > 0 ? ((totals.showed / totals.onCal) * 100).toFixed(1) + '%' : '0.0%';
  console.log('-'.repeat(140));
  console.log(`TOTAL | ${totals.bookings} | ${totals.thisWeek} | ${totals.future} | ${totals.onCal} | ${totals.cancelled} | ${totals.showed} | ${totalShowRate} | ${totals.noShow} | ${totals.pending} | ${totals.sales} | £${totals.revenue.toFixed(0)}`);

  // Daily bookings
  console.log('\n=== DAILY BOOKINGS MADE ===');
  const days = ['2026-06-08','2026-06-09','2026-06-10','2026-06-11','2026-06-12','2026-06-13','2026-06-14'];
  const dayNames = ['Mon 8th','Tue 9th','Wed 10th','Thu 11th','Fri 12th','Sat 13th','Sun 14th'];

  for (let d = 0; d < days.length; d++) {
    const dayLeads = bookedLeads.filter(l => l.booked_at && l.booked_at.startsWith(days[d]));
    const byB = {};
    for (const l of dayLeads) {
      const bn = getOriginalBooker(l);
      byB[bn] = (byB[bn] || 0) + 1;
    }
    const parts = Object.entries(byB).sort((a,b) => b[1] - a[1]).map(([n,c]) => n + ':' + c).join(', ');
    console.log(`${dayNames[d]} | Total: ${dayLeads.length} | ${parts}`);
  }

  // Sales detail
  console.log('\n=== SALES DETAIL ===');
  for (const s of allSales) {
    let leadName = 'Unknown Lead';
    const lead = calendarLeads.find(l => l.id === s.lead_id) || bookedLeads.find(l => l.id === s.lead_id);
    if (lead) leadName = lead.name;
    else if (s.lead_id) {
      const { data: ld } = await supabase.from('leads').select('name').eq('id', s.lead_id).single();
      if (ld) leadName = ld.name;
    }
    let bookerName = 'Unknown';
    if (s.lead_id && originalBookerMap[s.lead_id]) bookerName = userMap[originalBookerMap[s.lead_id]];
    else if (lead) bookerName = userMap[lead.booker_id] || 'Unknown';

    const saleDate = new Date(s.created_at);
    const day = saleDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    console.log(`${leadName} | £${parseFloat(s.amount).toFixed(0)} | ${bookerName} | ${day}`);
  }
}

run().catch(e => console.error(e));
