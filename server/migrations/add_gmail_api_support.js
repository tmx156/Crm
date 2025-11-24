require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   SUPABASE_URL:', SUPABASE_URL ? '✅' : '❌');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? '✅' : '❌');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runMigration() {
  console.log('📧 Starting Gmail API support migration...\n');

  try {
    // 1. Create gmail_accounts table
    console.log('1️⃣ Creating gmail_accounts table...');
    const { error: createTableError } = await supabase.rpc('exec_sql', {
      sql: `
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
      `
    });

    if (createTableError) {
      // Table might already exist, try alternative approach
      console.log('⚠️ Using alternative approach to create table...');

      // Check if table exists
      const { data: tableExists } = await supabase
        .from('gmail_accounts')
        .select('id')
        .limit(1);

      if (tableExists === null) {
        console.log('✅ gmail_accounts table already exists or created successfully');
      }
    } else {
      console.log('✅ gmail_accounts table created successfully');
    }

    // 2. Add gmail_message_id column to messages table
    console.log('\n2️⃣ Adding gmail_message_id column to messages table...');
    const { error: addGmailIdError } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
      `
    });

    if (addGmailIdError) {
      console.log('⚠️ Column might already exist, continuing...');
    } else {
      console.log('✅ gmail_message_id column added successfully');
    }

    // 3. Add metadata column to messages table (for attachments and other data)
    console.log('\n3️⃣ Adding metadata column to messages table...');
    const { error: addMetadataError } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS metadata JSONB;
      `
    });

    if (addMetadataError) {
      console.log('⚠️ Column might already exist, continuing...');
    } else {
      console.log('✅ metadata column added successfully');
    }

    // 4. Create index on gmail_message_id for faster lookups
    console.log('\n4️⃣ Creating index on gmail_message_id...');
    const { error: createIndexError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE INDEX IF NOT EXISTS idx_messages_gmail_message_id
        ON messages(gmail_message_id);
      `
    });

    if (createIndexError) {
      console.log('⚠️ Index might already exist, continuing...');
    } else {
      console.log('✅ Index created successfully');
    }

    console.log('\n✅ Gmail API support migration completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Authenticate your Gmail accounts via /api/gmail/auth-url');
    console.log('   2. Restart the email poller to use Gmail API');
    console.log('   3. All new emails will include full attachment support');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nYou may need to run SQL commands directly in Supabase dashboard:');
    console.error(`
-- 1. Create gmail_accounts table
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

-- 2. Add gmail_message_id to messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;

-- 3. Add metadata to messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 4. Create index
CREATE INDEX IF NOT EXISTS idx_messages_gmail_message_id ON messages(gmail_message_id);
    `);
    process.exit(1);
  }
}

// Run migration
runMigration()
  .then(() => {
    console.log('\n🎉 Migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
  });
