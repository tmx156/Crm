/**
 * Run schema migration to add gmail_message_id column
 */

require('dotenv').config();

// Load dependencies from server directory
let createClient;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (e) {
  ({ createClient } = require('./server/node_modules/@supabase/supabase-js'));
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runMigration() {
  console.log('\n🔧 Running schema migration: Add gmail_message_id column\n');

  try {
    // First, check if column exists
    console.log('📊 Checking if gmail_message_id column exists...');

    const { data: sampleMessage } = await supabase
      .from('messages')
      .select('gmail_message_id')
      .limit(1)
      .maybeSingle();

    // If we got here without error, column exists
    if (sampleMessage !== null || sampleMessage === null) {
      console.log('✅ Column gmail_message_id already exists in messages table');
      console.log('ℹ️  No migration needed\n');
      return true;
    }
  } catch (error) {
    if (error.message && error.message.includes('gmail_message_id')) {
      console.log('⚠️  Column gmail_message_id does not exist');
      console.log('\n❌ CRITICAL: Cannot add column using Supabase client');
      console.log('\nYou need to run this SQL directly in Supabase SQL Editor:');
      console.log('=' .repeat(80));
      console.log(`
ALTER TABLE messages ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_gmail_message_id ON messages(gmail_message_id);
COMMENT ON COLUMN messages.gmail_message_id IS 'Gmail API unique message ID for duplicate detection';
      `);
      console.log('='.repeat(80));
      console.log('\nSteps:');
      console.log('1. Go to https://supabase.com/dashboard/project/tnltvfzltdeilanxhlvy/sql');
      console.log('2. Copy the SQL above');
      console.log('3. Paste it into the SQL Editor');
      console.log('4. Click "Run"');
      console.log('5. Come back and run: node rebuild_email_system.js\n');
      return false;
    }
  }

  return true;
}

runMigration().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('\n❌ Migration failed:', error);
  process.exit(1);
});
