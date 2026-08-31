#!/usr/bin/env node

/**
 * Test if the current server is working with our test data
 */

const axios = require('axios');

async function testCurrentServer() {
  console.log('🧪 TESTING: Current running server');
  console.log('==================================');

  try {
    // Test if server is responding
    const healthResponse = await axios.get('http://localhost:5000/');
    console.log('✅ Server is responding');

    // Note: The dashboard API calls require authentication, so we can't test them directly
    // But we can check if the data would be available

    console.log('\n📋 DASHBOARD REFRESH INSTRUCTIONS:');
    console.log('==================================');
    console.log('1. Open dashboard at http://localhost:3000');
    console.log('2. Press F12 to open Developer Tools');
    console.log('3. Go to Console tab');
    console.log('4. Press Ctrl+Shift+R to hard refresh the page');
    console.log('5. Look for console logs starting with "🌅 DAILY ADMIN ACTIVITY DASHBOARD"');
    console.log('6. The dashboard should now show 24 bookings');
    console.log('7. john wf should show 3 bookings');

    console.log('\n🔍 EXPECTED CONSOLE LOGS:');
    console.log('=========================');
    console.log('🌅 DAILY ADMIN ACTIVITY DASHBOARD: Fetching today\'s booking activity...');
    console.log('📅 Today: 2025-09-28 | Current time: [time]');
    console.log('📅 Stats filtering by appointment date: 2025-09-28T00:00:00.000Z to 2025-09-28T23:59:59.999Z');
    console.log('🎆 DAILY RESET LOGIC: Found 24 total bookings since midnight');
    console.log('📋 Detailed breakdown: 24 leads for admin activity view');
    console.log('🌅 DAILY ADMIN ACTIVITY DASHBOARD loaded:');
    console.log('   📈 Total bookings today: 24 (matches Total Bookings Today: 24)');
    console.log('   👥 Active bookers today: 2');
    console.log('   1. Unknown Booker: 21 bookings today');
    console.log('   2. john wf: 3 bookings today');

    console.log('\n⚡ ALTERNATIVE: Create new test booking to trigger refresh');
    console.log('===========================================================');
    console.log('Run: cd server && node test_another_john_wf_booking.js');
    console.log('This will create a new booking and should trigger real-time updates');

  } catch (error) {
    console.error('❌ Server test failed:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testCurrentServer();
}

module.exports = testCurrentServer;