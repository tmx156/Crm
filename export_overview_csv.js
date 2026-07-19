const fs = require('fs');
const s = require('./scratch_month_age_area_summary.json');
const { areaName } = require('./postcode_area_names.js');

const monthOrder = s.months.map(m => m.month);
const monthLabels = {
  '2026-02': 'Feb 2026', '2026-03': 'Mar 2026', '2026-04': 'Apr 2026',
  '2026-05': 'May 2026', '2026-06': 'Jun 2026', '2026-07': 'Jul 2026*'
};

function csvEscape(v) {
  const str = String(v);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

const byMonth = {};
for (const m of s.months) byMonth[m.month] = m;

const grandTotal = s.months.reduce((a, m) => a + m.total, 0);

// Top 10 areas overall (excl Unknown)
const areaTotalsSorted = Object.entries(s.areaTotals)
  .filter(([k]) => k !== 'Unknown')
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([k]) => k);

const rows = [];
const header = ['Metric', ...monthOrder.map(mo => monthLabels[mo]), 'Feb-Jul Total/Avg'];
rows.push(header);

function pctCell(count, total) {
  return total ? (count / total * 100).toFixed(1) + '%' : '0.0%';
}

function sectionHeader(title) {
  rows.push([]);
  rows.push(['== ' + title + ' ==']);
}

// ---------------- OVERVIEW ----------------
sectionHeader('OVERVIEW');
rows.push(['Total leads', ...monthOrder.map(mo => byMonth[mo].total), grandTotal]);
{
  const weightedAge = s.months.reduce((a, m) => a + (m.avgAge || 0) * m.total, 0);
  rows.push(['Avg age (years)', ...monthOrder.map(mo => byMonth[mo].avgAge ?? 'N/A'), (weightedAge / grandTotal).toFixed(1)]);
}
{
  const classifiedTotals = monthOrder.map(mo => byMonth[mo].genders.Male + byMonth[mo].genders.Female);
  const femaleTotal = monthOrder.reduce((a, mo) => a + byMonth[mo].genders.Female, 0);
  const classifiedGrand = monthOrder.reduce((a, mo) => a + byMonth[mo].genders.Male + byMonth[mo].genders.Female, 0);
  rows.push(['Female share (of classified)', ...monthOrder.map((mo, i) => pctCell(byMonth[mo].genders.Female, classifiedTotals[i])), pctCell(femaleTotal, classifiedGrand)]);
}
{
  const topAreaTotal = monthOrder.reduce((a, mo) => a + (byMonth[mo].areas[areaTotalsSorted[0]] || 0), 0);
  rows.push(['Top area (' + areaName(areaTotalsSorted[0]) + ') share', ...monthOrder.map(mo => pctCell(byMonth[mo].areas[areaTotalsSorted[0]] || 0, byMonth[mo].total)), pctCell(topAreaTotal, grandTotal)]);
}

// ---------------- AGE BRACKETS ----------------
sectionHeader('AGE BRACKETS (% of month)');
const bracketOrder = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
for (const b of bracketOrder) {
  const total = monthOrder.reduce((a, mo) => a + (byMonth[mo].brackets[b] || 0), 0);
  rows.push([b, ...monthOrder.map(mo => pctCell(byMonth[mo].brackets[b] || 0, byMonth[mo].total)), pctCell(total, grandTotal)]);
}
{
  const unrecTotal = monthOrder.reduce((a, mo) => a + (byMonth[mo].brackets['Unknown'] || 0) + (byMonth[mo].brackets['Invalid'] || 0), 0);
  rows.push(['Unrecorded / invalid', ...monthOrder.map(mo => {
    const c = (byMonth[mo].brackets['Unknown'] || 0) + (byMonth[mo].brackets['Invalid'] || 0);
    return pctCell(c, byMonth[mo].total);
  }), pctCell(unrecTotal, grandTotal)]);
}

// ---------------- GENDER ----------------
sectionHeader('GENDER (% of month)');
for (const g of ['Female', 'Male', 'Unknown']) {
  const total = monthOrder.reduce((a, mo) => a + (byMonth[mo].genders[g] || 0), 0);
  rows.push([g, ...monthOrder.map(mo => pctCell(byMonth[mo].genders[g] || 0, byMonth[mo].total)), pctCell(total, grandTotal)]);
}

// ---------------- TOP AREAS ----------------
sectionHeader('TOP 10 AREAS OVERALL (% of month)');
for (const a of areaTotalsSorted) {
  const total = monthOrder.reduce((acc, mo) => acc + (byMonth[mo].areas[a] || 0), 0);
  rows.push([areaName(a) + ' (' + a + ')', ...monthOrder.map(mo => pctCell(byMonth[mo].areas[a] || 0, byMonth[mo].total)), pctCell(total, grandTotal)]);
}
{
  const otherTotal = grandTotal - monthOrder.reduce((acc, mo) => acc + areaTotalsSorted.reduce((a2, ar) => a2 + (byMonth[mo].areas[ar] || 0), 0), 0);
  rows.push(['Other (100+ areas combined)', ...monthOrder.map(mo => {
    const topSum = areaTotalsSorted.reduce((a2, ar) => a2 + (byMonth[mo].areas[ar] || 0), 0);
    return pctCell(byMonth[mo].total - topSum, byMonth[mo].total);
  }), pctCell(otherTotal, grandTotal)]);
}

const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
fs.writeFileSync('lead_stats_overview.csv', csv);
console.log('Wrote lead_stats_overview.csv (' + rows.length + ' rows)');
