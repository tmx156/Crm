require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PAGE_SIZE = 1000;

async function fetchAll(table) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('name, email')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function splitName(fullName) {
  const clean = (fullName || '').trim().replace(/\s+/g, ' ');
  if (!clean) return { fn: '', ln: '' };
  const parts = clean.split(' ');
  const fn = parts[0];
  const ln = parts.length > 1 ? parts.slice(1).join(' ') : '';
  return { fn, ln };
}

function csvEscape(value) {
  const str = (value || '').toString();
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

(async () => {
  console.log('Fetching leads...');
  const leads = await fetchAll('leads');
  console.log(`  leads: ${leads.length}`);

  console.log('Fetching legacy_leads...');
  const legacyLeads = await fetchAll('legacy_leads');
  console.log(`  legacy_leads: ${legacyLeads.length}`);

  const combined = [...leads, ...legacyLeads];

  const byEmail = new Map();
  let skippedNoEmail = 0;

  for (const row of combined) {
    const email = (row.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      skippedNoEmail++;
      continue;
    }
    // Keep the first record we see, but prefer one that actually has a name if the
    // one already stored doesn't.
    const existing = byEmail.get(email);
    if (!existing || (!existing.name && row.name)) {
      byEmail.set(email, { name: row.name || '', email });
    }
  }

  const rows = Array.from(byEmail.values());
  console.log(`Unique emails: ${rows.length} (skipped ${skippedNoEmail} rows with no usable email)`);

  const header = 'email,fn,ln\n';
  const csvRows = rows.map(r => {
    const { fn, ln } = splitName(r.name);
    return [csvEscape(r.email), csvEscape(fn), csvEscape(ln)].join(',');
  });

  const outPath = path.join(__dirname, '..', 'facebook_exclusion_list.csv');
  fs.writeFileSync(outPath, header + csvRows.join('\n') + '\n', 'utf8');

  console.log(`Wrote ${rows.length} rows to ${outPath}`);
})().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
