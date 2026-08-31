const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  var { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true });
  if (error) { console.log('Error:', JSON.stringify(error)); return; }
  console.log('Total users in database:', data.length);
  console.log('');
  data.forEach(function(u, i) {
    console.log((i+1) + '. ' + u.name);
    console.log('   Email: ' + u.email);
    console.log('   Role: ' + u.role);
    console.log('   ID: ' + u.id);
    console.log('   Created: ' + u.created_at);
    console.log('   Password hash: ' + (u.password ? u.password.substring(0, 15) + '...' : 'NONE'));
    console.log('');
  });
}
run();
