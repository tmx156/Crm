const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://yqpcxvtzdwmfllqjkzyi.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxcGN4dnR6ZHdtZmxscWprenlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5NzUwMjgsImV4cCI6MjA1NTU1MTAyOH0.fkkWUE9fIz7AaqKnpBqUYu-RpIoF6IpEgWElYTXX3Q4'
);

(async () => {
  try {
    console.log('🧹 Clearing booking_history for October 26th\n');

    // Get Oct 26 leads
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, name, date_booked, booking_history')
      .gte('date_booked', '2025-10-26T00:00:00.000Z')
      .lte('date_booked', '2025-10-26T23:59:59.999Z');

    if (error) {
      console.error('Error fetching leads:', error);
      process.exit(1);
    }

    console.log(`Found ${leads.length} leads on Oct 26\n`);

    let cleared = 0;
    for (const lead of leads) {
      const historySize = lead.booking_history ? JSON.stringify(lead.booking_history).length : 0;
      const time = new Date(lead.date_booked).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit'
      });

      const { error: updateError } = await supabase
        .from('leads')
        .update({ booking_history: [] })
        .eq('id', lead.id);

      if (updateError) {
        console.log(`  ❌ ${time} ${lead.name}: Failed`);
      } else {
        console.log(`  ✅ ${time} ${lead.name}: Cleared ${(historySize / 1024).toFixed(2)} KB`);
        cleared++;
      }
    }

    console.log(`\n✅ Cleared ${cleared}/${leads.length} leads`);
    console.log('October 26th should now load instantly!\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
