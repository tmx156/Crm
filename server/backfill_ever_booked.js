/**
 * Backfill ever_booked column for existing bookings
 * Updates in small batches to avoid timeout
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillEverBooked() {
  console.log('🚀 Backfilling ever_booked column\n');
  console.log('='.repeat(80));

  try {
    // First, count how many leads need updating
    const { count: totalNeedingUpdate, error: countError } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .not('booked_at', 'is', null)
      .or('ever_booked.is.null,ever_booked.eq.false');

    if (countError) throw countError;

    console.log(`\n📊 Found ${totalNeedingUpdate} leads that need ever_booked = true\n`);

    if (totalNeedingUpdate === 0) {
      console.log('✅ All bookings already have ever_booked set correctly!\n');
      return;
    }

    // Update in batches of 50
    const batchSize = 50;
    let updated = 0;
    let offset = 0;

    while (offset < totalNeedingUpdate) {
      // Get batch of leads to update
      const { data: batch, error: fetchError } = await supabase
        .from('leads')
        .select('id')
        .not('booked_at', 'is', null)
        .or('ever_booked.is.null,ever_booked.eq.false')
        .range(offset, offset + batchSize - 1);

      if (fetchError) throw fetchError;

      if (!batch || batch.length === 0) break;

      // Update each lead in the batch
      const ids = batch.map(lead => lead.id);
      
      const { error: updateError } = await supabase
        .from('leads')
        .update({ ever_booked: true })
        .in('id', ids);

      if (updateError) {
        console.error(`❌ Error updating batch at offset ${offset}:`, updateError);
        throw updateError;
      }

      updated += batch.length;
      offset += batchSize;

      const percentage = ((updated / totalNeedingUpdate) * 100).toFixed(1);
      console.log(`   ✓ Updated ${updated}/${totalNeedingUpdate} (${percentage}%)`);
    }

    console.log(`\n✅ Successfully updated ${updated} leads!\n`);

    // Verify the update
    console.log('🔍 Verifying update...\n');
    
    const { count: remainingCount, error: verifyError } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .not('booked_at', 'is', null)
      .or('ever_booked.is.null,ever_booked.eq.false');

    if (verifyError) throw verifyError;

    if (remainingCount === 0) {
      console.log('✅ Verification passed! All bookings now have ever_booked = true\n');
    } else {
      console.log(`⚠️  Warning: ${remainingCount} leads still need updating. Running again...\n`);
      // Recursive call to handle any remaining
      await backfillEverBooked();
    }

    // Show final stats
    const { data: stats, error: statsError } = await supabase
      .from('leads')
      .select('status, ever_booked, booked_at')
      .limit(1000);

    if (!statsError && stats) {
      const everBookedCount = stats.filter(l => l.ever_booked).length;
      const currentlyBooked = stats.filter(l => l.status === 'Booked').length;
      const cancelledButEverBooked = stats.filter(l => l.ever_booked && l.status === 'Cancelled').length;

      console.log('📈 Final Statistics (sample of 1000 leads):');
      console.log('='.repeat(80));
      console.log(`   Leads with ever_booked = true: ${everBookedCount}`);
      console.log(`   Currently Booked status:       ${currentlyBooked}`);
      console.log(`   Cancelled (but ever_booked):   ${cancelledButEverBooked}`);
      console.log('');
    }

  } catch (error) {
    console.error('\n❌ Backfill failed:', error);
    console.error('Details:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  backfillEverBooked()
    .then(() => {
      console.log('✅ Backfill completed successfully\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('Backfill failed:', error);
      process.exit(1);
    });
}

module.exports = { backfillEverBooked };

