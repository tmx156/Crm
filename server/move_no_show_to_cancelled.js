/**
 * Move all bookings with "No Show" status to "Cancelled" status
 * Only applies to bookings that have the "cancelled" tag
 */

const dbManager = require('./database-connection-manager');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const config = require('./config');
const supabaseUrl = config.supabase.url || process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || config.supabase.serviceRoleKey || config.supabase.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

async function moveNoShowToCancelled() {
  console.log('🔄 Moving "No Show" bookings with "cancelled" tag to "Cancelled" status\n');
  console.log('='.repeat(80));

  try {
    // First, find all leads with "No Show" status using dbManager
    // This includes both booking_status = 'No Show' and status = 'No Show'
    let noShowLeads;
    
    try {
      // Try to get all leads with No Show status
      const leadsWithBookingStatus = await dbManager.query('leads', {
        select: '*',
        eq: { booking_status: 'No Show' },
        is: { deleted_at: null }
      });
      
      const leadsWithStatus = await dbManager.query('leads', {
        select: '*',
        eq: { status: 'No Show' },
        is: { deleted_at: null }
      });
      
      // Combine and deduplicate
      const allLeads = [...(leadsWithBookingStatus || []), ...(leadsWithStatus || [])];
      const uniqueLeads = Array.from(new Map(allLeads.map(lead => [lead.id, lead])).values());
      noShowLeads = uniqueLeads;
    } catch (queryError) {
      // If dbManager fails, try direct Supabase query
      console.log('⚠️  dbManager query failed, trying direct Supabase query...');
      const { data, error: fetchError } = await supabase
        .from('leads')
        .select('*')
        .or('booking_status.eq.No Show,status.eq.No Show')
        .is('deleted_at', null);
      
      if (fetchError) {
        throw fetchError;
      }
      noShowLeads = data || [];
    }

    console.log(`\n📊 Found ${noShowLeads.length} leads with "No Show" status\n`);

    if (noShowLeads.length === 0) {
      console.log('   No "No Show" bookings found.\n');
      return;
    }

    // Filter to only those with "cancelled" tag (case-insensitive)
    const leadsToUpdate = noShowLeads.filter(lead => {
      // Check if tags field exists
      if (!lead.tags && lead.tags !== null && lead.tags !== undefined) {
        return false;
      }
      
      // Handle null or empty tags
      if (!lead.tags) return false;
      
      try {
        const tags = typeof lead.tags === 'string' ? JSON.parse(lead.tags) : lead.tags;
        if (!Array.isArray(tags)) return false;
        
        // Check if any tag matches "cancelled" (case-insensitive)
        return tags.some(tag => tag && tag.toString().toLowerCase() === 'cancelled');
      } catch (e) {
        // If parsing fails, it's not a valid tags field
        return false;
      }
    });

    console.log(`\n🏷️  Found ${leadsToUpdate.length} "No Show" bookings with "cancelled" tag\n`);

    if (leadsToUpdate.length === 0) {
      console.log('   No bookings with "cancelled" tag found.\n');
      return;
    }

    // Show what will be updated
    console.log('📋 Bookings to be moved to "Cancelled":');
    console.log('='.repeat(80));
    leadsToUpdate.forEach((lead, index) => {
      const tags = typeof lead.tags === 'string' ? JSON.parse(lead.tags) : lead.tags;
      const dateStr = lead.date_booked ? new Date(lead.date_booked).toLocaleDateString('en-GB') : 'No date';
      console.log(`\n${index + 1}. ${lead.name}${lead.email ? ` (${lead.email})` : ''}`);
      console.log(`   Current Status: ${lead.status}`);
      console.log(`   Booking Status: ${lead.booking_status || 'N/A'}`);
      console.log(`   Tags: ${Array.isArray(tags) ? tags.join(', ') : 'N/A'}`);
      console.log(`   Date Booked: ${dateStr}`);
    });

    // Ask for confirmation
    console.log('\n' + '='.repeat(80));
    console.log(`\n⚠️  This will update ${leadsToUpdate.length} booking(s) to "Cancelled" status.`);
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');

    // Wait 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('✅ Proceeding with update...\n');

    // Update each lead
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let i = 0; i < leadsToUpdate.length; i++) {
      const lead = leadsToUpdate[i];
      
      try {
        // Try using dbManager first, fallback to direct Supabase
        let updateError = null;
        try {
          await dbManager.update('leads', {
            status: 'Cancelled',
            booking_status: null, // Clear booking_status
            cancellation_reason: 'Moved from No Show (had cancelled tag)',
            updated_at: new Date().toISOString()
          }, { id: lead.id });
        } catch (dbError) {
          // Fallback to direct Supabase update
          const result = await supabase
            .from('leads')
            .update({
              status: 'Cancelled',
              booking_status: null,
              cancellation_reason: 'Moved from No Show (had cancelled tag)',
              updated_at: new Date().toISOString()
            })
            .eq('id', lead.id);
          
          if (result.error) {
            updateError = result.error;
          }
        }
        
        if (updateError) {
          throw updateError;
        }

        if (updateError) {
          throw updateError;
        }

        successCount++;
        console.log(`✅ ${i + 1}/${leadsToUpdate.length} - Updated: ${lead.name}`);
      } catch (error) {
        errorCount++;
        errors.push({ lead: lead.name, error: error.message });
        console.log(`❌ ${i + 1}/${leadsToUpdate.length} - Failed: ${lead.name} - ${error.message}`);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('UPDATE COMPLETE');
    console.log('='.repeat(80));
    console.log(`✅ Successfully updated: ${successCount} booking(s)`);
    console.log(`❌ Failed: ${errorCount} booking(s)`);

    if (errors.length > 0) {
      console.log('\nErrors encountered:');
      errors.forEach(({ lead, error }) => {
        console.log(`  - ${lead}: ${error}`);
      });
    }

    console.log('\n');

  } catch (error) {
    console.error('\n❌ Operation failed:', error);
    console.error('Details:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  moveNoShowToCancelled()
    .then(() => {
      console.log('✅ Operation completed\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('Operation failed:', error);
      process.exit(1);
    });
}

module.exports = { moveNoShowToCancelled };

