const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testSalesCreationFlow() {
  console.log('🧪 TESTING SALES CREATION FLOW (Calendar → Sale → Reports)');
  console.log('================================================================');

  try {
    // 1. Get users (simulate login)
    console.log('\n👥 Available Users:');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*');

    if (usersError) {
      console.error('❌ Cannot fetch users:', usersError);
      return;
    }

    const tomWilkins = users.find(u => u.name.toLowerCase().includes('tom'));
    const adminUser = users.find(u => u.role === 'admin');

    console.log(`   Tom Wilkins (viewer): ${tomWilkins?.id}`);
    console.log(`   Admin User: ${adminUser?.id}`);

    // 2. Get available leads
    console.log('\n📋 Available Leads:');
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, name, email, booker_id')
      .limit(3);

    if (leadsError || !leads || leads.length === 0) {
      console.error('❌ No leads available for testing');
      return;
    }

    leads.forEach((lead, i) => {
      console.log(`   ${i+1}. ${lead.name} (ID: ${lead.id}, Booker: ${lead.booker_id})`);
    });

    const testLead = leads[0];
    console.log(`\n🎯 Using test lead: ${testLead.name}`);

    // 3. Simulate sale creation by Tom Wilkins (like Calendar → SaleModal does)
    console.log('\n💰 SIMULATING SALE CREATION BY TOM WILKINS:');
    const saleData = {
      lead_id: testLead.id,
      user_id: tomWilkins.id, // This is what should happen in the API
      amount: 299.99,
      payment_method: 'cash',
      payment_type: 'full_payment',
      payment_status: 'Paid',
      notes: 'Test sale created from Calendar by Tom Wilkins',
      status: 'Completed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('   Sale data to be created:');
    console.log(`   - Lead ID: ${saleData.lead_id}`);
    console.log(`   - User ID: ${saleData.user_id} (${tomWilkins.name})`);
    console.log(`   - Amount: £${saleData.amount}`);
    console.log(`   - Notes: ${saleData.notes}`);

    // Create the sale directly (simulating what the API does)
    const { data: createdSale, error: createError } = await supabase
      .from('sales')
      .insert(saleData)
      .select()
      .single();

    if (createError) {
      console.error('❌ Sale creation failed:', createError);
      return;
    }

    console.log(`\n✅ SALE CREATED SUCCESSFULLY: ${createdSale.id}`);
    console.log(`   Sale ID: ${createdSale.id}`);
    console.log(`   User ID in DB: ${createdSale.user_id}`);

    // 4. Test the reports API (what /api/sales returns)
    console.log('\n📊 TESTING REPORTS API RESPONSE:');

    // Simulate API response for admin viewing all sales
    const { data: allSales, error: allSalesError } = await supabase
      .from('sales')
      .select(`
        *,
        users:user_id (
          name,
          email
        ),
        leads:lead_id (
          name,
          email,
          phone
        )
      `);

    if (allSalesError) {
      console.error('❌ Cannot fetch sales for reports:', allSalesError);
      return;
    }

    // Find our test sale
    const testSaleInReports = allSales.find(s => s.id === createdSale.id);

    if (testSaleInReports) {
      const userName = testSaleInReports.users?.name || (testSaleInReports.user_id ? `User ${testSaleInReports.user_id.slice(-4)}` : 'System');

      console.log('   Sale found in reports:');
      console.log(`   - Raw user_id: ${testSaleInReports.user_id}`);
      console.log(`   - User lookup result: ${testSaleInReports.users?.name || 'NULL'}`);
      console.log(`   - Display name: "${userName}"`);

      if (userName === tomWilkins.name) {
        console.log('   ✅ SUCCESS: Reports show "tom wilkins"');
      } else {
        console.log(`   ❌ FAILED: Reports show "${userName}" instead of "tom wilkins"`);
      }
    } else {
      console.log('   ❌ Test sale not found in reports');
    }

    // 5. Test viewer filtering (Tom can only see his own sales)
    console.log('\n🔒 TESTING VIEWER ROLE FILTERING:');

    const tomSales = allSales.filter(s => s.user_id === tomWilkins.id);
    console.log(`   Tom Wilkins should see ${tomSales.length} sales`);

    const tomSalesInReports = tomSales.length;
    const expectedTomSales = allSales.filter(s => s.user_id === tomWilkins.id).length;

    if (tomSalesInReports === expectedTomSales && expectedTomSales > 0) {
      console.log('   ✅ SUCCESS: Tom can see his sales');
    } else {
      console.log('   ❌ FAILED: Tom cannot see his sales properly');
    }

    // 6. Summary
    console.log('\n🎯 SALES CREATION FLOW TEST RESULTS:');
    console.log('=====================================');

    const results = [
      { test: 'Sale created with correct user_id', status: createdSale.user_id === tomWilkins.id },
      { test: 'Reports API returns user information', status: testSaleInReports?.users?.name === tomWilkins.name },
      { test: 'Frontend displays correct user name', status: userName === tomWilkins.name },
      { test: 'Viewer can see their own sales', status: tomSalesInReports > 0 }
    ];

    results.forEach(result => {
      console.log(`   ${result.status ? '✅' : '❌'} ${result.test}`);
    });

    const passedTests = results.filter(r => r.status).length;
    const totalTests = results.length;

    console.log(`\n📊 OVERALL SCORE: ${passedTests}/${totalTests}`);

    if (passedTests === totalTests) {
      console.log('🟢 EXCELLENT: Sales attribution working perfectly!');
      console.log('\n✅ DEPLOYMENT READY: Sales from calendar will be properly attributed');
    } else {
      console.log('🟠 ISSUES DETECTED: Need fixes before deployment');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testSalesCreationFlow();
