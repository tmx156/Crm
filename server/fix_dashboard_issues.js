#!/usr/bin/env node

/**
 * Fix Dashboard Data Issues
 * Addresses the specific problems identified in the audit
 */

const dbManager = require('./database-connection-manager');

async function fixDashboardIssues() {
  console.log('🔧 FIXING DASHBOARD DATA ISSUES');
  console.log('================================');

  try {
    let fixCount = 0;

    // === FIX 1: Update has_sale flag for leads with sales ===
    console.log('🔧 1. Fixing has_sale flags...');

    const allSales = await dbManager.query('sales', {
      select: 'lead_id'
    });

    const leadIdsWithSales = [...new Set(allSales.map(sale => sale.lead_id))];
    console.log(`💰 Found ${leadIdsWithSales.length} unique leads with sales`);

    for (const leadId of leadIdsWithSales) {
      try {
        const leads = await dbManager.query('leads', {
          select: 'id, has_sale',
          eq: { id: leadId }
        });

        if (leads.length > 0 && !leads[0].has_sale) {
          await dbManager.update('leads',
            { has_sale: true },
            { id: leadId }
          );
          console.log(`✅ Updated has_sale flag for lead ${leadId}`);
          fixCount++;
        }
      } catch (error) {
        console.error(`❌ Failed to update lead ${leadId}:`, error.message);
      }
    }

    // === FIX 2: Analyze unassigned leads ===
    console.log('\n🔧 2. Analyzing unassigned leads...');

    const unassignedLeads = await dbManager.query('leads', {
      select: 'id, name, created_at, status',
      eq: { booker_id: null }
    });

    console.log(`📋 Found ${unassignedLeads.length} unassigned leads`);

    if (unassignedLeads.length > 0) {
      console.log('📊 Status breakdown of unassigned leads:');
      const statusCounts = unassignedLeads.reduce((counts, lead) => {
        const status = lead.status || 'Unknown';
        counts[status] = (counts[status] || 0) + 1;
        return counts;
      }, {});

      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`   ${status}: ${count}`);
      });

      console.log('⚠️ These leads should be assigned to bookers for accurate dashboard stats');
    }

    // === FIX 3: Data validation ===
    console.log('\n🔧 3. Running data validation...');

    // Check for invalid dates
    const allLeads = await dbManager.query('leads', {
      select: 'id, date_booked, created_at'
    });

    const invalidDateBookedLeads = allLeads.filter(lead =>
      lead.date_booked && isNaN(new Date(lead.date_booked).getTime())
    );

    const invalidCreatedAtLeads = allLeads.filter(lead =>
      lead.created_at && isNaN(new Date(lead.created_at).getTime())
    );

    console.log(`📅 Leads with invalid date_booked: ${invalidDateBookedLeads.length}`);
    console.log(`📅 Leads with invalid created_at: ${invalidCreatedAtLeads.length}`);

    if (invalidDateBookedLeads.length > 0) {
      console.log('❌ Invalid date_booked found in leads:');
      invalidDateBookedLeads.slice(0, 5).forEach(lead => {
        console.log(`   Lead ${lead.id}: date_booked = "${lead.date_booked}"`);
      });
    }

    // === FIX 4: Generate accurate dashboard statistics ===
    console.log('\n🔧 4. Generating corrected dashboard statistics...');

    const today = new Date().toISOString().split('T')[0];
    const currentHour = new Date().getHours();

    // Correct today's bookings (using date_booked)
    const todaysBookings = allLeads.filter(lead =>
      lead.date_booked && lead.date_booked.startsWith(today)
    ).length;

    // Correct today's new leads (using created_at)
    const todaysNewLeads = allLeads.filter(lead =>
      lead.created_at && lead.created_at.startsWith(today)
    ).length;

    // Correct this hour's bookings (actual leads booked this hour)
    const thisHourStart = new Date();
    thisHourStart.setMinutes(0, 0, 0);
    const thisHourEnd = new Date();
    thisHourEnd.setMinutes(59, 59, 999);

    const thisHourBookings = allLeads.filter(lead => {
      if (!lead.date_booked) return false;
      const bookingDate = new Date(lead.date_booked);
      return bookingDate >= thisHourStart && bookingDate <= thisHourEnd;
    }).length;

    // Sales data
    const todaysSales = await dbManager.query('sales', {
      select: 'id, amount',
      gte: { created_at: today + 'T00:00:00.000Z' },
      lte: { created_at: today + 'T23:59:59.999Z' }
    });

    const todaysRevenue = todaysSales.reduce((sum, sale) => sum + (sale.amount || 0), 0);

    console.log('📊 CORRECTED DASHBOARD STATISTICS:');
    console.log('===================================');
    console.log(`📅 Today's date: ${today}`);
    console.log(`⏰ Current hour: ${currentHour}:00`);
    console.log(`📊 Today's bookings (date_booked): ${todaysBookings}`);
    console.log(`📊 Today's new leads (created_at): ${todaysNewLeads}`);
    console.log(`📊 This hour's bookings (actual): ${thisHourBookings}`);
    console.log(`💰 Today's sales: ${todaysSales.length}`);
    console.log(`💰 Today's revenue: £${todaysRevenue.toFixed(2)}`);

    // === FIX 5: Booker performance calculation ===
    console.log('\n🔧 5. Corrected booker performance...');

    const bookers = await dbManager.query('users', {
      select: 'id, name',
      eq: { role: 'booker' }
    });

    console.log('📈 CORRECTED BOOKER STATS:');
    for (const booker of bookers) {
      const bookerLeads = allLeads.filter(lead => lead.booker_id === booker.id);

      // Today's bookings (appointments scheduled for today)
      const todaysBookings = bookerLeads.filter(lead =>
        lead.date_booked && lead.date_booked.startsWith(today)
      ).length;

      // Today's assignments (leads assigned today)
      const todaysAssignments = bookerLeads.filter(lead =>
        lead.created_at && lead.created_at.startsWith(today)
      ).length;

      // Overall conversion rate
      const totalBooked = bookerLeads.filter(lead => lead.status === 'Booked').length;
      const conversionRate = bookerLeads.length > 0 ?
        ((totalBooked / bookerLeads.length) * 100).toFixed(2) : 0;

      console.log(`👤 ${booker.name}:`);
      console.log(`   📅 Today's bookings: ${todaysBookings}`);
      console.log(`   📋 Today's assignments: ${todaysAssignments}`);
      console.log(`   📊 Total leads: ${bookerLeads.length}`);
      console.log(`   📊 Total booked: ${totalBooked}`);
      console.log(`   📈 Conversion rate: ${conversionRate}%`);
      console.log('');
    }

    console.log('\n✅ DASHBOARD FIX SUMMARY');
    console.log('=========================');
    console.log(`🔧 Data fixes applied: ${fixCount}`);
    console.log(`📊 Statistics recalculated: ✅`);
    console.log(`📈 Booker performance verified: ✅`);

    console.log('\n💡 NEXT STEPS:');
    console.log('==============');
    console.log('1. Restart the server to apply fixes');
    console.log('2. Verify dashboard shows correct figures');
    console.log('3. Assign unassigned leads to bookers');
    console.log('4. Monitor data consistency going forward');

  } catch (error) {
    console.error('❌ Fix script failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the fix
if (require.main === module) {
  fixDashboardIssues();
}

module.exports = fixDashboardIssues;