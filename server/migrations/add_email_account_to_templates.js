const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrate() {
  console.log('🔄 Starting migration: Adding email_account to templates...');

  try {
    // First, check if the column already exists
    const { data: existingTemplates, error: checkError } = await supabase
      .from('templates')
      .select('*')
      .limit(1);

    if (checkError) {
      console.error('❌ Error checking templates:', checkError);
      return;
    }

    // Check if email_account column exists
    if (existingTemplates && existingTemplates.length > 0) {
      const hasEmailAccount = 'email_account' in existingTemplates[0];

      if (hasEmailAccount) {
        console.log('✅ email_account column already exists');
      } else {
        console.log('⚠️ email_account column does not exist');
        console.log('Please run this SQL in Supabase SQL Editor:');
        console.log('');
        console.log('ALTER TABLE templates ADD COLUMN email_account VARCHAR(50) DEFAULT \'primary\';');
        console.log('UPDATE templates SET email_account = \'primary\' WHERE email_account IS NULL;');
        console.log('CREATE INDEX IF NOT EXISTS idx_templates_email_account ON templates(email_account);');
        console.log('');
      }
    }

    // Update all existing templates to use primary account
    const { data, error } = await supabase
      .from('templates')
      .update({ email_account: 'primary' })
      .is('email_account', null);

    if (error && error.code !== '42703') { // Ignore column doesn't exist error
      console.error('❌ Error updating templates:', error);
      return;
    }

    console.log('✅ Migration completed successfully');
    console.log('📊 Templates updated');

  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

migrate().then(() => {
  console.log('Done!');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
