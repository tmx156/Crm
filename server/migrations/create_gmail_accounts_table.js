/**
 * Migration: Create gmail_accounts table
 * Stores OAuth2 tokens for Gmail API integration.
 *
 * Run:  node server/migrations/create_gmail_accounts_table.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS gmail_accounts (
  email        TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry_date  BIGINT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
`;

async function run() {
  console.log('Creating gmail_accounts table...');

  // Approach 1: Try RPC exec_sql
  const { error: rpcError } = await supabase.rpc('exec_sql', { sql: CREATE_SQL });

  if (!rpcError) {
    console.log('✅ gmail_accounts table created via RPC');
    return verify();
  }

  console.log('RPC not available, trying alternative approach...');

  // Approach 2: Try inserting a dummy row to see if table already exists
  const { error: probeError } = await supabase
    .from('gmail_accounts')
    .select('email')
    .limit(1);

  if (!probeError) {
    console.log('✅ gmail_accounts table already exists');
    return;
  }

  // Approach 3: Print SQL for manual execution
  console.log('\n' + '='.repeat(60));
  console.log('Please run this SQL in the Supabase SQL Editor:');
  console.log('='.repeat(60));
  console.log(CREATE_SQL);
  console.log('-- Optional: disable RLS so service can read/write freely');
  console.log('ALTER TABLE gmail_accounts DISABLE ROW LEVEL SECURITY;');
  console.log('='.repeat(60));
}

async function verify() {
  const { data, error } = await supabase
    .from('gmail_accounts')
    .select('email')
    .limit(1);

  if (error) {
    console.error('❌ Verification failed:', error.message);
  } else {
    console.log('✅ Verification passed - table is accessible');
  }
}

run().catch(console.error);
