const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Check environment variables
const envPath = '.env';
let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log('Environment variables not found, checking .env file...');
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envLines = envContent.split('\n');
    envLines.forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        if (key.trim() === 'SUPABASE_URL') supabaseUrl = value.trim();
        if (key.trim() === 'SUPABASE_SERVICE_ROLE_KEY') supabaseKey = value.trim();
      }
    });
  } catch (err) {
    console.log('Could not read .env file');
  }
}

if (!supabaseUrl || !supabaseKey) {
  console.log('❌ Supabase credentials not found');
  process.exit(1);
}

console.log('✅ Found Supabase credentials');

const supabase = createClient(supabaseUrl, supabaseKey);

// Test query for dates after Oct 25th
async function testCalendarQuery() {
  console.log('🔍 Testing calendar query for dates after October 25th...');

  const startDate = new Date('2025-10-26T00:00:00Z');
  const endDate = new Date('2025-12-01T00:00:00Z');

  console.log(`📅 Querying date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

  const startTime = Date.now();

  try {
    // Test count query first
    const countResult = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .or('date_booked.not.is.null,status.eq.Booked')
      .is('deleted_at', null)
      .gte('date_booked', startDate.toISOString())
      .lte('date_booked', endDate.toISOString());

    console.log(`📊 Count query result: ${countResult.count} leads found`);

    if (countResult.count > 0) {
      // Test actual data query (without booking_history to avoid timeout)
      const dataResult = await supabase
        .from('leads')
        .select('id, name, date_booked, status, booking_status')
        .or('date_booked.not.is.null,status.eq.Booked')
        .is('deleted_at', null)
        .gte('date_booked', startDate.toISOString())
        .lte('date_booked', endDate.toISOString())
        .order('date_booked', { ascending: true })
        .limit(10); // Just get first 10 for testing

      const queryTime = Date.now() - startTime;
      console.log(`⏱️ Query completed in ${queryTime}ms`);
      console.log(`📋 Sample results:`, dataResult.data?.slice(0, 3));
    } else {
      console.log('⚠️ No bookings found for dates after October 25th');
    }

  } catch (error) {
    console.error('❌ Query failed:', error.message);
  }
}

testCalendarQuery();
