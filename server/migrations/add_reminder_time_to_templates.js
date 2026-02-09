const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey);

async function migrate() {
  console.log('🔄 Starting migration: Adding reminder_time to templates...');

  try {
    // Check if the column already exists
    const { data: existingTemplates, error: checkError } = await supabase
      .from('templates')
      .select('*')
      .limit(1);

    if (checkError) {
      console.error('❌ Error checking templates:', checkError);
      return;
    }

    if (existingTemplates && existingTemplates.length > 0) {
      const hasReminderTime = 'reminder_time' in existingTemplates[0];

      if (hasReminderTime) {
        console.log('✅ reminder_time column already exists');
      } else {
        console.log('⚠️ reminder_time column does not exist');
        console.log('Please run this SQL in Supabase SQL Editor:');
        console.log('');
        console.log("ALTER TABLE templates ADD COLUMN reminder_time VARCHAR(5) DEFAULT '09:00';");
        console.log("UPDATE templates SET reminder_time = '09:00' WHERE type = 'appointment_reminder' AND reminder_time IS NULL;");
        console.log('');
      }
    }

    // Update existing appointment_reminder templates
    const { error } = await supabase
      .from('templates')
      .update({ reminder_time: '09:00' })
      .eq('type', 'appointment_reminder')
      .is('reminder_time', null);

    if (error && error.code !== '42703') {
      console.error('❌ Error updating templates:', error);
      return;
    }

    console.log('✅ Migration completed successfully');

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
