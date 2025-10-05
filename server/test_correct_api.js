#!/usr/bin/env node

/**
 * Test the API with correct created_at parameters
 */

const axios = require('axios');

async function testCorrectApi() {
  console.log('🧪 TESTING CORRECTED API CALLS');
  console.log('===============================');

  const today = new Date().toISOString().split('T')[0];

  try {
    // Test with created_at parameters (what we want)
    console.log('📊 Testing stats with created_at filtering...');

    const statsResponse = await axios.get('http://localhost:5000/api/stats/leads-public', {
      params: {
        startDate: `${today}T00:00:00.000Z`,
        endDate: `${today}T23:59:59.999Z`
      }
    });

    console.log('✅ Stats result:', statsResponse.data);

    // Test leads with created_at parameters
    console.log('\n📋 Testing leads with created_at filtering...');

    const leadsResponse = await axios.get('http://localhost:5000/api/leads/public', {
      params: {
        created_at_start: `${today}T00:00:00.000Z`,
        created_at_end: `${today}T23:59:59.999Z`,
        limit: 1000
      }
    });

    const leads = leadsResponse.data?.leads || [];
    console.log(`✅ Leads created today: ${leads.length}`);

    if (leads.length > 0) {
      console.log('📋 Bookings made today:');
      leads.forEach((lead, idx) => {
        const createdTime = new Date(lead.created_at).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', hour12: false
        });
        console.log(`${idx + 1}. ${lead.name} at ${createdTime} (Booker: ${lead.booker_id})`);
      });
    }

    console.log('\n🎯 EXPECTED DASHBOARD:');
    console.log('======================');
    console.log(`📊 DAILY ADMIN ACTIVITY DASHBOARD: ${leads.length} bookings`);
    console.log('📋 This shows bookings MADE today (daily activity)');

  } catch (error) {
    console.error('❌ API test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
if (require.main === module) {
  testCorrectApi();
}

module.exports = testCorrectApi;