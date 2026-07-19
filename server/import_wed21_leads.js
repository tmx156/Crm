/**
 * Book existing leads for Wednesday 21st January 2026
 * Run with: node server/import_wed21_leads.js
 * Run with: node server/import_wed21_leads.js --live (to actually update)
 * Run with: node server/import_wed21_leads.js --live --sms (to update AND send SMS confirmations)
 */

const { createClient } = require('@supabase/supabase-js');

// Supabase config
const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

// Base date: Wednesday 21st January 2026
const BASE_DATE = '2026-01-21';

// Leads data parsed from the sheet
const leadsData = [
  { time: '11:00', name: 'Julia Smeeton', phone: '07714 248552' },
  { time: '11:15', name: 'Sulekha Gass', phone: '07394165717' },
  { time: '11:30', name: 'Joanne Harrison', phone: '07402476808' },
  { time: '12:00', name: 'Snjezana Solar', phone: '07413782129' },
  { time: '12:00', name: 'Ian Wilkinson', phone: '07958054402' },
  { time: '12:15', name: 'Angela Coll', phone: '07702100213' },
  { time: '12:15', name: 'Joanne Frost', phone: '07968300923' },
  { time: '12:30', name: 'Noel', phone: '07470485583' },
  { time: '12:30', name: 'Jeanette Hemmings', phone: '07392366555' },
  { time: '12:45', name: 'Nicola Smythe', phone: '07719552405' },
  { time: '12:45', name: 'Karen Peall', phone: '447583986709' },
  { time: '13:00', name: 'Angela Storto', phone: '07474112444' },
  { time: '13:00', name: 'Susie Davies', phone: '07919411114' },
  { time: '13:15', name: 'Marina Katsika', phone: '7711184874' },
  { time: '13:15', name: 'Jules Spencer', phone: '+19176479321' },
  { time: '13:30', name: 'Sarah Allen', phone: '07946721970' },
  { time: '13:30', name: 'Ian Griffiths', phone: '7914 140595' },
  { time: '13:45', name: 'Brenda Nurse', phone: '7940352991' },
  { time: '13:45', name: 'Geoff Pinder', phone: '+447540556178' },
  { time: '14:00', name: 'Mike Cattlin', phone: '07925679320' },
  { time: '14:00', name: 'Hamza Eslam', phone: '07467203039' },
  { time: '14:15', name: 'Lisa Cartwright', phone: '07867965957' },
  { time: '14:15', name: 'Christine Mullen', phone: '07725629782' },
  { time: '14:30', name: 'Ruth Beach', phone: '07805579966' },
  { time: '14:30', name: 'Inês Castanho', phone: '+447954951069' },
  { time: '14:45', name: 'Paul Martin', phone: '07821 982282' },
  { time: '15:00', name: 'Victoria Newcombe', phone: '07902046630' },
  { time: '15:30', name: 'Shaun Coe', phone: '7803339419' },
  { time: '15:30', name: 'Lisa Ward', phone: '07761201957' },
  { time: '16:00', name: 'Lawrence Mullaney', phone: '07899902565' },
  { time: '16:00', name: 'Abbie Lee', phone: '07754907852' },
  { time: '16:15', name: 'Tracey Almond', phone: '07816749426' },
  { time: '16:30', name: 'Mandy Forrest', phone: '07561393608' },
  { time: '16:45', name: 'Lynn Fallon', phone: '07940365539' },
  { time: '16:45', name: 'Florent Fafiga', phone: '07850116777' },
  { time: '17:00', name: 'Sarah Evans', phone: '07756748700' },
  { time: '17:00', name: 'Russ Booth', phone: '07887574599' },
];

// Create datetime from time string
function createDateTime(timeStr) {
  return `${BASE_DATE}T${timeStr.padStart(5, '0')}:00.000Z`;
}

// Clean phone for comparison (remove all non-digits)
function cleanPhone(phone) {
  if (!phone) return '';
  return phone.replace(/[^\d]/g, '');
}

