#!/usr/bin/env node

/**
 * Live Updates Audit Script
 * Comprehensive audit of real-time update system for dashboard
 */

const dbManager = require('./database-connection-manager');

async function auditLiveUpdates() {
  console.log('🔴 LIVE UPDATES AUDIT');
  console.log('=====================');

  try {
    // 1. Check recent booking activity
    console.log('📊 1. RECENT BOOKING ACTIVITY');
    console.log('==============================');

    const today = new Date().toISOString().split('T')[0];
    const last30Minutes = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    // Check for recent bookings
    const recentBookings = await dbManager.query('leads', {
      select: 'id, name, status, date_booked, created_at, updated_at, booker_id',
      gte: { updated_at: last30Minutes }
    });

    console.log(`📅 Bookings updated in last 30 minutes: ${recentBookings.length}`);

    if (recentBookings.length > 0) {
      console.log('📋 Recent booking changes:');
      recentBookings.forEach((booking, index) => {
        console.log(`${index + 1}. ${booking.name || 'Unknown'}`);
        console.log(`   Status: ${booking.status}`);
        console.log(`   Updated: ${booking.updated_at}`);
        console.log(`   Date booked: ${booking.date_booked}`);
        console.log(`   Booker ID: ${booking.booker_id}`);
        console.log('');
      });
    }

    // 2. Check today's total bookings vs what dashboard should show
    console.log('📊 2. DASHBOARD DATA VERIFICATION');
    console.log('==================================');

    const todaysBookings = await dbManager.query('leads', {
      select: 'id, name, status, date_booked, booker_id',
      gte: { date_booked: `${today}T00:00:00.000Z` },
      lte: { date_booked: `${today}T23:59:59.999Z` }
    });

    console.log(`📊 Total bookings for today: ${todaysBookings.length}`);

    // Group by booker
    const bookerGroups = {};
    todaysBookings.forEach(booking => {
      const bookerId = booking.booker_id || 'unassigned';
      if (!bookerGroups[bookerId]) {
        bookerGroups[bookerId] = [];
      }
      bookerGroups[bookerId].push(booking);
    });

    console.log('📈 Bookings by booker:');
    Object.entries(bookerGroups).forEach(([bookerId, bookings]) => {
      console.log(`   Booker ${bookerId}: ${bookings.length} bookings`);
      bookings.forEach((booking, idx) => {
        console.log(`      ${idx + 1}. ${booking.name} at ${booking.date_booked}`);
      });
    });

    // 3. Check socket.io setup
    console.log('\n📡 3. SOCKET.IO SYSTEM CHECK');
    console.log('=============================');

    // Check if global.io exists
    console.log(`🔌 Global IO object: ${global.io ? 'EXISTS' : 'NOT FOUND'}`);

    if (global.io) {
      console.log('✅ Socket.IO server appears to be initialized');
      console.log(`🔌 Engine type: ${global.io.engine ? 'Available' : 'Not available'}`);
    } else {
      console.log('❌ Socket.IO server not found in global scope');
      console.log('⚠️ Real-time updates will not work');
    }

    // 4. Check leads route for event emissions
    console.log('\n📡 4. EVENT EMISSION AUDIT');
    console.log('===========================');

    console.log('🔍 Checking leads route for event emissions...');

    // Read the leads route file to check for socket events
    const fs = require('fs');
    const path = require('path');

    try {
      const leadsRoutePath = path.join(__dirname, 'routes', 'leads.js');
      const leadsRouteContent = fs.readFileSync(leadsRoutePath, 'utf8');

      // Check for socket event emissions
      const hasGlobalIo = leadsRouteContent.includes('global.io');
      const hasEmit = leadsRouteContent.includes('.emit(');
      const hasLeadEvents = leadsRouteContent.includes('lead_') || leadsRouteContent.includes('booking_');

      console.log(`📡 Uses global.io: ${hasGlobalIo ? 'YES' : 'NO'}`);
      console.log(`📡 Has emit calls: ${hasEmit ? 'YES' : 'NO'}`);
      console.log(`📡 Has lead/booking events: ${hasLeadEvents ? 'YES' : 'NO'}`);

      if (hasGlobalIo && hasEmit) {
        console.log('✅ Leads route appears to emit socket events');
      } else {
        console.log('❌ Leads route may not be emitting socket events properly');
      }

      // Look for specific event names
      const eventMatches = leadsRouteContent.match(/\.emit\(['"`]([^'"`]+)['"`]/g);
      if (eventMatches) {
        console.log('📡 Socket events found:');
        eventMatches.forEach(match => {
          const eventName = match.match(/\.emit\(['"`]([^'"`]+)['"`]/)[1];
          console.log(`   - ${eventName}`);
        });
      }

    } catch (error) {
      console.log('❌ Could not read leads route file:', error.message);
    }

    // 5. Check dashboard socket subscription
    console.log('\n📱 5. DASHBOARD SOCKET SUBSCRIPTION');
    console.log('===================================');

    try {
      const dashboardPath = path.join(__dirname, '..', 'client', 'src', 'pages', 'Dashboard.js');
      const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');

      const hasSocketContext = dashboardContent.includes('useSocket');
      const hasSubscription = dashboardContent.includes('subscribeToStatsUpdates');
      const hasSocketEffect = dashboardContent.includes('useEffect') && dashboardContent.includes('subscribe');

      console.log(`📱 Uses socket context: ${hasSocketContext ? 'YES' : 'NO'}`);
      console.log(`📱 Has stats subscription: ${hasSubscription ? 'YES' : 'NO'}`);
      console.log(`📱 Has socket useEffect: ${hasSocketEffect ? 'YES' : 'NO'}`);

      if (hasSocketContext && hasSubscription) {
        console.log('✅ Dashboard appears to subscribe to socket updates');
      } else {
        console.log('❌ Dashboard may not be properly subscribing to socket updates');
      }

    } catch (error) {
      console.log('❌ Could not read dashboard file:', error.message);
    }

    // 6. Check SocketContext implementation
    console.log('\n🔌 6. SOCKET CONTEXT CHECK');
    console.log('===========================');

    try {
      const contextPath = path.join(__dirname, '..', 'client', 'src', 'context', 'SocketContext.js');
      const contextContent = fs.readFileSync(contextPath, 'utf8');

      const hasStatsUpdates = contextContent.includes('subscribeToStatsUpdates');
      const hasEmitListeners = contextContent.includes('on(') || contextContent.includes('addEventListener');

      console.log(`🔌 Has subscribeToStatsUpdates: ${hasStatsUpdates ? 'YES' : 'NO'}`);
      console.log(`🔌 Has event listeners: ${hasEmitListeners ? 'YES' : 'NO'}`);

      // Look for event listeners
      const listenerMatches = contextContent.match(/\.on\(['"`]([^'"`]+)['"`]/g);
      if (listenerMatches) {
        console.log('🔌 Socket listeners found:');
        listenerMatches.forEach(match => {
          const eventName = match.match(/\.on\(['"`]([^'"`]+)['"`]/)[1];
          console.log(`   - ${eventName}`);
        });
      }

    } catch (error) {
      console.log('❌ Could not read socket context file:', error.message);
    }

    // 7. Recommendations
    console.log('\n💡 7. LIVE UPDATE RECOMMENDATIONS');
    console.log('===================================');

    console.log('Based on the audit, here are the issues and fixes needed:');
    console.log('');

    if (!global.io) {
      console.log('❌ CRITICAL: Socket.IO server not initialized');
      console.log('   Fix: Ensure server.js properly initializes Socket.IO');
    }

    console.log('🔧 Required fixes for robust live updates:');
    console.log('1. Verify Socket.IO server is running');
    console.log('2. Ensure booking creation emits socket events');
    console.log('3. Check dashboard properly subscribes to events');
    console.log('4. Add heartbeat/ping system for reliability');
    console.log('5. Add connection status indicators');
    console.log('6. Implement automatic reconnection');

    console.log('\n📊 CURRENT DATA SUMMARY');
    console.log('========================');
    console.log(`📅 Total bookings today: ${todaysBookings.length}`);
    console.log(`📅 Recent changes (30min): ${recentBookings.length}`);
    console.log(`👥 Active bookers: ${Object.keys(bookerGroups).filter(id => id !== 'unassigned').length}`);

  } catch (error) {
    console.error('❌ Audit failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the audit
if (require.main === module) {
  auditLiveUpdates();
}

module.exports = auditLiveUpdates;