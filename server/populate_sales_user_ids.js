const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function populateSalesUserIds() {
  console.log('🔄 POPULATING SALES USER IDs');
  console.log('==============================');

  try {
    // Get all sales with NULL user_id
    const { data: nullUserSales, error: nullSalesError } = await supabase
      .from('sales')
      .select('id, lead_id, amount, created_at')
      .is('user_id', null);

    if (nullSalesError) {
      console.error('❌ Error fetching sales with null user_id:', nullSalesError);
      return;
    }

    console.log(`Found ${nullUserSales?.length || 0} sales with NULL user_id`);

    if (!nullUserSales || nullUserSales.length === 0) {
      console.log('✅ No sales need user_id population');
      return;
    }

    // Get all leads with their booker_id (assigned user)
    const leadIds = nullUserSales.map(sale => sale.lead_id).filter(id => id);
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, booker_id')
      .in('id', leadIds);

    if (leadsError) {
      console.error('❌ Error fetching leads:', leadsError);
      return;
    }

    // Create lead to booker mapping
    const leadBookerMap = {};
    leads?.forEach(lead => {
      leadBookerMap[lead.id] = lead.booker_id;
    });

    console.log('\n📋 Processing sales for user_id assignment:');

    // For each sale with NULL user_id, assign based on lead's booker_id
    let updatedCount = 0;
    for (const sale of nullUserSales) {
      const bookerId = leadBookerMap[sale.lead_id];

      if (bookerId) {
        console.log(`   Sale ${sale.id.slice(-8)}: Assigning to user ${bookerId.slice(-8)} (from lead assignment)`);

        const { error: updateError } = await supabase
          .from('sales')
          .update({ user_id: bookerId })
          .eq('id', sale.id);

        if (updateError) {
          console.error(`❌ Failed to update sale ${sale.id}:`, updateError);
        } else {
          updatedCount++;
        }
      } else {
        console.log(`   Sale ${sale.id.slice(-8)}: No booker assigned to lead - leaving as NULL`);
      }
    }

    console.log(`\n✅ Updated ${updatedCount} out of ${nullUserSales.length} sales with user_id`);

    // Verify the updates
    console.log('\n🔍 Verification - checking updated sales:');
    const { data: updatedSales, error: verifyError } = await supabase
      .from('sales')
      .select(`
        id,
        user_id,
        amount,
        users:user_id (
          name
        )
      `)
      .in('id', nullUserSales.map(s => s.id))
      .limit(5);

    if (!verifyError && updatedSales) {
      updatedSales.forEach((sale, i) => {
        const userName = sale.users?.name || (sale.user_id ? `User ${sale.user_id.slice(-4)}` : 'System');
        console.log(`   Sale ${sale.id.slice(-8)}: user_id=${sale.user_id ? sale.user_id.slice(-8) : 'NULL'}, display="${userName}"`);
      });
    }

  } catch (error) {
    console.error('❌ Population error:', error);
  }
}

populateSalesUserIds();
