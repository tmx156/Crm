const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  console.log('📧 Checking email patterns...\n');

  const { data, error } = await supabase
    .from('messages')
    .select('id, type, email_subject, content, created_at')
    .eq('type', 'email')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log(`Total emails in last batch: ${data.length}\n`);
  console.log('Recent emails received:\n');

  const emailTypes = {
    automated: 0,
    replies: 0,
    marketing: 0,
    other: 0
  };

  data.forEach((msg, i) => {
    const subject = msg.email_subject || 'No subject';
    const date = msg.created_at?.split('T')[0] || 'Unknown';
    const preview = msg.content?.substring(0, 50) || '';

    console.log(`${i+1}. [${date}] ${subject}`);
    console.log(`   Preview: ${preview}...`);
    console.log('');

    // Categorize
    const subjectLower = subject.toLowerCase();
    if (subjectLower.includes('re:') || subjectLower.includes('fwd:')) {
      emailTypes.replies++;
    } else if (subjectLower.includes('confirm') || subjectLower.includes('reminder') || subjectLower.includes('automated')) {
      emailTypes.automated++;
    } else if (subjectLower.includes('newsletter') || subjectLower.includes('update') || subjectLower.includes('offer')) {
      emailTypes.marketing++;
    } else {
      emailTypes.other++;
    }
  });

  console.log('\n📊 Email Type Breakdown:');
  console.log(`   Automated/Confirmations: ${emailTypes.automated}`);
  console.log(`   Replies: ${emailTypes.replies}`);
  console.log(`   Marketing: ${emailTypes.marketing}`);
  console.log(`   Other: ${emailTypes.other}`);

  console.log('\n⚠️  IMPORTANT:');
  console.log('   - Automated emails often have logos/images (50-200KB each)');
  console.log('   - Marketing emails have heavy graphics (200-500KB each)');
  console.log('   - Simple replies may have signature images (20-100KB each)');
  console.log('\n   With source:true, you download ALL of this every time!');

  process.exit(0);
})();
