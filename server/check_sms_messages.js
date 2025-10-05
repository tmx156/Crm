const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

(async () => {
  console.log('📱 Checking SMS messages...\n');

  const { data, error, count } = await supabase
    .from('messages')
    .select('*', { count: 'exact' })
    .eq('type', 'sms')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.log('❌ Error:', error.message);
    return;
  }

  console.log(`📊 Total SMS messages: ${count}`);
  console.log(`📋 Showing last ${data.length} messages:\n`);

  data.forEach((msg, i) => {
    const date = msg.created_at?.split('T')[0] || 'Unknown';
    const time = msg.created_at?.split('T')[1]?.substring(0, 8) || '';
    const preview = msg.content?.substring(0, 60) || 'No content';
    console.log(`${i+1}. [${date} ${time}] From: ${msg.sent_by || 'Unknown'}`);
    console.log(`   Lead ID: ${msg.lead_id || 'None'}`);
    console.log(`   ${preview}`);
    console.log('');
  });

  // Check if any messages from today
  const today = new Date().toISOString().split('T')[0];
  const todayMessages = data.filter(m => m.created_at?.startsWith(today));
  console.log(`\n📅 Messages from today (${today}): ${todayMessages.length}`);

  process.exit(0);
})();
