const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function checkEmailStatus() {
  console.log('🔍 Checking Email Poller Status...\n');

  // Check latest emails
  const { data: emails, error: emailError } = await supabase
    .from('messages')
    .select('id, recipient_email, subject, created_at, content, status, type')
    .eq('type', 'email')
    .order('created_at', { ascending: false })
    .limit(5);

  if (emailError) {
    console.error('❌ Email query error:', emailError);
    return;
  }

  console.log('📧 Latest Emails in Database:');
  console.log('='.repeat(60));
  if (emails && emails.length > 0) {
    emails.forEach((email, i) => {
      console.log(`${i+1}. Subject: "${email.subject}"`);
      console.log(`   From: ${email.recipient_email}`);
      console.log(`   Date: ${new Date(email.created_at).toLocaleString()}`);
      console.log(`   Status: ${email.status}`);
      console.log(`   Content Length: ${email.content ? email.content.length : 0}`);
      console.log('');
    });
  } else {
    console.log('❌ No emails found in database');
  }

  // Check if there are any leads with emails
  const { data: leads, error: leadError } = await supabase
    .from('leads')
    .select('id, name, email')
    .not('email', 'is', null)
    .limit(3);

  if (leadError) {
    console.error('❌ Lead query error:', leadError);
    return;
  }

  console.log('👥 Sample Leads with Emails:');
  console.log('='.repeat(60));
  if (leads && leads.length > 0) {
    leads.forEach(lead => {
      console.log(`${lead.name}: ${lead.email}`);
    });
  } else {
    console.log('❌ No leads with email addresses found');
  }

  console.log('\n✅ Email status check complete!');
}

checkEmailStatus().catch(console.error);
