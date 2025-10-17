const axios = require('axios');

// Test script to audit leads counters and date filters
async function auditLeadsCounters() {
  console.log('🔍 AUDITING LEADS COUNTERS AND DATE FILTERS\n');

  const baseURL = 'http://localhost:5000';

  try {
    // Test 1: Get baseline stats from public endpoint
    console.log('1️⃣ TESTING BASELINE COUNTS (Public API)');
    const baselineStatsResponse = await axios.get(`${baseURL}/api/stats/leads-public`);
    console.log('   Public stats response:', JSON.stringify(baselineStatsResponse.data, null, 2));

    // Test 2: Test yesterday's data specifically (user mentioned this issue)
    console.log('\n2️⃣ TESTING YESTERDAY SPECIFICALLY');

    const yesterdayRange = getDateRange('yesterday');
    console.log(`   Yesterday date range: ${JSON.stringify(yesterdayRange)}`);

    // Test with yesterday date filter on public endpoint
    const yesterdayStatsResponse = await axios.get(`${baseURL}/api/stats/leads-public`, {
      params: {
        startDate: yesterdayRange.start,
        endDate: yesterdayRange.end
      }
    });
    console.log(`   Yesterday stats:`, JSON.stringify(yesterdayStatsResponse.data, null, 2));

    // Test 3: Test today's data
    console.log('\n3️⃣ TESTING TODAY SPECIFICALLY');

    const todayRange = getDateRange('today');
    console.log(`   Today date range: ${JSON.stringify(todayRange)}`);

    const todayStatsResponse = await axios.get(`${baseURL}/api/stats/leads-public`, {
      params: {
        startDate: todayRange.start,
        endDate: todayRange.end
      }
    });
    console.log(`   Today stats:`, JSON.stringify(todayStatsResponse.data, null, 2));

    // Test 4: Test last 7 days
    console.log('\n4️⃣ TESTING LAST 7 DAYS');

    const weekRange = getDateRange('week');
    console.log(`   Week date range: ${JSON.stringify(weekRange)}`);

    const weekStatsResponse = await axios.get(`${baseURL}/api/stats/leads-public`, {
      params: {
        startDate: weekRange.start,
        endDate: weekRange.end
      }
    });
    console.log(`   Last 7 days stats:`, JSON.stringify(weekStatsResponse.data, null, 2));

    // Test 5: Test last 30 days
    console.log('\n5️⃣ TESTING LAST 30 DAYS');

    const monthRange = getDateRange('month');
    console.log(`   Month date range: ${JSON.stringify(monthRange)}`);

    const monthStatsResponse = await axios.get(`${baseURL}/api/stats/leads-public`, {
      params: {
        startDate: monthRange.start,
        endDate: monthRange.end
      }
    });
    console.log(`   Last 30 days stats:`, JSON.stringify(monthStatsResponse.data, null, 2));

    // Test 6: Check actual database data with direct query
    console.log('\n6️⃣ CHECKING ACTUAL DATABASE DATA');

    // Let's try to get some calendar events to see real data
    const calendarResponse = await axios.get(`${baseURL}/api/stats/calendar-public`);
    console.log(`   Calendar events count: ${calendarResponse.data.length}`);
    console.log(`   Sample calendar events:`, calendarResponse.data.slice(0, 3));

    // Test 7: Try authenticated stats endpoint (will likely fail without token)
    console.log('\n7️⃣ TESTING AUTHENTICATED STATS ENDPOINT');

    try {
      const authStatsResponse = await axios.get(`${baseURL}/api/stats/leads`);
      console.log(`   Authenticated stats:`, JSON.stringify(authStatsResponse.data, null, 2));
    } catch (error) {
      console.log(`   Authenticated stats failed (expected):`, error.response?.data?.message || error.message);

      // Try with a dummy token to see what happens
      try {
        console.log(`   Trying with dummy token...`);
        const dummyTokenResponse = await axios.get(`${baseURL}/api/stats/leads`, {
          headers: { Authorization: 'Bearer dummy-token' }
        });
        console.log(`   Dummy token response:`, JSON.stringify(dummyTokenResponse.data, null, 2));
      } catch (dummyError) {
        console.log(`   Dummy token failed:`, dummyError.response?.data?.message || dummyError.message);
      }
    }

    // Test 8: Simulate what the frontend does exactly
    console.log('\n8️⃣ SIMULATING FRONTEND BEHAVIOR');

    // The frontend calls /api/stats/leads with created_at_start and created_at_end
    // Let's test what would happen if we could authenticate

    console.log('   Frontend would call: GET /api/stats/leads?created_at_start=...&created_at_end=...');
    console.log('   This should return the same data as public endpoint for admin users');

    // Test 9: Check if there are any leads with status='sales' (mentioned in frontend code)
    console.log('\n9️⃣ TESTING STATUS FILTERING LOGIC');

    // The frontend has a special case for 'sales' status that checks has_sale=1
    // Let's see if this affects the counts

    console.log('   Status filter logic in frontend:');
    console.log('   - statusFilter === "all": show all');
    console.log('   - statusFilter === "sales": lead.has_sale === 1');
    console.log('   - otherwise: lead.status === statusFilter');

    // Test 10: Check the actual leads data to see status distribution
    console.log('\n🔟 CHECKING LEAD STATUS DISTRIBUTION');

    try {
      // Get a sample of leads to see their status values
      const leadsSampleResponse = await axios.get(`${baseURL}/api/leads-public`);
      console.log(`   Found ${leadsSampleResponse.data.leads?.length || 0} sample leads`);

      if (leadsSampleResponse.data.leads && leadsSampleResponse.data.leads.length > 0) {
        const statusCounts = {};
        const hasSaleCounts = { true: 0, false: 0 };

        leadsSampleResponse.data.leads.forEach(lead => {
          const status = lead.status || 'null';
          statusCounts[status] = (statusCounts[status] || 0) + 1;
          hasSaleCounts[lead.has_sale === 1] = (hasSaleCounts[lead.has_sale === 1] || 0) + 1;
        });

        console.log('   Status distribution:', statusCounts);
        console.log('   Has sale distribution:', hasSaleCounts);
      }
    } catch (error) {
      console.log('   Could not get leads sample:', error.message);
    }

  } catch (error) {
    console.error('❌ Audit failed:', error.response?.data || error.message);
    console.error('Full error:', error);
  }
}

