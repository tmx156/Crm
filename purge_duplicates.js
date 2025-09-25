// Simple duplicate purge script
console.log('🧹 DUPLICATE MESSAGE PURGE AUDIT\n');

console.log('🔍 IDENTIFIED ROOT CAUSE:');
console.log('When server restarts, in-memory deduplication cache (global.__recentInboundSms) is cleared.');
console.log('BulkSMS poller then re-processes messages that were already stored before restart.');
console.log('Persistent file deduplication should prevent this, but may have issues.\n');

console.log('📋 RECOMMENDED FIX:');
console.log('1. Strengthen persistent deduplication file handling');
console.log('2. Add database-level duplicate prevention with unique constraints');
console.log('3. Improve in-memory cache restoration on server restart\n');

console.log('🗑️ PURGE STRATEGY:');
console.log('- Group messages by: lead_id + type + content');
console.log('- Keep OLDEST message (first created) as original');
console.log('- Delete NEWER duplicates created after server restart');
console.log('- Preserve message history and relationships\n');

console.log('⚠️  IMPORTANT NOTES:');
console.log('- This script currently runs in DRY-RUN mode only');
console.log('- Review the duplicate list carefully before enabling deletion');
console.log('- Backup database before running actual purge');
console.log('- Check that no important unique messages are being deleted\n');

console.log('🚀 NEXT STEPS:');
console.log('1. Run this script to see what duplicates exist');
console.log('2. Review the output carefully');
console.log('3. Uncomment the deletion code if satisfied');
console.log('4. Run again to perform actual purge');
console.log('5. Implement the prevention fixes listed above\n');

console.log('Run the actual audit from server directory with:');
console.log('cd server && node ../server/scripts/purge_duplicates.js');

async function purgeDuplicates() {
  console.log('🧹 Starting duplicate message purge...\n');

  // Get all messages
  const { data: allMessages, error } = await supabase
    .from('messages')
    .select('id, type, lead_id, content, sms_body, subject, created_at, sent_by, status')
    .order('created_at', { ascending: true }); // Oldest first to keep originals

  if (error) {
    console.error('❌ Error fetching messages:', error);
    return;
  }

  console.log(`📊 Found ${allMessages.length} total messages\n`);

  // Group by content, lead, and type to find duplicates
  const contentGroups = new Map();
  const toDelete = [];

  allMessages.forEach(msg => {
    const content = msg.content || msg.sms_body || msg.subject || '';
    const leadId = msg.lead_id || 'no_lead';
    const type = msg.type || 'unknown';

    // Create a deduplication key
    const key = `${leadId}_${type}_${content.substring(0, 100).trim()}`;

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
      console.log(`   Key: ${key}`);
      console.log(`   Total messages: ${messages.length}`);
      console.log(`   Will keep: 1 (oldest)`);
      console.log(`   Will delete: ${duplicatesInGroup}`);

      // Sort by creation date (already sorted ascending)
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

  console.log('\n🗑️ MESSAGES TO DELETE:');
  toDelete.forEach(id => console.log(`   ${id}`));

  // Ask for confirmation before deleting
  console.log('\n🚨 ABOUT TO DELETE DUPLICATES!');
  console.log(`This will permanently delete ${totalDuplicates} duplicate messages.`);
  console.log('The original messages will be preserved.');

  // Uncomment the next lines to actually perform the deletion
  /*
  console.log('\n🗑️ DELETING DUPLICATES...');

  const { error: deleteError } = await supabase
    .from('messages')
    .delete()
    .in('id', toDelete);

  if (deleteError) {
    console.error('❌ Error deleting duplicates:', deleteError);
  } else {
    console.log(`✅ Successfully deleted ${totalDuplicates} duplicate messages`);
  }
  */

  console.log('\n🔒 PURGE SCRIPT IS CURRENTLY IN DRY-RUN MODE');
  console.log('To actually delete duplicates, uncomment the deletion code in the script.');
  console.log('Review the list above carefully before running the actual deletion!');
}

purgeDuplicates().catch(console.error);
