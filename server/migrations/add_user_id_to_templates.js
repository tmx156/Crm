/**
 * Migration: Add user_id column to templates table
 * 
 * This migration adds user_id to track template ownership:
 * - Admin templates: user_id = NULL (global templates)
 * - User templates: user_id = specific user ID
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

async function addUserIdColumn() {
  try {
    console.log('🔄 Starting migration: Add user_id column to templates table...');

    // Execute SQL to add user_id column if it doesn't exist
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        -- Add user_id column if it doesn't exist (TEXT type to match users.id)
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'templates' AND column_name = 'user_id'
          ) THEN
            ALTER TABLE templates 
            ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
            
            RAISE NOTICE 'Added user_id column to templates table';
          ELSE
            RAISE NOTICE 'user_id column already exists in templates table';
          END IF;
        END $$;

        -- Create index for faster queries
        CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id);

        -- Set existing templates to NULL (admin/global templates)
        UPDATE templates SET user_id = NULL WHERE user_id IS NULL;
      `
    });

    if (error) {
      // If rpc method doesn't exist, try direct SQL
      console.log('⚠️ RPC method not available, attempting direct approach...');
      
      // Check if column exists
      const { data: columnCheck, error: checkError } = await supabase
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_name', 'templates')
        .eq('column_name', 'user_id');

      if (!columnCheck || columnCheck.length === 0) {
        console.log('✅ Column user_id does not exist. Please add it manually via Supabase SQL Editor:');
        console.log(`
          ALTER TABLE templates 
          ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
          
          CREATE INDEX idx_templates_user_id ON templates(user_id);
          
          UPDATE templates SET user_id = NULL WHERE user_id IS NULL;
        `);
        return false;
      } else {
        console.log('✅ Column user_id already exists');
        return true;
      }
    }

    console.log('✅ Migration completed successfully!');
    return true;

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.log('\n📝 Manual SQL to run in Supabase SQL Editor:');
    console.log(`
      -- Add user_id column if it doesn't exist (TEXT type to match users.id)
      ALTER TABLE templates 
      ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
      
      -- Create index for faster queries
      CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id);
      
      -- Set existing templates to NULL (admin/global templates)
      UPDATE templates SET user_id = NULL WHERE user_id IS NULL;
    `);
    return false;
  }
}

// Run migration if called directly
if (require.main === module) {
  addUserIdColumn()
    .then((success) => {
      if (success) {
        console.log('✅ Migration completed successfully');
        process.exit(0);
      } else {
        console.log('⚠️ Please run the SQL manually');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ Migration error:', error);
      process.exit(1);
    });
}

module.exports = { addUserIdColumn };

