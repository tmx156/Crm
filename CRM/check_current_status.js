const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://tnltvfzltdeilanxhlvy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc'
);

async function checkCurrentStatus() {
  console.log('🔍 Checking Current Email/SMS Status...\n');

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  console.log(`📊 Checking messages from ${oneHourAgo.toISOString()} to now...\n`);

  // Check recent email messages (last hour)
  const { data: emails, error: emailError } = await supabase
    .from('messages')
    .select('id, recipient_email, subject, created_at, type')
    .eq('type', 'email')
    .gte('created_at', oneHourAgo.toISOString())
    .order('created_at', { ascending: false });

  if (emailError) {
    console.error('❌ Email query error:', emailError);
  } else {
    console.log('📧 Recent Email Messages (last hour):');
    console.log('='.repeat(50));
    if (emails && emails.length > 0) {
      emails.forEach((msg, i) => {
        console.log(`${i+1}. ${new Date(msg.created_at).toLocaleString()} - ${msg.subject || 'No subject'}`);
        console.log(`   From: ${msg.recipient_email}`);
      });
    } else {
      console.log('❌ No new emails in the last hour');
    }
    console.log('');
  }

  // Check recent SMS messages (last hour)
  const { data: sms, error: smsError } = await supabase
    .from('messages')
    .select('id, recipient_phone, sms_body, created_at, type')
    .eq('type', 'sms')
    .gte('created_at', oneHourAgo.toISOString())
    .order('created_at', { ascending: false });

  if (smsError) {
    console.error('❌ SMS query error:', smsError);
  } else {
    console.log('📱 Recent SMS Messages (last hour):');
    console.log('='.repeat(50));
    if (sms && sms.length > 0) {
      sms.forEach((msg, i) => {
        console.log(`${i+1}. ${new Date(msg.created_at).toLocaleString()}`);
        console.log(`   Phone: ${msg.recipient_phone}`);
        console.log(`   Content: ${msg.sms_body || 'No content'}`);
      });
    } else {
      console.log('❌ No new SMS in the last hour');
    }
    console.log('');
  }

  // Check total counts
  const { count: emailCount, error: emailCountError } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'email');

  const { count: smsCount, error: smsCountError } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'sms');

  console.log('📈 Total Message Counts:');
  console.log('='.repeat(50));
  console.log(`📧 Total Emails: ${emailCount || 0}`);
  console.log(`📱 Total SMS: ${smsCount || 0}`);
  console.log('');

  console.log('✅ Status check complete!');
}

checkCurrentStatus().catch(console.error);
