#!/usr/bin/env node

/**
 * Debug Reports Page Date Range
 * Check what date range the Reports page is actually using
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

// Use service role key for admin operations
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

// Replicate the Reports page date calculation
function getReportsPageDateRange() {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysToMonday = currentDay === 0 ? 6 : currentDay - 1;
  
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToMonday);
  monday.setHours(0, 0, 0, 0);
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  
  return {
    startDate: monday.toISOString().split('T')[0],
    endDate: sunday.toISOString().split('T')[0],
    startUTC: monday.toISOString(),
    endUTC: sunday.toISOString()
  };
}

// Format date for display
function formatDate(date) {
  return date.toLocaleDateString('en-GB', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function debugReportsDateRange() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 REPORTS PAGE DATE RANGE DEBUG');
    console.log('='.repeat(80) + '\n');

    // Get the date range that Reports page should be using
    const dateRange = getReportsPageDateRange();
    
    console.log(`📅 Reports Page Date Range:`);
    console.log(`   Start: ${dateRange.startDate} (${dateRange.startUTC})`);
    console.log(`   End:   ${dateRange.endDate} (${dateRange.endUTC})`);
    console.log();

    // Check what sales exist in this exact range
    const { data: salesInRange, error: salesError } = await supabase
      .from('sales')
      .select('id, lead_id, amount, created_at')
      .gte('created_at', dateRange.startUTC)
      .lte('created_at', dateRange.endUTC)
      .order('created_at', { ascending: false });

    if (salesError) {
      console.error('❌ Error fetching sales:', salesError);
      return;
    }

    const totalRevenue = salesInRange?.reduce((sum, sale) => sum + (parseFloat(sale.amount) || 0), 0) || 0;
    const totalSales = salesInRange?.length || 0;

    console.log(`💰 Sales in Reports Date Range:`);
    console.log(`   Total Sales: ${totalSales}`);
    console.log(`   Total Revenue: £${totalRevenue.toFixed(2)}`);
    console.log();

    if (salesInRange && salesInRange.length > 0) {
      console.log(`📋 Sales Details:`);
      salesInRange.forEach((sale, i) => {
        console.log(`   ${i+1}. ID: ${sale.id.slice(-8)} | Amount: £${parseFloat(sale.amount).toFixed(2)} | Date: ${formatDate(new Date(sale.created_at))}`);
      });
    }

    // Also check what happens if we use a slightly different range
    console.log('\n' + '─'.repeat(80));
    console.log('🔍 CHECKING ALTERNATIVE DATE RANGES');
    console.log('─'.repeat(80));

    // Check last 7 days (old Reports logic)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(23, 59, 59, 999);

    const { data: salesLast7Days, error: last7Error } = await supabase
      .from('sales')
      .select('id, lead_id, amount, created_at')
      .gte('created_at', sevenDaysAgo.toISOString())
      .lte('created_at', now.toISOString());

    if (!last7Error) {
      const revenueLast7Days = salesLast7Days?.reduce((sum, sale) => sum + (parseFloat(sale.amount) || 0), 0) || 0;
      console.log(`📅 Last 7 Days (${sevenDaysAgo.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}):`);
      console.log(`   Sales: ${salesLast7Days?.length || 0}, Revenue: £${revenueLast7Days.toFixed(2)}`);
    }

    // Check if there are any sales just outside our range
    console.log('\n' + '─'.repeat(80));
    console.log('🔍 CHECKING SALES OUTSIDE DATE RANGE');
    console.log('─'.repeat(80));

    // Get all sales from this week (Monday to Sunday) regardless of time
    const mondayStart = new Date(dateRange.startDate + 'T00:00:00.000Z');
    const sundayEnd = new Date(dateRange.endDate + 'T23:59:59.999Z');

    const { data: allWeekSales, error: allWeekError } = await supabase
      .from('sales')
      .select('id, lead_id, amount, created_at')
      .gte('created_at', mondayStart.toISOString())
      .lte('created_at', sundayEnd.toISOString())
      .order('created_at', { ascending: false });

    if (!allWeekError) {
      const allWeekRevenue = allWeekSales?.reduce((sum, sale) => sum + (parseFloat(sale.amount) || 0), 0) || 0;
      console.log(`📅 All Sales This Week (Monday 00:00 to Sunday 23:59):`);
      console.log(`   Sales: ${allWeekSales?.length || 0}, Revenue: £${allWeekRevenue.toFixed(2)}`);
      
      if (allWeekSales && allWeekSales.length !== totalSales) {
        console.log(`\n⚠️  MISMATCH FOUND!`);
        console.log(`   Reports Range: ${totalSales} sales, £${totalRevenue.toFixed(2)}`);
        console.log(`   Full Week: ${allWeekSales.length} sales, £${allWeekRevenue.toFixed(2)}`);
        
        // Show which sales are missing
        const missingSales = allWeekSales.filter(sale => 
          !salesInRange?.some(r => r.id === sale.id)
        );
        
        console.log(`\n📋 Missing Sales:`);
        missingSales.forEach((sale, i) => {
          console.log(`   ${i+1}. ID: ${sale.id.slice(-8)} | Amount: £${parseFloat(sale.amount).toFixed(2)} | Date: ${formatDate(new Date(sale.created_at))}`);
        });
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ DEBUG COMPLETE');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Run the debug
debugReportsDateRange();

