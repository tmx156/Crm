/**
 * One-time backfill: send Schedule events for bookings MADE in the last 7 days.
 *
 * Most booking code paths were not firing the Facebook CAPI Schedule event
 * (only ~10% of bookings reached Meta). Meta accepts events up to 7 days old,
 * so this sends a Schedule for every lead with booked_at in the last 7 days,
 * using booked_at as the event time (when the booking actually happened).
 *
 * Usage:  node server/backfill_missed_schedules.js          (dry run — prints what would be sent)
 *         node server/backfill_missed_schedules.js --send   (actually sends to Facebook)
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { sendBatch, buildUserData } = require('./utils/facebookConversions');

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey);

async function run() {
  const send = process.argv.includes('--send');
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  let { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, phone, email, postcode, status, date_booked, booked_at, fbc, fbp, fb_client_ip, fb_user_agent')
    .gte('booked_at', sevenDaysAgo)
    .is('deleted_at', null)
    .order('booked_at', { ascending: true });

  if (error) {
    // If the fbc/fbp columns don't exist yet, retry without them
    console.warn('Retrying without fb columns:', error.message);
    const retry = await supabase
      .from('leads')
      .select('id, name, phone, email, postcode, status, date_booked, booked_at')
      .gte('booked_at', sevenDaysAgo)
      .is('deleted_at', null)
      .order('booked_at', { ascending: true });
    if (retry.error) throw new Error(retry.error.message);
    leads = retry.data;
  }

  const rows = leads || [];
  console.log(`Bookings made in last 7 days: ${rows.length}`);

  const events = rows
    .filter(l => l.booked_at && new Date(l.booked_at).getTime() <= now)
    .map(l => ({
      event_name: 'Schedule',
      event_time: Math.floor(new Date(l.booked_at).getTime() / 1000),
      action_source: 'system_generated',
      event_id: `Schedule_${l.id}_bf`,
      user_data: buildUserData(l),
      custom_data: {
        content_name: 'Appointment Booking',
        appointment_date: l.date_booked || null,
      },
    }));

  console.log(`Schedule events ready: ${events.length}`);
  for (const l of rows.slice(0, 10)) {
    console.log(`  e.g. ${l.name} — booked_at ${l.booked_at}, appt ${l.date_booked}`);
  }

  if (!send) {
    console.log('\nDRY RUN — nothing sent. Re-run with --send to upload to Facebook.');
    return;
  }

  const result = await sendBatch(events);
  console.log(`\nSent: ${result.sent}, Errors: ${result.errors}`);
  console.log('Check Meta Events Manager > Data Sources > your pixel > Overview.');
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
