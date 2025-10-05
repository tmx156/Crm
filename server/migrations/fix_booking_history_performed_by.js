/**
 * Migration: Fix booking_history performed_by column type
 * 
 * Changes performed_by from INTEGER to TEXT to match users.id type
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

async function fixBookingHistoryPerformedBy() {
  try {
    console.log('🔄 Starting migration: Fix booking_history performed_by column...');

    console.log('\n📝 Run this SQL in Supabase SQL Editor:\n');
    console.log(`
      -- Fix booking_history table performed_by column to match users.id type
      
      -- Step 1: Drop the foreign key constraint if it exists
      ALTER TABLE booking_history 
      DROP CONSTRAINT IF EXISTS booking_history_performed_by_fkey;
      
      -- Step 2: Change column type from INTEGER to TEXT
      ALTER TABLE booking_history 
      ALTER COLUMN performed_by TYPE TEXT USING performed_by::TEXT;
      
      -- Step 3: Re-add foreign key constraint with correct type
      ALTER TABLE booking_history 
      ADD CONSTRAINT booking_history_performed_by_fkey 
      FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL;
      
      -- Step 4: Update any existing numeric IDs to NULL (if needed)
      -- UPDATE booking_history SET performed_by = NULL WHERE performed_by IS NOT NULL AND performed_by ~ '^[0-9]+$';
    `);

    console.log('\n✅ Copy and run the SQL above in Supabase SQL Editor');
    console.log('   This will fix the type mismatch between booking_history.performed_by and users.id\n');

    return true;

  } catch (error) {
    console.error('❌ Migration error:', error);
    return false;
  }
}

// Run migration if called directly
if (require.main === module) {
  fixBookingHistoryPerformedBy()
    .then((success) => {
      if (success) {
        console.log('✅ Migration script completed');
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

module.exports = { fixBookingHistoryPerformedBy };

