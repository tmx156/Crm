const fs = require('fs');
const path = require('path');

// Simple CSV parser
function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',');

  return lines.slice(1).map(line => {
    const values = line.split(',');
    const record = {};
    headers.forEach((header, i) => {
      record[header.trim()] = values[i]?.trim() || '';
    });
    return record;
  });
}

const csvPath = path.join(__dirname, '../.claude/CRM2 - Sheet1.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');
const records = parseCSV(csvContent);

console.log('\n⚠️  LEADS WITH INVALID PHONE NUMBERS:\n');
console.log('═'.repeat(70));

let count = 0;
records.forEach(record => {
  const phone = record.phone?.toString().trim();
  if (phone === '#ERROR!' || phone === '' || !phone) {
    count++;
    console.log(`${count}. ${record.Name} (Age: ${record.Age})`);
    console.log(`   Email: ${record.Email}`);
    console.log(`   Phone: ${phone || 'MISSING'}`);
    console.log(`   Postcode: ${record.postcode}`);
    console.log('');
  }
});

console.log('═'.repeat(70));
console.log(`\nTotal leads with invalid/missing phone numbers: ${count}\n`);
