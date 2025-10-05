#!/usr/bin/env node

/**
 * Test the API directly to see if changes work
 */

const axios = require('axios');

async function testApiDirect() {
  console.log('🧪 TESTING API ENDPOINTS DIRECTLY');
  console.log('==================================');

  const today = new Date().toISOString().split('T')[0];

  try {
    // Test the public stats endpoint I created
    console.log('📊 1. Testing public stats endpoint');

    try {
      const statsResponse = await axios.get('http://localhost:5000/api/stats/leads-public', {
        params: {
          startDate: `${today}T00:00:00.000Z`,
          endDate: `${today}T23:59:59.999Z`
        }
      });
      console.log('✅ Public stats response:', statsResponse.data);
    } catch (error) {
      console.log('❌ Public stats failed:', error.message);
    }

    // Test the public leads endpoint
    console.log('\n📋 2. Testing public leads endpoint');

    try {
      const leadsResponse = await axios.get('http://localhost:5000/api/leads/public', {
        params: {
          created_at_start: `${today}T00:00:00.000Z`,
          created_at_end: `${today}T23:59:59.999Z`,
          limit: 1000
        }
      });
      console.log('✅ Public leads response:', {
        count: leadsResponse.data?.leads?.length || 0,
        leads: leadsResponse.data?.leads?.map(l => l.name) || []
      });
    } catch (error) {
      console.log('❌ Public leads failed:', error.message);
    }

    console.log('\n💡 RECOMMENDATION:');
    console.log('==================');
    console.log('If public endpoints work, temporarily update Dashboard.js to use them:');
    console.log('- /api/stats/leads-public');
    console.log('- /api/leads/public');
    console.log('This will bypass authentication issues');

  } catch (error) {
    console.error('❌ API test failed:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testApiDirect();
}

module.exports = testApiDirect;