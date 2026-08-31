const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

async function listRecentImports() {
  try {
    // Get leads created in the last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, name, email, phone, age, postcode, status, created_at')
      .gte('created_at', tenMinutesAgo)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error:', error);
      return;
    }

    console.log('\n📋 RECENTLY IMPORTED LEADS (Last 10 minutes)\n');
    console.log('═'.repeat(70));
    console.log(`Total: ${leads.length} leads\n`);

    leads.forEach((lead, index) => {
      console.log(`${index + 1}. ${lead.name} (Age: ${lead.age || 'N/A'})`);
      console.log(`   Email: ${lead.email}`);
      console.log(`   Phone: ${lead.phone}`);
      console.log(`   Postcode: ${lead.postcode || 'N/A'}`);
      console.log(`   Status: ${lead.status}`);
      console.log(`   Created: ${new Date(lead.created_at).toLocaleString()}`);
      console.log('');
    });

    console.log('═'.repeat(70));
    console.log(`\n✅ Listed ${leads.length} recently imported leads\n`);

  } catch (error) {
    console.error('Error listing leads:', error);
  }
}

listRecentImports();
