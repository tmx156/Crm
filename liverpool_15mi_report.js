const https = require('https');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Liverpool city centre (St George's Hall / Lime Street) reference point
const LIVERPOOL = { lat: 53.4084, lon: -2.9916 };
const RADIUS_MILES = 15;

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getOutcode(json) {
  https;
}

function fetchJson(url) {
  return new Promise((resolve) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}$/;

async function run() {
  const leads = JSON.parse(fs.readFileSync('scratch_leads.json', 'utf8'));

  const outcodeByLead = {};
  const outcodesSet = new Set();
  let unparsed = 0;
  for (const l of leads) {
    const pc = (l.postcode || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const m = pc.match(POSTCODE_RE);
    if (m) {
      outcodeByLead[l.id] = m[1];
      outcodesSet.add(m[1]);
    } else {
      unparsed++;
    }
  }
  console.log(`Parsed postcodes: ${Object.keys(outcodeByLead).length} / ${leads.length} (unparsed: ${unparsed})`);
  console.log(`Unique outcodes: ${outcodesSet.size}`);

  // Fetch centroid for each unique outcode via postcodes.io
  const outcodes = [...outcodesSet];
  const centroid = {};
  const batchSize = 15;
  for (let i = 0; i < outcodes.length; i += batchSize) {
    const batch = outcodes.slice(i, i + batchSize);
    await Promise.all(batch.map(async oc => {
      const json = await fetchJson(`https://api.postcodes.io/outcodes/${encodeURIComponent(oc)}`);
      if (json && json.result) {
        centroid[oc] = { lat: json.result.latitude, lon: json.result.longitude };
      }
    }));
    process.stdout.write(`\rGeocoded outcodes: ${Math.min(i + batchSize, outcodes.length)}/${outcodes.length}`);
  }
  console.log('');

  const missing = outcodes.filter(oc => !centroid[oc]);
  console.log(`Outcodes not found: ${missing.length}${missing.length ? ' -> ' + missing.slice(0,20).join(', ') : ''}`);

  // Compute distance per lead
  const within = [];
  for (const l of leads) {
    const oc = outcodeByLead[l.id];
    if (!oc || !centroid[oc]) continue;
    const c = centroid[oc];
    const dist = haversineMiles(LIVERPOOL.lat, LIVERPOOL.lon, c.lat, c.lon);
    if (dist <= RADIUS_MILES) within.push({ ...l, outcode: oc, dist });
  }
  console.log(`\nLeads within ${RADIUS_MILES} miles of Liverpool: ${within.length}`);

  // Breakdown by outcode
  const byOutcode = {};
  for (const l of within) byOutcode[l.outcode] = (byOutcode[l.outcode] || 0) + 1;
  console.log('\nBreakdown by outcode:');
  for (const [oc, ct] of Object.entries(byOutcode).sort((a,b)=>b[1]-a[1])) console.log(`  ${oc}: ${ct}`);

  // Cross-reference sales
  const ids = within.map(l => l.id);
  let sales = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supabase.from('sales').select('lead_id, amount, created_at').in('lead_id', chunk);
    if (error) { console.error(error); process.exit(1); }
    if (data) sales = sales.concat(data);
  }

  const leadMap = {};
  for (const l of within) leadMap[l.id] = l;

  let total = 0;
  console.log(`\n=== BUYERS within ${RADIUS_MILES} miles of Liverpool ===`);
  for (const s of sales) {
    const amt = parseFloat(s.amount) || 0;
    total += amt;
    const lead = leadMap[s.lead_id];
    console.log(`  ${lead ? lead.name : '?'} | postcode: ${lead ? lead.postcode : '?'} (${lead ? lead.outcode : '?'}, ${lead ? lead.dist.toFixed(1) : '?'}mi) | £${amt} | ${s.created_at}`);
  }

  console.log(`\nBuyers: ${sales.length}`);
  console.log(`Total revenue: £${total.toFixed(2)}`);

  fs.writeFileSync('scratch_within15.json', JSON.stringify(within));
}

run().catch(e => console.error(e));
