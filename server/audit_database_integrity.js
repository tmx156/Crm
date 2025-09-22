const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function auditDatabaseIntegrity() {
  console.log('🔍 DATABASE INTEGRITY AUDIT');
  console.log('===========================');

  const issues = [];
  const warnings = [];
  const successes = [];

  try {
    // 1. Check core tables exist and have data
    console.log('\n📊 TABLE EXISTENCE & DATA CHECK:');

    const tables = ['users', 'leads', 'sales', 'messages', 'templates', 'booking_history'];

    for (const table of tables) {
      try {
        const { data, error, count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        if (error) {
          issues.push(`❌ Table '${table}' error: ${error.message}`);
        } else {
          console.log(`   ✅ ${table}: ${count} records`);
          successes.push(`Table '${table}' exists with ${count} records`);

          if (count === 0 && table !== 'booking_history') {
            warnings.push(`⚠️  Table '${table}' is empty - may need seed data`);
          }
        }
      } catch (err) {
        issues.push(`❌ Table '${table}' access failed: ${err.message}`);
      }
    }

    // 2. Check user data integrity
    console.log('\n👥 USER DATA INTEGRITY:');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*');

    if (usersError) {
      issues.push(`❌ Cannot query users: ${usersError.message}`);
    } else {
      // Check for required fields
      const invalidUsers = users.filter(u => !u.id || !u.name || !u.email || !u.role);
      if (invalidUsers.length > 0) {
        issues.push(`❌ ${invalidUsers.length} users missing required fields (id, name, email, role)`);
      } else {
        successes.push('All users have required fields');
      }

      // Check role distribution
      const roles = users.reduce((acc, u) => {
        acc[u.role] = (acc[u.role] || 0) + 1;
        return acc;
      }, {});
      console.log('   Role distribution:', roles);

      // Check for admin user
      if (!roles.admin || roles.admin === 0) {
        issues.push('❌ No admin users found - system needs at least one admin');
      } else {
        successes.push(`Found ${roles.admin} admin user(s)`);
      }
    }

    // 3. Check sales data integrity
    console.log('\n💰 SALES DATA INTEGRITY:');
    const { data: sales, error: salesError } = await supabase
      .from('sales')
      .select('*');

    if (salesError) {
      issues.push(`❌ Cannot query sales: ${salesError.message}`);
    } else {
      console.log(`   Found ${sales.length} sales`);

      // Check for required fields
      const invalidSales = sales.filter(s => !s.id || !s.lead_id || !s.amount);
      if (invalidSales.length > 0) {
        issues.push(`❌ ${invalidSales.length} sales missing required fields`);
      } else {
        successes.push('All sales have required fields');
      }

      // Check user_id attribution
      const salesWithUserId = sales.filter(s => s.user_id).length;
      const salesWithoutUserId = sales.filter(s => !s.user_id).length;

      console.log(`   ✅ Sales with user_id: ${salesWithUserId}`);
      console.log(`   ⚠️  Sales without user_id: ${salesWithoutUserId}`);

      if (salesWithoutUserId > 0) {
        warnings.push(`${salesWithoutUserId} sales lack user attribution`);
      } else {
        successes.push('All sales have user attribution');
      }
    }

    // 4. Check leads data integrity
    console.log('\n📋 LEADS DATA INTEGRITY:');
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('*');

    if (leadsError) {
      issues.push(`❌ Cannot query leads: ${leadsError.message}`);
    } else {
      console.log(`   Found ${leads.length} leads`);

      // Check for required fields
      const invalidLeads = leads.filter(l => !l.id || !l.name);
      if (invalidLeads.length > 0) {
        issues.push(`❌ ${invalidLeads.length} leads missing required fields`);
      } else {
        successes.push('All leads have required fields');
      }

      // Check status distribution
      const statuses = leads.reduce((acc, l) => {
        acc[l.status] = (acc[l.status] || 0) + 1;
        return acc;
      }, {});
      console.log('   Status distribution:', statuses);
    }

    // 5. Check foreign key relationships
    console.log('\n🔗 FOREIGN KEY RELATIONSHIPS:');

    // Sales -> Leads relationship
    const { data: orphanedSales, error: orphanError } = await supabase
      .from('sales')
      .select('id, lead_id')
      .not('lead_id', 'is', null);

    if (!orphanError && orphanedSales) {
      // Check if all sales have valid leads
      const leadIds = leads.map(l => l.id);
      const invalidSales = orphanedSales.filter(s => !leadIds.includes(s.lead_id));

      if (invalidSales.length > 0) {
        issues.push(`❌ ${invalidSales.length} sales reference non-existent leads`);
      } else {
        successes.push('All sales reference valid leads');
      }
    }

    // Sales -> Users relationship
    if (sales && users) {
      const userIds = users.map(u => u.id);
      const invalidUserSales = sales.filter(s => s.user_id && !userIds.includes(s.user_id));

      if (invalidUserSales.length > 0) {
        issues.push(`❌ ${invalidUserSales.length} sales reference non-existent users`);
      } else {
        successes.push('All sales reference valid users (or have no user attribution)');
      }
    }

    // 6. Check for data consistency issues
    console.log('\n🔍 DATA CONSISTENCY CHECKS:');

    // Check for duplicate emails in users
    if (users) {
      const emails = users.map(u => u.email);
      const uniqueEmails = new Set(emails);
      if (emails.length !== uniqueEmails.size) {
        issues.push('❌ Duplicate email addresses found in users table');
      } else {
        successes.push('All user emails are unique');
      }
    }

    // Check for sales with future dates
    if (sales) {
      const futureSales = sales.filter(s => new Date(s.created_at) > new Date());
      if (futureSales.length > 0) {
        warnings.push(`${futureSales.length} sales have future creation dates`);
      }
    }

    // 7. Check table sizes for performance
    console.log('\n⚡ PERFORMANCE CHECKS:');

    if (leads && leads.length > 1000) {
      warnings.push(`Large leads table: ${leads.length} records - consider indexing`);
    }
    if (sales && sales.length > 1000) {
      warnings.push(`Large sales table: ${sales.length} records - consider indexing`);
    }

    // 8. Summary
    console.log('\n📋 AUDIT SUMMARY:');
    console.log('================');

    console.log(`\n✅ SUCCESSES (${successes.length}):`);
    successes.forEach(s => console.log(`   ✓ ${s}`));

    if (warnings.length > 0) {
      console.log(`\n⚠️  WARNINGS (${warnings.length}):`);
      warnings.forEach(w => console.log(`   ! ${w}`));
    }

    if (issues.length > 0) {
      console.log(`\n❌ ISSUES (${issues.length}):`);
      issues.forEach(i => console.log(`   ✗ ${i}`));
    }

    // Deployment readiness score
    const totalChecks = successes.length + warnings.length + issues.length;
    const score = Math.round((successes.length / totalChecks) * 100);

    console.log(`\n🎯 DEPLOYMENT READINESS SCORE: ${score}/100`);
    console.log(`   (Based on ${totalChecks} checks: ${successes.length} passed, ${warnings.length} warnings, ${issues.length} issues)`);

    if (score >= 90) {
      console.log('   🟢 EXCELLENT: Ready for deployment');
    } else if (score >= 75) {
      console.log('   🟡 GOOD: Ready with minor fixes');
    } else if (score >= 60) {
      console.log('   🟠 FAIR: Needs attention before deployment');
    } else {
      console.log('   🔴 POOR: Significant issues need fixing');
    }

  } catch (error) {
    console.error('❌ Audit failed:', error);
  }
}

auditDatabaseIntegrity();
