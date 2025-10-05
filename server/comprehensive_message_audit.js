const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

(async () => {
  console.log('🔍 COMPREHENSIVE MESSAGE AUDIT\n');
  console.log('='.repeat(80));

  // 1. CHECK DATABASE TOTALS
  console.log('\n📊 DATABASE MESSAGE COUNTS:\n');

  const { data: allMessages, count: totalCount } = await supabase
    .from('messages')
    .select('*', { count: 'exact' });

  const emailCount = allMessages.filter(m => m.type === 'email').length;
  const smsCount = allMessages.filter(m => m.type === 'sms').length;

  console.log(`Total messages in database: ${totalCount}`);
  console.log(`  - Email: ${emailCount}`);
  console.log(`  - SMS: ${smsCount}`);

  // 2. CHECK MESSAGES WITH vs WITHOUT LEADS
  console.log('\n📋 MESSAGE-LEAD LINKING:\n');

  const messagesWithLeads = allMessages.filter(m => m.lead_id !== null).length;
  const messagesWithoutLeads = allMessages.filter(m => m.lead_id === null).length;

  console.log(`Messages WITH lead_id: ${messagesWithLeads}`);
  console.log(`Messages WITHOUT lead_id (orphaned): ${messagesWithoutLeads}`);

  if (messagesWithoutLeads > 0) {
    console.log('\n⚠️  ORPHANED MESSAGES (no lead link):');
    const orphaned = allMessages.filter(m => m.lead_id === null).slice(0, 10);
    orphaned.forEach((msg, i) => {
      console.log(`  ${i+1}. Type: ${msg.type}, From: ${msg.sent_by || 'Unknown'}, Date: ${msg.created_at?.substring(0, 16)}`);
      const content = msg.content || msg.sms_body || 'No content';
      console.log(`     Content: ${content.substring(0, 60)}`);
    });
  }

  // 3. CHECK RECENT MESSAGES (Last 7 days)
  console.log('\n📅 RECENT MESSAGES (Last 7 days):\n');

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentMessages = allMessages.filter(m => m.created_at >= sevenDaysAgo);

  console.log(`Total recent messages: ${recentMessages.length}`);
  console.log(`  - Email (recent): ${recentMessages.filter(m => m.type === 'email').length}`);
  console.log(`  - SMS (recent): ${recentMessages.filter(m => m.type === 'sms').length}`);

  // 4. CHECK WHAT MESSAGES-LIST API WOULD RETURN
  console.log('\n🔌 MESSAGES-LIST API SIMULATION (3 days default):\n');

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: apiMessages, error: apiError } = await supabase
    .from('messages')
    .select('id, lead_id, type, content, sms_body, subject, sent_by, sent_by_name, status, read_status, sent_at, created_at')
    .gte('created_at', threeDaysAgo)
    .order('created_at', { ascending: false })
    .limit(100);

  console.log(`API would fetch: ${apiMessages.length} messages`);
  console.log(`  - Email: ${apiMessages.filter(m => m.type === 'email').length}`);
  console.log(`  - SMS: ${apiMessages.filter(m => m.type === 'sms').length}`);

  // Check how many have leads
  const apiWithLeads = apiMessages.filter(m => m.lead_id !== null);
  const apiWithoutLeads = apiMessages.filter(m => m.lead_id === null);

  console.log(`  - With lead_id: ${apiWithLeads.length}`);
  console.log(`  - WITHOUT lead_id (will be filtered out): ${apiWithoutLeads.length} ⚠️`);

  if (apiWithoutLeads.length > 0) {
    console.log('\n⚠️  MESSAGES THAT WILL BE FILTERED OUT (no lead):');
    apiWithoutLeads.slice(0, 10).forEach((msg, i) => {
      console.log(`  ${i+1}. Type: ${msg.type}, From: ${msg.sent_by || 'Unknown'}, Date: ${msg.created_at?.substring(0, 16)}`);
    });
  }

  // 5. CHECK LEADS WITH EMAIL/PHONE
  console.log('\n👥 LEAD CONTACT INFO:\n');

  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, email, phone, status');

  const leadsWithEmail = leads.filter(l => l.email && l.email.trim() !== '').length;
  const leadsWithPhone = leads.filter(l => l.phone && l.phone.trim() !== '').length;
  const leadsWithBoth = leads.filter(l => l.email && l.email.trim() !== '' && l.phone && l.phone.trim() !== '').length;

  console.log(`Total leads: ${leads.length}`);
  console.log(`  - With email: ${leadsWithEmail}`);
  console.log(`  - With phone: ${leadsWithPhone}`);
  console.log(`  - With both: ${leadsWithBoth}`);

  // 6. CHECK FOR MATCHING ISSUES
  console.log('\n🔍 MATCHING ANALYSIS:\n');

  const recentEmails = recentMessages.filter(m => m.type === 'email');
  const recentSms = recentMessages.filter(m => m.type === 'sms');

  console.log('Recent email senders:');
  const emailSenders = [...new Set(recentEmails.map(m => m.sent_by).filter(Boolean))];
  emailSenders.slice(0, 10).forEach(sender => {
    const matchingLead = leads.find(l => l.email && l.email.toLowerCase() === sender.toLowerCase());
    console.log(`  ${sender}: ${matchingLead ? `✅ Lead: ${matchingLead.name}` : '❌ NO MATCHING LEAD'}`);
  });

  console.log('\nRecent SMS senders:');
  const smsSenders = [...new Set(recentSms.map(m => m.sent_by || m.recipient_phone).filter(Boolean))];
  smsSenders.slice(0, 10).forEach(sender => {
    const cleanSender = sender.replace(/[^\d]/g, '');
    const matchingLead = leads.find(l => {
      if (!l.phone) return false;
      const cleanPhone = l.phone.replace(/[^\d]/g, '');
      return cleanPhone.includes(cleanSender) || cleanSender.includes(cleanPhone);
    });
    console.log(`  ${sender}: ${matchingLead ? `✅ Lead: ${matchingLead.name}` : '❌ NO MATCHING LEAD'}`);
  });

  // 7. CHECK EMAIL POLLER STATUS
  console.log('\n📧 EMAIL POLLER CHECK:\n');

  // Check for recent email messages
  const today = new Date().toISOString().split('T')[0];
  const todayEmails = allMessages.filter(m => m.type === 'email' && m.created_at?.startsWith(today));

  console.log(`Emails received today: ${todayEmails.length}`);
  console.log(`Last email received: ${recentEmails[0]?.created_at || 'None'}`);

  // 8. CHECK SMS POLLER STATUS
  console.log('\n📱 SMS POLLER CHECK:\n');

  const todaySms = allMessages.filter(m => m.type === 'sms' && m.created_at?.startsWith(today));

  console.log(`SMS received today: ${todaySms.length}`);
  console.log(`Last SMS received: ${recentSms[0]?.created_at || 'None'}`);

  // 9. CHECK CONTENT FIELDS
  console.log('\n📝 CONTENT FIELD ANALYSIS:\n');

  const emailsWithContent = allMessages.filter(m => m.type === 'email' && m.content).length;
  const emailsWithoutContent = emailCount - emailsWithContent;

  const smsWithBody = allMessages.filter(m => m.type === 'sms' && m.sms_body).length;
  const smsWithoutBody = smsCount - smsWithBody;

  console.log('Email messages:');
  console.log(`  - With content field: ${emailsWithContent}`);
  console.log(`  - WITHOUT content field: ${emailsWithoutContent} ${emailsWithoutContent > 0 ? '⚠️' : ''}`);

  console.log('\nSMS messages:');
  console.log(`  - With sms_body field: ${smsWithBody}`);
  console.log(`  - WITHOUT sms_body field: ${smsWithoutBody} ${smsWithoutBody > 0 ? '⚠️' : ''}`);

  // 10. SUMMARY & ISSUES
  console.log('\n' + '='.repeat(80));
  console.log('📋 SUMMARY OF ISSUES FOUND:\n');

  const issues = [];

  if (messagesWithoutLeads > 0) {
    issues.push(`❌ ${messagesWithoutLeads} messages not linked to leads (will not show in UI)`);
  }

  if (apiWithoutLeads.length > 0) {
    issues.push(`❌ ${apiWithoutLeads.length} recent messages without lead_id (filtered from API)`);
  }

  if (emailsWithoutContent > 0) {
    issues.push(`⚠️  ${emailsWithoutContent} emails missing content field`);
  }

  if (smsWithoutBody > 0) {
    issues.push(`⚠️  ${smsWithoutBody} SMS missing sms_body field`);
  }

  if (todayEmails.length === 0 && todaySms.length === 0) {
    issues.push(`⚠️  No messages received today - pollers may not be working`);
  }

  if (issues.length === 0) {
    console.log('✅ No major issues found!');
  } else {
    issues.forEach((issue, i) => {
      console.log(`${i + 1}. ${issue}`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 RECOMMENDATIONS:\n');

  if (messagesWithoutLeads > 0) {
    console.log('1. Fix lead matching logic - messages need to find their leads');
    console.log('   - Check email address matching (case sensitivity, whitespace)');
    console.log('   - Check phone number matching (formatting differences)');
  }

  if (apiWithoutLeads.length > 0) {
    console.log('2. Recent messages not linking to leads:');
    console.log('   - Verify email poller findLead() function');
    console.log('   - Verify SMS webhook lead matching');
  }

  console.log('\n3. Check frontend time window filter:');
  console.log('   - Default is now 3 days (was 7 days)');
  console.log('   - Older messages won\'t show unless date filter changed');

  process.exit(0);
})();
