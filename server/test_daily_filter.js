// Test script to verify daily activity filtering
const axios = require('axios');

(async () => {
  try {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    console.log('🔍 Testing /api/leads/public with created_at filtering');
    console.log('📅 Today range:', todayStart.toISOString(), 'to', todayEnd.toISOString());

    const response = await axios.get('http://localhost:5000/api/leads/public', {
      params: {
        created_at_start: todayStart.toISOString(),
        created_at_end: todayEnd.toISOString()
      }
    });

    const leads = response.data?.leads || response.data || [];
    console.log('\n📊 Results:', leads.length, 'leads returned');

    if (leads.length > 0) {
      console.log('\n📋 Leads returned:');
      leads.forEach((lead, idx) => {
        const createdDate = new Date(lead.created_at);
        const isToday = createdDate >= todayStart && createdDate <= todayEnd;
        console.log(`  ${idx + 1}. ${lead.name} | Created: ${lead.created_at} | ${isToday ? '✅ TODAY' : '❌ NOT TODAY'}`);
      });

      const todayLeads = leads.filter(l => {
        const d = new Date(l.created_at);
        return d >= todayStart && d <= todayEnd;
      });
      console.log(`\n✅ Leads actually created today: ${todayLeads.length}/${leads.length}`);

      if (todayLeads.length !== leads.length) {
        console.log('❌ FILTERING NOT WORKING! Historical data is being returned.');
      } else {
        console.log('✅ Filtering is working correctly!');
      }
    } else {
      console.log('\n⚠️  No leads returned - either no leads created today or API issue');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
})();
