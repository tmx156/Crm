const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

(async () => {
  try {
    console.log('🔍 Checking for messages in database...');

    const { data: messages, error } = await supabase
      .from('messages')
      .select('id, type, content, sms_body, read_status, created_at, lead_id')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    console.log('📊 Total messages found:', messages?.length || 0);

    const unreadCount = messages?.filter(m => m.read_status !== true).length || 0;
    console.log('📊 Unread messages:', unreadCount);

    if (messages && messages.length > 0) {
      console.log('📨 Recent messages:');
      messages.forEach((msg, i) => {
        console.log(`  ${i + 1}:`, {
          id: msg.id.substring(0, 8) + '...',
          type: msg.type,
          content: (msg.content || msg.sms_body || '').substring(0, 50) + '...',
          read_status: msg.read_status,
          created_at: msg.created_at
        });
      });
    } else {
      console.log('📭 No messages found in database');
    }
  } catch (err) {
    console.error('❌ Script error:', err.message);
  }

  process.exit(0);
})();