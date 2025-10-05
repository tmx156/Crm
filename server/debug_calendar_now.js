const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

(async () => {
  try {
    console.log('🔍 Checking what I can see in the calendar data RIGHT NOW...');

    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const startDate = today.toISOString().split('T')[0];
    const endDate = nextWeek.toISOString().split('T')[0];

    console.log(`📅 Today: ${today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}`);
    console.log(`📅 Checking date range: ${startDate} to ${endDate}`);

    // Get upcoming bookings in the next 7 days
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, name, date_booked, status')
      .gte('date_booked', startDate)
      .lte('date_booked', endDate)
      .order('date_booked', { ascending: true });

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    console.log(`📊 Total leads found: ${leads?.length || 0}`);

    if (leads && leads.length > 0) {
      // Group by date
      const byDate = {};
      leads.forEach(lead => {
        const date = lead.date_booked.split('T')[0];
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(lead);
      });

      console.log('\n📅 BOOKINGS BY DATE:');
      const dates = Object.keys(byDate).sort();

      dates.forEach(date => {
        const dateObj = new Date(date + 'T00:00:00');
        const dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
        const count = byDate[date].length;
        console.log(`  ${dayName}: ${count} bookings`);
      });

      // Find the next day with bookings (starting from tomorrow)
      let nextDayWithBookings = null;
      let nextDayCount = 0;

      // Find the first future date with bookings
      const sortedFutureDates = dates.filter(date => date > startDate);

      if (sortedFutureDates.length > 0) {
        nextDayWithBookings = sortedFutureDates[0];
        nextDayCount = byDate[nextDayWithBookings].length;
        const dayName = new Date(nextDayWithBookings + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
        console.log(`\n🎯 ANSWER: Next day with bookings is ${dayName}`);
        console.log(`📋 Count: ${nextDayCount} bookings`);

        // Show sample bookings
        console.log(`📋 Sample bookings on ${dayName}:`);
        byDate[nextDayWithBookings].slice(0, 3).forEach((booking, index) => {
          const time = new Date(booking.date_booked).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          console.log(`  ${index + 1}. ${time} - ${booking.name} (${booking.status})`);
        });
      }

      if (!nextDayWithBookings) {
        console.log('\n📭 No upcoming bookings found in next 7 days');
      }

    } else {
      console.log('📭 No bookings found in the next 7 days');
    }
  } catch (err) {
    console.error('❌ Script error:', err.message);
  }
  process.exit(0);
})();