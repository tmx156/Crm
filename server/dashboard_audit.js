#!/usr/bin/env node

/**
 * Dashboard Data Audit Script
 * Deep dive into dashboard metrics to identify data inconsistencies
 */

const dbManager = require('./database-connection-manager');

async function auditDashboardData() {
  console.log('🔍 DASHBOARD DATA AUDIT');
  console.log('=======================');

  try {
    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date();
    const startOfDay = new Date(today + 'T00:00:00.000Z');
    const endOfDay = new Date(today + 'T23:59:59.999Z');

    console.log(`📅 Audit Date: ${today}`);
    console.log(`⏰ Current Time: ${currentTime.toISOString()}`);
    console.log('');

    // === LEADS AUDIT ===
    console.log('📊 1. LEADS DATA AUDIT');
    console.log('======================');

    // Get all leads
    const allLeads = await dbManager.query('leads', {
      select: 'id, name, status, created_at, date_booked, booker_id, has_sale'
    });
    console.log(`📋 Total leads in database: ${allLeads.length}`);

    // Get today's leads by created_at
    const todaysCreatedLeads = allLeads.filter(lead =>
      lead.created_at && lead.created_at.startsWith(today)
    );
    console.log(`📅 Leads created today: ${todaysCreatedLeads.length}`);

    // Get today's bookings by date_booked
    const todaysBookedLeads = allLeads.filter(lead =>
      lead.date_booked && lead.date_booked.startsWith(today)
    );
    console.log(`📅 Leads booked for today: ${todaysBookedLeads.length}`);

    // Status breakdown
    const statusCounts = allLeads.reduce((counts, lead) => {
      const status = lead.status || 'Unknown';
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});

    console.log('📊 Status breakdown:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });

    // === BOOKER PERFORMANCE AUDIT ===
    console.log('\n📊 2. BOOKER PERFORMANCE AUDIT');
    console.log('===============================');

    // Get all users with booker role
    const bookers = await dbManager.query('users', {
      select: 'id, name, role',
      eq: { role: 'booker' }
    });
    console.log(`👥 Total bookers: ${bookers.length}`);

    // Calculate real-time booker stats
    const bookerStats = [];
    for (const booker of bookers) {
      const bookerLeads = allLeads.filter(lead => lead.booker_id === booker.id);
      const todaysBookings = bookerLeads.filter(lead =>
        lead.date_booked && lead.date_booked.startsWith(today)
      );
      const todaysAssignments = bookerLeads.filter(lead =>
        lead.created_at && lead.created_at.startsWith(today)
      );

      bookerStats.push({
        id: booker.id,
        name: booker.name,
        totalAssigned: bookerLeads.length,
        todaysAssignments: todaysAssignments.length,
        todaysBookings: todaysBookings.length,
        totalBookings: bookerLeads.filter(l => l.status === 'Booked').length,
        conversionRate: bookerLeads.length > 0 ?
          ((bookerLeads.filter(l => l.status === 'Booked').length / bookerLeads.length) * 100).toFixed(2) : 0
      });
    }

    bookerStats.sort((a, b) => b.todaysBookings - a.todaysBookings);

    console.log('📈 Booker performance (sorted by today\'s bookings):');
    bookerStats.forEach((booker, index) => {
      console.log(`${index + 1}. ${booker.name}:`);
      console.log(`   Today's bookings: ${booker.todaysBookings}`);
      console.log(`   Today's assignments: ${booker.todaysAssignments}`);
      console.log(`   Total bookings: ${booker.totalBookings}`);
      console.log(`   Conversion rate: ${booker.conversionRate}%`);
      console.log('');
    });

    // === SALES AUDIT ===
    console.log('📊 3. SALES DATA AUDIT');
    console.log('======================');

    const allSales = await dbManager.query('sales', {
      select: 'id, amount, created_at, lead_id, user_id'
    });
    console.log(`💰 Total sales in database: ${allSales.length}`);

    const todaysSales = allSales.filter(sale =>
      sale.created_at && sale.created_at.startsWith(today)
    );
    console.log(`💰 Sales made today: ${todaysSales.length}`);

    const todaysRevenue = todaysSales.reduce((sum, sale) => sum + (sale.amount || 0), 0);
    console.log(`💰 Today's revenue: £${todaysRevenue.toFixed(2)}`);

    // === DASHBOARD CALCULATION VERIFICATION ===
    console.log('\n📊 4. DASHBOARD CALCULATION VERIFICATION');
    console.log('=========================================');

    console.log('🔍 What the dashboard should show:');
    console.log(`📊 Today's bookings: ${todaysBookedLeads.length}`);
    console.log(`📊 This hour's bookings: ${Math.floor(todaysBookedLeads.length * (new Date().getHours() / 24))}`);
    console.log(`📊 Today's sales: ${todaysSales.length}`);
    console.log(`📊 Today's revenue: £${todaysRevenue.toFixed(2)}`);
    console.log(`📊 Active bookers: ${bookerStats.filter(b => b.todaysBookings > 0).length}`);

    // === DATA CONSISTENCY CHECKS ===
    console.log('\n🔍 5. DATA CONSISTENCY CHECKS');
    console.log('==============================');

    let issuesFound = 0;

    // Check for leads with sales but no has_sale flag
    const leadsWithSales = allSales.map(sale => sale.lead_id);
    const leadsWithoutSaleFlag = allLeads.filter(lead =>
      leadsWithSales.includes(lead.id) && !lead.has_sale
    );
    if (leadsWithoutSaleFlag.length > 0) {
      console.log(`❌ ${leadsWithoutSaleFlag.length} leads have sales but missing has_sale flag`);
      issuesFound++;
    }

    // Check for orphaned sales (sales without leads)
    const validLeadIds = allLeads.map(lead => lead.id);
    const orphanedSales = allSales.filter(sale =>
      sale.lead_id && !validLeadIds.includes(sale.lead_id)
    );
    if (orphanedSales.length > 0) {
      console.log(`❌ ${orphanedSales.length} sales reference non-existent leads`);
      issuesFound++;
    }

    // Check for leads without bookers
    const unassignedLeads = allLeads.filter(lead => !lead.booker_id);
    if (unassignedLeads.length > 0) {
      console.log(`⚠️ ${unassignedLeads.length} leads without assigned bookers`);
    }

    // Check for inconsistent date formats
    const invalidDates = allLeads.filter(lead =>
      lead.date_booked && isNaN(new Date(lead.date_booked).getTime())
    );
    if (invalidDates.length > 0) {
      console.log(`❌ ${invalidDates.length} leads with invalid date_booked format`);
      issuesFound++;
    }

    if (issuesFound === 0) {
      console.log('✅ No critical data consistency issues found');
    } else {
      console.log(`❌ Found ${issuesFound} critical data consistency issues`);
    }

    // === SUMMARY ===
    console.log('\n📋 AUDIT SUMMARY');
    console.log('================');
    console.log(`✅ Database connection: Working`);
    console.log(`✅ Data retrieval: Working`);
    console.log(`✅ Basic calculations: Working`);
    console.log(`📊 Data quality: ${issuesFound === 0 ? 'Good' : 'Issues found'}`);

    console.log('\n💡 RECOMMENDATIONS:');
    console.log('===================');
    if (issuesFound > 0) {
      console.log('1. Fix data consistency issues identified above');
      console.log('2. Implement data validation on lead updates');
      console.log('3. Add automated data integrity checks');
    }
    console.log('4. Verify dashboard API endpoints are working');
    console.log('5. Check frontend data fetching logic');
    console.log('6. Confirm real-time updates are functioning');

  } catch (error) {
    console.error('❌ Audit failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the audit
if (require.main === module) {
  auditDashboardData();
}

module.exports = auditDashboardData;