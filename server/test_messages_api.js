const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

(async () => {
  try {
    console.log('🔍 Testing messages API with lead permissions...');

    // First, get the unread messages with their lead details
    const { data: unreadMessages, error: msgError } = await supabase
      .from('messages')
      .select('id, type, content, sms_body, read_status, created_at, lead_id')
      .eq('read_status', false)
      .order('created_at', { ascending: false });

    if (msgError) {
      console.error('❌ Error fetching unread messages:', msgError);
      return;
    }

    console.log(`📊 Found ${unreadMessages?.length || 0} unread messages`);

    if (unreadMessages && unreadMessages.length > 0) {
      // Get the lead IDs from unread messages
      const leadIds = unreadMessages.map(msg => msg.lead_id).filter(id => id);

      console.log('📋 Unread message lead IDs:', leadIds);

      // Get lead details including booker assignments
      const { data: leads, error: leadError } = await supabase
        .from('leads')
        .select('id, name, phone, email, booker_id, status')
        .in('id', leadIds);

      if (leadError) {
        console.error('❌ Error fetching leads:', leadError);
        return;
      }

      console.log('👥 Lead details for unread messages:');
      leads?.forEach(lead => {
        const relatedMsg = unreadMessages.find(msg => msg.lead_id === lead.id);
        console.log(`  • Lead: ${lead.name} (${lead.id.substring(0, 8)}...)`);
        console.log(`    Booker ID: ${lead.booker_id || 'Not assigned'}`);
        console.log(`    Status: ${lead.status}`);
        console.log(`    Message: ${(relatedMsg?.content || relatedMsg?.sms_body || '').substring(0, 60)}...`);
        console.log(`    Created: ${relatedMsg?.created_at}`);
        console.log('');
      });

      // Also check what users exist to understand permissions
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('id, name, role, email')
        .eq('is_active', true);

      if (!userError && users) {
        console.log('👤 Active users in system:');
        users.forEach(user => {
          console.log(`  • ${user.name} (${user.role}) - ${user.id.substring(0, 8)}...`);
        });
      }
    }
  } catch (err) {
    console.error('❌ Script error:', err.message);
  }

  process.exit(0);
})();