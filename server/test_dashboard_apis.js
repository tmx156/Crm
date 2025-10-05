/**
 * Benchmark `/api/messages-list` endpoint to estimate egress/latency.
 * Usage (PowerShell example):
 *   node server/test_dashboard_apis.js "https://your-host" "<JWT_TOKEN>"
 */

const https = require('https');
const http = require('http');

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const sizeBytes = buf.length;
        try {
          const json = JSON.parse(buf.toString('utf8'));
          resolve({ status: res.statusCode, sizeBytes, json });
        } catch (e) {
          resolve({ status: res.statusCode, sizeBytes, text: buf.toString('utf8') });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB','MB','GB'];
  let i = -1; let v = bytes;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(2)} ${units[i]}`;
}

async function timeCall(url, headers) {
  const start = Date.now();
  const res = await fetchJson(url, headers);
  const ms = Date.now() - start;
  return { ...res, ms };
}

async function main() {
  const base = process.argv[2] || 'http://localhost:5000';
  const token = process.argv[3] || '';
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const since7d = new Date(Date.now() - 7*24*60*60*1000).toISOString();

  const urls = [
    { name: 'bounded-default', url: `${base}/api/messages-list` },
    { name: 'bounded-since', url: `${base}/api/messages-list?since=${encodeURIComponent(since7d)}&limit=200` },
  ];

  console.log(`Benchmarking /api/messages-list on ${base}`);
  const results = [];
  for (const u of urls) {
    const r = await timeCall(u.url, headers);
    results.push({ name: u.name, ms: r.ms, status: r.status, sizeBytes: r.sizeBytes, size: formatBytes(r.sizeBytes), count: Array.isArray(r.json?.messages) ? r.json.messages.length : null });
  }

  // Print results table
  console.table(results);

  if (results.length >= 2) {
    const a = results[0];
    const b = results[1];
    const sizeDrop = a.sizeBytes - b.sizeBytes;
    const sizeDropPct = a.sizeBytes ? (sizeDrop / a.sizeBytes) * 100 : 0;
    console.log(`\nEstimated size reduction vs default: ${formatBytes(sizeDrop)} (${sizeDropPct.toFixed(1)}%)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Test the exact API calls that the dashboard uses
 */

const axios = require('axios');

async function testDashboardAPIs() {
  console.log('🧪 TESTING: Dashboard API endpoints');
  console.log('====================================');

  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 Today: ${today}`);

  try {
    // Test 1: Total Bookings Today API (the working one)
    console.log('\n📊 1. TESTING: Total Bookings Today API (Working)');
    console.log('=================================================');

    const leadsStatsResponse = await axios.get('http://localhost:5000/api/stats/leads', {
      params: {
        startDate: `${today}T00:00:00.000Z`,
        endDate: `${today}T23:59:59.999Z`
      }
    });

    console.log('✅ /api/stats/leads response:');
    console.log(`   📈 Booked count: ${leadsStatsResponse.data.booked}`);
    console.log(`   📋 Total count: ${leadsStatsResponse.data.total}`);
    console.log(`   📊 Full response:`, leadsStatsResponse.data);

    // Test 2: Leads API for detailed breakdown (the new approach)
    console.log('\n📊 2. TESTING: Detailed Leads API (New Approach)');
    console.log('=================================================');

    const detailedLeadsResponse = await axios.get('http://localhost:5000/api/leads', {
      params: {
        limit: 1000,
        date_booked_start: `${today}T00:00:00.000Z`,
        date_booked_end: `${today}T23:59:59.999Z`
      }
    });

    const todaysLeads = detailedLeadsResponse.data?.leads || [];
    console.log('✅ /api/leads response:');
    console.log(`   📈 Total leads count: ${todaysLeads.length}`);
    console.log(`   📋 Leads with booker_id: ${todaysLeads.filter(l => l.booker_id).length}`);

    // Process booker breakdown (same as dashboard logic)
    const bookerStats = {};
    todaysLeads.forEach(lead => {
      const bookerId = lead.booker_id;
      if (!bookerId) return;

      if (!bookerStats[bookerId]) {
        bookerStats[bookerId] = {
          bookingsToday: 0,
          bookingDetails: []
        };
      }

      bookerStats[bookerId].bookingsToday++;

      const appointmentDate = new Date(lead.date_booked);
      bookerStats[bookerId].bookingDetails.push({
        leadName: lead.name,
        time: appointmentDate.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }),
        status: lead.status,
        phone: lead.phone
      });
    });

    console.log('\n📊 Processed Booker Stats:');
    Object.entries(bookerStats).forEach(([bookerId, stats]) => {
      console.log(`   👤 Booker ${bookerId}: ${stats.bookingsToday} bookings`);
      stats.bookingDetails.forEach((detail, idx) => {
        console.log(`      ${idx + 1}. ${detail.leadName} at ${detail.time} (${detail.status})`);
      });
    });

    // Test 3: Old Team Performance API (for comparison)
    console.log('\n📊 3. TESTING: Old Team Performance API (For Comparison)');
    console.log('=========================================================');

    try {
      const teamResponse = await axios.get('http://localhost:5000/api/stats/team-performance', {
        params: { date: today }
      });

      console.log('✅ /api/stats/team-performance response:');
      console.log('   📋 Team stats:', teamResponse.data);
    } catch (teamError) {
      console.log('❌ Team performance API error:', teamError.message);
    }

    // Test 4: Data consistency check
    console.log('\n🔍 4. DATA CONSISTENCY CHECK');
    console.log('============================');

    const statsCount = leadsStatsResponse.data.booked || 0;
    const detailedCount = todaysLeads.length;
    const bookerTotal = Object.values(bookerStats).reduce((sum, booker) => sum + booker.bookingsToday, 0);

    console.log(`📊 Stats API count: ${statsCount}`);
    console.log(`📊 Detailed API count: ${detailedCount}`);
    console.log(`📊 Booker breakdown total: ${bookerTotal}`);

    if (statsCount === detailedCount && detailedCount === bookerTotal) {
      console.log('✅ DATA CONSISTENCY: Perfect! All counts match');
    } else {
      console.log('❌ DATA CONSISTENCY: Mismatch detected');
    }

    // Test 5: Check john wf specifically
    console.log('\n👤 5. JOHN WF SPECIFIC CHECK');
    console.log('============================');

    const johnWfId = 'ff2fa0a0-027b-45fa-afde-8d0b2faf7a1f';
    const johnWfBookings = todaysLeads.filter(lead => lead.booker_id === johnWfId);

    console.log(`📊 john wf bookings found: ${johnWfBookings.length}`);
    johnWfBookings.forEach((booking, idx) => {
      const time = new Date(booking.date_booked).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      console.log(`   ${idx + 1}. ${booking.name} at ${time} (${booking.status})`);
    });

  } catch (error) {
    console.error('❌ API test failed:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testDashboardAPIs();
}

module.exports = testDashboardAPIs;