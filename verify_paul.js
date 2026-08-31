const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: users } = await supabase.from('users').select('id, name');
  const userMap = {};
  for (const u of users) userMap[u.id] = u.name;

  const paulId = '5202f54c-65ef-4b02-810e-929ed13afb41';
  const lucyId = '26115b0a-db69-4604-906e-6c938b60bd3e';
  const adminId = '8d5086a5-de59-4455-a4b3-82e4ff1e2fa3';

  // Get the two leads in question
  const { data: christine } = await supabase
    .from('leads')
    .select('*')
    .ilike('name', '%Christine Hartley%')
    .single();

  const { data: emma } = await supabase
    .from('leads')
    .select('*')
    .ilike('name', '%Emma Denning%')
    .single();

  for (const lead of [christine, emma]) {
    console.log('='.repeat(80));
    console.log(`LEAD: ${lead.name} (id: ${lead.id})`);
    console.log('-'.repeat(80));

    // All key fields
    console.log(`  created_at:   ${lead.created_at}`);
    console.log(`  booked_at:    ${lead.booked_at}`);
    console.log(`  booked_by:    ${lead.booked_by ? userMap[lead.booked_by] : 'NULL'} (${lead.booked_by})`);
    console.log(`  booker_id:    ${lead.booker_id ? userMap[lead.booker_id] : 'NULL'} (${lead.booker_id})`);
    console.log(`  created_by:   ${lead.created_by ? userMap[lead.created_by] || lead.created_by : 'NULL'}`);
    console.log(`  updated_by:   ${lead.updated_by ? userMap[lead.updated_by] || lead.updated_by : 'NULL'}`);
    console.log(`  status:       ${lead.status}`);
    console.log(`  date_booked:  ${lead.date_booked}`);
    console.log(`  source:       ${lead.source}`);
    console.log(`  notes:        ${(lead.notes || '').substring(0, 300)}`);

    // Check booking_history JSON
    console.log(`\n  --- booking_history JSON ---`);
    if (lead.booking_history && Array.isArray(lead.booking_history) && lead.booking_history.length > 0) {
      for (const h of lead.booking_history) {
        console.log(`    ${JSON.stringify(h).substring(0, 250)}`);
      }
    } else {
      console.log('    (empty/null)');
    }

    // Check booking_history table
    console.log(`\n  --- booking_history TABLE ---`);
    const { data: bh } = await supabase
      .from('booking_history')
      .select('*')
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: true });
    if (bh && bh.length > 0) {
      for (const h of bh) {
        console.log(`    [${h.created_at}] ${h.action} by ${userMap[h.user_id] || h.user_id} — ${JSON.stringify(h.details || {}).substring(0, 200)}`);
      }
    } else {
      console.log('    (none)');
    }

    // Check ALL messages for this lead
    console.log(`\n  --- ALL MESSAGES ---`);
    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: true });
    if (msgs && msgs.length > 0) {
      for (const m of msgs) {
        console.log(`    [${m.created_at}] ${m.direction} ${m.type} by ${userMap[m.user_id] || m.user_id} — subj: "${m.subject || ''}" — body: ${(m.body || '').substring(0, 150)}`);
      }
    } else {
      console.log('    (no messages)');
    }

    // Check if lead appears in any Google Sheets import or source data
    console.log(`\n  --- OTHER FIELDS ---`);
    const otherFields = ['phone', 'email', 'source', 'fb_lead_id', 'google_sheet_row'];
    for (const f of otherFields) {
      if (lead[f]) console.log(`    ${f}: ${lead[f]}`);
    }

    console.log('');
  }

  // Also check: who was booking leads around the same time as Christine (June 11 morning)?
  console.log('='.repeat(80));
  console.log('CONTEXT: Other leads booked around Christine Hartley time (June 11, 08:00-10:00)');
  console.log('-'.repeat(80));
  const { data: nearbyLeads } = await supabase
    .from('leads')
    .select('id, name, booker_id, booked_by, booked_at, notes')
    .gte('booked_at', '2026-06-11T08:00:00')
    .lt('booked_at', '2026-06-11T10:00:00')
    .order('booked_at', { ascending: true });
  if (nearbyLeads) {
    for (const l of nearbyLeads) {
      const noteEnd = l.notes ? l.notes.trim().split('\n').pop().trim().substring(0, 80) : '';
      console.log(`  [${l.booked_at}] ${l.name} | booker: ${userMap[l.booker_id] || 'NULL'} | booked_by: ${userMap[l.booked_by] || 'NULL'} | "${noteEnd}"`);
    }
  }

  // Context: who was booking around Emma's time (June 9 evening)?
  console.log('\nCONTEXT: Other leads booked around Emma Denning time (June 9, 18:00-20:30)');
  console.log('-'.repeat(80));
  const { data: nearbyLeads2 } = await supabase
    .from('leads')
    .select('id, name, booker_id, booked_by, booked_at, notes')
    .gte('booked_at', '2026-06-09T18:00:00')
    .lt('booked_at', '2026-06-09T20:30:00')
    .order('booked_at', { ascending: true });
  if (nearbyLeads2) {
    for (const l of nearbyLeads2) {
      const noteEnd = l.notes ? l.notes.trim().split('\n').pop().trim().substring(0, 80) : '';
      console.log(`  [${l.booked_at}] ${l.name} | booker: ${userMap[l.booker_id] || 'NULL'} | booked_by: ${userMap[l.booked_by] || 'NULL'} | "${noteEnd}"`);
    }
  }
}

run().catch(e => console.error(e));
