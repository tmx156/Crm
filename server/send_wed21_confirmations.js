/**
 * Send booking confirmation EMAILS to all Wed 21st Jan leads
 * Run with: node server/send_wed21_confirmations.js
 * Run with: node server/send_wed21_confirmations.js --live (to actually send)
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Load environment and services
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Import messaging service
const MessagingService = require('./utils/messagingService');

// Admin user ID for sending
const ADMIN_USER_ID = '4864a1fe-4022-400d-84d9-cc3c72884445';

async function sendConfirmations(dryRun = true) {
  console.log('='.repeat(60));
  console.log('📧 SENDING BOOKING CONFIRMATION EMAILS');
  console.log(`🔍 Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE (sending emails)'}`);
  console.log('='.repeat(60));

  // Get all leads booked for Wed 21st Jan 2026
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, email, phone, date_booked, status')
    .eq('status', 'Booked')
    .gte('date_booked', '2026-01-21T00:00:00.000Z')
    .lt('date_booked', '2026-01-22T00:00:00.000Z')
    .order('date_booked', { ascending: true });

  if (error) {
    console.error('❌ Error fetching leads:', error.message);
    return;
  }

  console.log(`\n📋 Found ${leads.length} leads booked for Wed 21st Jan\n`);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const lead of leads) {
    const time = new Date(lead.date_booked).toISOString().slice(11, 16);
    process.stdout.write(`${time} | ${lead.name.padEnd(22)} | `);

    if (!lead.email) {
      console.log(`⏭️ No email address`);
      skipped++;
      continue;
    }

    console.log(`📧 ${lead.email}`);

    if (!dryRun) {
      try {
        // Use the Editorialco booking confirmation template
        const EDITORIALCO_TEMPLATE_ID = 'template-1760810690437-qdtz44y3d';

        await MessagingService.sendBookingConfirmation(
          lead.id,
          ADMIN_USER_ID,
          lead.date_booked,
          {
            sendEmail: true,
            sendSms: false,
            templateId: EDITORIALCO_TEMPLATE_ID
          }
        );
        console.log(`     ✅ Email sent`);
        sent++;

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.log(`     ❌ Failed: ${err.message}`);
        failed++;
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`📋 Total leads: ${leads.length}`);
  if (!dryRun) {
    console.log(`✅ Emails sent: ${sent}`);
    console.log(`⏭️ Skipped (no email): ${skipped}`);
    console.log(`❌ Failed: ${failed}`);
  } else {
    console.log(`📧 Leads with email: ${leads.filter(l => l.email).length}`);
    console.log(`⏭️ Leads without email: ${leads.filter(l => !l.email).length}`);
  }
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\n💡 This was a DRY RUN. To actually send emails, run:');
    console.log('   node server/send_wed21_confirmations.js --live\n');
  }
}

const isLive = process.argv.includes('--live');

sendConfirmations(!isLive)
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
