/**
 * Export all leads (CRM + Legacy) to CSV formatted for Facebook Audience
 * Facebook Audience format: Email, Phone, First Name, Last Name, City, State, Country, Date of Birth
 */

const dbManager = require('./database-connection-manager');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const config = require('./config');
const supabaseUrl = config.supabase.url || process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || config.supabase.serviceRoleKey || config.supabase.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to escape CSV values
function escapeCSV(value) {
  if (value === null || value === undefined || value === '') return '';
  const stringValue = String(value).trim();
  if (stringValue === '') return '';
  // If value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

// Helper function to split name into first and last name
function splitName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { firstName: '', lastName: '' };
  }
  
  const nameParts = fullName.trim().split(/\s+/);
  
  if (nameParts.length === 0) {
    return { firstName: '', lastName: '' };
  } else if (nameParts.length === 1) {
    return { firstName: nameParts[0], lastName: '' };
  } else {
    // First name is first part, last name is everything else
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');
    return { firstName, lastName };
  }
}

// Helper function to format phone number for Facebook (add country code if missing)
function formatPhoneForFacebook(phone) {
  if (!phone) return '';
  
  let cleaned = phone.toString().trim().replace(/\s+/g, '');
  
  // Remove common separators
  cleaned = cleaned.replace(/[-\s()]/g, '');
  
  // If starts with 0, replace with +44 (UK)
  if (cleaned.startsWith('0')) {
    cleaned = '+44' + cleaned.substring(1);
  }
  // If doesn't start with +, add +44 (assuming UK)
  else if (!cleaned.startsWith('+')) {
    // If it's already 11 digits starting with 44, add +
    if (cleaned.length === 11 && cleaned.startsWith('44')) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 10) {
      // Assume UK number, add +44
      cleaned = '+44' + cleaned;
    } else {
      // Just add +44 prefix
      cleaned = '+44' + cleaned;
    }
  }
  
  return cleaned;
}

// Helper function to calculate date of birth from age (approximate)
function calculateDOBFromAge(age) {
  if (!age || isNaN(age)) return '';
  
  const ageNum = parseInt(age);
  if (ageNum < 1 || ageNum > 120) return '';
  
  // Use January 1st as the date, current year minus age
  const currentYear = new Date().getFullYear();
  const birthYear = currentYear - ageNum;
  
  // Facebook expects YYYY-MM-DD format
  return `${birthYear}-01-01`;
}

// Helper function to get city from postcode (basic UK postcode parsing)
function getCityFromPostcode(postcode) {
  if (!postcode) return '';
  
  // UK postcodes: first part before space gives area
  // For Facebook, we'll just use the postcode area or return empty
  // You might want to use a postcode lookup API for actual city names
  const parts = postcode.trim().split(/\s+/);
  if (parts.length > 0) {
    // Return the outward code (first part) - this is a basic approach
    // For production, use a proper postcode-to-city API
    return parts[0];
  }
  
  return '';
}

