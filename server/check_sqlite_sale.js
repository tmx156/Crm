const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../local-crm.db');
console.log('🔍 Checking SQLite database at:', dbPath);

try {
  const db = new Database(dbPath);

  // Check the specific sale
  const saleId = 'e44dcdc2-5e53-4dd4-93d8-173d916251c0';
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);

  if (!sale) {
    console.log('❌ Sale not found in SQLite database!');
    db.close();
    return;
  }

  console.log('✅ Sale found in SQLite:');
  console.log('   ID:', sale.id);
  console.log('   Lead ID:', sale.lead_id);
  console.log('   User ID:', sale.user_id || 'NULL');
  console.log('   Amount:', sale.amount);
  console.log('   Created At:', sale.created_at);

  // Check all sales by this user_id
  if (sale.user_id) {
    const userSales = db.prepare('SELECT id, amount, created_at FROM sales WHERE user_id = ? ORDER BY created_at DESC').all(sale.user_id);
    console.log(`📊 All sales by user ${sale.user_id}:`, userSales.length);

    userSales.forEach((s, i) => {
      console.log(`   ${i+1}. ${s.id.slice(-8)} - £${s.amount} - ${new Date(s.created_at).toLocaleDateString()}`);
    });
  }

  // Check for sales with NULL user_id
  const nullSales = db.prepare('SELECT COUNT(*) as count FROM sales WHERE user_id IS NULL').get();
  console.log('⚠️ Sales with NULL user_id:', nullSales.count);

  db.close();

} catch (error) {
  console.error('❌ Error:', error);
}
