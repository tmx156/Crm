const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../local-crm.db');
console.log('🔍 DEBUGGING SALES DATABASE');
console.log('================================');

try {
  const db = new Database(dbPath);

  // Check sales table structure
  console.log('📋 Sales table columns:');
  const tableInfo = db.prepare("PRAGMA table_info(sales)").all();
  tableInfo.forEach(col => {
    console.log(`   ${col.name}: ${col.type} ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
  });

  console.log('');

  // Check recent sales
  console.log('📊 Recent sales (last 5):');
  const recentSales = db.prepare(`
    SELECT s.id, s.user_id, s.amount, s.created_at, u.name as user_name, u.email as user_email
    FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    ORDER BY s.created_at DESC
    LIMIT 5
  `).all();

  recentSales.forEach((sale, i) => {
    console.log(`${i+1}. Sale: ${sale.id.slice(-8)}`);
    console.log(`   User ID: ${sale.user_id || 'NULL'}`);
    console.log(`   User Name: ${sale.user_name || 'NULL (JOIN FAILED)'}`);
    console.log(`   Amount: £${sale.amount}`);
    console.log(`   Created: ${new Date(sale.created_at).toLocaleString()}`);
    console.log('');
  });

  // Check if users table exists and has data
  console.log('👥 Users table check:');
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  console.log(`   Total users: ${userCount.count}`);

  if (userCount.count > 0) {
    const sampleUsers = db.prepare('SELECT id, name, email, role FROM users LIMIT 3').all();
    sampleUsers.forEach(user => {
      console.log(`   ${user.name} (${user.role}): ${user.id.slice(-8)}`);
    });
  }

  console.log('');

  // Check for sales with NULL user_id
  const nullUserIdSales = db.prepare('SELECT COUNT(*) as count FROM sales WHERE user_id IS NULL').get();
  console.log(`⚠️ Sales with NULL user_id: ${nullUserIdSales.count}`);

  if (nullUserIdSales.count > 0) {
    console.log('   These sales will show as "System" in reports');
  }

  // Check for sales with user_id but no matching user
  const orphanedSales = db.prepare(`
    SELECT COUNT(*) as count FROM sales s
    LEFT JOIN users u ON s.user_id = u.id
    WHERE s.user_id IS NOT NULL AND u.id IS NULL
  `).get();
  console.log(`⚠️ Sales with user_id but no matching user: ${orphanedSales.count}`);

  if (orphanedSales.count > 0) {
    console.log('   These sales will show as "User XXXX" in reports');
  }

  db.close();

} catch (error) {
  console.error('❌ Error:', error);
}
