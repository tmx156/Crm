const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://tnltvfzltdeilanxhlvy.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc');

async function auditDuplicates() {
  console.log('🔍 Auditing duplicate messages...\n');

  // Get all messages
  const { data: allMessages, error } = await supabase
    .from('messages')
    .select('id, type, lead_id, content, sms_body, subject, created_at, sent_by')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching messages:', error);
    return;
  }

  console.log(`📊 Total messages in database: ${allMessages.length}\n`);

  // Group by content and lead to find duplicates
  const contentGroups = new Map();
  const duplicates = [];

  allMessages.forEach(msg => {
    const content = msg.content || msg.sms_body || msg.subject || '';
    const leadId = msg.lead_id;
    const type = msg.type;

    const key = `${leadId}_${type}_${content.substring(0, 100)}`;

    if (!contentGroups.has(key)) {
      contentGroups.set(key, []);
    }
    contentGroups.get(key).push(msg);
  });

  console.log('🔍 Analyzing for duplicates...\n');

  let totalDuplicates = 0;
  let duplicateGroups = 0;

  contentGroups.forEach((messages, key) => {
    if (messages.length > 1) {
      duplicateGroups++;
      totalDuplicates += messages.length - 1; // Don't count the original

      console.log(`📋 DUPLICATE GROUP ${duplicateGroups}:`);
      console.log(`   Key: ${key}`);
      console.log(`   Total messages: ${messages.length}`);
      console.log(`   Duplicates to remove: ${messages.length - 1}`);

      messages.forEach((msg, index) => {
        const isOriginal = index === 0; // Assume first one is original
        console.log(`   ${isOriginal ? '✅ KEEP' : '❌ REMOVE'}: ID ${msg.id} - Created: ${msg.created_at} - Sent by: ${msg.sent_by || 'system'}`);
      });

      // Add to duplicates array (skip the first/original)
      duplicates.push(...messages.slice(1));
      console.log('');
    }
  });

  console.log('📊 SUMMARY:');
  console.log(`   Total duplicate groups: ${duplicateGroups}`);
  console.log(`   Total duplicate messages: ${totalDuplicates}`);
  console.log(`   Messages to keep: ${allMessages.length - totalDuplicates}`);

  if (duplicates.length > 0) {
    console.log('\n🗑️ DUPLICATES TO REMOVE:');
    duplicates.forEach(dup => {
      console.log(`   ID: ${dup.id} - Content: ${(dup.content || dup.sms_body || dup.subject || '').substring(0, 50)}...`);
    });

    console.log('\n🚨 READY TO PURGE DUPLICATES?');
    console.log('Run the purge script to remove these duplicates.');
  } else {
    console.log('\n✅ No duplicates found!');
  }

  // Return the duplicates for the purge script
  return duplicates;
}

auditDuplicates().catch(console.error);
