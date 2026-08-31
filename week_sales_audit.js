const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: users } = await supabase.from('users').select('id, name');
  const userMap = {};
  for (const u of users) userMap[u.id] = u.name;

  const start = '2026-06-15T00:00:00';
  const end = '2026-06-22T00:00:00';

  // ============================================================
  // CHECK 1: Sales — verify every sale, its amount, and attribution
  // ============================================================
  console.log('=== CHECK 1: SALES VERIFICATION ===');
  const { data: sales } = await supabase
    .from('sales')
    .select('id, lead_id, amount, created_at, user_id')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true });

  let totalRevenue = 0;
  const salesByBooker = {};

  for (const s of sales) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, name, booked_by, booker_id')
      .eq('id', s.lead_id)
      .single();

    // Get first booking confirmation
    const { data: firstConf } = await supabase
      .from('messages')
      .select('sent_by, sent_by_name, created_at')
      .eq('lead_id', s.lead_id)
      .like('subject', 'Booking Confirmation %')
      .order('created_at', { ascending: true })
      .limit(1);

    const amt = parseFloat(s.amount);
    totalRevenue += amt;

    const bookedBy = lead?.booked_by ? userMap[lead.booked_by] : null;
    const confBy = firstConf?.[0]?.sent_by ? userMap[firstConf[0].sent_by] : null;
    const bookerId = lead?.booker_id ? userMap[lead.booker_id] : null;

    // Determine original booker (same priority as report)
    const originalBooker = bookedBy || confBy || bookerId || 'Unknown';

    // Check if all 3 sources agree
    const sources = [bookedBy, confBy, bookerId].filter(Boolean);
    const allAgree = sources.every(s => s === sources[0]);

    salesByBooker[originalBooker] = (salesByBooker[originalBooker] || 0) + amt;

    console.log(`  ${lead?.name || '?'} | £${amt} | booked_by: ${bookedBy || 'NULL'} | 1st conf: ${confBy || 'NULL'} | booker_id: ${bookerId || 'NULL'} | → ${originalBooker} ${allAgree ? '✓' : '⚠️ MISMATCH'}`);
  }

  console.log(`\n  Total sales: ${sales.length} | Total revenue: £${totalRevenue}`);
  console.log('  Revenue by original booker:');
  for (const [name, rev] of Object.entries(salesByBooker).sort((a,b) => b[1] - a[1])) {
    console.log(`    ${name}: £${rev}`);
  }

  // ============================================================
  // CHECK 2: On-calendar count — verify total and per-booker
  // ============================================================
  console.log('\n=== CHECK 2: ON-CALENDAR VERIFICATION ===');
  const { data: calLeads, count: calCount } = await supabase
    .from('leads')
    .select('id, name, status, booking_status, date_booked, booker_id, booked_by', { count: 'exact' })
    .gte('date_booked', start)
    .lt('date_booked', end);

  console.log(`  Total on calendar: ${calCount}`);

  const showedStatuses = ['Attended', 'Arrived', 'Left', 'No Sale'];
  let showed = 0, noShow = 0, cancelled = 0, pending = 0;
  const calByBooker = {};

  for (const l of calLeads) {
    const bookedBy = l.booked_by ? userMap[l.booked_by] : null;
    const bookerId = l.booker_id ? userMap[l.booker_id] : null;

    if (l.status === 'Cancelled') cancelled++;
    else if (showedStatuses.includes(l.booking_status) || showedStatuses.includes(l.status)) showed++;
    else if (l.booking_status === 'No Show') noShow++;
    else pending++;
  }

  console.log(`  Showed: ${showed} | No Show: ${noShow} | Cancelled: ${cancelled} | Pending: ${pending}`);
  console.log(`  Sum check: ${showed} + ${noShow} + ${cancelled} + ${pending} = ${showed + noShow + cancelled + pending} (should equal ${calCount})`);
  console.log(`  Show rate: ${(showed / calCount * 100).toFixed(1)}%`);

  // ============================================================
  // CHECK 3: Bookings made — verify count
  // ============================================================
  console.log('\n=== CHECK 3: BOOKINGS MADE VERIFICATION ===');
  const { count: bookingsCount } = await supabase
    .from('leads')
    .select('id', { count: 'exact' })
    .gte('booked_at', start)
    .lt('booked_at', end);

  console.log(`  Total bookings made this week: ${bookingsCount}`);

  // Verify per-booker bookings
  const { data: bookingsAll } = await supabase
    .from('leads')
    .select('id, name, booker_id, booked_by, booked_at, date_booked')
    .gte('booked_at', start)
    .lt('booked_at', end);

  const bkByBooker = {};
  for (const l of bookingsAll) {
    const orig = l.booked_by ? userMap[l.booked_by] : userMap[l.booker_id] || 'Unknown';
    bkByBooker[orig] = (bkByBooker[orig] || 0) + 1;
  }
  console.log('  By original booker:');
  for (const [name, count] of Object.entries(bkByBooker).sort((a,b) => b[1] - a[1])) {
    console.log(`    ${name}: ${count}`);
  }
  const bkSum = Object.values(bkByBooker).reduce((a, b) => a + b, 0);
  console.log(`  Sum: ${bkSum} (should equal ${bookingsCount})`);

  // ============================================================
  // CHECK 4: Per-booker on-calendar cross-check
  // ============================================================
  console.log('\n=== CHECK 4: PER-BOOKER ON-CALENDAR ===');

  // Fetch first booking confirmations for all calendar leads
  const calIds = calLeads.map(l => l.id);
  const confMap = {};
  for (let i = 0; i < calIds.length; i += 50) {
    const chunk = calIds.slice(i, i + 50);
    const { data: msgs } = await supabase
      .from('messages')
      .select('lead_id, sent_by')
      .in('lead_id', chunk)
      .like('subject', 'Booking Confirmation %')
      .order('created_at', { ascending: true });
    if (msgs) {
      for (const m of msgs) {
        if (!confMap[m.lead_id] && m.sent_by) confMap[m.lead_id] = m.sent_by;
      }
    }
  }

  const calPerBooker = {};
  const showPerBooker = {};
  const noShowPerBooker = {};
  const cancelPerBooker = {};

  for (const l of calLeads) {
    const origId = l.booked_by || confMap[l.id] || l.booker_id;
    const origName = userMap[origId] || 'Unknown';

    calPerBooker[origName] = (calPerBooker[origName] || 0) + 1;
    if (l.status === 'Cancelled') cancelPerBooker[origName] = (cancelPerBooker[origName] || 0) + 1;
    else if (showedStatuses.includes(l.booking_status) || showedStatuses.includes(l.status)) showPerBooker[origName] = (showPerBooker[origName] || 0) + 1;
    else if (l.booking_status === 'No Show') noShowPerBooker[origName] = (noShowPerBooker[origName] || 0) + 1;
  }

  for (const name of Object.keys(calPerBooker).sort()) {
    const onCal = calPerBooker[name] || 0;
    const sh = showPerBooker[name] || 0;
    const ns = noShowPerBooker[name] || 0;
    const cn = cancelPerBooker[name] || 0;
    const pend = onCal - sh - ns - cn;
    const rate = onCal > 0 ? (sh / onCal * 100).toFixed(1) + '%' : '-';
    console.log(`  ${name}: onCal=${onCal} showed=${sh} noShow=${ns} cancelled=${cn} pending=${pend} showRate=${rate}`);
  }
  const calSum = Object.values(calPerBooker).reduce((a, b) => a + b, 0);
  console.log(`  Sum: ${calSum} (should equal ${calCount})`);

  // ============================================================
  // CHECK 5: Revenue arithmetic
  // ============================================================
  console.log('\n=== CHECK 5: REVENUE ARITHMETIC ===');
  const amounts = sales.map(s => parseFloat(s.amount));
  console.log(`  Individual amounts: ${amounts.map(a => '£' + a).join(' + ')}`);
  console.log(`  Sum: £${amounts.reduce((a, b) => a + b, 0)}`);

  // ============================================================
  // CHECK 6: Misattribution risk — leads where booked_by differs from first confirmation
  // ============================================================
  console.log('\n=== CHECK 6: ATTRIBUTION MISMATCHES (sales leads only) ===');
  let mismatches = 0;
  for (const s of sales) {
    const { data: lead } = await supabase.from('leads').select('id, name, booked_by, booker_id').eq('id', s.lead_id).single();
    const { data: conf } = await supabase.from('messages').select('sent_by').eq('lead_id', s.lead_id).like('subject', 'Booking Confirmation %').order('created_at', { ascending: true }).limit(1);

    if (lead && conf && conf.length > 0) {
      const bookedBy = lead.booked_by;
      const confBy = conf[0].sent_by;
      const bookerId = lead.booker_id;

      if (bookedBy && confBy && bookedBy !== confBy) {
        console.log(`  ⚠️ ${lead.name}: booked_by=${userMap[bookedBy]} vs 1st conf=${userMap[confBy]}`);
        mismatches++;
      }
      if (bookedBy && bookerId && bookedBy !== bookerId) {
        console.log(`  ℹ️ ${lead.name}: booked_by=${userMap[bookedBy]} but current booker_id=${userMap[bookerId]} (reassigned)`);
      }
    }
  }
  if (mismatches === 0) console.log('  ✓ No mismatches — booked_by and first confirmation agree on all sales');

  console.log('\n=== AUDIT COMPLETE ===');
}

run().catch(e => console.error(e));
