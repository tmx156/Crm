const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

async function checkAllTables() {
  console.log('🔍 COMPREHENSIVE DATABASE ANALYSIS\n');
  console.log('='.repeat(60));

  const tables = [
    'leads',
    'users',
    'templates',
    'sales',
    'booking_history',
    'messages',
    'sms_messages'
  ];

  let totalSize = 0;
  const results = [];

  for (const table of tables) {
    try {
      console.log(`\n📊 Analyzing: ${table}`);
      
      // Get all data
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact' });
      
      if (error) {
        console.log(`   ❌ Error: ${error.message}`);
        continue;
      }

      if (!data) {
        console.log(`   ⚠️  No data returned`);
        continue;
      }

      // Calculate size
      const tableSize = JSON.stringify(data).length;
      const tableMB = (tableSize / 1024 / 1024).toFixed(2);
      const avgSize = data.length > 0 ? (tableSize / data.length).toFixed(0) : 0;
      
      totalSize += tableSize;

      console.log(`   Rows: ${data.length}`);
      console.log(`   Size: ${tableMB} MB`);
      console.log(`   Avg row size: ${avgSize} bytes`);

      results.push({
        table,
        rows: data.length,
        size: tableSize,
        sizeMB: tableMB,
        avgSize
      });

      // Check for large columns
      if (data.length > 0) {
        const firstRow = data[0];
        const largeColumns = [];
        
        Object.entries(firstRow).forEach(([col, val]) => {
          if (val) {
            const colSize = JSON.stringify(val).length;
            if (colSize > 500) {
              largeColumns.push({ col, size: colSize });
            }
          }
        });

        if (largeColumns.length > 0) {
          console.log(`   📏 Large columns detected:`);
          largeColumns.forEach(({ col, size }) => {
            console.log(`      ${col}: ${(size / 1024).toFixed(2)} KB per row (sample)`);
          });
        }
      }

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 SUMMARY\n');
  
  // Sort by size
  results.sort((a, b) => b.size - a.size);
  
  const totalMB = (totalSize / 1024 / 1024).toFixed(2);
  console.log(`💾 Total Database Size (estimated): ${totalMB} MB\n`);
  
  console.log('Breakdown by table:');
  results.forEach(({ table, rows, sizeMB, avgSize }) => {
    const pct = ((JSON.parse(sizeMB) * 1024 * 1024 / totalSize) * 100).toFixed(1);
    console.log(`   ${table.padEnd(20)}: ${sizeMB.padStart(8)} MB (${pct.padStart(5)}%) - ${rows.toLocaleString()} rows`);
  });

  console.log('\n💡 RECOMMENDATIONS:');
  
  // Check for large tables
  const largeTables = results.filter(r => parseFloat(r.sizeMB) > 1);
  if (largeTables.length > 0) {
    console.log('\n   📦 Large Tables:');
    largeTables.forEach(({ table, sizeMB }) => {
      console.log(`      • ${table} (${sizeMB} MB) - Consider archiving old data`);
    });
  }

  // Check for tables with many rows
  const rowHeavy = results.filter(r => r.rows > 1000);
  if (rowHeavy.length > 0) {
    console.log('\n   📝 Row-Heavy Tables:');
    rowHeavy.forEach(({ table, rows }) => {
      console.log(`      • ${table} (${rows.toLocaleString()} rows) - Consider pagination or cleanup`);
    });
  }

  // Check for large average row size
  const fatRows = results.filter(r => parseInt(r.avgSize) > 2000);
  if (fatRows.length > 0) {
    console.log('\n   🎯 Tables with Large Rows:');
    fatRows.forEach(({ table, avgSize }) => {
      console.log(`      • ${table} (${(parseInt(avgSize) / 1024).toFixed(1)} KB avg) - Check for large text/JSON columns`);
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Analysis complete!');
}

checkAllTables().catch(console.error);


