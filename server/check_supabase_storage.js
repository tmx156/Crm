const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

async function checkStorageUsage() {
  console.log('🔍 SUPABASE STORAGE AUDIT\n');
  console.log('='.repeat(60));

  // 1. Check Storage Buckets
  console.log('\n📦 STORAGE BUCKETS:');
  console.log('-'.repeat(60));
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
      console.error('❌ Error fetching buckets:', error);
    } else {
      for (const bucket of buckets) {
        console.log(`\n📁 Bucket: ${bucket.name}`);
        console.log(`   Public: ${bucket.public}`);
        console.log(`   Created: ${bucket.created_at}`);
        
        // List files in bucket
        const { data: files, error: listError } = await supabase.storage
          .from(bucket.name)
          .list('', { limit: 1000 });
        
        if (listError) {
          console.log(`   ❌ Error listing files: ${listError.message}`);
        } else {
          const totalSize = files.reduce((sum, file) => {
            const size = file.metadata?.size || 0;
            return sum + size;
          }, 0);
          const sizeInMB = (totalSize / 1024 / 1024).toFixed(2);
          console.log(`   Files: ${files.length}`);
          console.log(`   Total Size: ${sizeInMB} MB`);
          
          // Show largest files
          if (files.length > 0) {
            const sortedFiles = files
              .filter(f => f.metadata?.size)
              .sort((a, b) => (b.metadata?.size || 0) - (a.metadata?.size || 0))
              .slice(0, 5);
            
            if (sortedFiles.length > 0) {
              console.log(`   Top 5 Largest Files:`);
              sortedFiles.forEach((file, i) => {
                const fileSizeMB = ((file.metadata?.size || 0) / 1024 / 1024).toFixed(2);
                console.log(`      ${i + 1}. ${file.name} - ${fileSizeMB} MB`);
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Storage bucket error:', error.message);
  }

  // 2. Check Table Row Counts
  console.log('\n\n📊 DATABASE TABLES:');
  console.log('-'.repeat(60));
  
  const tables = [
    'leads',
    'users', 
    'templates',
    'sales',
    'booking_history',
    'messages',
    'sms_messages'
  ];

  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`❌ ${table}: Error - ${error.message}`);
      } else {
        console.log(`📋 ${table}: ${count.toLocaleString()} rows`);
      }
    } catch (error) {
      console.log(`❌ ${table}: ${error.message}`);
    }
  }

  // 3. Check specific large columns
  console.log('\n\n🔍 CHECKING LARGE DATA COLUMNS:');
  console.log('-'.repeat(60));

  // Check booking_history details column
  try {
    console.log('\n📝 booking_history table:');
    const { data: historyData, error } = await supabase
      .from('booking_history')
      .select('id, action, details, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      console.log('   ❌ Error:', error.message);
    } else {
      console.log(`   Recent entries: ${historyData.length}`);
      historyData.forEach((entry, i) => {
        const detailsSize = JSON.stringify(entry.details || {}).length;
        console.log(`   ${i + 1}. ${entry.action} - Details size: ${detailsSize} bytes`);
      });
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }

  // Check messages content
  try {
    console.log('\n📧 messages table:');
    const { data: messages, error } = await supabase
      .from('messages')
      .select('id, type, content, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      console.log('   ❌ Error:', error.message);
    } else {
      console.log(`   Recent entries: ${messages.length}`);
      messages.forEach((msg, i) => {
        const contentSize = (msg.content || '').length;
        console.log(`   ${i + 1}. ${msg.type} - Content size: ${contentSize} bytes`);
      });
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }

  // Check leads for image URLs
  try {
    console.log('\n🖼️  leads table (checking image_url):');
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, name, image_url')
      .not('image_url', 'is', null)
      .limit(10);
    
    if (error) {
      console.log('   ❌ Error:', error.message);
    } else {
      console.log(`   Leads with images: ${leads.length}`);
      leads.forEach((lead, i) => {
        const isSupabase = lead.image_url?.includes('supabase.co') || false;
        const urlLength = (lead.image_url || '').length;
        console.log(`   ${i + 1}. ${lead.name} - ${isSupabase ? '⚠️ SUPABASE' : '✅ External'} URL (${urlLength} chars)`);
      });
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }

  // 4. Run SQL to get actual table sizes (if permissions allow)
  console.log('\n\n💾 DATABASE SIZE (attempting SQL query):');
  console.log('-'.repeat(60));
  try {
    const { data, error } = await supabase.rpc('pg_database_size', {
      database_name: 'postgres'
    });
    
    if (error) {
      console.log('⚠️  Cannot fetch database size - requires admin permissions');
      console.log('   You can check this manually in Supabase Dashboard > Database > Usage');
    } else {
      console.log('✅ Database size:', data);
    }
  } catch (error) {
    console.log('⚠️  Cannot fetch database size via RPC');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Audit complete!');
  console.log('\n💡 To check exact database size:');
  console.log('   1. Go to Supabase Dashboard');
  console.log('   2. Navigate to Database > Usage');
  console.log('   3. Check table sizes and storage usage');
}

checkStorageUsage().catch(console.error);

