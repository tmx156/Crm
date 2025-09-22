const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testSalesAttribution() {
  console.log('🔍 SALES ATTRIBUTION AUDIT - DEPLOYMENT CRITICAL');
  console.log('================================================');

  try {
    // 1. Check sales in database
    console.log('\n📊 SALES IN DATABASE:');
    const { data: sales, error: salesError } = await supabase
      .from('sales')
      .select('*')
      .limit(5);

    if (salesError) {
      console.error('❌ Cannot query sales:', salesError);
      return;
    }

    console.log(`Found ${sales.length} sales:`);
    sales.forEach((sale, i) => {
      console.log(`  ${i+1}. ID: ${sale.id.slice(-8)}, user_id: ${sale.user_id || 'NULL'}, amount: £${sale.amount}`);
    });

    // 2. Check users in database
    console.log('\n👥 USERS IN DATABASE:');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, role')
      .limit(5);

    if (usersError) {
      console.error('❌ Cannot query users:', usersError);
      return;
    }

    console.log(`Found ${users.length} users:`);
    users.forEach((user, i) => {
      console.log(`  ${i+1}. ${user.name} (${user.role}): ${user.id.slice(-8)}`);
    });

    // 3. Test the API-style query (what frontend receives)
    console.log('\n🌐 SIMULATING FRONTEND API CALL:');

    // Simulate what the backend API returns for sales list
    if (sales.length > 0) {
      const salesWithDetails = [];

      for (const sale of sales.slice(0, 2)) { // Test first 2 sales
        // Get lead details
        const { data: lead } = await supabase
          .from('leads')
          .select('name, email, phone, status')
          .eq('id', sale.lead_id)
          .single();

        // Get user details
        let userData = null;
        if (sale.user_id) {
          const { data: user } = await supabase
            .from('users')
            .select('name, email')
            .eq('id', sale.user_id)
            .single();
          userData = user;
        }

        // Format like the API does
        const formattedSale = {
          ...sale,
          lead_name: lead?.name || 'Unknown',
          lead_email: lead?.email || '',
          lead_phone: lead?.phone || '',
          lead_status: lead?.status || 'Unknown',
          user_name: userData?.name || (sale.user_id ? `User ${sale.user_id.slice(-4)}` : 'System'),
          user_email: userData?.email || ''
        };

        salesWithDetails.push(formattedSale);

        console.log(`  Sale ${formattedSale.id.slice(-8)}:`);
        console.log(`    user_id: ${formattedSale.user_id}`);
        console.log(`    user_name: "${formattedSale.user_name}"`);
        console.log(`    Frontend will display: "${formattedSale.user_name || (formattedSale.user_id ? `User ${formattedSale.user_id.slice(-4)}` : 'System')}"`);
        console.log('');
      }

      // Check for issues
      const salesWithProperAttribution = salesWithDetails.filter(s => s.user_name && s.user_name !== 'System');
      const salesWithSystemAttribution = salesWithDetails.filter(s => s.user_name === 'System');

      console.log(`✅ Sales with proper attribution: ${salesWithProperAttribution.length}`);
      console.log(`❌ Sales showing "System": ${salesWithSystemAttribution.length}`);

      if (salesWithSystemAttribution.length > 0) {
        console.log('\n🚨 CRITICAL ISSUE: Sales are showing "System" attribution!');
        console.log('   This means user_id is NULL or user lookup failed');

        salesWithSystemAttribution.forEach(sale => {
          console.log(`   - Sale ${sale.id.slice(-8)}: user_id=${sale.user_id}, user_name="${sale.user_name}"`);
        });
      }
    }

    // 4. Check if new sales would work
    console.log('\n🧪 TESTING NEW SALE ATTRIBUTION:');
    if (users.length > 0) {
      const testUser = users.find(u => u.role === 'viewer') || users[0];
      const testUserId = testUser.id;

      console.log(`Using test user: ${testUser.name} (${testUser.role})`);

      // Simulate what happens when this user creates a sale
      const mockSale = {
        id: 'test-sale-id',
        lead_id: 'test-lead-id',
        user_id: testUserId,
        amount: 100,
        created_at: new Date().toISOString()
      };

      // Get user data like the API would
      const { data: userLookup } = await supabase
        .from('users')
        .select('name, email')
        .eq('id', testUserId)
        .single();

      const displayName = userLookup?.name || (mockSale.user_id ? `User ${mockSale.user_id.slice(-4)}` : 'System');

      console.log(`Mock sale attribution: "${displayName}"`);
      console.log(`Expected result: "${testUser.name}"`);

      if (displayName === testUser.name) {
        console.log('✅ New sales would be properly attributed');
      } else {
        console.log('❌ New sales would also show wrong attribution');
      }
    }

  } catch (error) {
    console.error('❌ Audit failed:', error);
  }
}

testSalesAttribution();
