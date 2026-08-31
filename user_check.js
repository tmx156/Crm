const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: users } = await supabase.from('users').select('id, name, role');
  const userMap = {};
  for (const u of users) userMap[u.id] = u.name;
  console.log('=== ALL USERS ===');
  for (const u of users) console.log(u.id, '|', u.name, '|', u.role);

  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, status, booking_status, date_booked, booker_id, created_by_user_id, assigned_at, booked_at')
    .gte('date_booked', '2026-05-11T00:00:00')
    .lt('date_booked', '2026-05-18T00:00:00')
    .order('date_booked', { ascending: true });

  console.log('\nTotal leads:', leads.length);

  // Check how many have booker_id vs created_by_user_id
  const hasBooker = leads.filter(l => l.booker_id).length;
  const hasCreator = leads.filter(l => l.created_by_user_id).length;
  const hasBoth = leads.filter(l => l.booker_id && l.created_by_user_id).length;
  const different = leads.filter(l => l.booker_id && l.created_by_user_id && l.booker_id !== l.created_by_user_id).length;
  console.log('Has booker_id:', hasBooker);
  console.log('Has created_by_user_id:', hasCreator);
  console.log('Has both:', hasBoth);
  console.log('booker_id != created_by_user_id:', different);

  // Show the ones where they differ
  if (different > 0) {
    console.log('\n=== LEADS WHERE BOOKER != CREATOR ===');
    leads.filter(l => l.booker_id && l.created_by_user_id && l.booker_id !== l.created_by_user_id).forEach(l => {
      console.log(l.name, '| Booker:', userMap[l.booker_id], '| Creator:', userMap[l.created_by_user_id], '| Status:', l.status, '| Outcome:', l.booking_status || '-');
    });
  }

  // Group by booker_id
  console.log('\n=== BY BOOKER_ID ===');
  const byBooker = {};
  for (const l of leads) {
    const bid = l.booker_id || 'NO_BOOKER';
    const bname = userMap[l.booker_id] || 'No Booker Assigned';
    if (!byBooker[bid]) byBooker[bid] = { name: bname, leads: [] };
    byBooker[bid].leads.push(l);
  }
  for (const [bid, info] of Object.entries(byBooker).sort((a, b) => b[1].leads.length - a[1].leads.length)) {
    console.log('\n' + info.name + ' (' + info.leads.length + ' leads):');
    for (const l of info.leads) {
      const outcome = l.status === 'Cancelled' ? 'Cancelled' : l.status === 'Attended' ? 'Attended' : (l.booking_status || 'Pending');
      console.log('  ' + l.name + ' | ' + outcome + ' | ' + l.date_booked);
    }
  }

  // Group by created_by_user_id
  console.log('\n\n=== BY CREATED_BY_USER_ID ===');
  const byCreator = {};
  for (const l of leads) {
    const cid = l.created_by_user_id || 'NO_CREATOR';
    const cname = userMap[l.created_by_user_id] || 'No Creator';
    if (!byCreator[cid]) byCreator[cid] = { name: cname, leads: [] };
    byCreator[cid].leads.push(l);
  }
  for (const [cid, info] of Object.entries(byCreator).sort((a, b) => b[1].leads.length - a[1].leads.length)) {
    console.log(info.name + ': ' + info.leads.length + ' leads');
  }
}

run();