// Find lead by phone first (most reliable), then by name
async function findLead(name, phone) {
  const cleanedPhone = cleanPhone(phone);
  const last6 = cleanedPhone.length >= 6 ? cleanedPhone.slice(-6) : cleanedPhone;

  // FIRST: Try phone match (most reliable)
  if (last6.length >= 6) {
    const { data: byPhone } = await supabase
      .from('leads')
      .select('id, name, phone, status, date_booked, booker_id')
      .ilike('phone', `%${last6}%`)
      .limit(10);

    if (byPhone && byPhone.length > 0) {
      // Find exact phone match
      for (const lead of byPhone) {
        const leadClean = cleanPhone(lead.phone);
        if (leadClean.slice(-6) === last6 || leadClean === cleanedPhone) {
          return lead;
        }
      }
    }
  }

  // SECOND: Try exact name match
  const { data: exactName } = await supabase
    .from('leads')
    .select('id, name, phone, status, date_booked, booker_id')
    .ilike('name', name)
    .limit(1);

  if (exactName && exactName.length > 0) {
    return exactName[0];
  }

  // THIRD: Try partial name match (first name + last name)
  const nameParts = name.split(' ');
  if (nameParts.length >= 2) {
    const { data: partialName } = await supabase
      .from('leads')
      .select('id, name, phone, status, date_booked, booker_id')
      .ilike('name', `%${nameParts[0]}%${nameParts[nameParts.length - 1]}%`)
      .limit(5);

    if (partialName && partialName.length > 0) {
      const bestMatch = partialName.find(l =>
        l.name.toLowerCase().includes(nameParts[0].toLowerCase()) &&
        l.name.toLowerCase().includes(nameParts[nameParts.length - 1].toLowerCase())
      );
      if (bestMatch) return bestMatch;
    }

    // Try last name only
    const { data: lastName } = await supabase
      .from('leads')
      .select('id, name, phone, status, date_booked, booker_id')
      .ilike('name', `%${nameParts[nameParts.length - 1]}%`)
      .limit(10);

    if (lastName && lastName.length > 0) {
      // Match by phone if possible
      for (const lead of lastName) {
        const leadClean = cleanPhone(lead.phone);
        if (leadClean.slice(-6) === last6) {
          return lead;
        }
      }
    }
  }

  // FOURTH: Try first name only for single-name entries like "Noel"
  if (nameParts.length === 1) {
    const { data: firstName } = await supabase
      .from('leads')
      .select('id, name, phone, status, date_booked, booker_id')
      .ilike('name', `${name}%`)
      .limit(5);

    if (firstName && firstName.length > 0) {
      const exactMatch = firstName.find(l => l.name.toLowerCase() === name.toLowerCase());
      if (exactMatch) return exactMatch;
      // Match by phone
      for (const lead of firstName) {
        const leadClean = cleanPhone(lead.phone);
        if (leadClean.slice(-6) === last6) {
          return lead;
        }
      }
      return firstName[0];
    }
  }

  return null;
}

async function bookLeads(dryRun = true, sendSms = false) {
  console.log('='.repeat(60));
  console.log(`📅 BOOKING LEADS FOR WEDNESDAY 21st JANUARY 2026`);
  console.log(`🔍 Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE (updating database)'}`);
  if (!dryRun && sendSms) {
    console.log(`📱 SMS: Will send booking confirmations`);
  }
  console.log('='.repeat(60));
  console.log(`\n📋 Total leads to process: ${leadsData.length}\n`);

  let found = 0;
  let notFound = 0;
  let updated = 0;
  let smsSent = 0;
  const notFoundList = [];
  const foundList = [];

  for (const lead of leadsData) {
    const dateBooked = createDateTime(lead.time);

    process.stdout.write(`${lead.time} | ${lead.name.padEnd(20)} | `);

    const existingLead = await findLead(lead.name, lead.phone);

    if (existingLead) {
      found++;
      foundList.push({ ...lead, dbId: existingLead.id, dbName: existingLead.name });
      console.log(`✅ Found: ${existingLead.name}`);

      if (!dryRun) {
        // Use admin user ID for the update (mel@crm.com)
        const ADMIN_USER_ID = '4864a1fe-4022-400d-84d9-cc3c72884445';

        // First check if lead has a booker_id, if not set it
        const updateData = {
          status: 'Booked',
          date_booked: dateBooked,
          updated_at: new Date().toISOString(),
          booked_at: new Date().toISOString(),
          updated_by_user_id: ADMIN_USER_ID
        };

        // Set booker_id if not already set (required for activity log trigger)
        if (!existingLead.booker_id) {
          updateData.booker_id = ADMIN_USER_ID;
        }

        const { error } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', existingLead.id);

        if (error) {
          console.log(`     ❌ Update failed: ${error.message}`);
        } else {
          console.log(`     📅 Booked for ${lead.time} on Wed 21st Jan`);
          updated++;

          // Send SMS if requested
          if (sendSms && existingLead.phone) {
            try {
              // Call the booking confirmation endpoint
              const response = await fetch(`http://localhost:5000/api/leads/${existingLead.id}/send-booking-confirmation`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  // Note: This requires a valid auth token - we'll handle this differently
                },
                body: JSON.stringify({
                  appointmentDate: dateBooked,
                  sendEmail: false,
                  sendSms: true
                })
              });
              if (response.ok) {
                console.log(`     📱 SMS confirmation sent`);
                smsSent++;
              }
            } catch (smsErr) {
              console.log(`     ⚠️ SMS skipped (server not running or auth needed)`);
            }
          }
        }
      }
    } else {
      notFound++;
      notFoundList.push({ name: lead.name, phone: lead.phone, time: lead.time });
      console.log(`❌ NOT FOUND`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Found in CRM: ${found}`);
  console.log(`❌ Not found: ${notFound}`);
  if (!dryRun) {
    console.log(`📅 Bookings updated: ${updated}`);
    if (sendSms) {
      console.log(`📱 SMS sent: ${smsSent}`);
    }
  }

  if (notFoundList.length > 0) {
    console.log('\n⚠️  LEADS NOT FOUND IN CRM:');
    notFoundList.forEach(l => {
      console.log(`   - ${l.name} (${l.phone}) @ ${l.time}`);
    });
  }

  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\n💡 This was a DRY RUN. To actually update the database, run:');
    console.log('   node server/import_wed21_leads.js --live');
    console.log('\n💡 To update AND send SMS confirmations:');
    console.log('   node server/import_wed21_leads.js --live --sms\n');
  }

  return { found, notFound, updated, smsSent, notFoundList, foundList };
}

// Check for flags
const isLive = process.argv.includes('--live');
const sendSms = process.argv.includes('--sms');

bookLeads(!isLive, sendSms)
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
