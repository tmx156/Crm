const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testSalesCreation() {
  console.log('🧪 TESTING SALES CREATION DIRECTLY IN SUPABASE');
  console.log('================================================');

  try {
    // First, let's see what users we have
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, name, email, role');

    if (userError) {
      console.error('❌ Error fetching users:', userError);
      return;
    }

    console.log('👥 Available users:');
    users?.forEach(user => {
      console.log(`   ${user.name} (${user.role}): ${user.id}`);
    });

    // Find Tom Wilkins
    const tomWilkins = users?.find(u => u.name.toLowerCase().includes('tom'));
    if (!tomWilkins) {
      console.error('❌ Tom Wilkins not found');
      return;
    }

    console.log(`\n👤 Using Tom Wilkins: ${tomWilkins.id}`);

    // Check for existing leads
    const { data: leads, error: leadError } = await supabase
      .from('leads')
      .select('id, name')
      .limit(3);

    if (leadError || !leads || leads.length === 0) {
      console.error('❌ No leads found:', leadError);
      return;
    }

    const testLead = leads[0];
    console.log(`📋 Using test lead: ${testLead.name} (${testLead.id})`);

    // Create a test sale directly in Supabase
    const testSaleId = `test-${Date.now()}`;
    const testSale = {
      id: testSaleId,
      lead_id: testLead.id,
      user_id: tomWilkins.id, // This should be Tom Wilkins' ID
      amount: 999.99,
      payment_method: 'cash',
      payment_type: 'full_payment',
      payment_status: 'Pending',
      notes: 'Test sale created directly in Supabase',
      status: 'Pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('\n💰 Creating test sale with data:');
    console.log(`   ID: ${testSale.id}`);
    console.log(`   User ID: ${testSale.user_id} (${tomWilkins.name})`);
    console.log(`   Lead ID: ${testSale.lead_id}`);
    console.log(`   Amount: £${testSale.amount}`);

    const { data: createdSale, error: createError } = await supabase
      .from('sales')
      .insert(testSale)
      .select()
      .single();

    if (createError) {
      console.error('❌ Failed to create test sale:', createError);
      return;
    }

    console.log('✅ Test sale created successfully!');
    console.log(`   Sale ID: ${createdSale.id}`);
    console.log(`   User ID in DB: ${createdSale.user_id}`);

    // Verify the sale was created correctly
    const { data: verifySale, error: verifyError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', testSaleId);

    if (verifyError) {
      console.error('❌ Failed to verify sale:', verifyError);
    } else {
      const sale = verifySale[0];
      console.log('\n🔍 Verification - Sale in database:');
      console.log(`   ID: ${sale.id}`);
      console.log(`   User ID: ${sale.user_id || 'NULL!!!'}`);
      console.log(`   Amount: £${sale.amount}`);

      if (sale.user_id === tomWilkins.id) {
        console.log('✅ User ID correctly set to Tom Wilkins!');
      } else {
        console.log('❌ User ID NOT set correctly!');
      }
    }

    // Test the API-style query that would be used by the frontend
    console.log('\n🌐 Testing API-style query (what frontend sees):');
    const { data: apiSale, error: apiError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', testSaleId);

    if (apiError) {
      console.error('❌ API query failed:', apiError);
    } else {
      const sale = apiSale[0];

      // Get user data separately (like our API does)
      const { data: userData } = sale.user_id ? await supabase
        .from('users')
        .select('name, email')
        .eq('id', sale.user_id)
        .single() : { data: null };

      const displayName = userData?.name || (sale.user_id ? `User ${sale.user_id.slice(-4)}` : 'System');

      console.log(`   Raw user_id: ${sale.user_id}`);
      console.log(`   User data found: ${userData ? 'YES' : 'NO'}`);
      console.log(`   Display name: "${displayName}"`);

      if (displayName === tomWilkins.name) {
        console.log('✅ Frontend will correctly show Tom Wilkins!');
      } else {
        console.log('❌ Frontend will show wrong name!');
      }
    }

  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

testSalesCreation();
