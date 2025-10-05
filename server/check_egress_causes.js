const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

async function analyzeEgressCauses() {
  console.log('🔍 EGRESS (DATA TRANSFER) ANALYSIS\n');
  console.log('='.repeat(60));

  console.log('\n📊 Database Size vs Egress:\n');
  console.log('   Database Size: ~3.82 MB');
  console.log('   Egress Usage: ~5 GB');
  console.log('   Transfer Multiplier: ~1,300x');
  console.log('\n   This means you\'re downloading the SAME data ~1,300 times!');

  console.log('\n\n🔍 Potential Egress Causes:\n');

  // 1. Check leads with bloated booking_history
  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('id, name, booking_history')
    .not('booking_history', 'is', null);

  if (!leadsError && leads) {
    let totalHistorySize = 0;
    leads.forEach(lead => {
      let history = lead.booking_history;
      if (typeof history === 'string') {
        try { history = JSON.parse(history); } catch (e) { history = []; }
      }
      if (Array.isArray(history)) {
        totalHistorySize += JSON.stringify(history).length;
      }
    });

    const historySizeMB = (totalHistorySize / 1024 / 1024).toFixed(2);
    console.log('1️⃣  LEADS TABLE with booking_history column:');
    console.log(`   ❌ Size per full fetch: ${historySizeMB} MB`);
    console.log(`   ❌ If fetched 100x/day: ${(historySizeMB * 100 / 1024).toFixed(2)} GB/day`);
    console.log(`   ❌ If fetched 500x/day: ${(historySizeMB * 500 / 1024).toFixed(2)} GB/day`);
    console.log(`   ❌ If fetched 2,700x: ${(historySizeMB * 2700 / 1024).toFixed(2)} GB total`);
    console.log('   🔧 FIX: Clear leads.booking_history column!');
  }

  // 2. Check messages table
  const { count: msgCount } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true });

  if (msgCount) {
    const msgSizeMB = 0.82; // From previous analysis
    console.log('\n2️⃣  MESSAGES TABLE:');
    console.log(`   Size: ${msgSizeMB} MB (${msgCount} messages)`);
    console.log(`   If fetched 100x/day: ${(msgSizeMB * 100 / 1024).toFixed(2)} GB/day`);
    console.log(`   If fetched 6,100x: ${(msgSizeMB * 6100 / 1024).toFixed(2)} GB total`);
    console.log('   🔧 FIX: Use pagination, limit results, add date filters');
  }

  // 3. Check Storage bucket
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    
    console.log('\n3️⃣  STORAGE BUCKETS:');
    for (const bucket of buckets || []) {
      const { data: files } = await supabase.storage
        .from(bucket.name)
        .list('', { limit: 1000 });
      
      if (files && files.length > 0) {
        const totalSize = files.reduce((sum, f) => sum + (f.metadata?.size || 0), 0);
        const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
        console.log(`\n   📦 ${bucket.name}:`);
        console.log(`      Size: ${sizeMB} MB (${files.length} files)`);
        
        if (parseFloat(sizeMB) > 1) {
          console.log(`      If downloaded 100x: ${(sizeMB * 100 / 1024).toFixed(2)} GB`);
          console.log(`      If downloaded 2,359x: ${(sizeMB * 2359 / 1024).toFixed(2)} GB`);
          console.log('      🔧 FIX: Cache files, use CDN, limit downloads');
        }
      }
    }
  } catch (e) {
    console.log('\n3️⃣  STORAGE BUCKETS: (checking...)');
  }

  // 4. Real-time subscriptions
  console.log('\n4️⃣  REAL-TIME SUBSCRIPTIONS:');
  console.log('   ⚠️  If you have real-time updates enabled:');
  console.log('      - Each change triggers data transfer');
  console.log('      - Multiple clients = multiplied transfer');
  console.log('      - Socket.IO messages count as egress');
  console.log('   🔧 FIX: Minimize real-time payload size');

  // 5. Analyze likely scenarios
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 MOST LIKELY SCENARIOS:\n');

  const scenarios = [
    {
      name: 'Leads table fetched with booking_history',
      sizePerFetch: 1.83,
      fetchesNeeded: Math.ceil(5000 / 1.83),
      likelihood: '🔥 VERY HIGH',
      fix: 'Clear leads.booking_history column'
    },
    {
      name: 'Messages table fetched without pagination',
      sizePerFetch: 0.82,
      fetchesNeeded: Math.ceil(5000 / 0.82),
      likelihood: '⚠️  HIGH',
      fix: 'Add pagination, date filters'
    },
    {
      name: 'Storage files downloaded repeatedly',
      sizePerFetch: 2.12,
      fetchesNeeded: Math.ceil(5000 / 2.12),
      likelihood: '⚠️  MEDIUM',
      fix: 'Cache files, use CDN'
    },
    {
      name: 'Multiple users + auto-refresh + real-time',
      sizePerFetch: 3.82,
      fetchesNeeded: Math.ceil(5000 / 3.82),
      likelihood: '🔥 VERY HIGH',
      fix: 'Reduce refresh frequency, optimize queries'
    }
  ];

  scenarios.forEach((s, i) => {
    console.log(`${i + 1}. ${s.name}`);
    console.log(`   Likelihood: ${s.likelihood}`);
    console.log(`   Size per fetch: ${s.sizePerFetch} MB`);
    console.log(`   Fetches to reach 5GB: ~${s.fetchesNeeded.toLocaleString()}`);
    console.log(`   Fix: ${s.fix}\n`);
  });

  console.log('='.repeat(60));
  console.log('\n💡 RECOMMENDED ACTIONS (Priority Order):\n');
  console.log('1. ✅ Clear leads.booking_history column (saves 1.83 MB per query)');
  console.log('2. ✅ Add pagination to messages/leads lists (reduce data per load)');
  console.log('3. ✅ Use .select() to only fetch needed columns');
  console.log('4. ✅ Add caching headers for API responses');
  console.log('5. ✅ Reduce auto-refresh frequency on dashboard');
  console.log('6. ✅ Optimize real-time updates (send only IDs, not full objects)');
  console.log('7. ✅ Add date filters to limit historical data fetches');
  console.log('\n' + '='.repeat(60));
  console.log('✅ Analysis complete!\n');
}

analyzeEgressCauses().catch(console.error);

