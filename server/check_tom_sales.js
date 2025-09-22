const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 SALES CREATED BY TRACKING AUDIT');
console.log('====================================');

async function checkTomWilkinsSales() {
  try {

    // Find the user
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, name, email, role')
      .ilike('name', '%Tom%')
      .limit(1);

    if (userError) {
      console.error('❌ Error querying users:', userError);
      return;
    }

    if (!users || users.length === 0) {
      console.log('❌ No user found with name containing "Tom"');
      return;
    }

    const user = users[0];
    console.log('👤 Tom Wilkins Profile:');
    console.log('   ID:', user.id);
    console.log('   Name:', user.name);
    console.log('   Email:', user.email);
    console.log('   Role:', user.role);
    console.log('');

    // Check the specific sale created by Tom Wilkins from the log
    const recentSaleId = 'e44dcdc2-5e53-4dd4-93d8-173d916251c0';
    console.log('🎯 Checking recent sale by Tom Wilkins:');
    console.log('   Sale ID:', recentSaleId);

    const { data: specificSale, error: specificError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', recentSaleId);

    if (specificError) {
      console.error('❌ Error fetching specific sale:', specificError);
      return;
    }

    if (!specificSale || specificSale.length === 0) {
      console.log('❌ Sale not found in database!');
      return;
    }

    const sale = specificSale[0];
    console.log('✅ Sale found in database:');
    console.log('   Sale ID:', sale.id);
    console.log('   Lead ID:', sale.lead_id);
    console.log('   User ID:', sale.user_id || 'NULL (not set!)');
    console.log('   Amount:', sale.amount);
    console.log('   Created At:', sale.created_at);
    console.log('   All columns:', Object.keys(sale));

    // Check if user_id matches Tom Wilkins
    const userIdMatches = sale.user_id === user.id;
    console.log('🔍 User ID matches Tom Wilkins:', userIdMatches);

    if (!userIdMatches) {
      console.log('❌ CRITICAL ISSUE: Sale user_id does not match Tom Wilkins!');
      console.log('   Expected user_id:', user.id);
      console.log('   Actual user_id:', sale.user_id);
    } else {
      console.log('✅ Sale correctly attributed to Tom Wilkins');
    }
    console.log('');

    if (!hasUserId) {
      console.log('⚠️ Sales table does not have user_id column. Checking if Tom Wilkins is associated with any sales through leads...');

      // Try to find sales through leads that Tom Wilkins is associated with
      const { data: userLeads, error: leadsError } = await supabase
        .from('leads')
        .select('id, name')
        .eq('booker_id', user.id);

      if (leadsError) {
        console.error('❌ Error querying leads:', leadsError);
        return;
      }

      console.log(`📋 Tom Wilkins is assigned to ${userLeads?.length || 0} leads`);

      if (userLeads && userLeads.length > 0) {
        const leadIds = userLeads.map(lead => lead.id);
        const { data: sales, error: salesError } = await supabase
          .from('sales')
          .select('*')
          .in('lead_id', leadIds);

        if (salesError) {
          console.error('❌ Error querying sales by leads:', salesError);
          return;
        }

        const totalSales = sales?.length || 0;
        const totalRevenue = sales?.reduce((sum, sale) => sum + (sale.amount || 0), 0) || 0;

        console.log('📊 Sales statistics for leads assigned to', user.name + ':');
        console.log('   Total Sales:', totalSales);
        console.log('   Total Revenue: £' + totalRevenue.toFixed(2));

        // Get recent sales (last 5)
        const recentSales = sales?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5) || [];

        console.log('📋 Recent sales:');
        recentSales.forEach((sale, i) => {
          console.log('   ' + (i+1) + '.', sale.id.slice(-8), '- £' + (sale.amount || 0).toFixed(2), '(' + (sale.payment_type || 'Unknown') + ')', new Date(sale.created_at).toLocaleDateString());
        });

        return;
      } else {
        console.log('❌ Tom Wilkins has no leads assigned to him, so no sales data available');
        return;
      }
    }

    // Count sales for this user (if user_id column exists)
    const { data: sales, error: salesError } = await supabase
      .from('sales')
      .select('id, amount, payment_type, created_at')
      .eq('user_id', user.id);

    if (salesError) {
      console.error('❌ Error querying sales:', salesError);
      return;
    }

    const totalSales = sales?.length || 0;
    const totalRevenue = sales?.reduce((sum, sale) => sum + (sale.amount || 0), 0) || 0;

    console.log('📊 Sales statistics for', user.name + ':');
    console.log('   Total Sales:', totalSales);
    console.log('   Total Revenue: £' + totalRevenue.toFixed(2));

    // Get recent sales (last 5)
    const recentSales = sales?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5) || [];

    console.log('📋 Recent sales:');
    recentSales.forEach((sale, i) => {
      console.log('   ' + (i+1) + '.', sale.id.slice(-8), '- £' + sale.amount.toFixed(2), '(' + (sale.payment_type || 'Unknown') + ')', new Date(sale.created_at).toLocaleDateString());
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

checkTomWilkinsSales();
