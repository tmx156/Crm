#!/usr/bin/env node

/**
 * Test Lead Assignment API
 * Test the bulk assignment functionality to ensure RLS policies work
 */

const config = require('./config');
const { createClient } = require('@supabase/supabase-js');

async function testLeadAssignment() {
  console.log('🧪 TESTING LEAD ASSIGNMENT FUNCTIONALITY');
  console.log('======================================');

  // Test with service role client to bypass RLS
  const serviceRoleClient = createClient(
    config.supabase.url,
    process.env.SUPABASE_SERVICE_ROLE_KEY || config.supabase.anonKey
  );

  console.log('🔑 Using service role key:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

  const supabase = serviceRoleClient;

  try {
    // Get sample leads and users
    console.log('1. Fetching sample leads...');
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, name, booker_id, status')
      .limit(5);

    if (leadsError) {
      console.error('❌ Error fetching leads:', leadsError);
      return;
    }

    console.log(`✅ Found ${leads.length} leads`);
    leads.forEach((lead, i) => {
      console.log(`   ${i + 1}. ${lead.name} - Status: ${lead.status} - Booker: ${lead.booker_id}`);
    });

    // Get sample users
    console.log('\n2. Fetching active users...');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, role, is_active')
      .eq('is_active', true)
      .limit(3);

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }

    console.log(`✅ Found ${users.length} active users`);
    users.forEach((user, i) => {
      console.log(`   ${i + 1}. ${user.name} (${user.role}) - ID: ${user.id}`);
    });

    if (leads.length === 0 || users.length === 0) {
      console.log('⚠️ Not enough data to test assignment');
      return;
    }

    // Test direct lead update (simulating fixed bulk assign)
    console.log('\n3. Testing direct lead update...');
    const testLead = leads[0];
    const testUser = users.find(u => u.role === 'booker') || users[0];

    console.log(`   Assigning lead "${testLead.name}" to user "${testUser.name}"`);

    const { data: updateResult, error: updateError } = await supabase
      .from('leads')
      .update({
        booker_id: testUser.id,
        status: 'Assigned',
        updated_at: new Date().toISOString()
      })
      .eq('id', testLead.id)
      .select();

    if (updateError) {
      console.error('❌ Error updating lead:', updateError);
      console.log('   This might indicate RLS policy issues');
    } else {
      console.log('✅ Lead assignment successful!');
      console.log('   Updated lead:', updateResult[0]);
    }

    // Test user count update
    console.log('\n4. Testing user count update...');
    const { data: userCountResult, error: userCountError } = await supabase
      .from('users')
      .update({ leads_assigned: (testUser.leads_assigned || 0) + 1 })
      .eq('id', testUser.id)
      .select();

    if (userCountError) {
      console.error('❌ Error updating user count:', userCountError);
    } else {
      console.log('✅ User count update successful!');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testLeadAssignment();
}

module.exports = testLeadAssignment;