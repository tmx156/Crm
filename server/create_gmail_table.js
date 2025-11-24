require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function createTables() {
  console.log('📧 Creating Gmail API tables in Supabase...\n');

  try {
    // Create a dummy record to force table creation (Supabase method)
    console.log('1️⃣ Creating gmail_accounts table...');

    // First, let's try to create the table using a direct insert that will fail
    // This is a workaround since we can't execute raw SQL directly

    console.log('\n⚠️  MANUAL STEP REQUIRED ⚠️\n');
    console.log('Please run this SQL in your Supabase SQL Editor:');
    console.log('(Dashboard → SQL Editor → New Query → Paste and Run)\n');
    console.log('─'.repeat(80));
    console.log(`
-- Create gmail_accounts table
CREATE TABLE IF NOT EXISTS gmail_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  crm_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  scope TEXT,
  token_type TEXT,
  expiry_date BIGINT,
  raw_tokens JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add gmail_message_id to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;

-- Add metadata to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_messages_gmail_message_id ON messages(gmail_message_id);

-- Verify tables
SELECT 'gmail_accounts table created' as status;
    `);
    console.log('─'.repeat(80));
    console.log('\n📋 Steps:');
    console.log('   1. Go to: https://supabase.com/dashboard/project/tnltvfzltdeilanxhlvy/sql/new');
    console.log('   2. Copy the SQL above');
    console.log('   3. Paste it into the SQL Editor');
    console.log('   4. Click "Run" or press Ctrl+Enter');
    console.log('   5. Come back here and press Enter when done\n');

    // Wait for user confirmation
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    await new Promise(resolve => {
      readline.question('Press Enter when you have run the SQL in Supabase... ', () => {
        readline.close();
        resolve();
      });
    });

    // Verify the table was created
    console.log('\n🔍 Verifying table creation...');
    const { data, error } = await supabase
      .from('gmail_accounts')
      .select('id')
      .limit(1);

    if (error && error.message.includes('does not exist')) {
      console.log('❌ Table not found. Please run the SQL in Supabase dashboard.');
      process.exit(1);
    }

    console.log('✅ gmail_accounts table verified!');
    console.log('\n🎉 Database setup complete!');
    console.log('\nNext steps:');
    console.log('   1. Run: node server/authenticate_gmail.js');
    console.log('   2. Open the URL in your browser');
    console.log('   3. Sign in with: camrymodels.co.uk.crm.bookings@gmail.com');
    console.log('   4. Restart your server\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

createTables();