// Helper function to calculate date ranges (copied from frontend)
function getDateRange(dateFilter) {
  const now = new Date();
  const todayLondonStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const todayMidnightLondon = new Date(todayLondonStr + 'T00:00:00.000Z');

  switch (dateFilter) {
    case 'today':
      const startOfToday = todayLondonStr + 'T00:00:00.000Z';
      const startOfTomorrow = new Date(todayMidnightLondon.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] + 'T00:00:00.000Z';
      return {
        start: startOfToday,
        end: startOfTomorrow
      };
    case 'yesterday':
      const yesterdayDate = new Date(todayMidnightLondon.getTime() - 24 * 60 * 60 * 1000);
      const startOfYesterday = yesterdayDate.toISOString().split('T')[0] + 'T00:00:00.000Z';
      return {
        start: startOfYesterday,
        end: todayLondonStr + 'T00:00:00.000Z'
      };
    case 'week':
    case 'last7days':
      const weekAgo = new Date(todayMidnightLondon.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startOfWeek = weekAgo.toISOString().split('T')[0] + 'T00:00:00.000Z';
      return {
        start: startOfWeek,
        end: new Date().toISOString()
      };
    case 'month':
    case 'last30days':
      const monthAgo = new Date(todayMidnightLondon.getTime() - 30 * 24 * 60 * 60 * 1000);
      const startOfMonth = monthAgo.toISOString().split('T')[0] + 'T00:00:00.000Z';
      return {
        start: startOfMonth,
        end: new Date().toISOString()
      };
    default:
      return null;
  }
}

// Run the audit
if (require.main === module) {
  auditLeadsCounters().then(() => {
    console.log('\n✅ Audit completed');
  }).catch(error => {
    console.error('\n❌ Audit failed:', error);
  });
}

module.exports = { auditLeadsCounters };
