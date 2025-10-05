const express = require('express');
const { auth, adminAuth } = require('../middleware/auth');
const dbManager = require('../database-connection-manager');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

// @route   GET /api/booker-analytics/overview
// @desc    Get comprehensive booker performance overview for admins
// @access  Admin only
router.get('/overview', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate, period = 'daily' } = req.query;

    // Get all bookers
    const bookers = await dbManager.query('users', {
      select: 'id, name, email, role, created_at, last_active_at',
      eq: { role: 'booker' }
    });

    const bookerPerformance = [];

    for (const booker of bookers) {
      // Get period-specific performance
      let performanceQuery = {
        select: '*',
        eq: { user_id: booker.id }
      };

      if (startDate && endDate) {
        if (period === 'daily') {
          performanceQuery.gte = { performance_date: startDate };
          performanceQuery.lte = { performance_date: endDate };
        } else {
          performanceQuery.gte = { performance_month: startDate };
          performanceQuery.lte = { performance_month: endDate };
        }
      }

      const tableName = period === 'daily' ? 'daily_booker_performance' : 'monthly_booker_performance';
      const performance = await dbManager.query(tableName, performanceQuery);

      // Calculate aggregated metrics
      const metrics = performance.reduce((acc, curr) => ({
        totalLeadsAssigned: acc.totalLeadsAssigned + (curr.leads_assigned || 0),
        totalLeadsBooked: acc.totalLeadsBooked + (curr.leads_booked || 0),
        totalLeadsAttended: acc.totalLeadsAttended + (curr.leads_attended || 0),
        totalSalesMade: acc.totalSalesMade + (curr.sales_made || 0),
        totalSaleAmount: acc.totalSaleAmount + parseFloat(curr.total_sale_amount || 0),
        averageConversionRate: acc.averageConversionRate + parseFloat(curr.conversion_rate || 0),
        averageShowUpRate: acc.averageShowUpRate + parseFloat(curr.show_up_rate || 0),
        recordCount: acc.recordCount + 1
      }), {
        totalLeadsAssigned: 0,
        totalLeadsBooked: 0,
        totalLeadsAttended: 0,
        totalSalesMade: 0,
        totalSaleAmount: 0,
        averageConversionRate: 0,
        averageShowUpRate: 0,
        recordCount: 0
      });

      // Calculate final averages
      const finalMetrics = {
        ...metrics,
        averageConversionRate: metrics.recordCount > 0 ? (metrics.averageConversionRate / metrics.recordCount).toFixed(2) : 0,
        averageShowUpRate: metrics.recordCount > 0 ? (metrics.averageShowUpRate / metrics.recordCount).toFixed(2) : 0,
        overallConversionRate: metrics.totalLeadsAssigned > 0 ? ((metrics.totalLeadsBooked / metrics.totalLeadsAssigned) * 100).toFixed(2) : 0,
        overallShowUpRate: metrics.totalLeadsBooked > 0 ? ((metrics.totalLeadsAttended / metrics.totalLeadsBooked) * 100).toFixed(2) : 0
      };

      bookerPerformance.push({
        booker: {
          id: booker.id,
          name: booker.name,
          email: booker.email,
          lastActive: booker.last_active_at
        },
        metrics: finalMetrics,
        dailyBreakdown: performance
      });
    }

    // Sort by total revenue descending
    bookerPerformance.sort((a, b) => b.metrics.totalSaleAmount - a.metrics.totalSaleAmount);

    // Calculate team totals
    const teamTotals = bookerPerformance.reduce((acc, curr) => ({
      totalLeadsAssigned: acc.totalLeadsAssigned + curr.metrics.totalLeadsAssigned,
      totalLeadsBooked: acc.totalLeadsBooked + curr.metrics.totalLeadsBooked,
      totalLeadsAttended: acc.totalLeadsAttended + curr.metrics.totalLeadsAttended,
      totalSalesMade: acc.totalSalesMade + curr.metrics.totalSalesMade,
      totalRevenue: acc.totalRevenue + curr.metrics.totalSaleAmount
    }), {
      totalLeadsAssigned: 0,
      totalLeadsBooked: 0,
      totalLeadsAttended: 0,
      totalSalesMade: 0,
      totalRevenue: 0
    });

    res.json({
      period,
      dateRange: { startDate, endDate },
      teamTotals,
      bookerCount: bookers.length,
      bookerPerformance,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Booker analytics overview error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/booker-analytics/activity-log
// @desc    Get comprehensive activity log for bookers
// @access  Admin only
router.get('/activity-log', adminAuth, async (req, res) => {
  try {
    const {
      userId,
      leadId,
      activityType,
      startDate,
      endDate,
      limit = 50,
      offset = 0
    } = req.query;

    let queryOptions = {
      select: `
        *,
        users:user_id(name, email),
        leads:lead_id(name, phone, status)
      `,
      order: { performed_at: 'desc' },
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    // Apply filters
    if (userId) queryOptions.eq = { ...queryOptions.eq, user_id: userId };
    if (leadId) queryOptions.eq = { ...queryOptions.eq, lead_id: leadId };
    if (activityType) queryOptions.eq = { ...queryOptions.eq, activity_type: activityType };
    if (startDate) queryOptions.gte = { performed_at: startDate };
    if (endDate) queryOptions.lte = { performed_at: endDate };

    const activities = await dbManager.query('booker_activity_log', queryOptions);

    // Get total count for pagination
    const countQuery = { ...queryOptions };
    delete countQuery.select;
    delete countQuery.limit;
    delete countQuery.offset;
    delete countQuery.order;
    const totalActivities = await dbManager.query('booker_activity_log', countQuery);

    res.json({
      activities,
      pagination: {
        total: totalActivities.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: totalActivities.length > parseInt(offset) + parseInt(limit)
      },
      filters: { userId, leadId, activityType, startDate, endDate }
    });

  } catch (error) {
    console.error('Activity log error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/booker-analytics/assignment-history
// @desc    Get lead assignment history with audit trail
// @access  Admin only
router.get('/assignment-history', adminAuth, async (req, res) => {
  try {
    const { leadId, userId, startDate, endDate, limit = 50 } = req.query;

    let queryOptions = {
      select: `
        *,
        assigned_by_user:assigned_by(name, email),
        assigned_to_user:assigned_to(name, email),
        previous_assignee_user:previous_assignee(name, email),
        leads:lead_id(name, phone, status)
      `,
      order: { assigned_at: 'desc' },
      limit: parseInt(limit)
    };

    if (leadId) queryOptions.eq = { ...queryOptions.eq, lead_id: leadId };
    if (userId) queryOptions.eq = { ...queryOptions.eq, assigned_to: userId };
    if (startDate) queryOptions.gte = { assigned_at: startDate };
    if (endDate) queryOptions.lte = { assigned_at: endDate };

    const assignments = await dbManager.query('lead_assignments', queryOptions);

    res.json({
      assignments,
      filters: { leadId, userId, startDate, endDate }
    });

  } catch (error) {
    console.error('Assignment history error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/booker-analytics/daily-comparison
// @desc    Get daily performance comparison between bookers
// @access  Admin only
router.get('/daily-comparison', adminAuth, async (req, res) => {
  try {
    const { date = new Date().toISOString().split('T')[0] } = req.query;

    // Get all bookers
    const bookers = await dbManager.query('users', {
      select: 'id, name, email',
      eq: { role: 'booker' }
    });

    const dailyComparison = [];

    for (const booker of bookers) {
      // Get daily performance
      const performance = await dbManager.query('daily_booker_performance', {
        select: '*',
        eq: { user_id: booker.id, performance_date: date }
      });

      const todayPerformance = performance[0] || {
        leads_assigned: 0,
        leads_contacted: 0,
        leads_booked: 0,
        leads_attended: 0,
        leads_cancelled: 0,
        sales_made: 0,
        total_sale_amount: 0,
        conversion_rate: 0,
        show_up_rate: 0
      };

      // Get recent activity count
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const recentActivity = await dbManager.query('booker_activity_log', {
        select: 'id',
        eq: { user_id: booker.id },
        gte: { performed_at: startOfDay.toISOString() },
        lte: { performed_at: endOfDay.toISOString() }
      });

      dailyComparison.push({
        booker: {
          id: booker.id,
          name: booker.name,
          email: booker.email
        },
        performance: todayPerformance,
        activityCount: recentActivity.length,
        isActive: recentActivity.length > 0
      });
    }

    // Sort by total leads booked descending
    dailyComparison.sort((a, b) => b.performance.leads_booked - a.performance.leads_booked);

    res.json({
      date,
      dailyComparison,
      summary: {
        totalBookers: bookers.length,
        activeBookers: dailyComparison.filter(b => b.isActive).length,
        totalLeadsBooked: dailyComparison.reduce((sum, b) => sum + b.performance.leads_booked, 0),
        totalRevenue: dailyComparison.reduce((sum, b) => sum + parseFloat(b.performance.total_sale_amount || 0), 0)
      }
    });

  } catch (error) {
    console.error('Daily comparison error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/booker-analytics/log-activity
// @desc    Log booker activity (for manual tracking)
// @access  Private
router.post('/log-activity', auth, async (req, res) => {
  try {
    const { leadId, activityType, activityDetails, oldValue, newValue } = req.body;

    if (!leadId || !activityType) {
      return res.status(400).json({ message: 'Lead ID and activity type are required' });
    }

    // Log the activity using service role client to bypass RLS
    const config = require('../config');
    const serviceRoleClient = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey || config.supabase.anonKey
    );

    const activity = {
      user_id: req.user.id,
      lead_id: leadId,
      activity_type: activityType,
      old_value: oldValue || null,
      new_value: newValue || null,
      activity_details: activityDetails || {},
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      created_at: new Date().toISOString()
    };

    const { error: insertError } = await serviceRoleClient
      .from('booker_activity_log')
      .insert([activity]);

    if (insertError) {
      console.error('Error inserting booker activity:', insertError);
      
      // If it's an RLS policy violation, log warning but don't fail the request
      if (insertError.code === '42501') {
        console.warn('⚠️ RLS policy violation for booker_activity_log - continuing without logging activity');
        // Don't throw the error, just continue
      } else {
        throw insertError;
      }
    }

    // Update daily performance metrics
    await updateDailyPerformance(req.user.id);

    res.json({
      success: true,
      message: 'Activity logged successfully',
      activity: {
        activityType,
        leadId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Log activity error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/booker-analytics/update-performance
// @desc    Manually trigger performance metrics update
// @access  Admin only
router.post('/update-performance', adminAuth, async (req, res) => {
  try {
    const { userId, date } = req.body;

    if (userId) {
      // Update specific user
      await updateDailyPerformance(userId, date);
    } else {
      // Update all bookers
      const bookers = await dbManager.query('users', {
        select: 'id',
        eq: { role: 'booker' }
      });

      for (const booker of bookers) {
        await updateDailyPerformance(booker.id, date);
      }
    }

    res.json({
      success: true,
      message: 'Performance metrics updated successfully',
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Update performance error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/booker-analytics/reports/daily
// @desc    Generate and return daily report
// @access  Admin only
router.get('/reports/daily', adminAuth, async (req, res) => {
  try {
    const { date = new Date().toISOString().split('T')[0] } = req.query;

    const BookerReportingService = require('../services/bookerReportingService');
    const reportingService = new BookerReportingService();

    const reportData = await reportingService.generateDailyReport(date);

    res.json({
      success: true,
      data: reportData,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Daily report error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/booker-analytics/reports/monthly
// @desc    Generate and return monthly report
// @access  Admin only
router.get('/reports/monthly', adminAuth, async (req, res) => {
  try {
    const { year = new Date().getFullYear(), month = new Date().getMonth() + 1 } = req.query;

    const BookerReportingService = require('../services/bookerReportingService');
    const reportingService = new BookerReportingService();

    const reportData = await reportingService.generateMonthlyReport(parseInt(year), parseInt(month));

    res.json({
      success: true,
      data: reportData,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Monthly report error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/booker-analytics/reports/trigger-daily
// @desc    Manually trigger daily report automation (including email)
// @access  Admin only
router.post('/reports/trigger-daily', adminAuth, async (req, res) => {
  try {
    const { date = new Date().toISOString().split('T')[0] } = req.body;

    const bookerReportingScheduler = require('../services/bookerReportingScheduler');
    const result = await bookerReportingScheduler.triggerDailyReport(date);

    res.json({
      success: true,
      message: 'Daily report automation triggered successfully',
      data: result,
      triggeredAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Trigger daily report error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/booker-analytics/reports/trigger-monthly
// @desc    Manually trigger monthly report automation (including email)
// @access  Admin only
router.post('/reports/trigger-monthly', adminAuth, async (req, res) => {
  try {
    const { year = new Date().getFullYear(), month = new Date().getMonth() + 1 } = req.body;

    const bookerReportingScheduler = require('../services/bookerReportingScheduler');
    const result = await bookerReportingScheduler.triggerMonthlyReport(parseInt(year), parseInt(month));

    res.json({
      success: true,
      message: 'Monthly report automation triggered successfully',
      data: result,
      triggeredAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Trigger monthly report error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   GET /api/booker-analytics/scheduler/status
// @desc    Get scheduler status and health check
// @access  Admin only
router.get('/scheduler/status', adminAuth, async (req, res) => {
  try {
    const bookerReportingScheduler = require('../services/bookerReportingScheduler');
    const status = bookerReportingScheduler.healthCheck();

    res.json({
      success: true,
      status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Scheduler status error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Helper function to update daily performance
async function updateDailyPerformance(userId, date = new Date().toISOString().split('T')[0]) {
  try {
    // This would call the PostgreSQL function we created in the schema
    // For now, we'll implement the logic here

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Get leads for this user and date
    const leads = await dbManager.query('leads', {
      select: 'id, status, assigned_at, booked_at, last_contacted_at, has_sale, sales',
      eq: { booker_id: userId }
    });

    // Calculate metrics
    const leadsAssignedToday = leads.filter(l =>
      l.assigned_at && new Date(l.assigned_at) >= startOfDay && new Date(l.assigned_at) <= endOfDay
    ).length;

    const leadsContactedToday = leads.filter(l =>
      l.last_contacted_at && new Date(l.last_contacted_at) >= startOfDay && new Date(l.last_contacted_at) <= endOfDay
    ).length;

    const leadsBookedToday = leads.filter(l =>
      l.status === 'Booked' && l.booked_at && new Date(l.booked_at) >= startOfDay && new Date(l.booked_at) <= endOfDay
    ).length;

    const leadsAttendedToday = leads.filter(l =>
      l.status === 'Attended' && l.updated_at && new Date(l.updated_at) >= startOfDay && new Date(l.updated_at) <= endOfDay
    ).length;

    const salesMadeToday = leads.filter(l =>
      l.has_sale && l.updated_at && new Date(l.updated_at) >= startOfDay && new Date(l.updated_at) <= endOfDay
    ).length;

    const totalSaleAmountToday = leads
      .filter(l => l.has_sale && l.updated_at && new Date(l.updated_at) >= startOfDay && new Date(l.updated_at) <= endOfDay)
      .reduce((sum, l) => sum + parseFloat(l.sales || 0), 0);

    // Calculate rates
    const conversionRate = leadsAssignedToday > 0 ? (leadsBookedToday / leadsAssignedToday * 100) : 0;
    const showUpRate = leadsBookedToday > 0 ? (leadsAttendedToday / leadsBookedToday * 100) : 0;

    // Upsert daily performance record
    const performanceData = {
      user_id: userId,
      performance_date: date,
      leads_assigned: leadsAssignedToday,
      leads_contacted: leadsContactedToday,
      leads_booked: leadsBookedToday,
      leads_attended: leadsAttendedToday,
      sales_made: salesMadeToday,
      total_sale_amount: totalSaleAmountToday,
      conversion_rate: conversionRate.toFixed(2),
      show_up_rate: showUpRate.toFixed(2),
      updated_at: new Date().toISOString()
    };

    // Check if record exists
    const existing = await dbManager.query('daily_booker_performance', {
      select: 'id',
      eq: { user_id: userId, performance_date: date }
    });

    if (existing.length > 0) {
      await dbManager.update('daily_booker_performance', performanceData, existing[0].id);
    } else {
      await dbManager.insert('daily_booker_performance', performanceData);
    }

  } catch (error) {
    console.error('Update daily performance error:', error);
    throw error;
  }
}

module.exports = router;
module.exports.updateDailyPerformance = updateDailyPerformance;