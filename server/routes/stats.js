const express = require('express');
const { auth } = require('../middleware/auth');
const dbManager = require('../database-connection-manager');

const router = express.Router();

// @route   GET /api/stats/leads
// @desc    Get lead status counts using database aggregation
// @access  Private
router.get('/leads', auth, async (req, res) => {
  try {
    // Parse filters from query
    const { startDate, endDate, userId } = req.query;

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin') {
      console.log(`🔒 Stats filtering: User ${req.user.name} (${req.user.role}) can only see stats for their assigned leads`);
    } else {
      console.log(`👑 Admin stats access: User ${req.user.name} can see all lead stats`);
    }

    // Build query options for role-based filtering (same as leads endpoint)
    let queryOptions = {
      select: 'id, status, created_at, booker_id'
    };

    // Apply role-based filtering
    if (req.user.role !== 'admin') {
      queryOptions.eq = { booker_id: req.user.id };
    }

    // Apply date filters
    if (startDate && endDate) {
      queryOptions.gte = { created_at: startDate };
      queryOptions.lte = { created_at: endDate };
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
    let queryOptions = {
      select: 'id, status, date_booked, booker_id, created_at, booking_history, has_sale',
      gte: { date_booked: startOfDay.toISOString() },
      lte: { date_booked: endOfDay.toISOString() }
    };

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin') {
      queryOptions.eq = { booker_id: req.user.id };
      console.log(`🔒 Daily analytics filtering: User ${req.user.name} (${req.user.role}) can only see their assigned leads`);
    } else {
      console.log(`👑 Admin daily analytics access: User ${req.user.name} can see all leads`);
    }

    // Get leads for the day
    const leads = await dbManager.query('leads', queryOptions);

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
// @desc    Get team performance metrics for selected date
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
      // Get bookings for this user on this date
      const bookingsQuery = {
        select: 'id, status, has_sale',
        eq: { booker_id: user.id },
        gte: { date_booked: startOfDay.toISOString() },
        lte: { date_booked: endOfDay.toISOString() }
      };
      const userBookings = await dbManager.query('leads', bookingsQuery);

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
        showUpRate: userBookings.length > 0 ? Math.round((userBookings.filter(lead => ['attended', 'complete'].includes(lead.status?.toLowerCase())).length / userBookings.length) * 100) : 0
      };

      teamPerformance.push(performance);
    }

    // Sort by revenue descending
    teamPerformance.sort((a, b) => b.revenue - a.revenue);

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

module.exports = router;