/**
 * AI Assistant Routes
 * Admin-only natural language queries for CRM data
 */

const express = require('express');
const router = express.Router();
const { auth, adminAuth } = require('../middleware/auth');
const geminiService = require('../services/geminiService');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const axios = require('axios');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

/**
 * Available CRM API Endpoints for AI Assistant
 */
const CRM_ENDPOINTS = {
  // Reports & Analytics
  comprehensiveReport: {
    path: '/api/stats/comprehensive-report',
    method: 'GET',
    params: ['startDate', 'endDate', 'userId'],
    description: 'Get comprehensive KPI report with bookings, sales, revenue'
  },
  dailyBreakdown: {
    path: '/api/stats/daily-breakdown-report',
    method: 'GET',
    params: ['startDate', 'endDate', 'userId'],
    description: 'Get daily breakdown of leads, bookings, sales by day'
  },
  monthlyBreakdown: {
    path: '/api/stats/monthly-breakdown-report',
    method: 'GET',
    params: ['startDate', 'endDate', 'userId'],
    description: 'Get weekly/monthly breakdown of performance'
  },
  salesFromBookings: {
    path: '/api/stats/sales-from-bookings',
    method: 'GET',
    params: ['startDate', 'endDate', 'userId'],
    description: 'Get detailed list of sales from bookings'
  },

  // Daily Analytics
  dailyAnalytics: {
    path: '/api/stats/daily-analytics',
    method: 'GET',
    params: ['date'],
    description: 'Get daily analytics for specific date'
  },
  hourlyActivity: {
    path: '/api/stats/hourly-activity',
    method: 'GET',
    params: ['date'],
    description: 'Get hourly breakdown of activity'
  },
  teamPerformance: {
    path: '/api/stats/team-performance',
    method: 'GET',
    params: ['date'],
    description: 'Get team performance metrics'
  },

  // Calendar & Bookings
  calendar: {
    path: '/api/leads/calendar',
    method: 'GET',
    params: ['startDate', 'endDate'],
    description: 'Get calendar bookings for date range'
  },
  calendarPublic: {
    path: '/api/stats/calendar-public',
    method: 'GET',
    params: [],
    description: 'Get public calendar view of all bookings'
  },

  // Dashboard
  dashboard: {
    path: '/api/stats/dashboard',
    method: 'GET',
    params: [],
    description: 'Get main dashboard stats'
  },

  // User Analytics
  userAnalytics: {
    path: '/api/stats/user-analytics',
    method: 'GET',
    params: ['userId', 'userRole'],
    description: 'Get analytics for specific user'
  }
};

/**
 * Helper: Call internal CRM endpoint
 */
