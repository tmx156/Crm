/**
 * Export all cancelled bookings to a CSV file
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
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  // If value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

// Helper function to format date
function formatDate(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return dateString;
  }
}

async function exportCancelledBookings() {
  console.log('📊 Exporting cancelled bookings to CSV...\n');
  console.log('='.repeat(80));

  try {
    // Get all cancelled leads
    let cancelledLeads;
    
    try {
      cancelledLeads = await dbManager.query('leads', {
        select: '*',
        eq: { status: 'Cancelled' },
        is: { deleted_at: null }
      });
    } catch (queryError) {
      console.log('⚠️  dbManager query failed, trying direct Supabase query...');
      const { data, error: fetchError } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'Cancelled')
        .is('deleted_at', null);
      
      if (fetchError) {
        throw fetchError;
      }
      cancelledLeads = data || [];
    }

    console.log(`\n📊 Found ${cancelledLeads.length} cancelled bookings\n`);

    if (cancelledLeads.length === 0) {
      console.log('   No cancelled bookings found.\n');
      return;
    }

    // Get booker names for all leads
    const bookerIds = [...new Set(cancelledLeads.map(lead => lead.booker_id).filter(Boolean))];
    let bookersMap = {};
    
    if (bookerIds.length > 0) {
      try {
        const { data: bookers, error: bookersError } = await supabase
          .from('users')
          .select('id, name')
          .in('id', bookerIds);
        
        if (!bookersError && bookers) {
          bookers.forEach(booker => {
            bookersMap[booker.id] = booker.name;
          });
        }
      } catch (e) {
        console.warn('⚠️  Could not fetch booker names:', e.message);
      }
    }

    // Prepare CSV data
    const csvRows = [];
    
    // CSV Header
    const headers = [
      'ID',
      'Name',
      'Email',
      'Phone',
      'Postcode',
      'Age',
      'Status',
      'Booking Status',
      'Date Booked',
      'Time Booked',
      'Booker',
      'Cancellation Reason',
      'Is Confirmed',
      'Has Sale',
      'Created At',
      'Updated At',
      'Notes'
    ];
    csvRows.push(headers.map(escapeCSV).join(','));

    // CSV Rows
    cancelledLeads.forEach(lead => {
      const row = [
        lead.id || '',
        lead.name || '',
        lead.email || '',
        lead.phone || '',
        lead.postcode || '',
        lead.age || '',
        lead.status || '',
        lead.booking_status || '',
        lead.date_booked ? formatDate(lead.date_booked) : '',
        lead.time_booked || '',
        lead.booker_id ? (bookersMap[lead.booker_id] || lead.booker_id) : '',
        lead.cancellation_reason || '',
        lead.is_confirmed ? 'Yes' : 'No',
        lead.has_sale ? 'Yes' : 'No',
        lead.created_at ? formatDate(lead.created_at) : '',
        lead.updated_at ? formatDate(lead.updated_at) : '',
        lead.notes || ''
      ];
      csvRows.push(row.map(escapeCSV).join(','));
    });

    // Write to CSV file
    const csvContent = csvRows.join('\n');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `cancelled_bookings_${timestamp}.csv`;
    const filepath = path.join(__dirname, '..', filename);

    fs.writeFileSync(filepath, csvContent, 'utf8');

    console.log('✅ CSV file created successfully!');
    console.log(`📁 File: ${filename}`);
    console.log(`📂 Path: ${filepath}`);
    console.log(`📊 Total records: ${cancelledLeads.length}\n`);

    // Show summary
    console.log('📋 Summary:');
    console.log('='.repeat(80));
    console.log(`   Total cancelled bookings: ${cancelledLeads.length}`);
    
    const withDateBooked = cancelledLeads.filter(l => l.date_booked).length;
    const withCancellationReason = cancelledLeads.filter(l => l.cancellation_reason).length;
    const withNotes = cancelledLeads.filter(l => l.notes).length;
    
    console.log(`   With booking date: ${withDateBooked}`);
    console.log(`   With cancellation reason: ${withCancellationReason}`);
    console.log(`   With notes: ${withNotes}\n`);

  } catch (error) {
    console.error('\n❌ Export failed:', error);
    console.error('Details:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  exportCancelledBookings()
    .then(() => {
      console.log('✅ Export completed\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('Export failed:', error);
      process.exit(1);
    });
}

module.exports = { exportCancelledBookings };

