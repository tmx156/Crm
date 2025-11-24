require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

(async () => {
  try {
    console.log('📧 Creating gmail_accounts table in Supabase...\n');

    const supabase = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey || config.supabase.anonKey
    );

    // SQL to create the table
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS gmail_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_type TEXT DEFAULT 'Bearer',
        expiry_date BIGINT,
        scope TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Create index on email for faster lookups
      CREATE INDEX IF NOT EXISTS idx_gmail_accounts_email ON gmail_accounts(email);
    `;

    // Note: Supabase doesn't support direct SQL execution via JS client
    // You need to run this in Supabase SQL Editor
    console.log('⚠️  Supabase JS client cannot execute DDL directly.');
    console.log('📝 Please run this SQL in your Supabase SQL Editor:\n');
    console.log('='.repeat(80));
    console.log(createTableSQL);
    console.log('='.repeat(80));
    console.log('\n✅ After creating the table, restart your server and authenticate via:');
    console.log('   http://localhost:5000/api/gmail/auth-url\n');

    // Try to verify table exists
    const { data, error } = await supabase
      .from('gmail_accounts')
      .select('*')
      .limit(1);

    if (error && error.message.includes('relation "gmail_accounts" does not exist')) {
      console.log('❌ Table does not exist yet. Please create it using the SQL above.\n');
    } else if (error) {
      console.log('⚠️  Error checking table:', error.message);
    } else {
      console.log('✅ Table exists! You can now authenticate Gmail accounts.\n');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();

