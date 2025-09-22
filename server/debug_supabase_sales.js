const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function debugSupabaseSales() {
  console.log('🔍 DEBUGGING SUPABASE SALES QUERIES');
  console.log('=====================================');

  try {
    // Test basic sales query
    console.log('📊 Testing basic sales query...');
    const { data: allSales, error: allSalesError } = await supabase
      .from('sales')
      .select('*')
      .limit(5);

    if (allSalesError) {
      console.error('❌ Error fetching sales:', allSalesError);
      return;
    }

    console.log(`✅ Found ${allSales?.length || 0} sales in database`);

    // Check the specific sale mentioned by the user
    const specificSaleId = 'e44dcdc2-5e53-4dd4-93d8-173d916251c0';
    console.log(`\n🎯 Checking specific sale: ${specificSaleId}`);
    const { data: specificSale, error: specificError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', specificSaleId);

    if (specificError) {
      console.error('❌ Error fetching specific sale:', specificError);
    } else if (!specificSale || specificSale.length === 0) {
      console.log('❌ Specific sale not found in database');
    } else {
      const sale = specificSale[0];
      console.log('✅ Found specific sale:');
      console.log(`   ID: ${sale.id}`);
      console.log(`   User ID: ${sale.user_id || 'NULL (will show as "System")'}`);
      console.log(`   Amount: £${sale.amount}`);
      console.log(`   Created: ${new Date(sale.created_at).toLocaleString()}`);
    }

    // Test sales with user joins
    console.log('\n👤 Testing sales with user joins...');
    const { data: salesWithUsers, error: joinError } = await supabase
      .from('sales')
      .select(`
        *,
        users!inner (
          name,
          email
        )
      `)
      .limit(3);

    if (joinError) {
      console.error('❌ Error with user joins:', joinError);
      // Try without joins
      console.log('🔄 Trying without joins...');
      const { data: simpleSales, error: simpleError } = await supabase
        .from('sales')
        .select('*')
        .limit(3);

      if (simpleError) {
        console.error('❌ Even simple query failed:', simpleError);
        return;
      }

      console.log('✅ Simple sales query works');
      simpleSales?.forEach((sale, i) => {
        console.log(`   Sale ${i+1}: user_id="${sale.user_id}", amount=£${sale.amount}`);
      });
      return;
    }

    console.log('✅ User joins working');
    salesWithUsers?.forEach((sale, i) => {
      console.log(`   Sale ${i+1}: user_name="${sale.users?.name}", user_id="${sale.user_id}"`);
    });

    // Check for sales with null user_id
    console.log('\n⚠️ Checking for sales with null user_id...');
    const { data: nullUserSales, error: nullError } = await supabase
      .from('sales')
      .select('*')
      .is('user_id', null);

    if (nullError) {
      console.error('❌ Error checking null user_id:', nullError);
    } else {
      console.log(`   Found ${nullUserSales?.length || 0} sales with null user_id`);
      if (nullUserSales && nullUserSales.length > 0) {
        nullUserSales.slice(0, 2).forEach((sale, i) => {
          console.log(`     ${i+1}. ID: ${sale.id.slice(-8)}, Amount: £${sale.amount}`);
        });
      }
    }

    // Test role-based filtering (simulate viewer)
    console.log('\n🔒 Testing role-based filtering (viewer simulation)...');
    if (allSales && allSales.length > 0) {
      const testUserId = allSales[0].user_id;
      if (testUserId) {
        const { data: viewerSales, error: viewerError } = await supabase
          .from('sales')
          .select('*')
          .eq('user_id', testUserId);

        if (viewerError) {
          console.error('❌ Error with viewer filtering:', viewerError);
        } else {
          console.log(`✅ Viewer filtering works: ${viewerSales?.length || 0} sales for user ${testUserId}`);
        }
      }
    }

    // Check users table
    console.log('\n👥 Checking users table...');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, email, role')
      .limit(5);

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
    } else {
      console.log(`✅ Found ${users?.length || 0} users`);
      users?.forEach(user => {
        console.log(`   ${user.name} (${user.role}): ${user.id.slice(-8)}`);
      });
    }

  } catch (error) {
    console.error('❌ Script error:', error);
  }
}

debugSupabaseSales();
