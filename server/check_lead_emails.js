const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('📋 Checking leads with email addresses...\n');

  const { data, error, count } = await supabase
    .from('leads')
    .select('id, name, email, phone, status', { count: 'exact' })
    .not('email', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log('='.repeat(90));
  console.log('Lead Name'.padEnd(30) + ' | ' + 'Email'.padEnd(35) + ' | ' + 'Status');
  console.log('='.repeat(90));

  data.forEach(lead => {
    const name = (lead.name || 'N/A').substring(0, 28).padEnd(30);
    const email = (lead.email || 'N/A').substring(0, 33).padEnd(35);
    const status = lead.status || 'N/A';
    console.log(`${name} | ${email} | ${status}`);
  });

  console.log('='.repeat(90));
  console.log(`\nShowing ${data.length} most recent leads with emails (Total: ${count})`);

  // Get count of leads without emails
  const { count: noEmailCount } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .or('email.is.null,email.eq.');

  console.log(`Leads without emails: ${noEmailCount}`);
})();
