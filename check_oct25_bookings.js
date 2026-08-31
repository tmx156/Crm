const axios = require('axios');

async function checkOct25Bookings() {
  try {
    const response = await axios.get('http://localhost:3001/api/leads/public?limit=1000');
    const leads = response.data?.leads || [];

    // Filter for bookings on October 25th, 2025
    const oct25Bookings = leads.filter(lead => {
      if (!lead.booked_at) return false;
      const bookedDate = new Date(lead.booked_at);
      const dateStr = bookedDate.toISOString().split('T')[0];
      return dateStr === '2025-10-25';
    });

    // Count by current status
    const statusCount = {};
    oct25Bookings.forEach(lead => {
      const status = lead.status || 'Unknown';
      statusCount[status] = (statusCount[status] || 0) + 1;
    });

    console.log('\n=== BOOKINGS MADE ON OCTOBER 25TH, 2025 ===');
    console.log('Total bookings made that day:', oct25Bookings.length);
    console.log('\nBreakdown by current status:');
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    if (oct25Bookings.length > 0) {
      console.log('\nSample bookings:');
      oct25Bookings.slice(0, 10).forEach(lead => {
        const bookedTime = new Date(lead.booked_at).toLocaleString('en-GB');
        console.log(`  - ${lead.name} (Status: ${lead.status}) - Booked at: ${bookedTime}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkOct25Bookings();
