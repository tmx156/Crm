const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

async function checkMessages() {
  console.log('🔍 DETAILED MESSAGES TABLE ANALYSIS\n');
  console.log('='.repeat(60));

  // Get total size estimation
  const { data: allMessages, error } = await supabase
    .from('messages')
    .select('*');
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`\n📊 Total Messages: ${allMessages.length}`);
  
  // Calculate total data size
  let totalSize = 0;
  const sizes = {
    content: 0,
    email_body: 0,
    sms_body: 0,
    attachment_url: 0,
    recipient_email: 0,
    recipient_phone: 0,
    other: 0
  };

  allMessages.forEach(msg => {
    const msgStr = JSON.stringify(msg);
    totalSize += msgStr.length;
    
    sizes.content += (msg.content || '').length;
    sizes.email_body += (msg.email_body || '').length;
    sizes.sms_body += (msg.sms_body || '').length;
    sizes.attachment_url += (msg.attachment_url || '').length;
    sizes.recipient_email += (msg.recipient_email || '').length;
    sizes.recipient_phone += (msg.recipient_phone || '').length;
  });

  const totalMB = (totalSize / 1024 / 1024).toFixed(2);
  console.log(`💾 Estimated Total Size: ${totalMB} MB`);
  console.log(`📏 Average message size: ${(totalSize / allMessages.length).toFixed(0)} bytes`);

  console.log('\n📋 Size breakdown by field:');
  Object.entries(sizes).forEach(([field, size]) => {
    const mb = (size / 1024 / 1024).toFixed(2);
    const pct = ((size / totalSize) * 100).toFixed(1);
    console.log(`   ${field.padEnd(20)}: ${mb.padStart(8)} MB (${pct}%)`);
  });

  // Check message types
  console.log('\n📨 Messages by type:');
  const byType = {};
  allMessages.forEach(msg => {
    byType[msg.type] = (byType[msg.type] || 0) + 1;
  });
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`);
  });

  // Check message status
  console.log('\n📮 Messages by status:');
  const byStatus = {};
  allMessages.forEach(msg => {
    byStatus[msg.status] = (byStatus[msg.status] || 0) + 1;
  });
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`   ${status}: ${count}`);
  });

  // Check date distribution
  console.log('\n📅 Messages by date:');
  const byDate = {};
  allMessages.forEach(msg => {
    const date = new Date(msg.created_at).toISOString().split('T')[0];
    byDate[date] = (byDate[date] || 0) + 1;
  });
  const sortedDates = Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10);
  sortedDates.forEach(([date, count]) => {
    console.log(`   ${date}: ${count} messages`);
  });

  // Find largest messages
  console.log('\n📏 Top 10 Largest Messages:');
  const withSizes = allMessages.map(msg => ({
    ...msg,
    size: JSON.stringify(msg).length
  })).sort((a, b) => b.size - a.size).slice(0, 10);

  withSizes.forEach((msg, i) => {
    const kb = (msg.size / 1024).toFixed(2);
    console.log(`   ${i + 1}. ${msg.type} to ${msg.recipient_email || msg.recipient_phone} - ${kb} KB`);
    console.log(`      Status: ${msg.status}, Date: ${new Date(msg.created_at).toLocaleDateString()}`);
    if (msg.content) console.log(`      Content preview: ${msg.content.substring(0, 80)}...`);
  });

  // Check for potential duplicates
  console.log('\n🔍 Checking for potential duplicates:');
  const contentHashes = {};
  allMessages.forEach(msg => {
    const hash = `${msg.lead_id}-${msg.type}-${(msg.content || '').substring(0, 50)}`;
    contentHashes[hash] = (contentHashes[hash] || 0) + 1;
  });
  const duplicates = Object.entries(contentHashes).filter(([_, count]) => count > 1).slice(0, 10);
  if (duplicates.length > 0) {
    console.log(`   Found ${duplicates.length} potential duplicate patterns:`);
    duplicates.forEach(([hash, count]) => {
      console.log(`      ${count} similar messages`);
    });
  } else {
    console.log('   ✅ No obvious duplicates found');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Messages analysis complete!');
}

checkMessages().catch(console.error);


