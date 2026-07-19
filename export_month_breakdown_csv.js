const fs = require('fs');
const s = require('./scratch_month_age_area_summary.json');
const { areaName } = require('./postcode_area_names.js');

const monthNames = {
  '2026-02': 'Feb 2026', '2026-03': 'Mar 2026', '2026-04': 'Apr 2026',
  '2026-05': 'May 2026', '2026-06': 'Jun 2026', '2026-07': 'Jul 2026 (partial, to 12th)'
};

function csvEscape(v) {
  const str = String(v);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

const rows = [];
rows.push(['Month', 'Month_Label', 'Total_Leads', 'Avg_Age', 'Breakdown_Type', 'Category', 'Postcode_Area_Code', 'Count', 'Percent_Of_Month']);

for (const m of s.months) {
  const label = monthNames[m.month] || m.month;

  // Summary row
  rows.push([m.month, label, m.total, m.avgAge ?? '', 'Total', 'All Leads', '', m.total, '100.0%']);

  // Age brackets
  const bracketOrder = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Invalid', 'Unknown'];
  for (const b of bracketOrder) {
    const c = m.brackets[b] || 0;
    if (c === 0) continue;
    const label2 = b === 'Invalid' ? 'Invalid (data-entry error)' : b === 'Unknown' ? 'Unrecorded' : b;
    rows.push([m.month, label, m.total, m.avgAge ?? '', 'Age Bracket', label2, '', c, (c / m.total * 100).toFixed(1) + '%']);
  }

  // Gender
  for (const g of ['Female', 'Male', 'Unknown']) {
    const c = m.genders[g] || 0;
    rows.push([m.month, label, m.total, m.avgAge ?? '', 'Gender', g, '', c, (c / m.total * 100).toFixed(1) + '%']);
  }

  // Areas (all, sorted by count desc) — named by town/city, with the postcode code alongside
  const areaEntries = Object.entries(m.areas).sort((a, b) => b[1] - a[1]);
  for (const [area, c] of areaEntries) {
    const name = area === 'Unknown' ? 'Unknown (no postcode on file)' : areaName(area);
    rows.push([m.month, label, m.total, m.avgAge ?? '', 'Area', name, area === 'Unknown' ? '' : area, c, (c / m.total * 100).toFixed(1) + '%']);
  }
}

const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
fs.writeFileSync('lead_stats_monthly_breakdown.csv', csv);
console.log('Wrote lead_stats_monthly_breakdown.csv (' + rows.length + ' rows)');
