#!/usr/bin/env node

/**
 * Comprehensive Dashboard Audit - Find why DAILY ADMIN ACTIVITY shows 0 bookings
 */

const dbManager = require('./database-connection-manager');

async function comprehensiveDashboardAudit() {
  console.log('🔍 COMPREHENSIVE DASHBOARD AUDIT');
  console.log('=================================');
  console.log('Finding why DAILY ADMIN ACTIVITY DASHBOARD shows 0 bookings\n');

  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Today: ${today}`);
    console.log(`🕐 Current time: ${new Date().toISOString()}\n`);

    // 1. CHECK RAW DATA - Total bookings for today
    console.log('📊 1. RAW DATA CHECK - Total bookings for today');
    console.log('===============================================');

    const allTodaysBookings = await dbManager.query('leads', {
      select: '*',
      gte: { date_booked: `${today}T00:00:00.000Z` },
      lte: { date_booked: `${today}T23:59:59.999Z` }
    });

    console.log(`✅ Total bookings for today: ${allTodaysBookings.length}`);

    // Group by status
    const statusBreakdown = {};
    allTodaysBookings.forEach(booking => {
      const status = booking.status || 'No Status';
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    });

    console.log('📋 Status breakdown:');
    Object.entries(statusBreakdown).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });

    // 2. CHECK BOOKER ASSIGNMENT
    console.log('\n👥 2. BOOKER ASSIGNMENT CHECK');
    console.log('============================');

    const bookingsWithBooker = allTodaysBookings.filter(b => b.booker_id);
    const bookingsWithoutBooker = allTodaysBookings.filter(b => !b.booker_id);

    console.log(`✅ Bookings with booker assigned: ${bookingsWithBooker.length}`);
    console.log(`⚠️  Bookings without booker: ${bookingsWithoutBooker.length}`);

    if (bookingsWithoutBooker.length > 0) {
      console.log('📋 Unassigned bookings:');
      bookingsWithoutBooker.forEach((booking, idx) => {
        console.log(`   ${idx + 1}. ${booking.name} - ${booking.status}`);
      });
    }

    // 3. CHECK SALES CONFLICT
    console.log('\n💰 3. SALES DATA CONFLICT CHECK');
    console.log('==============================');

    const bookingsWithSales = allTodaysBookings.filter(b => b.has_sale === 1 || b.sales);
    const bookingsWithoutSales = allTodaysBookings.filter(b => b.has_sale === 0 || !b.sales);

    console.log(`📈 Bookings with sales: ${bookingsWithSales.length}`);
    console.log(`📊 Bookings without sales: ${bookingsWithoutSales.length}`);

    // 4. CHECK DASHBOARD API FILTERS
    console.log('\n🔍 4. DASHBOARD API FILTER SIMULATION');
    console.log('====================================');

    // Simulate the EXACT query the dashboard fetchBookerStats function uses
    console.log('Simulating fetchBookerStats API query...');

    // Filter only "Booked" status (common filter in dashboard)
    const bookedOnly = allTodaysBookings.filter(booking => booking.status === 'Booked');
    console.log(`✅ Bookings with "Booked" status: ${bookedOnly.length}`);

    // Group by booker for dashboard display
    const dailyActivity = {};
    let processedCount = 0;

    bookedOnly.forEach(booking => {
      const bookerId = booking.booker_id;
      if (!bookerId) return;

      if (!dailyActivity[bookerId]) {
        dailyActivity[bookerId] = {
          bookingsToday: 0,
          bookings: []
        };
      }

      dailyActivity[bookerId].bookingsToday++;
      dailyActivity[bookerId].bookings.push({
        name: booking.name,
        time: new Date(booking.date_booked).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', hour12: false
        }),
        status: booking.status
      });
      processedCount++;
    });

    console.log(`✅ Processed bookings for daily activity: ${processedCount}`);
    console.log(`👥 Bookers with bookings today: ${Object.keys(dailyActivity).length}`);

    // 5. CHECK USER/BOOKER DATA
    console.log('\n👤 5. BOOKER DATA CHECK');
    console.log('======================');

    const bookers = await dbManager.query('users', {
      select: 'id, name, role',
      eq: { role: 'booker' }
    });

    console.log(`👥 Total bookers in system: ${bookers.length}`);

    const bookerMap = {};
    bookers.forEach(booker => {
      bookerMap[booker.id] = booker;
    });

    // Show daily activity with booker names
    console.log('\n📊 DAILY ACTIVITY BREAKDOWN (What dashboard should show):');
    console.log('=========================================================');

    Object.entries(dailyActivity).forEach(([bookerId, data]) => {
      const booker = bookerMap[bookerId];
      const bookerName = booker?.name || 'Unknown Booker';
      console.log(`👤 ${bookerName} (${bookerId}): ${data.bookingsToday} bookings`);
      data.bookings.forEach((booking, idx) => {
        console.log(`   ${idx + 1}. ${booking.name} at ${booking.time} (${booking.status})`);
      });
    });

    // 6. CHECK FOR POTENTIAL ISSUES
    console.log('\n⚠️  6. POTENTIAL ISSUES DIAGNOSIS');
    console.log('=================================');

    console.log('🔍 Checking for common dashboard issues:');

    // Issue 1: No bookings with "Booked" status
    if (bookedOnly.length === 0) {
      console.log('❌ ISSUE FOUND: No bookings have "Booked" status');
      console.log('   💡 Solution: Dashboard might be filtering only "Booked" status');
      console.log('   📋 Available statuses:', Object.keys(statusBreakdown));
    } else {
      console.log('✅ Bookings with "Booked" status exist');
    }

    // Issue 2: No booker assignments
    if (bookingsWithBooker.length === 0) {
      console.log('❌ ISSUE FOUND: No bookings have booker_id assigned');
      console.log('   💡 Solution: Dashboard needs booker_id to group bookings');
    } else {
      console.log('✅ Bookings with booker assignments exist');
    }

    // Issue 3: API authentication
    console.log('⚠️  POTENTIAL ISSUE: API Authentication');
    console.log('   📋 Dashboard APIs require authentication');
    console.log('   💡 Check browser console for 401/403 errors');

    // Issue 4: Wrong date filtering
    console.log('⚠️  POTENTIAL ISSUE: Date filtering mismatch');
    console.log('   📋 Check if dashboard uses created_at vs date_booked');

    // 7. RECOMMENDED FIXES
    console.log('\n🔧 7. RECOMMENDED FIXES');
    console.log('=======================');

    console.log('Based on the audit, try these fixes:');
    console.log('');
    console.log('1. 🔄 Hard refresh dashboard (Ctrl+Shift+R)');
    console.log('2. 🔐 Check login status - ensure admin user is logged in');
    console.log('3. 🔍 Check browser console for error messages');
    console.log('4. 📊 Verify dashboard is not filtering by specific status');
    console.log('5. 🔧 Check if /api/stats/leads endpoint is working');

    // 8. DATA VERIFICATION
    console.log('\n✅ 8. DATA VERIFICATION SUMMARY');
    console.log('==============================');

    console.log(`📊 Total bookings today: ${allTodaysBookings.length}`);
    console.log(`📋 Bookings with "Booked" status: ${bookedOnly.length}`);
    console.log(`👥 Bookings with booker assigned: ${bookingsWithBooker.length}`);
    console.log(`💰 Bookings with sales data: ${bookingsWithSales.length}`);
    console.log(`📈 Processed for daily activity: ${processedCount}`);
    console.log(`👤 Active bookers today: ${Object.keys(dailyActivity).length}`);

    if (processedCount > 0) {
      console.log('\n✅ DATA IS AVAILABLE - Dashboard should show bookings');
      console.log('❌ Issue is likely in frontend/API communication');
    } else {
      console.log('\n❌ NO DATA PROCESSED - Issue with data filtering');
    }

  } catch (error) {
    console.error('❌ Audit failed:', error);
  }
}

// Run the audit
if (require.main === module) {
  comprehensiveDashboardAudit();
}

module.exports = comprehensiveDashboardAudit;