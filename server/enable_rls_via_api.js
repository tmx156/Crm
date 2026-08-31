const https = require('https');

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function runSQL(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const options = {
      hostname: 'tnltvfzltdeilanxhlvy.supabase.co',
      path: '/rest/v1/rpc/exec_sql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  // First try via pg_query function approach
  for (const sql of statements) {
    console.log('Running:', sql.substring(0, 60) + '...');
    const result = await runSQL(sql);
    console.log('  Status:', result.status, result.body.substring(0, 200));
  }
}

run().catch(console.error);
