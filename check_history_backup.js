const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: users } = await supabase.from('users').select('id, name');
  const userMap = {};
  for (const u of users) userMap[u.id] = u.name;

  // 1. Check the booking_history TABLE (the orphaned one)
  console.log('=== BOOKING_HISTORY TABLE (orphaned backup) ===');
  const { data: allHist, count: totalCount } = await supabase
    .from('booking_history')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(30);

  console.log(`Total entries in table: ${totalCount}\n`);

  if (allHist && allHist.length > 0) {
    // Summary by action type
    const actionCounts = {};
    for (const h of allHist) {
      actionCounts[h.action] = (actionCounts[h.action] || 0) + 1;
    }
    console.log('Action types (last 30):', JSON.stringify(actionCounts));

    console.log('\nRecent entries:');
    for (const h of allHist.slice(0, 15)) {
      const who = userMap[h.performed_by] || userMap[h.user_id] || h.performed_by || h.user_id || '?';
      let details = '';
      try {
        const d = typeof h.details === 'string' ? JSON.parse(h.details) : h.details;
        if (d) details = JSON.stringify(d).substring(0, 150);
      } catch(e) { details = String(h.details || '').substring(0, 150); }
      console.log(`  [${h.created_at}] ${h.action} by ${who} | lead: ${h.lead_id} | ${details}`);
    }
  }

  // 2. Check the leads.booking_history JSON column - how many leads have data?
  console.log('\n\n=== LEADS.BOOKING_HISTORY JSON COLUMN ===');
  const { data: leadsWithHistory } = await supabase
    .from('leads')
    .select('id, name, booking_history, booker_id, booked_by')
    .not('booking_history', 'is', null)
    .limit(100);

  let withActualHistory = 0;
  let totalEntries = 0;
  const sampleLeads = [];

  if (leadsWithHistory) {
    for (const l of leadsWithHistory) {
      let hist = l.booking_history;
      if (typeof hist === 'string') {
        try { hist = JSON.parse(hist); } catch(e) { continue; }
      }
      if (Array.isArray(hist) && hist.length > 0) {
        withActualHistory++;
        totalEntries += hist.length;
        if (sampleLeads.length < 5) {
          sampleLeads.push({ name: l.name, count: hist.length, entries: hist });
        }
      }
    }
  }

  console.log(`Leads with non-empty booking_history JSON: ${withActualHistory}`);
  console.log(`Total history entries across all leads: ${totalEntries}`);

  if (sampleLeads.length > 0) {
    console.log('\nSample leads with history:');
    for (const sl of sampleLeads) {
      console.log(`\n  ${sl.name} (${sl.count} entries):`);
      for (const e of sl.entries.slice(0, 3)) {
        console.log(`    [${e.timestamp}] ${e.action} by ${e.performedByName} — ${JSON.stringify(e.details || {}).substring(0, 120)}`);
      }
    }
  }

  // 3. Now check the 4 sales leads specifically in the booking_history TABLE
  console.log('\n\n=== SALES LEADS IN BOOKING_HISTORY TABLE ===');
  const { data: sales } = await supabase
    .from('sales')
    .select('lead_id, amount')
    .gte('created_at', '2026-06-15T00:00:00')
    .lt('created_at', '2026-06-22T00:00:00');

  for (const s of sales) {
    const { data: hist } = await supabase
      .from('booking_history')
      .select('*')
      .eq('lead_id', s.lead_id)
      .order('created_at', { ascending: true });

    const { data: lead } = await supabase
      .from('leads')
      .select('name')
      .eq('id', s.lead_id)
      .single();

    console.log(`\n${lead?.name || s.lead_id} (£${s.amount}):`);
    if (hist && hist.length > 0) {
      for (const h of hist) {
        const who = userMap[h.performed_by] || userMap[h.user_id] || '?';
        console.log(`  [${h.created_at}] ${h.action} by ${who}`);
      }
    } else {
      console.log('  (no entries in booking_history table)');
    }
  }

  // 4. Check messages table - are user_ids being set on any messages?
  console.log('\n\n=== MESSAGE USER ATTRIBUTION CHECK ===');
  const { data: recentMsgs } = await supabase
    .from('messages')
    .select('id, lead_id, user_id, type, direction, subject, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  let withUser = 0;
  let withoutUser = 0;
  if (recentMsgs) {
    for (const m of recentMsgs) {
      if (m.user_id) withUser++;
      else withoutUser++;
    }
    console.log(`Last 20 messages: ${withUser} WITH user_id, ${withoutUser} WITHOUT`);
    console.log('\nRecent messages:');
    for (const m of recentMsgs.slice(0, 10)) {
      console.log(`  [${m.created_at}] ${m.direction} ${m.type} | user: ${m.user_id ? userMap[m.user_id] || m.user_id : 'NULL'} | "${(m.subject || '').substring(0, 50)}"`);
    }
  }
}

run().catch(e => console.error(e));
