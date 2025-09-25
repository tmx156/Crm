const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://tnltvfzltdeilanxhlvy.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc');

async function purgeDuplicates() {
  console.log('🧹 DUPLICATE MESSAGE PURGE AUDIT\n');

  // Get all messages
  const { data: allMessages, error } = await supabase
    .from('messages')
    .select('id, type, lead_id, content, sms_body, subject, created_at, sent_by, status')
    .order('created_at', { ascending: true }); // Oldest first

  if (error) {
    console.error('❌ Error fetching messages:', error);
    return;
  }

  console.log(`📊 Found ${allMessages.length} total messages\n`);

  // Group by content, lead, and type to find duplicates
  const contentGroups = new Map();
  const toDelete = [];

  allMessages.forEach(msg => {
    const content = (msg.content || msg.sms_body || msg.subject || '').trim();
    const leadId = msg.lead_id || 'no_lead';
    const type = msg.type || 'unknown';

    // Create a deduplication key
    const key = `${leadId}_${type}_${content.substring(0, 100)}`;

    if (!contentGroups.has(key)) {
      contentGroups.set(key, []);
    }
    contentGroups.get(key).push(msg);
  });

  console.log('🔍 Analyzing duplicate groups...\n');

  let totalDuplicates = 0;
  let groupsWithDuplicates = 0;

  contentGroups.forEach((messages, key) => {
    if (messages.length > 1) {
      groupsWithDuplicates++;
      const duplicatesInGroup = messages.length - 1; // Keep one original
      totalDuplicates += duplicatesInGroup;

      console.log(`📋 DUPLICATE GROUP ${groupsWithDuplicates}:`);
      console.log(`   Content: "${(messages[0].content || messages[0].sms_body || messages[0].subject || '').substring(0, 80)}..."`);
      console.log(`   Lead ID: ${messages[0].lead_id || 'none'}`);
      console.log(`   Type: ${messages[0].type}`);
      console.log(`   Total messages: ${messages.length}`);
      console.log(`   Will keep: 1 (oldest)`);
      console.log(`   Will delete: ${duplicatesInGroup}`);

      // Keep the first (oldest) message, delete the rest
      const [original, ...duplicates] = messages;

      console.log(`   ✅ KEEPING (original): ID ${original.id} - Created: ${original.created_at}`);

      duplicates.forEach(dup => {
        console.log(`   ❌ TO DELETE (duplicate): ID ${dup.id} - Created: ${dup.created_at}`);
        toDelete.push(dup.id);
      });

      console.log('');
    }
  });

  console.log('📊 PURGE SUMMARY:');
  console.log(`   Groups with duplicates: ${groupsWithDuplicates}`);
  console.log(`   Total messages to delete: ${totalDuplicates}`);
  console.log(`   Messages to keep: ${allMessages.length - totalDuplicates}`);

  if (toDelete.length === 0) {
    console.log('\n✅ No duplicates found - nothing to purge!');
    return;
  }

  console.log('\n🗑️ DUPLICATES TO DELETE:');
  toDelete.forEach(id => console.log(`   ${id}`));

  console.log('\n🚨 ABOUT TO DELETE DUPLICATES!');
  console.log(`This will permanently delete ${totalDuplicates} duplicate messages.`);
  console.log('The original messages will be preserved.');

  // Get user confirmation
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('\n⚠️  Type "YES" to confirm deletion of duplicates: ', async (answer) => {
    rl.close();

    if (answer.toUpperCase() === 'YES') {
      console.log('\n🗑️ PERFORMING ACTUAL DELETION...');

      const { error: deleteError } = await supabase
        .from('messages')
        .delete()
        .in('id', toDelete);

      if (deleteError) {
        console.error('❌ Error deleting duplicates:', deleteError);
      } else {
        console.log(`✅ Successfully deleted ${totalDuplicates} duplicate messages`);
        console.log('🔄 Refresh your Messages page to see the cleaned results.');
        console.log('🔒 Future duplicates should be prevented by the fixed deduplication logic.');
      }
    } else {
      console.log('❌ Deletion cancelled by user.');
    }

    process.exit(0);
  });
}

purgeDuplicates().catch(console.error);
