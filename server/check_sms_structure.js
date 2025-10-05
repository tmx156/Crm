const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

(async () => {
  console.log('📱 Checking SMS message structure...\n');

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('type', 'sms')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.log('❌ Error:', error.message);
    return;
  }

  console.log('📋 Sample SMS message structure:\n');
  data.forEach((msg, i) => {
    console.log(`\n=== Message ${i+1} ===`);
    console.log('Fields present:');
    Object.keys(msg).forEach(key => {
      const value = msg[key];
      if (value !== null && value !== undefined) {
        const preview = typeof value === 'string' && value.length > 50
          ? value.substring(0, 50) + '...'
          : value;
        console.log(`  ${key}: ${preview}`);
      }
    });
  });

  // Check for content in different fields
  console.log('\n\n📊 Content field analysis:');
  const contentCheck = data.map(m => ({
    id: m.id,
    content: m.content || null,
    sms_body: m.sms_body || null,
    message: m.message || null,
    body: m.body || null,
    text: m.text || null
  }));
  console.table(contentCheck);

  process.exit(0);
})();
