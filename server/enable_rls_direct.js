const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres.tnltvfzltdeilanxhlvy:0ALicn6Y9xnfaoiC@aws-0-eu-west-2.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const statements = [
      'ALTER TABLE sales ENABLE ROW LEVEL SECURITY',
      "CREATE POLICY \"sales_select_policy\" ON sales FOR SELECT USING (true)",
      "CREATE POLICY \"sales_insert_block\" ON sales FOR INSERT WITH CHECK (false)",
      "CREATE POLICY \"sales_update_block\" ON sales FOR UPDATE USING (false)",
      "CREATE POLICY \"sales_delete_block\" ON sales FOR DELETE USING (false)",
      'ALTER TABLE leads ENABLE ROW LEVEL SECURITY',
      "CREATE POLICY \"leads_select_policy\" ON leads FOR SELECT USING (true)",
      "CREATE POLICY \"leads_insert_block\" ON leads FOR INSERT WITH CHECK (false)",
      "CREATE POLICY \"leads_update_block\" ON leads FOR UPDATE USING (false)",
      "CREATE POLICY \"leads_delete_block\" ON leads FOR DELETE USING (false)",
    ];

    for (const sql of statements) {
      try {
        await client.query(sql);
        console.log('OK: ' + sql.substring(0, 70));
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log('SKIP (already exists): ' + sql.substring(0, 70));
        } else {
          console.log('ERROR: ' + err.message + ' -- ' + sql.substring(0, 70));
        }
      }
    }

    // Verify RLS is enabled
    const { rows } = await client.query(
      "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('sales', 'leads')"
    );
    console.log('\nRLS Status:');
    rows.forEach(r => console.log('  ' + r.tablename + ': RLS ' + (r.rowsecurity ? 'ENABLED' : 'DISABLED')));

    // List policies
    const { rows: policies } = await client.query(
      "SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('sales', 'leads')"
    );
    console.log('\nPolicies:');
    policies.forEach(p => console.log('  ' + p.tablename + ' | ' + p.policyname + ' | ' + p.cmd));

  } catch (err) {
    console.error('Connection error:', err.message);
  } finally {
    await client.end();
  }
}

run();
