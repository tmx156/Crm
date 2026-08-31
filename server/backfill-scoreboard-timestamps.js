const dbManager = require('./database-connection-manager');

async function backfillScoreboardTimestamps() {
  console.log('🔧 Starting scoreboard timestamp backfill...');
  
  try {
    // Get all leads with bookers but missing assigned_at timestamps
    const leadsToUpdate = await dbManager.query('leads', {
      select: 'id, name, booker_id, status, created_at, updated_at',
      not: { booker_id: null },
      is: { assigned_at: null }
    });

    console.log(`📊 Found ${leadsToUpdate.length} leads needing assigned_at timestamps`);

    let updatedCount = 0;
    let bookedCount = 0;

    for (const lead of leadsToUpdate) {
      try {
        const updateData = {
          assigned_at: lead.created_at || new Date().toISOString()
        };

        // If lead is booked but missing booked_at, set it to updated_at or created_at
        if (lead.status === 'Booked') {
          updateData.booked_at = lead.updated_at || lead.created_at || new Date().toISOString();
          bookedCount++;
        }

        await dbManager.update('leads', updateData, { id: lead.id });
        updatedCount++;

        console.log(`✅ Updated lead ${lead.name}: assigned_at=${updateData.assigned_at}${updateData.booked_at ? `, booked_at=${updateData.booked_at}` : ''}`);

      } catch (error) {
        console.error(`❌ Failed to update lead ${lead.name}:`, error.message);
      }
    }

    console.log(`🎉 Backfill complete: ${updatedCount} leads updated, ${bookedCount} booked leads processed`);

    // Now update daily performance for all bookers
    console.log('📊 Updating daily performance metrics...');
    
    const bookers = await dbManager.query('users', {
      select: 'id, name',
      eq: { role: 'booker' }
    });

    for (const booker of bookers) {
      try {
        const bookerAnalytics = require('./routes/booker-analytics');
        await bookerAnalytics.updateDailyPerformance(booker.id);
        console.log(`✅ Updated daily performance for ${booker.name}`);
      } catch (error) {
        console.error(`❌ Failed to update performance for ${booker.name}:`, error.message);
      }
    }

    console.log('🎯 Scoreboard backfill completed successfully!');

  } catch (error) {
    console.error('❌ Backfill failed:', error);
  }
}

// Run the backfill
backfillScoreboardTimestamps();
