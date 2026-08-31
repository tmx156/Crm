const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  // Check all users - is there a Lewis?
  const { data: users } = await supabase.from('users').select('id, name, email, role, is_active');
  console.log('=== ALL USERS ===');
  for (const u of users) {
    console.log(`  ${u.name} | ${u.email} | role: ${u.role} | active: ${u.is_active} | id: ${u.id}`);
  }

  // Check who created/modified these leads around their booked_at time
  const leadIds = [
    'olivia_id', // we need the actual IDs
  ];

  // Get the 4 sale leads
  const { data: sales } = await supabase
    .from('sales')
    .select('lead_id, amount')
    .gte('created_at', '2026-06-15T00:00:00')
    .lt('created_at', '2026-06-22T00:00:00');

  const saleLeadIds = sales.map(s => s.lead_id).filter(Boolean);

  // For Christine Hartley (booked_by: Paul, notes say LEWIS)
  // and Emma Denning (booked_by: NULL, notes say LEWIS)
  // Let's check the leads table audit columns
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, booked_by, booker_id, booked_at, created_at, notes')
    .in('id', saleLeadIds);

  const userMap = {};
  for (const u of users) userMap[u.id] = u.name;

  console.log('\n=== LEAD CREATION & BOOKING TIMELINE ===');
  for (const l of leads) {
    console.log(`\n${l.name}:`);
    console.log(`  Created: ${l.created_at}`);
    console.log(`  Booked at: ${l.booked_at}`);
    console.log(`  booked_by: ${l.booked_by ? userMap[l.booked_by] : 'NULL'}`);
    console.log(`  booker_id: ${l.booker_id ? userMap[l.booker_id] : 'NULL'}`);

    // Check if notes contain any user name signatures
    if (l.notes) {
      const noteLines = l.notes.split('\n').map(line => line.trim()).filter(Boolean);
      const lastLine = noteLines[noteLines.length - 1];
      console.log(`  Last line of notes: "${lastLine}"`);

      // Check if any user name appears in notes
      for (const u of users) {
        if (l.notes.toLowerCase().includes(u.name.toLowerCase().split(' ')[0])) {
          console.log(`  ** Notes mention: ${u.name} **`);
        }
      }
    }
  }

  // Check if Christine or Emma were ever assigned to someone else
  // Look at other leads with LEWIS signature to find patterns
  console.log('\n=== LEADS WITH "LEWIS" IN NOTES ===');
  const { data: lewisLeads, count: lewisCount } = await supabase
    .from('leads')
    .select('id, name, booker_id, booked_by, booked_at, notes', { count: 'exact' })
    .ilike('notes', '%LEWIS%')
    .limit(20);

  console.log(`Found ${lewisCount} leads with LEWIS in notes:`);
  if (lewisLeads) {
    for (const l of lewisLeads) {
      const booker = l.booker_id ? userMap[l.booker_id] : 'NULL';
      const origBooker = l.booked_by ? userMap[l.booked_by] : 'NULL';
      const noteEnd = l.notes ? l.notes.trim().split('\n').pop().trim() : '';
      console.log(`  ${l.name} | booker_id: ${booker} | booked_by: ${origBooker} | booked_at: ${l.booked_at} | notes end: "${noteEnd}"`);
    }
  }

  // Also check leads signed by Mel, Paul, Lucy to compare pattern
  console.log('\n=== LEADS WITH "- Mel" IN NOTES (sample) ===');
  const { data: melLeads, count: melCount } = await supabase
    .from('leads')
    .select('id, name, booker_id, booked_by', { count: 'exact' })
    .ilike('notes', '%- Mel%')
    .limit(5);
  console.log(`Found ${melCount} total`);
  if (melLeads) {
    for (const l of melLeads) {
      console.log(`  ${l.name} | booker_id: ${userMap[l.booker_id] || 'NULL'} | booked_by: ${userMap[l.booked_by] || 'NULL'}`);
    }
  }
}

run().catch(e => console.error(e));
