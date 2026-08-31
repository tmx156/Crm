const { createClient } = require('@supabase/supabase-js');

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(process.env.SUPABASE_URL, SERVICE_KEY);

async function run() {
  console.log('=== Step 1: Delete all fake test sales from Tom Wilkins ===');

  const tomUserId = 'be5396d2-5318-4858-b183-1d5b30d1a355';

  const { data: fakeSales, error: fetchErr } = await supabase
    .from('sales')
    .select('id, amount, notes, created_at')
    .eq('user_id', tomUserId);

  if (fetchErr) {
    console.log('Error fetching fake sales:', fetchErr);
    return;
  }

  console.log('Found ' + fakeSales.length + ' fake sales to delete');

  if (fakeSales.length > 0) {
    const ids = fakeSales.map(s => s.id);
    const { error: delErr } = await supabase
      .from('sales')
      .delete()
      .in('id', ids);

    if (delErr) {
      console.log('Error deleting fake sales:', delErr);
    } else {
      console.log('Deleted ' + ids.length + ' fake sales');
    }
  }

  // Reset has_sale on Laura Mathieson
  const { error: resetErr } = await supabase
    .from('leads')
    .update({ has_sale: 0, updated_at: new Date().toISOString() })
    .eq('id', '22feff74-ba96-436c-b940-feb92a5bd3d8');

  if (resetErr) console.log('Error resetting lead:', resetErr);
  else console.log('Reset has_sale on Laura Mathieson');

  console.log('\n=== Step 2: Verify service_role key works ===');
  const { data: testSales, error: testErr } = await supabase
    .from('sales')
    .select('id')
    .limit(3);

  if (testErr) console.log('Service role query failed:', testErr);
  else console.log('Service role key works - can read ' + testSales.length + ' sales');

  console.log('\n=== Step 3: Test that anon key is blocked ===');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const anonClient = createClient(process.env.SUPABASE_URL, anonKey);

  const { data: anonInsert, error: anonErr } = await anonClient
    .from('sales')
    .insert({
      lead_id: '22feff74-ba96-436c-b940-feb92a5bd3d8',
      user_id: tomUserId,
      amount: 0.01,
      payment_method: 'cash',
      notes: 'RLS TEST - should be blocked',
      status: 'Pending',
      payment_status: 'Pending',
      payment_type: 'full_payment'
    })
    .select();

  if (anonErr) {
    console.log('GOOD - Anon key insert BLOCKED: ' + anonErr.message);
  } else {
    console.log('WARNING - Anon key insert was NOT blocked! RLS not active yet.');
    console.log('You need to run the SQL in enable_rls_sales.sql via Supabase dashboard SQL editor');
    // Clean up the test row
    if (anonInsert && anonInsert.length > 0) {
      await supabase.from('sales').delete().eq('id', anonInsert[0].id);
      console.log('Cleaned up test insert');
    }
  }

  console.log('\nDone!');
}

run().catch(console.error);
