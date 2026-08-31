const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Liverpool postcode area = "L" followed directly by digits (L1-L40, L60-L71 etc).
// Excludes LA (Lancaster), LD (Llandrindod), LE (Leicester), LL (Llandudno), LN (Lincoln), LS (Leeds), LU (Luton).
const LIVERPOOL_RE = /^l\d/i;

async function run() {
  let all = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, postcode, has_sale')
      .ilike('postcode', 'l%')
      .range(from, from + pageSize - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const liverpoolLeads = all.filter(l => l.postcode && LIVERPOOL_RE.test(l.postcode.trim()));
  console.log(`Total Liverpool-area leads (postcode L#): ${liverpoolLeads.length}`);

  const ids = liverpoolLeads.map(l => l.id);
  let sales = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supabase.from('sales').select('lead_id, amount, created_at').in('lead_id', chunk);
    if (error) { console.error(error); process.exit(1); }
    if (data) sales = sales.concat(data);
  }

  const leadMap = {};
  for (const l of liverpoolLeads) leadMap[l.id] = l;

  let total = 0;
  console.log('\n=== LIVERPOOL BUYERS ===');
  for (const s of sales) {
    const amt = parseFloat(s.amount) || 0;
    total += amt;
    const lead = leadMap[s.lead_id];
    console.log(`  ${lead ? lead.name : '?'} | postcode: ${lead ? lead.postcode : '?'} | £${amt} | ${s.created_at}`);
  }

  console.log(`\nLiverpool buyers: ${sales.length}`);
  console.log(`Total revenue from Liverpool: £${total.toFixed(2)}`);
}

run().catch(e => console.error(e));
