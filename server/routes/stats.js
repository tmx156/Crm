const express = require('express');
const { auth } = require('../middleware/auth');
const dbManager = require('../database-connection-manager');

const router = express.Router();

// @route   GET /api/stats/leads-public
// @desc    Get lead status counts for dashboard (temporary fix for authentication issue)
// @access  Public (temporary)
router.get('/leads-public', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    console.log('📊 PUBLIC STATS API: Dashboard requesting booking stats');
    console.log(`📅 Date range: ${startDate} to ${endDate}`);

    let queryOptions = {
      select: 'id, status, created_at, booker_id, date_booked'
    };

    // Apply date filters using created_at for daily booking activity
    if (startDate && endDate) {
      queryOptions.gte = { created_at: startDate };
      queryOptions.lte = { created_at: endDate };
      console.log(`📅 Public stats filtering by booking creation date: ${startDate} to ${endDate}`);
    }

    // Get all leads to calculate counts
    const leads = await dbManager.query('leads', queryOptions);

    // Calculate counts from the leads data
    const total = leads.length;
    const statusCounts = {
      new: leads.filter(lead => lead.status === 'New').length,
      booked: leads.filter(lead => lead.status === 'Booked').length,
      attended: leads.filter(lead => lead.status === 'Attended').length,
      cancelled: leads.filter(lead => lead.status === 'Cancelled').length,
      assigned: leads.filter(lead => lead.status === 'Assigned').length,
      rejected: leads.filter(lead => lead.status === 'Rejected').length
    };

    const result = {
      total: total || 0,
      new: statusCounts.new || 0,
      booked: statusCounts.booked || 0,
      attended: statusCounts.attended || 0,
      cancelled: statusCounts.cancelled || 0,
      assigned: statusCounts.assigned || 0,
      rejected: statusCounts.rejected || 0
    };

    console.log(`📊 PUBLIC STATS RESULT: Found ${total} bookings`);
    res.json(result);
  } catch (error) {
    console.error('❌ Public stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// @route   GET /api/stats/leads
// @desc    Get lead status counts using database aggregation
// @access  Private
router.get('/leads', auth, async (req, res) => {
  try {
    // Parse filters from query - support both old and new parameter names
    const { startDate, endDate, userId, created_at_start, created_at_end, assigned_at_start, assigned_at_end } = req.query;

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin') {
      console.log(`🔒 Stats filtering: User ${req.user.name} (${req.user.role}) can only see stats for their assigned leads`);
    } else {
      console.log(`👑 Admin stats access: User ${req.user.name} can see all lead stats`);
    }

    // Build query options for role-based filtering (same as leads endpoint)
    let queryOptions = {
      select: 'id, status, created_at, booker_id, assigned_at'
    };

    // Apply role-based filtering
    if (req.user.role !== 'admin') {
      queryOptions.eq = { booker_id: req.user.id };
    }

    // Apply date filters - support both created_at and assigned_at
    // Prioritize new parameter names over old ones
    const useCreatedAt = created_at_start && created_at_end;
    const useAssignedAt = assigned_at_start && assigned_at_end;
    const useLegacy = !useCreatedAt && !useAssignedAt && startDate && endDate;

    if (useCreatedAt) {
      queryOptions.gte = { created_at: created_at_start };
      queryOptions.lte = { created_at: created_at_end };
      console.log(`📅 Stats filtering by creation date: ${created_at_start} to ${created_at_end}`);
    } else if (useAssignedAt) {
      queryOptions.gte = { assigned_at: assigned_at_start };
      queryOptions.lte = { assigned_at: assigned_at_end };
      console.log(`📅 Stats filtering by assignment date: ${assigned_at_start} to ${assigned_at_end}`);
    } else if (useLegacy) {
      queryOptions.gte = { created_at: startDate };
      queryOptions.lte = { created_at: endDate };
      console.log(`📅 Stats filtering by creation date (legacy): ${startDate} to ${endDate}`);
    }

    // Apply user filter (booker) - only for admins
    if (userId && userId !== 'all' && req.user.role === 'admin') {
      queryOptions.eq = { ...queryOptions.eq, booker_id: userId };
    }

    // Get all leads to calculate counts (using same method as leads endpoint)
    const leads = await dbManager.query('leads', queryOptions);

    // Calculate counts from the leads data
    const total = leads.length;
    const statusCounts = {
      new: leads.filter(lead => lead.status === 'New').length,
      booked: leads.filter(lead => lead.status === 'Booked').length,
      attended: leads.filter(lead => lead.status === 'Attended').length,
      cancelled: leads.filter(lead => lead.status === 'Cancelled').length,
      assigned: leads.filter(lead => lead.status === 'Assigned').length,
      rejected: leads.filter(lead => lead.status === 'Rejected').length
    };

    const result = {
      total: total || 0,
      new: statusCounts.new || 0,
      booked: statusCounts.booked || 0,
      attended: statusCounts.attended || 0,
      cancelled: statusCounts.cancelled || 0,
      assigned: statusCounts.assigned || 0,
      rejected: statusCounts.rejected || 0
    };

    console.log(`📊 Lead stats for user ${req.user.name} (${req.user.role}):`, result);
    res.json(result);
  } catch (error) {
    console.error('Lead stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/stats/dashboard
// @desc    Get dashboard statistics
// @access  Private
router.get('/dashboard', auth, async (req, res) => {
  try {
    // Get current month's data
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    // Build query options for role-based filtering
    let queryOptions = {
      select: 'id, status, created_at, booker_id',
      gte: { created_at: firstDayOfMonth.toISOString() },
      lte: { created_at: lastDayOfMonth.toISOString() }
    };
    
    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin') {
      queryOptions.eq = { booker_id: req.user.id };
      console.log(`🔒 Dashboard stats filtering: User ${req.user.name} (${req.user.role}) can only see stats for their assigned leads`);
    } else {
      console.log(`👑 Admin dashboard stats access: User ${req.user.name} can see all stats`);
    }
    
    // Get all leads for this month to calculate stats
    const leads = await dbManager.query('leads', queryOptions);
    const totalLeadsThisMonth = leads.length;
    
    // Calculate stats from the leads data
    const clientsBookedThisMonth = leads.filter(lead => lead.status === 'Booked').length;
    const totalBooked = leads.filter(lead => lead.status === 'Booked').length;
    const totalAttended = leads.filter(lead => lead.status === 'Attended').length;
    const showUpRate = totalBooked > 0 ? Math.round((totalAttended / totalBooked) * 100) : 0;

    console.log(`📊 Dashboard stats for user ${req.user.name} (${req.user.role}): total=${totalLeadsThisMonth}, booked=${clientsBookedThisMonth}`);

    res.json({
      totalLeadsThisMonth: totalLeadsThisMonth || 0,
      clientsBookedThisMonth: clientsBookedThisMonth || 0,
      showUpRate,
      leadsOverTime: [], // Simplified for now
      statusBreakdown: [], // Simplified for now
      leaderboard: [] // Simplified for now
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Simplified routes for other endpoints
router.get('/reports', auth, async (req, res) => {
  res.json({ message: 'Reports endpoint - simplified for Supabase migration' });
});

router.get('/daily-diary', auth, async (req, res) => {
  res.json({ message: 'Daily diary endpoint - simplified for Supabase migration' });
});

router.get('/booking-history', auth, async (req, res) => {
  res.json({ message: 'Booking history endpoint - simplified for Supabase migration' });
});

router.get('/monthly-tally', auth, async (req, res) => {
  res.json({ message: 'Monthly tally endpoint - simplified for Supabase migration' });
});

// @route   GET /api/stats/monthly-booking-tally
// @desc    Get monthly booking tally for daily diary
// @access  Private
router.get('/monthly-booking-tally', auth, async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({ message: 'Year and month are required' });
    }

    // Create date range for the month
    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);

    console.log(`📊 Fetching booking tally for ${year}-${month}: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Build query options for role-based filtering
    let queryOptions = {
      select: 'id, status, date_booked, booker_id, created_at',
      gte: { date_booked: startDate.toISOString() },
      lte: { date_booked: endDate.toISOString() }
    };

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin') {
      queryOptions.eq = { booker_id: req.user.id };
      console.log(`🔒 Monthly tally filtering: User ${req.user.name} (${req.user.role}) can only see their assigned leads`);
    } else {
      console.log(`👑 Admin monthly tally access: User ${req.user.name} can see all leads`);
    }

    // Get leads for the month
    const leads = await dbManager.query('leads', queryOptions);

    // Group by day and calculate tally
    const tally = {};

    leads.forEach(lead => {
      if (lead.date_booked) {
        const bookingDate = new Date(lead.date_booked);
        const day = bookingDate.getDate();

        if (!tally[day]) {
          tally[day] = {
            date: day,
            bookings: 0,
            attended: 0,
            cancelled: 0,
            noShow: 0
          };
        }

        tally[day].bookings++;

        // Count by status
        switch (lead.status?.toLowerCase()) {
          case 'attended':
          case 'complete':
            tally[day].attended++;
            break;
          case 'cancelled':
            tally[day].cancelled++;
            break;
          case 'no show':
            tally[day].noShow++;
            break;
        }
      }
    });

    // Convert to array format expected by frontend
    const tallyArray = Object.values(tally).sort((a, b) => a.date - b.date);

    console.log(`📊 Monthly booking tally for ${year}-${month}: ${tallyArray.length} days with bookings`);

    res.json({
      tally: tallyArray,
      total: leads.length,
      month: parseInt(month),
      year: parseInt(year)
    });

  } catch (error) {
    console.error('Monthly booking tally error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/stats/daily-analytics
// @desc    Get comprehensive daily analytics for Daily Diary
// @access  Private
router.get('/daily-analytics', auth, async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Date is required' });
    }

    const selectedDate = new Date(date);
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    console.log(`📊 Fetching daily analytics for ${date}: ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);

    // Build query options for role-based filtering
    // ✅ DAILY ACTIVITY FIX: Use booked_at to track when leads were booked, not when appointments are scheduled
    let queryOptions = {
      select: 'id, status, date_booked, booker_id, created_at, booking_history, has_sale, booked_at',
      gte: { booked_at: startOfDay.toISOString() },
      lte: { booked_at: endOfDay.toISOString() }
    };

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin') {
      queryOptions.eq = { booker_id: req.user.id };
      console.log(`🔒 Daily analytics filtering: User ${req.user.name} (${req.user.role}) can only see their assigned leads`);
    } else {
      console.log(`👑 Admin daily analytics access: User ${req.user.name} can see all leads`);
    }

    // Get leads booked on this day (status changed to Booked)
    const leads = await dbManager.query('leads', queryOptions);
    console.log(`📊 Found ${leads.length} leads booked on ${date} (using booked_at timestamp)`);

    // Get leads assigned on this day (for conversion calculation)
    const assignedQueryOptions = {
      select: 'id, status, booker_id, created_at',
      gte: { created_at: startOfDay.toISOString() },
      lte: { created_at: endOfDay.toISOString() }
    };
    if (req.user.role !== 'admin') {
      assignedQueryOptions.eq = { booker_id: req.user.id };
    }
    const assignedLeads = await dbManager.query('leads', assignedQueryOptions);

    // Calculate metrics
    const metrics = {
      leadsAssigned: assignedLeads.length,
      bookingsMade: leads.length,
      bookingsAttended: leads.filter(lead => ['attended', 'complete'].includes(lead.status?.toLowerCase())).length,
      bookingsCancelled: leads.filter(lead => lead.status?.toLowerCase() === 'cancelled').length,
      noShows: leads.filter(lead => lead.status?.toLowerCase() === 'no show').length,
      salesMade: leads.filter(lead => lead.has_sale).length,
      totalRevenue: 0, // Temporarily set to 0 since sale_amount column doesn't exist
      conversionRate: assignedLeads.length > 0 ? Math.round((leads.length / assignedLeads.length) * 100) : 0,
      showUpRate: leads.length > 0 ? Math.round((leads.filter(lead => ['attended', 'complete'].includes(lead.status?.toLowerCase())).length / leads.length) * 100) : 0,
      salesConversionRate: leads.length > 0 ? Math.round((leads.filter(lead => lead.has_sale).length / leads.length) * 100) : 0
    };

    metrics.averageSale = metrics.salesMade > 0 ? Math.round(metrics.totalRevenue / metrics.salesMade) : 0;

    // Get upcoming bookings for next 7 days
    const nextWeek = new Date(selectedDate);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const upcomingQueryOptions = {
      select: 'id, name, phone, date_booked, status, booker_id',
      gte: { date_booked: endOfDay.toISOString() },
      lte: { date_booked: nextWeek.toISOString() }
    };
    if (req.user.role !== 'admin') {
      upcomingQueryOptions.eq = { booker_id: req.user.id };
    }
    const upcomingBookings = await dbManager.query('leads', upcomingQueryOptions);

    console.log(`📊 Daily analytics for ${date}: ${metrics.leadsAssigned} assigned, ${metrics.bookingsMade} booked, ${metrics.bookingsAttended} attended`);

    res.json({
      date,
      metrics,
      upcomingBookings: upcomingBookings.slice(0, 10), // Limit to 10 upcoming
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Daily analytics error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/stats/hourly-activity
// @desc    Get hourly breakdown of activity for selected date
// @access  Private
router.get('/hourly-activity', auth, async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Date is required' });
    }

    const selectedDate = new Date(date);
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Build query options for role-based filtering
    let queryOptions = {
      select: 'id, status, date_booked, booker_id, booking_history',
      gte: { date_booked: startOfDay.toISOString() },
      lte: { date_booked: endOfDay.toISOString() }
    };

    if (req.user.role !== 'admin') {
      queryOptions.eq = { booker_id: req.user.id };
    }

    const leads = await dbManager.query('leads', queryOptions);

    // Create hourly breakdown
    const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
      hour: `${hour.toString().padStart(2, '0')}:00`,
      bookings: 0,
      attended: 0,
      cancelled: 0,
      calls: 0,
      sms: 0
    }));

    leads.forEach(lead => {
      if (lead.date_booked) {
        const bookingHour = new Date(lead.date_booked).getHours();
        hourlyData[bookingHour].bookings++;

        if (['attended', 'complete'].includes(lead.status?.toLowerCase())) {
          hourlyData[bookingHour].attended++;
        } else if (lead.status?.toLowerCase() === 'cancelled') {
          hourlyData[bookingHour].cancelled++;
        }

        // Count SMS and calls from booking history
        if (lead.booking_history) {
          try {
            const history = typeof lead.booking_history === 'string'
              ? JSON.parse(lead.booking_history)
              : lead.booking_history;

            history.forEach(entry => {
              if (entry.timestamp) {
                const entryDate = new Date(entry.timestamp);
                if (entryDate >= startOfDay && entryDate <= endOfDay) {
                  const entryHour = entryDate.getHours();
                  if (entry.action?.includes('SMS')) {
                    hourlyData[entryHour].sms++;
                  } else if (entry.action?.includes('CALL')) {
                    hourlyData[entryHour].calls++;
                  }
                }
              }
            });
          } catch (error) {
            console.warn('Failed to parse booking history:', error);
          }
        }
      }
    });

    res.json({
      date,
      hourlyActivity: hourlyData,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Hourly activity error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/stats/team-performance
// @desc    Get team performance metrics for selected date with detailed booking breakdown
// @access  Private
router.get('/team-performance', auth, async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Date is required' });
    }

    const selectedDate = new Date(date);
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all users for team performance (admins can see all, users see only themselves)
    let usersQuery = { select: 'id, name, role' };
    if (req.user.role !== 'admin') {
      usersQuery.eq = { id: req.user.id };
    }
    const users = await dbManager.query('users', usersQuery);

    const teamPerformance = [];

    for (const user of users) {
      // ✅ DAILY ACTIVITY FIX: Get bookings made today (using booked_at), not appointments scheduled for today
      const bookingsQuery = {
        select: 'id, name, phone, date_booked, status, has_sale, created_at, booked_at',
        eq: { booker_id: user.id },
        gte: { booked_at: startOfDay.toISOString() },
        lte: { booked_at: endOfDay.toISOString() }
      };
      const userBookings = await dbManager.query('leads', bookingsQuery);

      // Create detailed booking breakdown for dashboard scoreboard
      const bookingDetails = userBookings.map(booking => {
        const appointmentDate = new Date(booking.date_booked);
        return {
          id: booking.id,
          leadName: booking.name || 'Unknown Lead',
          phone: booking.phone || '',
          date: appointmentDate.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          time: appointmentDate.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }),
          status: booking.status || 'Booked',
          dateBooked: booking.date_booked,
          createdAt: booking.created_at
        };
      }).sort((a, b) => new Date(a.dateBooked) - new Date(b.dateBooked));

      // Get leads assigned to this user on this date
      const assignedQuery = {
        select: 'id',
        eq: { booker_id: user.id },
        gte: { created_at: startOfDay.toISOString() },
        lte: { created_at: endOfDay.toISOString() }
      };
      const assignedLeads = await dbManager.query('leads', assignedQuery);

      const performance = {
        userId: user.id,
        name: user.name,
        role: user.role,
        leadsAssigned: assignedLeads.length,
        bookingsMade: userBookings.length,
        attended: userBookings.filter(lead => ['attended', 'complete'].includes(lead.status?.toLowerCase())).length,
        salesMade: userBookings.filter(lead => lead.has_sale).length,
        revenue: 0, // Temporarily set to 0 since sale_amount column doesn't exist
        conversionRate: assignedLeads.length > 0 ? Math.round((userBookings.length / assignedLeads.length) * 100) : 0,
        showUpRate: userBookings.length > 0 ? Math.round((userBookings.filter(lead => ['attended', 'complete'].includes(lead.status?.toLowerCase())).length / userBookings.length) * 100) : 0,
        bookingDetails: bookingDetails, // Add detailed booking breakdown for dashboard
        lastBooking: bookingDetails.length > 0 ? bookingDetails[bookingDetails.length - 1].dateBooked : null
      };

      teamPerformance.push(performance);
    }

    // Sort by bookings made descending (more relevant for dashboard)
    teamPerformance.sort((a, b) => b.bookingsMade - a.bookingsMade);

    res.json({
      date,
      teamPerformance,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Team performance error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/stats/calendar-public
// @desc    Get calendar events for dashboard (public endpoint)
// @access  Public
router.get('/calendar-public', async (req, res) => {
  try {
    const { start, end, limit = 200 } = req.query;
    const validatedLimit = Math.min(parseInt(limit) || 200, 500);

    console.log(`📅 Public Calendar Stats API: Date range ${start} to ${end}, Limit: ${validatedLimit}`);

    let queryOptions = {
      select: 'id, name, phone, email, status, date_booked, booker_id, created_at, is_confirmed',
      order: { date_booked: 'asc' },
      limit: validatedLimit
    };

    // Apply date range filter if provided
    if (start && end) {
      queryOptions.gte = { date_booked: start };
      queryOptions.lte = { date_booked: end };
    }

    // Get leads with bookings
    const leads = await dbManager.query('leads', queryOptions);

    console.log(`📅 Database returned ${leads.length} total leads`);

    // Filter to only leads with valid date_booked
    const validLeads = leads.filter(lead => lead.date_booked && lead.date_booked !== null);

    console.log(`📅 Found ${validLeads.length} calendar events`);

    // Convert to flat events format for dashboard
    const events = validLeads.slice(0, validatedLimit).map(lead => {
      const date = new Date(lead.date_booked);
      return {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        lead_status: lead.status, // Lead status (Booked, Cancelled, etc)
        status: lead.is_confirmed ? 'confirmed' : 'unconfirmed', // Calendar confirmation status
        booking_date: lead.date_booked,
        booking_time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        booker_id: lead.booker_id,
        created_at: lead.created_at,
        is_confirmed: lead.is_confirmed
      };
    });

    res.json(events);
  } catch (error) {
    console.error('Calendar events error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/stats/user-analytics
// @desc    Get detailed analytics for a specific user (for Dashboard modal)
// @access  Public (using public endpoint pattern for now)
router.get('/user-analytics', async (req, res) => {
  try {
    const { userId, date, userRole } = req.query;

    if (!userId || !date) {
      return res.status(400).json({ message: 'userId and date are required' });
    }

    const today = date;
    console.log(`📊 USER ANALYTICS: Fetching analytics for user ${userId} (${userRole || 'unknown role'}) on ${today}`);

    if (userRole === 'booker') {
      // ===== BOOKER ANALYTICS =====
      
      // 1. Fetch leads assigned today to this booker
      const leadsAssignedQuery = {
        select: 'id, status, created_at, booker_id',
        eq: { booker_id: userId },
        gte: { created_at: `${today}T00:00:00.000Z` },
        lte: { created_at: `${today}T23:59:59.999Z` }
      };
      const leadsAssigned = await dbManager.query('leads', leadsAssignedQuery);
      const leadsAssignedCount = leadsAssigned.length;

      // 2. Fetch bookings made today by this booker
      const bookingsMadeQuery = {
        select: 'id, status, created_at, booker_id, date_booked',
        eq: { booker_id: userId, status: 'Booked' },
        gte: { created_at: `${today}T00:00:00.000Z` },
        lte: { created_at: `${today}T23:59:59.999Z` }
      };
      const bookingsMade = await dbManager.query('leads', bookingsMadeQuery);
      const bookingsMadeCount = bookingsMade.length;

      // 3. Calculate booking timing for bookings made TODAY
      // Categorize by when the appointments are scheduled (today vs future)
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);

      // Count how many of today's bookings are scheduled for this week
      const thisWeekStart = new Date();
      thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
      thisWeekStart.setHours(0, 0, 0, 0);
      const thisWeekEnd = new Date(thisWeekStart);
      thisWeekEnd.setDate(thisWeekEnd.getDate() + 6);
      thisWeekEnd.setHours(23, 59, 59, 999);

      const thisWeekBookingsCount = bookingsMade.filter(booking => {
        const appointmentDate = new Date(booking.date_booked);
        return appointmentDate >= thisWeekStart && appointmentDate <= thisWeekEnd;
      }).length;

      // Count how many of today's bookings are scheduled for next week
      const nextWeekStart = new Date(thisWeekStart);
      nextWeekStart.setDate(nextWeekStart.getDate() + 7);
      const nextWeekEnd = new Date(nextWeekStart);
      nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);
      nextWeekEnd.setHours(23, 59, 59, 999);

      const nextWeekBookingsCount = bookingsMade.filter(booking => {
        const appointmentDate = new Date(booking.date_booked);
        return appointmentDate >= nextWeekStart && appointmentDate <= nextWeekEnd;
      }).length;

      // 4. Calculate yesterday's bookings for daily trend comparison
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const yesterdayBookingsQuery = {
        select: 'id, status, created_at, booker_id',
        eq: { booker_id: userId, status: 'Booked' },
        gte: { created_at: `${yesterdayStr}T00:00:00.000Z` },
        lte: { created_at: `${yesterdayStr}T23:59:59.999Z` }
      };
      const yesterdayBookings = await dbManager.query('leads', yesterdayBookingsQuery);
      const yesterdayBookingsCount = yesterdayBookings.length;

      // Calculate rates and trends
      const leadsToBookingsRate = leadsAssignedCount > 0 ? (bookingsMadeCount / leadsAssignedCount) * 100 : 0;
      const weeklyTrendRate = yesterdayBookingsCount > 0 
        ? ((bookingsMadeCount - yesterdayBookingsCount) / yesterdayBookingsCount) * 100 
        : (bookingsMadeCount > 0 ? 100 : 0);
      const weeklyAverage = (bookingsMadeCount + yesterdayBookingsCount) / 2;

      const analytics = {
        userRole: 'booker',
        leadsAssigned: leadsAssignedCount,
        bookingsMade: bookingsMadeCount,
        leadsToBookingsRate,
        thisWeekBookings: thisWeekBookingsCount,
        nextWeekBookings: nextWeekBookingsCount,
        weeklyTrendRate,
        weeklyAverage
      };

      console.log('📊 BOOKER ANALYTICS RESULT:', analytics);
      return res.json(analytics);

    } else if (userRole === 'admin' || userRole === 'viewer') {
      // ===== ADMIN/VIEWER (SALES) ANALYTICS =====

      // 1. Fetch appointments attended today
      const appointmentsQuery = {
        select: 'id, status, date_booked',
        eq: { status: 'Attended' },
        gte: { date_booked: `${today}T00:00:00.000Z` },
        lte: { date_booked: `${today}T23:59:59.999Z` }
      };
      const appointments = await dbManager.query('leads', appointmentsQuery);
      const appointmentsAttended = appointments.length;

      // 2. Fetch sales made today by this user
      let salesMade = 0;
      let totalSalesAmount = 0;

      try {
        const salesQuery = {
          select: 'id, amount, created_at, user_id, completed_by_id',
          gte: { created_at: `${today}T00:00:00.000Z` },
          lte: { created_at: `${today}T23:59:59.999Z` }
        };
        const sales = await dbManager.query('sales', salesQuery);
        
        // Filter by user_id or completed_by_id
        const userSales = sales.filter(sale => 
          sale.user_id === userId || sale.completed_by_id === userId
        );
        
        salesMade = userSales.length;
        totalSalesAmount = userSales.reduce((sum, sale) => sum + (parseFloat(sale.amount) || 0), 0);
      } catch (error) {
        console.log('Sales data query error:', error.message);
      }

      // 3. Fetch all leads created today for overall close rate
      const allLeadsQuery = {
        select: 'id, status, created_at',
        gte: { created_at: `${today}T00:00:00.000Z` },
        lte: { created_at: `${today}T23:59:59.999Z` }
      };
      const allLeads = await dbManager.query('leads', allLeadsQuery);
      const totalLeads = allLeads.length;

      // Calculate rates
      const averageSaleAmount = salesMade > 0 ? totalSalesAmount / salesMade : 0;
      const attendanceToSalesRate = appointmentsAttended > 0 ? (salesMade / appointmentsAttended) * 100 : 0;
      const overallCloseRate = totalLeads > 0 ? (salesMade / totalLeads) * 100 : 0;

      const analytics = {
        userRole: 'sales',
        appointmentsAttended,
        salesMade,
        totalLeads,
        totalSalesAmount,
        averageSaleAmount,
        attendanceToSalesRate,
        overallCloseRate
      };

      console.log('📊 SALES ANALYTICS RESULT:', analytics);
      return res.json(analytics);

    } else {
      return res.status(400).json({ message: 'Invalid userRole. Must be booker, admin, or viewer' });
    }

  } catch (error) {
    console.error('❌ User analytics error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;