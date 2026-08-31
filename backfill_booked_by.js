const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DRY_RUN = process.argv.includes('--apply') ? false : true;

async function run() {
  const { data: users } = await supabase.from('users').select('id, name');
  const userMap = {};
  for (const u of users) userMap[u.id] = u.name;

  // Find all leads with NULL booked_by that have status Booked or ever_booked
  let allLeads = [];
  let from = 0;
  while (true) {
    const { data: batch, error } = await supabase
      .from('leads')
      .select('id, name, booker_id, booked_by, booked_at, status')
      .is('booked_by', null)
      .range(from, from + 499);
    if (error) { console.error('Error:', error.message); break; }
    if (!batch || batch.length === 0) break;
    allLeads = allLeads.concat(batch);
    from += 500;
  }

  console.log(`Found ${allLeads.length} leads with NULL booked_by\n`);

  // For each lead, find the first booking confirmation message
  let canFix = 0;
  let cannotFix = 0;
  let alreadyMatch = 0;
  const fixes = [];
  const fixesByBooker = {};

  for (let i = 0; i < allLeads.length; i += 50) {
    const chunk = allLeads.slice(i, i + 50);
    const ids = chunk.map(l => l.id);

    const { data: msgs } = await supabase
      .from('messages')
      .select('lead_id, sent_by, sent_by_name, created_at')
      .in('lead_id', ids)
      .like('subject', 'Booking Confirmation %')
      .order('created_at', { ascending: true });

    // Get the FIRST booking confirmation per lead
    const firstConfirmation = {};
    if (msgs) {
      for (const m of msgs) {
        if (!firstConfirmation[m.lead_id] && m.sent_by) {
          firstConfirmation[m.lead_id] = m;
        }
      }
    }

    for (const lead of chunk) {
      const conf = firstConfirmation[lead.id];
      if (conf && conf.sent_by) {
        const bookerName = userMap[conf.sent_by] || conf.sent_by_name || 'Unknown';
        if (lead.booker_id === conf.sent_by) {
          alreadyMatch++;
        }
        canFix++;
        fixes.push({
          id: lead.id,
          name: lead.name,
          originalBooker: conf.sent_by,
          originalBookerName: bookerName,
          currentBookerId: lead.booker_id,
          currentBookerName: userMap[lead.booker_id] || 'NULL',
          confirmationDate: conf.created_at
        });
        fixesByBooker[bookerName] = (fixesByBooker[bookerName] || 0) + 1;
      } else {
        cannotFix++;
      }
    }
  }

  console.log(`Can restore: ${canFix} leads (have booking confirmation with sent_by)`);
  console.log(`Cannot restore: ${cannotFix} leads (no booking confirmation found)`);
  console.log(`Of the fixable ones, ${alreadyMatch} already have booker_id matching the original booker\n`);

  console.log('Breakdown by original booker:');
  const sorted = Object.entries(fixesByBooker).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    console.log(`  ${name}: ${count} leads`);
  }

  // Show leads where original booker DIFFERS from current booker_id
  const mismatches = fixes.filter(f => f.originalBooker !== f.currentBookerId);
  console.log(`\nLeads where original booker differs from current booker_id: ${mismatches.length}`);
  for (const f of mismatches.slice(0, 20)) {
    console.log(`  ${f.name} | Original: ${f.originalBookerName} | Current: ${f.currentBookerName} | Confirmed: ${f.confirmationDate}`);
  }
  if (mismatches.length > 20) console.log(`  ... and ${mismatches.length - 20} more`);

  if (DRY_RUN) {
    console.log('\n=== DRY RUN — no changes made ===');
    console.log('Run with --apply to actually update the database');
  } else {
    console.log('\n=== APPLYING CHANGES ===');
    let success = 0;
    let failed = 0;
    for (const f of fixes) {
      const { error } = await supabase
        .from('leads')
        .update({ booked_by: f.originalBooker })
        .eq('id', f.id)
        .is('booked_by', null); // safety: only update if still NULL

      if (error) {
        console.error(`  FAILED: ${f.name} — ${error.message}`);
        failed++;
      } else {
        success++;
      }
    }
    console.log(`\nDone: ${success} updated, ${failed} failed`);
  }
}

run().catch(e => console.error(e));