async function exportAllLeadsForFacebook() {
  console.log('📊 Exporting all leads (CRM + Legacy) for Facebook Audience...\n');
  console.log('='.repeat(80));

  try {
    // Fetch all current CRM leads
    console.log('📋 Fetching current CRM leads...');
    let crmLeads = [];
    
    try {
      crmLeads = await dbManager.query('leads', {
        select: '*',
        is: { deleted_at: null }
      });
    } catch (queryError) {
      console.log('⚠️  dbManager query failed, trying direct Supabase query...');
      const { data, error: fetchError } = await supabase
        .from('leads')
        .select('*')
        .is('deleted_at', null);
      
      if (fetchError) {
        throw fetchError;
      }
      crmLeads = data || [];
    }
    
    console.log(`✅ Found ${crmLeads.length} current CRM leads`);

    // Fetch all legacy leads with pagination
    console.log('\n📜 Fetching legacy leads...');
    const allLegacyLeads = [];
    const batchSize = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: batch, error } = await supabase
        .from('legacy_leads')
        .select('id, name, phone, email, postcode, age, image_url, import_timestamp')
        .eq('import_status', 'imported')
        .range(from, from + batchSize - 1)
        .order('import_timestamp', { ascending: false });

      if (error) {
        console.error('❌ Error fetching legacy leads batch:', error.message);
        break;
      }

      if (!batch || batch.length === 0) {
        hasMore = false;
      } else {
        allLegacyLeads.push(...batch);
        from += batchSize;
        console.log(`   Fetched ${allLegacyLeads.length} legacy leads so far...`);

        // Safety check to prevent infinite loops
        if (from > 100000) {
          console.log('⚠️ Reached safety limit of 100,000 records');
          break;
        }
      }
    }

    console.log(`✅ Found ${allLegacyLeads.length} legacy leads`);

    // Combine all leads
    const allLeads = [...crmLeads, ...allLegacyLeads];
    console.log(`\n📊 Total leads to export: ${allLeads.length}`);

    if (allLeads.length === 0) {
      console.log('   No leads found to export.\n');
      return;
    }

    // Prepare CSV data for Facebook Audience
    // Facebook Audience format: Email, Phone, First Name, Last Name, City, State, Country, Date of Birth
    const csvRows = [];
    
    // CSV Header (Facebook Audience format)
    const headers = [
      'Email',
      'Phone',
      'First Name',
      'Last Name',
      'City',
      'State',
      'Country',
      'Date of Birth'
    ];
    csvRows.push(headers.map(escapeCSV).join(','));

    // Track statistics
    let withEmail = 0;
    let withPhone = 0;
    let withBoth = 0;
    let skipped = 0;

    // Process each lead
    allLeads.forEach(lead => {
      const email = lead.email ? lead.email.trim().toLowerCase() : '';
      const phone = formatPhoneForFacebook(lead.phone);
      const { firstName, lastName } = splitName(lead.name);
      const city = getCityFromPostcode(lead.postcode);
      const state = ''; // UK doesn't use states, leave empty
      const country = 'GB'; // UK country code
      const dob = calculateDOBFromAge(lead.age);

      // Facebook requires at least Email OR Phone
      if (!email && !phone) {
        skipped++;
        return; // Skip leads without email or phone
      }

      if (email) withEmail++;
      if (phone) withPhone++;
      if (email && phone) withBoth++;

      const row = [
        email,
        phone,
        firstName,
        lastName,
        city,
        state,
        country,
        dob
      ];
      
      csvRows.push(row.map(escapeCSV).join(','));
    });

    // Write to CSV file
    const csvContent = csvRows.join('\n');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `facebook_audience_all_leads_${timestamp}.csv`;
    const filepath = path.join(__dirname, '..', filename);

    fs.writeFileSync(filepath, csvContent, 'utf8');

    console.log('\n✅ CSV file created successfully!');
    console.log(`📁 File: ${filename}`);
    console.log(`📂 Path: ${filepath}`);
    console.log(`📊 Total records exported: ${csvRows.length - 1} (${allLeads.length - skipped} valid, ${skipped} skipped)`);
    console.log('\n📋 Export Statistics:');
    console.log('='.repeat(80));
    console.log(`   Total leads processed: ${allLeads.length}`);
    console.log(`   Leads with email: ${withEmail}`);
    console.log(`   Leads with phone: ${withPhone}`);
    console.log(`   Leads with both email & phone: ${withBoth}`);
    console.log(`   Leads skipped (no email or phone): ${skipped}`);
    console.log(`   Records exported: ${csvRows.length - 1}`);
    console.log('\n📝 Facebook Audience Format:');
    console.log('   - Email: Required for email matching');
    console.log('   - Phone: Required for phone matching (formatted with +44 for UK)');
    console.log('   - First Name / Last Name: Optional, helps with matching');
    console.log('   - City: Derived from postcode (basic)');
    console.log('   - Country: Set to GB (United Kingdom)');
    console.log('   - Date of Birth: Calculated from age (approximate)\n');

  } catch (error) {
    console.error('\n❌ Export failed:', error);
    console.error('Details:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  exportAllLeadsForFacebook()
    .then(() => {
      console.log('✅ Export completed\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('Export failed:', error);
      process.exit(1);
    });
}

module.exports = { exportAllLeadsForFacebook };



