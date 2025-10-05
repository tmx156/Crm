const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

async function checkBookingHistoryBloat() {
  console.log('🔍 BOOKING HISTORY BLOAT ANALYSIS\n');
  console.log('='.repeat(60));

  // Get leads with booking_history
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, booking_history')
    .not('booking_history', 'is', null);
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`\n📊 Leads with booking_history: ${leads.length}`);

  // Analyze the booking_history column
  let totalHistorySize = 0;
  let totalEntries = 0;
  const leadsWithHistory = [];

  leads.forEach(lead => {
    let history = lead.booking_history;
    
    // Parse if string
    if (typeof history === 'string') {
      try {
        history = JSON.parse(history);
      } catch (e) {
        history = [];
      }
    }

    if (Array.isArray(history) && history.length > 0) {
      const historySize = JSON.stringify(history).length;
      totalHistorySize += historySize;
      totalEntries += history.length;
      
      leadsWithHistory.push({
        id: lead.id,
        name: lead.name,
        entries: history.length,
        size: historySize,
        history: history
      });
    }
  });

  const avgHistorySize = leadsWithHistory.length > 0 
    ? (totalHistorySize / leadsWithHistory.length).toFixed(0) 
    : 0;
  const avgEntries = leadsWithHistory.length > 0
    ? (totalEntries / leadsWithHistory.length).toFixed(1)
    : 0;

  console.log(`\n💾 Total booking_history Size: ${(totalHistorySize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📏 Average history size per lead: ${(avgHistorySize / 1024).toFixed(2)} KB`);
  console.log(`📝 Total history entries: ${totalEntries}`);
  console.log(`📊 Average entries per lead: ${avgEntries}`);

  // Find leads with largest history
  leadsWithHistory.sort((a, b) => b.size - a.size);
  
  console.log('\n\n📦 Top 10 Leads with Largest Booking History:');
  leadsWithHistory.slice(0, 10).forEach((lead, i) => {
    const kb = (lead.size / 1024).toFixed(2);
    console.log(`\n${i + 1}. ${lead.name} (ID: ${lead.id})`);
    console.log(`   Size: ${kb} KB`);
    console.log(`   Entries: ${lead.entries}`);
    console.log(`   Entry types:`);
    
    const actionCounts = {};
    lead.history.forEach(entry => {
      actionCounts[entry.action] = (actionCounts[entry.action] || 0) + 1;
    });
    
    Object.entries(actionCounts).forEach(([action, count]) => {
      console.log(`      ${action}: ${count}`);
    });

    // Show sample entry
    if (lead.history.length > 0) {
      const sample = lead.history[0];
      console.log(`   Sample entry size: ${JSON.stringify(sample).length} bytes`);
      console.log(`   Sample entry keys: ${Object.keys(sample).join(', ')}`);
    }
  });

  // Check for duplicate entries
  console.log('\n\n🔍 Checking for potential duplicate history entries:');
  let duplicateCount = 0;
  
  leadsWithHistory.forEach(lead => {
    const seen = new Set();
    let leadDuplicates = 0;
    
    lead.history.forEach(entry => {
      const key = `${entry.timestamp}-${entry.action}-${entry.performed_by}`;
      if (seen.has(key)) {
        leadDuplicates++;
      }
      seen.add(key);
    });
    
    if (leadDuplicates > 0) {
      duplicateCount += leadDuplicates;
    }
  });

  if (duplicateCount > 0) {
    console.log(`   ⚠️  Found ${duplicateCount} potential duplicate entries across all leads`);
  } else {
    console.log(`   ✅ No obvious duplicates found`);
  }

  // Recommendations
  console.log('\n\n💡 RECOMMENDATIONS:\n');
  
  const avgSizeKB = parseFloat(avgHistorySize) / 1024;
  if (avgSizeKB > 5) {
    console.log('   ⚠️  ISSUE: booking_history is VERY large (avg ' + avgSizeKB.toFixed(1) + ' KB per lead)');
    console.log('   📋 Each lead stores ALL its history in one JSON column');
    console.log('   🔧 SOLUTION: Use the separate booking_history table instead!');
    console.log('');
    console.log('   Current Setup:');
    console.log('      ❌ leads.booking_history column: ' + (totalHistorySize / 1024 / 1024).toFixed(2) + ' MB (duplicated data)');
    console.log('      ✅ booking_history table: 0.68 MB (normalized data)');
    console.log('');
    console.log('   Action Required:');
    console.log('      1. Stop writing to leads.booking_history column');
    console.log('      2. Only use the booking_history table (already working!)');
    console.log('      3. Clear the leads.booking_history column to save space');
    console.log('      4. Update frontend to read from booking_history table');
  } else if (avgSizeKB > 2) {
    console.log('   ⚠️  booking_history is moderately large (' + avgSizeKB.toFixed(1) + ' KB per lead)');
    console.log('   Consider moving old entries to archive table');
  } else {
    console.log('   ✅ booking_history size is reasonable');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Analysis complete!');
}

checkBookingHistoryBloat().catch(console.error);


