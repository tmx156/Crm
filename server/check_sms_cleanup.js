require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkAndCleanMessages() {
  console.log('=== Checking Messages Table ===');
  const { data: messages, error } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log(`Total recent messages: ${messages.length}`);
  
  console.log('\n=== Recent Messages ===');
  messages.slice(0, 10).forEach(msg => {
    console.log(`ID: ${msg.id}`);
    console.log(`Lead: ${msg.lead_id}`);
    console.log(`Type: ${msg.type}`);
    console.log(`Content: ${msg.content ? msg.content.substring(0, 100) : 'null'}...`);
    console.log(`Created: ${msg.created_at}`);
    console.log('---');
  });
  
  console.log('\n=== Checking for Test Messages ===');
  const testMessages = messages.filter(msg => 
    msg.content && (
      msg.content.toLowerCase().includes('test sms') ||
      msg.content.toLowerCase().includes('test message') ||
      msg.content.toLowerCase().includes('debugging') ||
      msg.content.toLowerCase().includes('migration test') ||
      msg.content.toLowerCase().includes('hello from calendar') ||
      msg.content.toLowerCase().includes('this is a test') ||
      msg.content.toLowerCase().includes('sample message')
    )
  );
  
  if (testMessages.length > 0) {
    console.log(`Found ${testMessages.length} test messages:`);
    testMessages.forEach(msg => {
      console.log(`- ID: ${msg.id}, Content: "${msg.content}"`);
    });
    
    console.log('\n=== Removing Test Messages ===');
    const testIds = testMessages.map(msg => msg.id);
    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .in('id', testIds);
    
    if (deleteError) {
      console.error('Error deleting test messages:', deleteError);
    } else {
      console.log(`Successfully deleted ${testIds.length} test messages`);
    }
  } else {
    console.log('No obvious test messages found');
  }
  
  console.log('\n=== Checking Leads with Booking History ===');
  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('id, first_name, last_name, phone, booking_history')
    .not('booking_history', 'is', null)
    .limit(10);
    
  if (leadsError) {
    console.error('Error fetching leads:', leadsError);
    return;
  }
  
  leads.forEach(lead => {
    console.log(`\nLead: ${lead.first_name} ${lead.last_name} (${lead.phone})`);
    if (lead.booking_history) {
      try {
        const history = JSON.parse(lead.booking_history);
        const smsHistory = history.filter(h => 
          h.action && (h.action.includes('SMS_') || h.action === 'message_sent' || h.action === 'message_received')
        );
        console.log(`  SMS entries in booking_history: ${smsHistory.length}`);
        smsHistory.slice(0, 3).forEach(sms => {
          console.log(`    - ${sms.action}: ${sms.details ? sms.details.substring(0, 50) : 'no details'}...`);
        });
      } catch (e) {
        console.log(`  Error parsing booking_history: ${e.message}`);
      }
    }
  });
}

checkAndCleanMessages().catch(console.error);
