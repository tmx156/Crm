/**
 * One-time script: Upload historical BOOKED leads to Facebook Conversions API
 *
 * Sends Schedule events for all 1,675 booked leads (matching the calendar view)
 * using original date_booked timestamps so Facebook can optimise ad delivery.
 *
 * Usage:  node server/upload_historical_to_facebook.js
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { sendBatch, buildUserData } = require('./utils/facebookConversions');

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Convert a date string to Unix timestamp (seconds)
function toUnixTime(dateValue) {
  if (!dateValue) return Math.floor(Date.now() / 1000);
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return Math.floor(Date.now() / 1000);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Fetch all booked leads using the same query as the calendar view.
 * Paginates in batches of 1000 to get past Supabase's row limit.
 */
async function fetchAllBookedLeads() {
  const BATCH_SIZE = 1000;
  const allLeads = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, email, postcode, status, date_booked, notes, created_at, updated_at')
      .or('date_booked.not.is.null,status.eq.Booked')
      .is('deleted_at', null)
      .not('status', 'in', '(Cancelled,Rejected)')
      .order('date_booked', { ascending: true, nullsLast: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`  Error fetching batch at offset ${offset}:`, error.message);
      break;
    }

    allLeads.push(...data);
    console.log(`  Fetched batch: ${data.length} leads (total so far: ${allLeads.length})`);

    if (data.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      offset += BATCH_SIZE;
    }
  }

  return allLeads;
}

async function run() {
  console.log('=== Facebook Historical Upload (Booked Leads) ===\n');

  // ------------------------------------------------------------------
  // 1. Fetch all booked leads (same filter as calendar)
  // ------------------------------------------------------------------
  console.log('Fetching booked leads...');
  const bookedLeads = await fetchAllBookedLeads();
  console.log(`\nTotal booked leads found: ${bookedLeads.length}\n`);

  if (bookedLeads.length === 0) {
    console.log('No booked leads to upload. Exiting.');
    return;
  }

  // ------------------------------------------------------------------
  // 2. Filter to last 7 days only (Facebook rejects older events)
  // ------------------------------------------------------------------
  const now = Date.now();
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
  const recentLeads = bookedLeads.filter((lead) => {
    const bookDate = new Date(lead.date_booked || lead.created_at);
    const ts = bookDate.getTime();
    // Must be within last 7 days AND not in the future
    return ts >= sevenDaysAgo && ts <= now;
  });
  const tooOld = bookedLeads.filter((l) => new Date(l.date_booked || l.created_at).getTime() < sevenDaysAgo).length;
  const futureCount = bookedLeads.filter((l) => new Date(l.date_booked || l.created_at).getTime() > now).length;
  console.log(`Within last 7 days (past only): ${recentLeads.length}`);
  console.log(`Too old for Facebook (>7 days): ${tooOld}`);
  console.log(`Future bookings (skipped): ${futureCount}\n`);

  if (recentLeads.length === 0) {
    console.log('No recent past bookings to upload. Facebook only accepts events from the last 7 days.');
    return;
  }

  // ------------------------------------------------------------------
  // 3. Build Schedule events
  // ------------------------------------------------------------------
  console.log('Building Schedule events...');
  const scheduleEvents = recentLeads.map((lead) => ({
    event_name: 'Schedule',
    event_time: toUnixTime(lead.date_booked || lead.updated_at || lead.created_at),
    action_source: 'system_generated',
    event_id: `Schedule_${lead.id}_hist`,
    user_data: buildUserData(lead),
    custom_data: {
      content_name: 'Appointment Booking',
      appointment_date: lead.date_booked || null,
    },
  }));
  console.log(`${scheduleEvents.length} Schedule events ready\n`);

  // ------------------------------------------------------------------
  // 4. Send to Facebook in batches of 1000
  // ------------------------------------------------------------------
  console.log('--- Sending Schedule events to Facebook ---');
  const result = await sendBatch(scheduleEvents);

  // ------------------------------------------------------------------
  // 4. Summary
  // ------------------------------------------------------------------
  console.log('\n=== Upload Complete ===');
  console.log(`Schedule events sent: ${result.sent}`);
  console.log(`Errors: ${result.errors}`);
  console.log(`\nCheck Facebook Events Manager > Overview to verify.`);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
