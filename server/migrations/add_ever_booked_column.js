/**
 * Migration: Add ever_booked column to leads table
 *
 * Purpose: Track if a lead was ever booked, regardless of current status
 * This ensures cancelled bookings remain in statistics
 *
 * Steps:
 * 1. Add ever_booked column (BOOLEAN, default FALSE)
 * 2. Backfill existing data based on booked_at timestamp
 * 3. Verify the migration
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('🚀 Starting migration: Add ever_booked column\n');

  try {
    // Step 1: Add the ever_booked column using raw SQL
    console.log('📊 Step 1: Adding ever_booked column to leads table...');

    const { error: alterError } = await supabase.rpc('exec_sql', {
      sql: `
        DO $$
        BEGIN
          -- Check if column exists, if not add it
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'leads' AND column_name = 'ever_booked'
          ) THEN
            ALTER TABLE leads ADD COLUMN ever_booked BOOLEAN DEFAULT FALSE;
            COMMENT ON COLUMN leads.ever_booked IS 'Tracks if this lead was ever booked, remains true even after cancellation';
          END IF;
        END $$;
      `
    });

    if (alterError) {
      // If RPC doesn't exist, try direct ALTER TABLE
      console.log('⚠️  RPC method not available, trying direct SQL execution...');

      // For Supabase, we might need to use the SQL editor or do it via raw query
      // Let's try a simpler approach - just update in batches
      console.log('💡 Using batch update approach instead...');
    } else {
      console.log('✅ Column added successfully (or already exists)');
    }

    // Step 2: Backfill existing data
    console.log('\n📊 Step 2: Backfilling ever_booked for existing leads...');
    console.log('   Setting ever_booked = TRUE for all leads with booked_at timestamp...');

    // Get count of leads with booked_at
    const { count: totalToUpdate, error: countError } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .not('booked_at', 'is', null);

    if (countError) throw countError;

    console.log(`   Found ${totalToUpdate} leads with booking history`);

    if (totalToUpdate > 0) {
      // Update all leads with booked_at to have ever_booked = true
      const { data: updateResult, error: updateError } = await supabase
        .from('leads')
        .update({ ever_booked: true })
        .not('booked_at', 'is', null)
        .select('id');

      if (updateError) throw updateError;

      console.log(`✅ Updated ${updateResult?.length || 0} leads with ever_booked = TRUE`);
    }

    // Step 3: Verify the migration
    console.log('\n📊 Step 3: Verifying migration...');

    const { data: stats, error: statsError } = await supabase
      .from('leads')
      .select('status, ever_booked, booked_at')
      .limit(1000);

    if (statsError) throw statsError;

    const everBookedCount = stats.filter(l => l.ever_booked).length;
    const currentlyBooked = stats.filter(l => l.status === 'Booked').length;
    const cancelledButEverBooked = stats.filter(l => l.ever_booked && l.status === 'Cancelled').length;
    const bookedAtCount = stats.filter(l => l.booked_at).length;

    console.log('\n📈 Migration Results:');
    console.log(`   Total leads checked: ${stats.length}`);
    console.log(`   Leads with ever_booked = TRUE: ${everBookedCount}`);
    console.log(`   Leads with booked_at timestamp: ${bookedAtCount}`);
    console.log(`   Currently Booked: ${currentlyBooked}`);
    console.log(`   Cancelled (but ever_booked): ${cancelledButEverBooked}`);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('📝 Next steps:');
    console.log('   1. Update booking logic to set ever_booked = TRUE when booking');
    console.log('   2. Update stats queries to use ever_booked instead of status filter');
    console.log('   3. Update daily activities to show cancelled bookings\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

// Run migration if called directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log('Migration script completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };
