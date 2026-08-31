const dbManager = require('./database-connection-manager');

async function getTodayBookingsData() {
  try {
    console.log('📊 Fetching today\'s booking data...');
    
    const today = new Date().toISOString().split('T')[0];
    
    // Get all leads with booked_at timestamp today
    const todaysBookings = await dbManager.query('leads', {
      select: 'id, name, status, booked_at, booker_id, booker',
      gte: { booked_at: today + 'T00:00:00' },
      lte: { booked_at: today + 'T23:59:59' }
    });
    
    console.log(`✅ Found ${todaysBookings.length} bookings for today`);
    
    // Group by booker
    const bookerStatsMap = {};
    
    todaysBookings.forEach(lead => {
      const bookerId = lead.booker_id || 'unassigned';
      const bookerName = lead.booker?.name || 'Unassigned';
      
      if (!bookerStatsMap[bookerId]) {
        bookerStatsMap[bookerId] = {
          id: bookerId,
          name: bookerName,
          bookingsToday: 0,
          lastBooking: null,
          bookingDetails: []
        };
      }
      
      bookerStatsMap[bookerId].bookingsToday++;
      
      // Add booking detail
      const bookingTime = new Date(lead.booked_at);
      const timeString = bookingTime.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
      
      bookerStatsMap[bookerId].bookingDetails.push({
        leadName: lead.name,
        bookedAt: lead.booked_at,
        time: timeString
      });
      
      // Track last booking time
      if (!bookerStatsMap[bookerId].lastBooking || lead.booked_at > bookerStatsMap[bookerId].lastBooking) {
        bookerStatsMap[bookerId].lastBooking = lead.booked_at;
      }
    });
    
    // Convert to array and sort by bookings made today
    const bookerStats = Object.values(bookerStatsMap)
      .filter(booker => booker.id !== 'unassigned')
      .sort((a, b) => b.bookingsToday - a.bookingsToday);
    
    console.log('📈 Booker stats generated:');
    bookerStats.forEach(booker => {
      console.log(`👤 ${booker.name}: ${booker.bookingsToday} bookings`);
      booker.bookingDetails.forEach(booking => {
        console.log(`  📅 ${booking.leadName} at ${booking.time}`);
      });
    });
    
    return bookerStats;
    
  } catch (error) {
    console.error('❌ Error fetching booking data:', error.message);
    return [];
  }
}

// Run the function
getTodayBookingsData();
