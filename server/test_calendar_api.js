const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

(async () => {
  try {
    console.log('🔍 Testing calendar API data structure...');

    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const startDate = today.toISOString().split('T')[0];
    const endDate = nextWeek.toISOString().split('T')[0];

    console.log(`📅 Date range: ${startDate} to ${endDate}`);

    // Test the same query that the calendar API uses
    const { data: leads, error } = await supabase
      .from('leads')
      .select(`
        id, name, phone, email, status, date_booked, booker_id,
        is_confirmed, booking_status, booking_history, has_sale,
        created_at, updated_at, postcode, notes, image_url
      `)
      .or('date_booked.not.is.null,status.eq.Booked')
      .is('deleted_at', null)
      .gte('date_booked', startDate)
      .lte('date_booked', endDate)
      .order('date_booked', { ascending: true })
      .limit(50);

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    console.log(`📊 Calendar API returned: ${leads?.length || 0} leads`);

    if (leads && leads.length > 0) {
      console.log('📅 Sample leads:');
      leads.slice(0, 5).forEach((lead, index) => {
        console.log(`  ${index + 1}. ${lead.name} - ${lead.date_booked} (${lead.status})`);
      });

      // Convert to events format like the API does
      const events = leads.map(lead => {
        const date = new Date(lead.date_booked);
        return {
          id: lead.id,
          title: lead.name,
          start: lead.date_booked,
          extendedProps: {
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            status: lead.status,
            date_booked: lead.date_booked,
            booker_id: lead.booker_id,
            time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
          }
        };
      });

      console.log('📅 Events format (first 3):');
      events.slice(0, 3).forEach((event, index) => {
        console.log(`  ${index + 1}. ${event.title} - ${event.start} - ${event.extendedProps.time}`);
      });

      // Group by date like our dashboard code does
      const eventsByDate = {};
      events.forEach(event => {
        const date = event.start?.split('T')[0];
        if (date) {
          if (!eventsByDate[date]) eventsByDate[date] = [];
          eventsByDate[date].push(event);
        }
      });

      console.log('📅 Events grouped by date:');
      Object.keys(eventsByDate).forEach(date => {
        console.log(`  ${date}: ${eventsByDate[date].length} events`);
      });
    } else {
      console.log('📭 No leads found in date range');
    }
  } catch (err) {
    console.error('❌ Script error:', err.message);
  }
  process.exit(0);
})();