const axios = require('axios');

// Test the sales API to see what data is being returned
async function testSalesAPI() {
  console.log('🧪 TESTING SALES API RESPONSE');
  console.log('================================');

  try {
    // Test basic sales endpoint
    console.log('📡 Calling /api/sales...');
    const response = await axios.get('http://localhost:5000/api/sales', {
      headers: {
        // Mock auth header for testing - in real scenario this would be set by the frontend
        'Authorization': 'Bearer mock-token'
      }
    });

    console.log('✅ API Response received');
    console.log('📊 Number of sales:', response.data?.length || 0);

    if (response.data && response.data.length > 0) {
      console.log('\n🔍 First sale data structure:');
      const firstSale = response.data[0];
      console.log('Sale ID:', firstSale.id);
      console.log('User ID:', firstSale.user_id);
      console.log('User Name:', firstSale.user_name);
      console.log('Amount:', firstSale.amount);
      console.log('Created At:', firstSale.created_at);
      console.log('All keys:', Object.keys(firstSale));

      console.log('\n🎯 Frontend display logic:');
      const displayName = firstSale.user_name || (firstSale.user_id ? `User ${firstSale.user_id.slice(-4)}` : 'System');
      console.log('What frontend will show:', `"${displayName}"`);

      if (firstSale.user_name) {
        console.log('✅ user_name is present - should display correctly');
      } else if (firstSale.user_id) {
        console.log('⚠️ user_name is missing but user_id exists - will show "User XXXX"');
      } else {
        console.log('❌ Both user_name and user_id are missing - will show "System"');
      }
    } else {
      console.log('❌ No sales data returned');
    }

  } catch (error) {
    console.error('❌ API test failed:', error.response?.data || error.message);

    if (error.response?.status === 401) {
      console.log('🔐 API requires authentication - this is expected');
    }
  }
}

testSalesAPI();
