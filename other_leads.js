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

  const { data: calLeads } = await supabase
    .from('leads')
    .select('id, name, status, booking_status, date_booked, booker_id, booked_by, booked_at, notes')
    .gte('date_booked', start)
    .lt('date_booked', end);

  const { data: bookedLeads } = await supabase
    .from('leads')
    .select('id, name, status, booking_status, date_booked, booker_id, booked_by, booked_at, notes')
    .gte('booked_at', start)
    .lt('booked_at', end);

  const { data: sales } = await supabase
    .from('sales')
    .select('id, lead_id, amount, created_at')
    .gte('created_at', start)
    .lt('created_at', end);

  const allIds = [...new Set([...calLeads.map(l => l.id), ...bookedLeads.map(l => l.id), ...sales.map(s => s.lead_id).filter(Boolean)])];

  const confMap = {};
  for (let i = 0; i < allIds.length; i += 50) {
    const chunk = allIds.slice(i, i + 50);
    const { data: msgs } = await supabase
      .from('messages')
      .select('lead_id, sent_by, created_at')
      .in('lead_id', chunk)
      .like('subject', 'Booking Confirmation %')
      .order('created_at', { ascending: true });
    if (msgs) {
      for (const m of msgs) {
        if (!confMap[m.lead_id] && m.sent_by) confMap[m.lead_id] = m.sent_by;
      }
    }
  }

  function attributeLead(lead) {
    const bookedBy = lead.booked_by;
    const confBy = confMap[lead.id];
    const bookerId = lead.booker_id;
    let method, confidence, origId;

    if (bookedBy && confBy && bookedBy === confBy) {
      method = 'booked_by + confirmation';
      confidence = 'HIGH';
      origId = bookedBy;
    } else if (bookedBy && confBy && bookedBy !== confBy) {
      method = 'booked_by (conf differs: ' + (userMap[confBy] || '?') + ')';
      confidence = 'MEDIUM';
      origId = bookedBy;
    } else if (bookedBy) {
      method = 'booked_by only';
      confidence = 'HIGH';
      origId = bookedBy;
    } else if (confBy) {
      method = '1st confirmation only';
      confidence = 'HIGH';
      origId = confBy;
    } else if (bookerId) {
      method = 'booker_id fallback';
      confidence = 'LOW';
      origId = bookerId;
    } else {
      method = 'no data';
      confidence = 'NONE';
      origId = null;
    }
    return { origId, origName: origId ? (userMap[origId] || 'Unknown') : 'Unknown', method, confidence };
  }

  // BOOKINGS MADE
  console.log('=== BOOKINGS MADE: June 15-21 ===\n');
  const bookingStats = {};
  for (const l of bookedLeads) {
    const attr = attributeLead(l);
    if (!bookingStats[attr.origName]) bookingStats[attr.origName] = { total: 0, high: 0, medium: 0, low: 0, lowLeads: [] };
    bookingStats[attr.origName].total++;
    if (attr.confidence === 'HIGH') bookingStats[attr.origName].high++;
    else if (attr.confidence === 'MEDIUM') bookingStats[attr.origName].medium++;
    else { bookingStats[attr.origName].low++; bookingStats[attr.origName].lowLeads.push(l.name); }
  }

  console.log('Booker          | Total | HIGH  | MEDIUM | LOW   | Accuracy');
  console.log('-'.repeat(75));
  for (const [name, st] of Object.entries(bookingStats).sort((a, b) => b[1].total - a[1].total)) {
    const accuracy = st.total > 0 ? (((st.high + st.medium) / st.total) * 100).toFixed(1) + '%' : '-';
    console.log(`${name.padEnd(16)}| ${String(st.total).padEnd(6)}| ${String(st.high).padEnd(6)}| ${String(st.medium).padEnd(7)}| ${String(st.low).padEnd(6)}| ${accuracy}`);
    if (st.lowLeads.length > 0 && st.lowLeads.length <= 5) {
      for (const ln of st.lowLeads) console.log(`  ⚠️ ${ln}`);
    } else if (st.lowLeads.length > 5) {
      console.log(`  ⚠️ ${st.lowLeads.length} leads on booker_id fallback`);
    }
  }

  // ON CALENDAR
  console.log('\n=== ON CALENDAR: June 15-21 ===\n');
  const showedStatuses = ['Attended', 'Arrived', 'Left', 'No Sale'];
  const calStats = {};

  for (const l of calLeads) {
    const attr = attributeLead(l);
    if (!calStats[attr.origName]) calStats[attr.origName] = { onCal:0, showed:0, noShow:0, cancelled:0, pending:0, high:0, medium:0, low:0, lowLeads:[] };
    const st = calStats[attr.origName];
    st.onCal++;
    if (attr.confidence === 'HIGH') st.high++;
    else if (attr.confidence === 'MEDIUM') st.medium++;
    else { st.low++; st.lowLeads.push({ name: l.name, status: l.status, bs: l.booking_status, bkr: userMap[l.booker_id] }); }

    if (l.status === 'Cancelled') st.cancelled++;
    else if (showedStatuses.includes(l.booking_status) || showedStatuses.includes(l.status)) st.showed++;
    else if (l.booking_status === 'No Show') st.noShow++;
    else st.pending++;
  }

  console.log('Booker          | On Cal | Showed | NoShow | Cancel | Pend | Show%  | HIGH | MED  | LOW  | Accuracy');
  console.log('-'.repeat(115));

  let gt = { onCal:0, showed:0, noShow:0, cancelled:0, pending:0, high:0, medium:0, low:0 };
  for (const [name, st] of Object.entries(calStats).sort((a, b) => b[1].onCal - a[1].onCal)) {
    const showRate = st.onCal > 0 ? ((st.showed / st.onCal) * 100).toFixed(1) + '%' : '-';
    const accuracy = st.onCal > 0 ? (((st.high + st.medium) / st.onCal) * 100).toFixed(1) + '%' : '-';
    console.log(`${name.padEnd(16)}| ${String(st.onCal).padEnd(7)}| ${String(st.showed).padEnd(7)}| ${String(st.noShow).padEnd(7)}| ${String(st.cancelled).padEnd(7)}| ${String(st.pending).padEnd(5)}| ${showRate.padEnd(7)}| ${String(st.high).padEnd(5)}| ${String(st.medium).padEnd(5)}| ${String(st.low).padEnd(5)}| ${accuracy}`);
    for (const ll of st.lowLeads.slice(0, 3)) {
      console.log(`  ⚠️ ${ll.name} (${ll.status}/${ll.bs}) — fallback: ${ll.bkr}`);
    }
    if (st.lowLeads.length > 3) console.log(`  ... +${st.lowLeads.length - 3} more LOW`);
    gt.onCal+=st.onCal; gt.showed+=st.showed; gt.noShow+=st.noShow; gt.cancelled+=st.cancelled; gt.pending+=st.pending; gt.high+=st.high; gt.medium+=st.medium; gt.low+=st.low;
  }
  console.log('-'.repeat(115));
  const gtAcc = (((gt.high+gt.medium)/gt.onCal)*100).toFixed(1)+'%';
  console.log(`${'TOTAL'.padEnd(16)}| ${String(gt.onCal).padEnd(7)}| ${String(gt.showed).padEnd(7)}| ${String(gt.noShow).padEnd(7)}| ${String(gt.cancelled).padEnd(7)}| ${String(gt.pending).padEnd(5)}| ${((gt.showed/gt.onCal)*100).toFixed(1).padEnd(6)}%| ${String(gt.high).padEnd(5)}| ${String(gt.medium).padEnd(5)}| ${String(gt.low).padEnd(5)}| ${gtAcc}`);

  // SALES
  console.log('\n=== SALES: June 15-21 ===\n');
  for (const s of sales) {
    let lead = calLeads.find(l => l.id === s.lead_id) || bookedLeads.find(l => l.id === s.lead_id);
    if (!lead) { const { data: ld } = await supabase.from('leads').select('id, name, booked_by, booker_id').eq('id', s.lead_id).single(); lead = ld; }
    if (!lead) { console.log(`  ??? £${s.amount}`); continue; }
    const attr = attributeLead(lead);
    const icon = attr.confidence === 'HIGH' ? '✓' : attr.confidence === 'MEDIUM' ? '~' : '⚠️';
    console.log(`  ${icon} ${lead.name.padEnd(22)} | £${String(parseFloat(s.amount)).padEnd(6)} | ${attr.origName.padEnd(12)} | ${attr.confidence} — ${attr.method}`);
  }

  // OVERALL CONFIDENCE
  console.log('\n=== OVERALL CONFIDENCE ===\n');
  const allLeads = [...new Map([...calLeads, ...bookedLeads].map(l => [l.id, l])).values()];
  let tH=0, tM=0, tL=0, tN=0;
  for (const l of allLeads) {
    const attr = attributeLead(l);
    if (attr.confidence==='HIGH') tH++; else if (attr.confidence==='MEDIUM') tM++; else if (attr.confidence==='LOW') tL++; else tN++;
  }
  const t = allLeads.length;
  console.log(`Total unique leads: ${t}`);
  console.log(`  HIGH:   ${tH} (${(tH/t*100).toFixed(1)}%) — booked_by and/or 1st confirmation match`);
  console.log(`  MEDIUM: ${tM} (${(tM/t*100).toFixed(1)}%) — booked_by set but 1st confirmation differs (rebook scenario)`);
  console.log(`  LOW:    ${tL} (${(tL/t*100).toFixed(1)}%) — using booker_id fallback only`);
  console.log(`  NONE:   ${tN}`);
  console.log(`\n  Reliable: ${tH+tM}/${t} = ${((tH+tM)/t*100).toFixed(1)}%`);
  console.log(`  At risk:  ${tL}/${t} = ${((tL)/t*100).toFixed(1)}% — these could be wrong if the lead was ever reassigned`);
}

run().catch(e => console.error(e));
