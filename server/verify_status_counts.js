const dbManager = require('./database-connection-manager');

// Script to verify status counts in the database vs what stats endpoints return
async function verifyStatusCounts() {
  console.log('🔍 VERIFYING STATUS COUNTS - Database vs Stats Endpoints\n');

  try {
    console.log('1️⃣ QUERYING DATABASE DIRECTLY FOR STATUS COUNTS');

    // First get the accurate total count (same as stats API)
    const { count: totalCount, error: countError } = await dbManager.client
      .from('leads')
      .select('id', { count: 'exact', head: true });

    if (countError) throw countError;
    console.log(`📊 Database total count: ${totalCount}`);

    // Then get all leads for status breakdown (need to handle pagination)
    let allLeads = [];
    let from = 0;
    const batchSize = 1000;

    while (true) {
      const { data: batch, error: batchError } = await dbManager.client
        .from('leads')
        .select('status, created_at, has_sale')
        .range(from, from + batchSize - 1);

      if (batchError) throw batchError;
      if (!batch || batch.length === 0) break;

      allLeads = allLeads.concat(batch);
      from += batchSize;

      if (batch.length < batchSize) break; // Last batch
    }

    console.log(`📊 Database returned ${allLeads.length} total leads (paginated)`);

    // Count by status
    const statusCounts = {
      total: totalCount,
      new: 0,
      booked: 0,
      attended: 0,
      cancelled: 0,
      assigned: 0,
      rejected: 0,
      sales: 0 // has_sale = 1
    };

    allLeads.forEach(lead => {
      const status = lead.status || 'null';
      switch (status) {
        case 'New':
          statusCounts.new++;
          break;
        case 'Booked':
          statusCounts.booked++;
          break;
        case 'Attended':
          statusCounts.attended++;
          break;
        case 'Cancelled':
          statusCounts.cancelled++;
          break;
        case 'Assigned':
          statusCounts.assigned++;
          break;
        case 'Rejected':
          statusCounts.rejected++;
          break;
      }

      // Count sales (has_sale = 1)
      if (lead.has_sale === 1) {
        statusCounts.sales++;
      }
    });

    console.log('📊 DATABASE STATUS COUNTS:');
    console.log(JSON.stringify(statusCounts, null, 2));

    // Now test different date ranges
    console.log('\n2️⃣ TESTING DATE RANGE COUNTS');

    const testRanges = [
      {
        name: 'All Time',
        start: null,
        end: null
      },
      {
        name: 'Yesterday',
        start: '2025-10-14T00:00:00.000Z',
        end: '2025-10-15T00:00:00.000Z'
      },
      {
        name: 'Today',
        start: '2025-10-15T00:00:00.000Z',
        end: '2025-10-16T00:00:00.000Z'
      },
      {
        name: 'Last 7 Days',
        start: '2025-10-08T00:00:00.000Z',
        end: new Date().toISOString()
      },
      {
        name: 'Last 30 Days',
        start: '2025-09-15T00:00:00.000Z',
        end: new Date().toISOString()
      }
    ];

    for (const range of testRanges) {
      console.log(`\n📅 Testing ${range.name}:`);

      let query = dbManager.client
        .from('leads')
        .select('status, created_at, has_sale');

      if (range.start && range.end) {
        query = query
          .gte('created_at', range.start)
          .lte('created_at', range.end);
      }

      const { data: rangeLeads, error: rangeError } = await query.limit(10000);
      if (rangeError) throw rangeError;

      const rangeCounts = {
        total: rangeLeads.length,
        new: 0,
        booked: 0,
        attended: 0,
        cancelled: 0,
        assigned: 0,
        rejected: 0,
        sales: 0
      };

      rangeLeads.forEach(lead => {
        const status = lead.status || 'null';
        switch (status) {
          case 'New':
            rangeCounts.new++;
            break;
          case 'Booked':
            rangeCounts.booked++;
            break;
          case 'Attended':
            rangeCounts.attended++;
            break;
          case 'Cancelled':
            rangeCounts.cancelled++;
            break;
          case 'Assigned':
            rangeCounts.assigned++;
            break;
          case 'Rejected':
            rangeCounts.rejected++;
            break;
        }

        if (lead.has_sale === 1) {
          rangeCounts.sales++;
        }
      });

      console.log(`   ${range.name} Database Counts:`, JSON.stringify(rangeCounts, null, 2));
    }

    // Test what the actual stats endpoints return
    console.log('\n3️⃣ TESTING STATS ENDPOINTS');

    // Test the exact query used by stats API
    console.log('\n🔍 Testing exact same query as stats API:');
    const { data: statsQueryData, error: statsQueryError } = await dbManager.client
      .from('leads')
      .select('status')
      .limit(5000);

    if (statsQueryError) {
      console.log('❌ Stats query error:', statsQueryError);
    } else {
      console.log(`📊 Stats query returned ${statsQueryData?.length || 0} records`);

      const statsCounts = {
        new: statsQueryData.filter(lead => lead.status === 'New').length,
        booked: statsQueryData.filter(lead => lead.status === 'Booked').length,
        attended: statsQueryData.filter(lead => lead.status === 'Attended').length,
        cancelled: statsQueryData.filter(lead => lead.status === 'Cancelled').length,
        assigned: statsQueryData.filter(lead => lead.status === 'Assigned').length,
        rejected: statsQueryData.filter(lead => lead.status === 'Rejected').length
      };

      console.log('📊 Counts from stats-style query:', JSON.stringify(statsCounts, null, 2));
    }

    // Test the pagination approach used in the fixed stats API
    console.log('\n🔍 Testing pagination approach used in stats API:');
    let paginatedData = [];
    let rangeFrom = 0;
    const pageBatchSize = 1000;

    while (true) {
      console.log(`   Fetching batch from ${rangeFrom} to ${rangeFrom + pageBatchSize - 1}`);

      const { data: batch, error: batchError } = await dbManager.client
        .from('leads')
        .select('status')
        .range(rangeFrom, rangeFrom + pageBatchSize - 1);

      if (batchError) {
        console.log('   ❌ Batch error:', batchError);
        break;
      }

      console.log(`   Batch returned ${batch?.length || 0} records`);
      if (!batch || batch.length === 0) break;

      paginatedData = paginatedData.concat(batch);
      rangeFrom += pageBatchSize;

      if (batch.length < pageBatchSize) break;
    }

    console.log(`📊 Pagination returned ${paginatedData.length} total records`);

    const paginatedCounts = {
      new: paginatedData.filter(lead => lead.status === 'New').length,
      booked: paginatedData.filter(lead => lead.status === 'Booked').length,
      attended: paginatedData.filter(lead => lead.status === 'Attended').length,
      cancelled: paginatedData.filter(lead => lead.status === 'Cancelled').length,
      assigned: paginatedData.filter(lead => lead.status === 'Assigned').length,
      rejected: paginatedData.filter(lead => lead.status === 'Rejected').length
    };

    console.log('📊 Counts from pagination query:', JSON.stringify(paginatedCounts, null, 2));

    const axios = require('axios');
    const baseURL = 'http://localhost:5000';

    // Test public stats
    try {
      const publicStats = await axios.get(`${baseURL}/api/stats/leads-public`);
      console.log('📊 Public Stats API Response:');
      console.log(JSON.stringify(publicStats.data, null, 2));
    } catch (error) {
      console.log('❌ Public stats error:', error.message);
    }

    // Test authenticated stats (will fail without token, but we can see the logic)
    console.log('\n4️⃣ COMPARING DATABASE VS STATS API LOGIC');

    console.log('🔍 DATABASE COUNTING LOGIC:');
    console.log('   - Total: All records in leads table');
    console.log('   - New: status = "New"');
    console.log('   - Booked: status = "Booked"');
    console.log('   - Attended: status = "Attended"');
    console.log('   - Cancelled: status = "Cancelled"');
    console.log('   - Assigned: status = "Assigned"');
    console.log('   - Rejected: status = "Rejected"');

    console.log('\n🔍 STATS API LOGIC:');
    console.log('   - Should use the same counting as database');
    console.log('   - Should filter by created_at for date ranges');
    console.log('   - Should show global counts (no user filtering for counters)');

  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
}

// Run the verification
if (require.main === module) {
  verifyStatusCounts().then(() => {
    console.log('\n✅ Status count verification completed');
  }).catch(error => {
    console.error('\n❌ Status count verification failed:', error);
  });
}

module.exports = { verifyStatusCounts };
