const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  console.log('🧪 Testing Supabase connection...');

  try {
    // Test basic connection
    const { data, error } = await supabase.from('users').select('count').limit(1);

    if (error) {
      console.error('❌ Connection failed:', error);
      return;
    }

    console.log('✅ Supabase connection successful');

    // Check specific sale
    const saleId = 'e44dcdc2-5e53-4dd4-93d8-173d916251c0';
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', saleId);

    if (saleError) {
      console.error('❌ Error fetching sale:', saleError);
      return;
    }

    if (!sale || sale.length === 0) {
      console.log('❌ Sale not found!');
      return;
    }

    console.log('✅ Sale found:', sale[0]);

  } catch (error) {
    console.error('❌ Script error:', error);
  }
}

testConnection();
