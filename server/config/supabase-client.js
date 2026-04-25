const { createClient } = require('@supabase/supabase-js');
const config = require('./index');

let supabaseInstance = null;

function getSupabaseClient() {
  if (!supabaseInstance) {
    const key = config.supabase.serviceRoleKey || config.supabase.anonKey;
    supabaseInstance = createClient(config.supabase.url, key);
  }
  return supabaseInstance;
}

module.exports = { getSupabaseClient };
