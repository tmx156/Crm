const { createClient } = require('@supabase/supabase-js');
const config = require('./server/config');
const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.serverKey);
(async () => {
  const { data, error } = await supabase.from('users').select('id,name,role').eq('role', 'admin').limit(3);
  if (error) { console.error(error); process.exit(1); }
  console.log(JSON.stringify(data, null, 2));
})();
