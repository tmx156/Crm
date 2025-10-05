// Check exactly what the dashboard is fetching
const axios = require('axios');

(async () => {
  try {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    console.log('🔍 Testing EXACT dashboard API calls...');
    console.log('📅 Today:', today.toDateString());
    console.log('📅 Range:', todayStart.toISOString(), 'to', todayEnd.toISOString());
    console.log('\n' + '='.repeat(80));

    // 1. Check leads
    console.log('\n1️⃣  CHECKING LEADS API (what Dashboard.js calls)...');
    try {
      const leadsRes = await axios.get('http://localhost:5000/api/leads/public', {
        params: {
          created_at_start: todayStart.toISOString(),
          created_at_end: todayEnd.toISOString()
        }
      });
      const leads = leadsRes.data?.leads || leadsRes.data || [];
      console.log(`   ✅ Found ${leads.length} leads created today`);

      if (leads.length > 0) {
        console.log('\n   📋 Leads:');
        leads.forEach(lead => {
          console.log(`      - ${lead.name} | Booker: ${lead.booker_id || 'Unassigned'} | Status: ${lead.status}`);
        });
      } else {
        console.log('   ⚠️  NO LEADS CREATED TODAY - Dashboard will show empty');
      }
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }

    // 2. Check users
    console.log('\n2️⃣  CHECKING USERS API...');
    try {
      const usersRes = await axios.get('http://localhost:5000/api/users');
      const users = usersRes.data || [];
      console.log(`   ✅ Found ${users.length} users`);
      if (users.length > 0) {
        users.forEach(u => console.log(`      - ${u.name} (ID: ${u.id})`));
      }
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }

    // 3. Check sales
    console.log('\n3️⃣  CHECKING SALES API...');
    try {
      const salesRes = await axios.get('http://localhost:5000/api/sales', {
        params: {
          startDate: todayStart.toISOString(),
          endDate: todayEnd.toISOString()
        }
      });
      const sales = salesRes.data || [];
      console.log(`   ✅ Found ${sales.length} sales created today`);

      if (sales.length > 0) {
        console.log('\n   📋 Sales:');
        sales.forEach(sale => {
          console.log(`      - £${sale.amount} | Lead: ${sale.lead_name} | User: ${sale.user_id}`);
        });
      } else {
        console.log('   ⚠️  NO SALES CREATED TODAY');
      }
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n📊 DASHBOARD SUMMARY:');
    console.log('   If all APIs returned 0 results, the DAILY ADMIN ACTIVITY DASHBOARD');
    console.log('   will show: "No bookings scheduled for today"');
    console.log('\n   This is CORRECT behavior - the dashboard only shows TODAY\'s activity.');
    console.log('   Historical data from Oct 2-3 will NOT appear.\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
})();
