const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDatabase() {
  console.log('🔍 SIMPLE DATABASE CHECK');
  console.log('========================');

  try {
    // Check sales
    console.log('📊 Sales in database:');
    const { data: sales, error: salesError } = await supabase
      .from('sales')
      .select('*')
      .limit(5);

    if (salesError) {
      console.error('❌ Sales error:', salesError);
      return;
    }

    console.log(`Found ${sales?.length || 0} sales`);
    sales?.forEach((sale, i) => {
      console.log(`${i+1}. ID: ${sale.id.slice(-8)}, user_id: ${sale.user_id || 'NULL'}, amount: £${sale.amount}`);
    });

    // Check users
    console.log('\n👥 Users in database:');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, role')
      .limit(5);

    if (usersError) {
      console.error('❌ Users error:', usersError);
      return;
    }

    console.log(`Found ${users?.length || 0} users`);
    users?.forEach((user, i) => {
      console.log(`${i+1}. ${user.name} (${user.role}): ${user.id.slice(-8)}`);
    });

    // Test user lookup for sales
    console.log('\n🔗 Testing user lookup for sales:');
    if (sales && sales.length > 0 && users && users.length > 0) {
      const testSale = sales[0];
      const matchingUser = users.find(u => u.id === testSale.user_id);

      console.log(`Sale user_id: ${testSale.user_id}`);
      console.log(`Matching user: ${matchingUser ? matchingUser.name : 'NONE'}`);

      if (testSale.user_id && matchingUser) {
        console.log('✅ User attribution should work');
      } else if (testSale.user_id && !matchingUser) {
        console.log('❌ User ID exists but no matching user in database');
      } else {
        console.log('❌ No user_id in sale - will show "System"');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkDatabase();
