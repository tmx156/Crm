#!/usr/bin/env node

/**
 * Manually delete the test bookings I created
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

async function deleteTestBookingsManually() {
  console.log('🗑️ DELETING TEST BOOKINGS MANUALLY');
  console.log('===================================');

  try {
    // IDs of test bookings to delete
    const testBookingIds = [
      '4c75312a-5fc7-404e-95ec-f252fe6153c9', // Test Real-Time Update Lead
      '09893713-3b96-47c1-a4d4-2953026c55a2', // Second Real-Time Test Lead
      'c77790f6-3182-40e0-9768-2cb06f3a6599'  // Third Dashboard Test Lead
    ];

    console.log(`🎯 Deleting ${testBookingIds.length} test bookings...`);

    for (const id of testBookingIds) {
      console.log(`🗑️ Deleting booking ID: ${id}`);

      const { data, error } = await supabase
        .from('leads')
        .delete()
        .eq('id', id);

      if (error) {
        console.error(`❌ Failed to delete ${id}:`, error);
      } else {
        console.log(`✅ Successfully deleted ${id}`);
      }
    }

    // Verify deletion
    console.log('\n🔍 VERIFYING DELETION...');

    const today = new Date().toISOString().split('T')[0];
    const { data: remainingBookings, error } = await supabase
      .from('leads')
      .select('*')
      .gte('date_booked', `${today}T00:00:00.000Z`)
      .lte('date_booked', `${today}T23:59:59.999Z`);

    if (error) {
      console.error('❌ Verification failed:', error);
      return;
    }

    console.log(`📊 Remaining bookings for today: ${remainingBookings.length}`);

    // Check if any test bookings remain
    const remainingTestBookings = remainingBookings.filter(booking =>
      booking.name.includes('Test Real-Time') ||
      booking.name.includes('Real-Time Update') ||
      booking.name.includes('Dashboard Test')
    );

    if (remainingTestBookings.length === 0) {
      console.log('✅ All test bookings successfully deleted!');
    } else {
      console.log(`❌ ${remainingTestBookings.length} test bookings still remain`);
      remainingTestBookings.forEach(booking => {
        console.log(`   - ${booking.name} (${booking.id})`);
      });
    }

    console.log('\n🎯 EXPECTED DASHBOARD UPDATE:');
    console.log('=============================');
    console.log(`📊 "Total Bookings Today Since midnight" should now show: ${remainingBookings.length}`);
    console.log(`📊 "DAILY ADMIN ACTIVITY DASHBOARD" should now show: ${remainingBookings.length}`);
    console.log('🔄 Dashboard should automatically refresh with socket events');

  } catch (error) {
    console.error('❌ Manual deletion failed:', error);
  }
}

// Run the deletion
if (require.main === module) {
  deleteTestBookingsManually();
}

module.exports = deleteTestBookingsManually;