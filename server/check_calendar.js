const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

(async () => {
  try {
    console.log('🔍 Checking lead statuses and upcoming bookings...');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, name, phone, status, date_booked, created_at')
      .gte('date_booked', tomorrow.toISOString().split('T')[0])
      .lte('date_booked', nextWeek.toISOString().split('T')[0])
      .order('date_booked', { ascending: true })
      .limit(20);

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    console.log('📊 Upcoming bookings (next 7 days):');
    console.log('Found', leads?.length || 0, 'bookings');

    if (leads && leads.length > 0) {
      const statusCounts = {};
      const dayGroups = {};

      leads.forEach(lead => {
        const status = lead.status || 'unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;

        const day = lead.date_booked.split('T')[0];
        if (!dayGroups[day]) dayGroups[day] = [];
        dayGroups[day].push(lead);
      });

      console.log('📈 Status breakdown:', statusCounts);
      console.log('📅 Bookings by day:');

      Object.keys(dayGroups).forEach(day => {
        console.log(`   ${day}: ${dayGroups[day].length} bookings`);
        dayGroups[day].slice(0, 3).forEach(lead => {
          console.log(`     - ${lead.name} (${lead.status})`);
        });
      });
    } else {
      console.log('📭 No upcoming bookings found');
    }
  } catch (err) {
    console.error('❌ Script error:', err.message);
  }
  process.exit(0);
})();