async function callCRMEndpoint(endpointKey, params, authToken) {
  const endpoint = CRM_ENDPOINTS[endpointKey];
  if (!endpoint) {
    throw new Error(`Unknown endpoint: ${endpointKey}`);
  }

  const url = `http://localhost:${config.port || 5000}${endpoint.path}`;

  try {
    const response = await axios({
      method: endpoint.method,
      url,
      params,
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  } catch (error) {
    console.error(`Error calling ${endpoint.path}:`, error.message);
    throw new Error(`Failed to fetch data from ${endpoint.path}: ${error.message}`);
  }
}

/**
 * Helper: Resolve user lookups in filters
 */
async function resolveUserLookups(filters) {
  if (!filters || !Array.isArray(filters)) return filters;

  const resolvedFilters = [];
  
  for (const filter of filters) {
    if (typeof filter.value === 'string' && filter.value.startsWith('BOOKER_ID_LOOKUP:')) {
      const name = filter.value.replace('BOOKER_ID_LOOKUP:', '');
      
      // Look up user by name
      const { data: users } = await supabase
        .from('users')
        .select('id, name')
        .ilike('name', `%${name}%`)
        .limit(1);
      
      if (users && users.length > 0) {
        resolvedFilters.push({
          ...filter,
          value: users[0].id
        });
      } else {
        // If user not found, skip this filter (will return no results)
        console.warn(`User not found: ${name}`);
      }
    } else {
      resolvedFilters.push(filter);
    }
  }
  
  return resolvedFilters;
}

/**
 * Helper: Get leaderboard data (fast pre-built queries)
 */
async function getLeaderboard(metric, timeframe = 'week') {
  const now = new Date();
  let startDate, endDate;

  // Calculate date range
  switch (timeframe) {
    case 'today':
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'week':
      startDate = new Date(now);
      startDate.setDate(now.getDate() - now.getDay()); // Sunday
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    default:
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
      endDate = new Date(now);
  }

  try {
    if (metric === 'most_bookings') {
      // Get all users
      const { data: users } = await supabase
        .from('users')
        .select('id, name, email, role')
        .in('role', ['booker', 'admin']);

      // Get bookings for each user
      const leaderboard = [];

      for (const user of users) {
        // Count bookings made by this user (using booked_at timestamp)
        const { data: bookings } = await supabase
          .from('leads')
          .select('id, booked_at, date_booked, has_sale')
          .eq('booker_id', user.id)
          .not('booked_at', 'is', null)
          .gte('booked_at', startDate.toISOString())
          .lte('booked_at', endDate.toISOString());

        // Get sales from these bookings
        const leadIds = bookings.map(b => b.id);
        let sales = [];
        let totalRevenue = 0;

        if (leadIds.length > 0) {
          const { data: salesData } = await supabase
            .from('sales')
            .select('id, lead_id, amount')
            .in('lead_id', leadIds);

          sales = salesData || [];
          totalRevenue = sales.reduce((sum, sale) => sum + (parseFloat(sale.amount) || 0), 0);
        }

        leaderboard.push({
          userId: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          bookingsMade: bookings.length,
          salesMade: sales.length,
          totalRevenue: totalRevenue,
          averageSale: sales.length > 0 ? totalRevenue / sales.length : 0,
          conversionRate: bookings.length > 0 ? Math.round((sales.length / bookings.length) * 100) : 0
        });
      }

      // Sort by bookings made (descending)
      leaderboard.sort((a, b) => b.bookingsMade - a.bookingsMade);

      return {
        metric: 'Most Bookings',
        timeframe,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        leaderboard: leaderboard.slice(0, 10) // Top 10
      };
    }

    if (metric === 'most_revenue') {
      // Get all users
      const { data: users } = await supabase
        .from('users')
        .select('id, name, email, role')
        .in('role', ['booker', 'admin']);

      // Get revenue for each user
      const leaderboard = [];

      for (const user of users) {
        // Get leads assigned to this user
        const { data: leads } = await supabase
          .from('leads')
          .select('id, booked_at')
          .eq('booker_id', user.id)
          .not('booked_at', 'is', null);

        const leadIds = leads.map(l => l.id);
        let totalRevenue = 0;
        let salesCount = 0;

        if (leadIds.length > 0) {
          const { data: sales } = await supabase
            .from('sales')
            .select('id, amount, created_at')
            .in('lead_id', leadIds)
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());

          salesCount = sales.length;
          totalRevenue = sales.reduce((sum, sale) => sum + (parseFloat(sale.amount) || 0), 0);
        }

        leaderboard.push({
          userId: user.id,
          name: user.name,
          bookingsMade: leads.length,
          salesMade: salesCount,
          totalRevenue: totalRevenue,
          averageSale: salesCount > 0 ? totalRevenue / salesCount : 0
        });
      }

      // Sort by revenue (descending)
      leaderboard.sort((a, b) => b.totalRevenue - a.totalRevenue);

      return {
        metric: 'Most Revenue',
        timeframe,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        leaderboard: leaderboard.slice(0, 10)
      };
    }

    throw new Error(`Unknown leaderboard metric: ${metric}`);
  } catch (error) {
    console.error(`Error calculating leaderboard ${metric}:`, error);
    throw error;
  }
}

/**
 * Helper: Calculate KPI metrics
 */
async function calculateKPI(metric, filters = {}) {
  const startDate = filters.startDate || new Date(new Date().setDate(new Date().getDate() - 7)).toISOString();
  const endDate = filters.endDate || new Date().toISOString();

  try {
    switch (metric) {
      case 'booking_rate': {
        // Get leads assigned
        const { data: assigned } = await supabase
          .from('leads')
          .select('id, assigned_at')
          .gte('assigned_at', startDate)
          .lte('assigned_at', endDate);

        // Get bookings made
        const { data: booked } = await supabase
          .from('leads')
          .select('id, booked_at')
          .not('booked_at', 'is', null)
          .gte('assigned_at', startDate)
          .lte('assigned_at', endDate);

        const rate = assigned.length > 0 ? Math.round((booked.length / assigned.length) * 100) : 0;
        return { metric: 'Booking Rate', value: `${rate}%`, assigned: assigned.length, booked: booked.length };
      }

      case 'show_up_rate': {
        // Get all bookings
        const { data: booked } = await supabase
          .from('leads')
          .select('id, status, booked_at')
          .not('booked_at', 'is', null);

        // Get attended
        const attended = booked.filter(lead => ['Attended', 'Complete'].includes(lead.status));

        const rate = booked.length > 0 ? Math.round((attended.length / booked.length) * 100) : 0;
        return { metric: 'Show Up Rate', value: `${rate}%`, booked: booked.length, attended: attended.length };
      }

      case 'sales_conversion_rate': {
        // Get attended leads
        const { data: attended } = await supabase
          .from('leads')
          .select('id, has_sale, status')
          .in('status', ['Attended', 'Complete']);

        // Get sales count
        const salesCount = attended.filter(lead => lead.has_sale === 1).length;

        const rate = attended.length > 0 ? Math.round((salesCount / attended.length) * 100) : 0;
        return { metric: 'Sales Conversion Rate', value: `${rate}%`, attended: attended.length, sales: salesCount };
      }

      default:
        throw new Error(`Unknown KPI metric: ${metric}`);
    }
  } catch (error) {
    console.error(`Error calculating KPI ${metric}:`, error);
    throw error;
  }
}

/**
 * Helper: Execute Supabase query from structure
 */
async function executeQuery(queryStructure) {
  const { table, select, filters, order, limit } = queryStructure;

  // Resolve any user lookups
  const resolvedFilters = await resolveUserLookups(filters);

  // Check if this is a count query
  const isCountQuery = select && (select.toLowerCase().includes('count(') || select === 'count');

  // Check if this is an aggregate query (sum, avg, etc.)
  const aggregateMatch = select && select.toLowerCase().match(/(sum|avg|min|max)\s*\(\s*(\w+)\s*\)/);
  const isAggregateQuery = !!aggregateMatch;

  // Start building query
  let query;
  if (isCountQuery) {
    // For count queries, use Supabase's count feature
    query = supabase.from(table).select('*', { count: 'exact', head: true });
  } else if (isAggregateQuery) {
    // For aggregate queries, fetch all data and calculate in-memory
    const column = aggregateMatch[2];
    query = supabase.from(table).select(column);
  } else {
    // For regular queries, use the select as provided
    query = supabase.from(table).select(select || '*');
  }
  
  // Apply filters
  if (resolvedFilters && Array.isArray(resolvedFilters)) {
    for (const filter of resolvedFilters) {
      const { column, operator, value } = filter;
      
      switch (operator) {
        case 'eq':
          query = query.eq(column, value);
          break;
        case 'neq':
          query = query.neq(column, value);
          break;
        case 'gt':
          query = query.gt(column, value);
          break;
        case 'gte':
          query = query.gte(column, value);
          break;
        case 'lt':
          query = query.lt(column, value);
          break;
        case 'lte':
          query = query.lte(column, value);
          break;
        case 'like':
          query = query.like(column, value);
          break;
        case 'ilike':
          query = query.ilike(column, value);
          break;
        case 'in':
          query = query.in(column, value);
          break;
      }
    }
  }
  
  // Apply ordering (not needed for count/aggregate queries)
  if (order && !isCountQuery && !isAggregateQuery) {
    query = query.order(order.column, { ascending: order.ascending });
  }

  // Apply limit (not needed for count/aggregate queries)
  if (limit && !isCountQuery && !isAggregateQuery) {
    query = query.limit(limit);
  }

  // Execute query
  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Database query failed: ${error.message}`);
  }

  // For count queries, return the count as data
  if (isCountQuery) {
    return [{ count: count || 0 }];
  }

  // For aggregate queries, calculate in-memory
  if (isAggregateQuery) {
    const aggregateType = aggregateMatch[1].toLowerCase();
    const column = aggregateMatch[2];

    if (!data || data.length === 0) {
      return [{ [aggregateType]: 0 }];
    }

    let result;
    const values = data.map(row => parseFloat(row[column]) || 0);

    switch (aggregateType) {
      case 'sum':
        result = values.reduce((sum, val) => sum + val, 0);
        break;
      case 'avg':
        result = values.reduce((sum, val) => sum + val, 0) / values.length;
        break;
      case 'min':
        result = Math.min(...values);
        break;
      case 'max':
        result = Math.max(...values);
        break;
    }

    return [{
      [aggregateType]: result,
      total_revenue: aggregateType === 'sum' && column === 'amount' ? result : undefined,
      count: data.length
    }];
  }

  return data;
}

/**
 * @route   POST /api/ai-assistant/query
 * @desc    Process natural language query
 * @access  Admin only
 */
router.post('/query', auth, adminAuth, async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required' });
    }
    
    // Check if Gemini is available
    if (!geminiService.isAvailable()) {
      return res.status(503).json({ 
        error: 'AI service is not configured. Please add GEMINI_API_KEY to environment variables.',
        setupRequired: true
      });
    }
    
    console.log(`🤖 AI Query from ${req.user.name}: "${question}"`);

    // Step 1: Check if this is a leaderboard query (FASTEST - pre-built)
    const leaderboardQuery = geminiService.detectLeaderboardQuery(question);

    if (leaderboardQuery) {
      console.log(`🏆 Detected leaderboard query: ${leaderboardQuery.metric} (${leaderboardQuery.timeframe})`);

      try {
        const leaderboardData = await getLeaderboard(leaderboardQuery.metric, leaderboardQuery.timeframe);

        const response = await geminiService.formatResponse(
          question,
          leaderboardData,
          `Leaderboard for ${leaderboardQuery.metric} in ${leaderboardQuery.timeframe}`
        );

        return res.json({
          question,
          response,
          data: leaderboardData,
          queryType: 'leaderboard',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error(`❌ Leaderboard query failed: ${error.message}`);
        // Fall through to other methods
      }
    }

    // Step 2: Check if this should use a CRM endpoint
    const endpointQuery = geminiService.detectEndpointQuery(question);

    if (endpointQuery) {
      console.log(`🔗 Detected endpoint query: ${endpointQuery.endpoint}`);

      // Build parameters based on query needs
      const params = {};
      const today = new Date().toISOString().split('T')[0];

      if (endpointQuery.needsDateRange) {
        // Default to last 7 days
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        params.startDate = weekAgo.toISOString().split('T')[0];
        params.endDate = today;
      }

      if (endpointQuery.needsDate) {
        params.date = today;
      }

      // Get auth token from request
      const authToken = req.headers.authorization?.replace('Bearer ', '');

      try {
        const endpointData = await callCRMEndpoint(endpointQuery.endpoint, params, authToken);

        const response = await geminiService.formatResponse(
          question,
          endpointData,
          `Fetched data from ${endpointQuery.endpoint} endpoint`
        );

        return res.json({
          question,
          response,
          data: endpointData,
          queryType: 'endpoint',
          endpoint: endpointQuery.endpoint,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error(`❌ Endpoint query failed: ${error.message}`);
        // Fall through to regular query handling
      }
    }

    // Step 2: Check if this is a KPI query
    const kpiMetric = geminiService.detectKPIQuery(question);

    if (kpiMetric) {
      // Handle KPI calculation
      console.log(`📊 Detected KPI query: ${kpiMetric}`);
      const kpiData = await calculateKPI(kpiMetric);

      const response = await geminiService.formatResponse(
        question,
        kpiData,
        `Calculated ${kpiData.metric}`
      );

      return res.json({
        question,
        response,
        data: kpiData,
        queryType: 'kpi',
        timestamp: new Date().toISOString()
      });
    }

    // Step 1: Convert question to query structure
    const queryStructure = await geminiService.convertToSQL(question);
    console.log('📊 Generated query structure:', JSON.stringify(queryStructure, null, 2));

    // Step 2: Execute query
    const data = await executeQuery(queryStructure);
    console.log(`✅ Query returned ${Array.isArray(data) ? data.length : 1} result(s)`);

    // Step 3: Format response
    const response = await geminiService.formatResponse(
      question,
      data,
      queryStructure.explanation
    );

    res.json({
      question,
      response,
      data,
      queryStructure,
      queryType: 'sql',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ AI Assistant error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process query',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route   GET /api/ai-assistant/examples
 * @desc    Get example questions
 * @access  Admin only
 */
router.get('/examples', auth, adminAuth, async (req, res) => {
  try {
    const examples = geminiService.getExampleQuestions();
    res.json({ examples });
  } catch (error) {
    console.error('❌ Error getting examples:', error);
    res.status(500).json({ error: 'Failed to get examples' });
  }
});

/**
 * @route   GET /api/ai-assistant/status
 * @desc    Check AI service status
 * @access  Admin only
 */
router.get('/status', auth, adminAuth, async (req, res) => {
  try {
    const isAvailable = geminiService.isAvailable();
    res.json({ 
      available: isAvailable,
      message: isAvailable 
        ? 'AI Assistant is ready' 
        : 'AI Assistant requires GEMINI_API_KEY configuration'
    });
  } catch (error) {
    console.error('❌ Error checking status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

module.exports = router;

