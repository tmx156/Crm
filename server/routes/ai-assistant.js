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
  },

  // Demographic Analytics
  leadAnalyticsSummary: {
    path: '/api/lead-analytics/summary',
    method: 'GET',
    params: ['startDate', 'endDate'],
    description: 'Get real leads/sales/revenue/conversion-rate breakdown by age bracket and postcode area (joins leads and sales tables)'
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
 * Helper: Compute a {startDate, endDate} range for a named timeframe.
 * Shared by getLeaderboard and calculateKPI so both use identical date math.
 * Weeks run Monday-Sunday (UK convention), not Sunday-Saturday.
 */
function computeDateRange(timeframe = 'week') {
  const now = new Date();
  let startDate, endDate;

  // getDay(): 0=Sun..6=Sat, so days-since-Monday = (day + 6) % 7.
  const mondayOf = (date) => {
    const d = new Date(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    d.setHours(0, 0, 0, 0);
    return d;
  };

  switch (timeframe) {
    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      startDate = new Date(yesterday);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(yesterday);
      endDate.setHours(23, 59, 59, 999);
      break;
    }
    case 'today':
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'week':
      startDate = mondayOf(now);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'last_week': {
      const thisMonday = mondayOf(now);
      startDate = new Date(thisMonday);
      startDate.setDate(thisMonday.getDate() - 7);
      endDate = new Date(thisMonday);
      endDate.setDate(thisMonday.getDate() - 1); // last Sunday
      endDate.setHours(23, 59, 59, 999);
      break;
    }
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'last_month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0); // last day of previous month
      endDate.setHours(23, 59, 59, 999);
      break;
    default:
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
      endDate = new Date(now);
  }

  return { startDate, endDate };
}

/**
 * Helper: Get leaderboard data (fast pre-built queries)
 */
async function getLeaderboard(metric, timeframe = 'week') {
  const { startDate, endDate } = computeDateRange(timeframe);

  try {
    if (metric === 'most_bookings') {
      // Get all users
      const { data: users } = await supabase
        .from('users')
        .select('id, name, email, role')
        .in('role', ['booker', 'admin']);

      // Get bookings for each user (fetched in parallel, not one-by-one)
      const leaderboard = await Promise.all(users.map(async (user) => {
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

        return {
          userId: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          bookingsMade: bookings.length,
          salesMade: sales.length,
          totalRevenue: totalRevenue,
          averageSale: sales.length > 0 ? totalRevenue / sales.length : 0,
          conversionRate: bookings.length > 0 ? Math.round((sales.length / bookings.length) * 100) : 0
        };
      }));

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

      // Get revenue for each user (fetched in parallel, not one-by-one)
      const leaderboard = await Promise.all(users.map(async (user) => {
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

        return {
          userId: user.id,
          name: user.name,
          bookingsMade: leads.length,
          salesMade: salesCount,
          totalRevenue: totalRevenue,
          averageSale: salesCount > 0 ? totalRevenue / salesCount : 0
        };
      }));

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
 *
 * Uses Supabase's exact `count` (head: true) rather than fetching rows -
 * fetching rows silently truncates at Supabase's default 1000-row page size,
 * which previously made show_up_rate compute against 1000 of 6000+ real rows.
 * Counting server-side avoids that cap entirely and is cheaper besides.
 */
async function calculateKPI(metric, timeframe = 'week') {
  const { startDate, endDate } = computeDateRange(timeframe);
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  const exactCount = async (build) => {
    const { count, error } = await build(supabase.from('leads').select('*', { count: 'exact', head: true }));
    if (error) throw new Error(error.message);
    return count || 0;
  };

  try {
    switch (metric) {
      case 'booking_rate': {
        const assignedCount = await exactCount(q => q.gte('assigned_at', startIso).lte('assigned_at', endIso));
        const bookedCount = await exactCount(q => q.not('booked_at', 'is', null).gte('assigned_at', startIso).lte('assigned_at', endIso));

        const rate = assignedCount > 0 ? Math.round((bookedCount / assignedCount) * 100) : 0;
        return { metric: 'Booking Rate', value: `${rate}%`, assigned: assignedCount, booked: bookedCount, timeframe, startDate: startIso, endDate: endIso };
      }

      case 'show_up_rate': {
        // Scoped by date_booked (the appointment date), matching how "this
        // week's appointments" is defined elsewhere in this file.
        const bookedCount = await exactCount(q => q.not('booked_at', 'is', null).gte('date_booked', startIso).lte('date_booked', endIso));
        const attendedCount = await exactCount(q => q.not('booked_at', 'is', null).in('status', ['Attended', 'Complete']).gte('date_booked', startIso).lte('date_booked', endIso));

        const rate = bookedCount > 0 ? Math.round((attendedCount / bookedCount) * 100) : 0;
        return { metric: 'Show Up Rate', value: `${rate}%`, booked: bookedCount, attended: attendedCount, timeframe, startDate: startIso, endDate: endIso };
      }

      case 'sales_conversion_rate': {
        const attendedCount = await exactCount(q => q.in('status', ['Attended', 'Complete']).gte('date_booked', startIso).lte('date_booked', endIso));
        const salesCount = await exactCount(q => q.in('status', ['Attended', 'Complete']).eq('has_sale', 1).gte('date_booked', startIso).lte('date_booked', endIso));

        const rate = attendedCount > 0 ? Math.round((salesCount / attendedCount) * 100) : 0;
        return { metric: 'Sales Conversion Rate', value: `${rate}%`, attended: attendedCount, sales: salesCount, timeframe, startDate: startIso, endDate: endIso };
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
 * Helper: fetch every row matching a filter, paginating past Supabase's
 * default 1000-row page size. Shared by the multi-metric handlers below,
 * which need true totals (not a truncated sample) to sum/bucket correctly.
 */
async function fetchAllPaginated(table, selectCols, applyFilters) {
  let all = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    let query = supabase.from(table).select(selectCols);
    query = applyFilters(query);
    const { data, error } = await query.range(from, from + batchSize - 1);
    if (error) throw new Error(`Database query failed: ${error.message}`);
    all = all.concat(data || []);
    if (!data || data.length < batchSize) break;
    from += batchSize;
  }
  return all;
}

/**
 * Helper: Comprehensive report - every key metric for one period, combined.
 * All counts use Supabase's exact `count` (no row truncation risk); the two
 * metrics that need real row values (avg age, revenue) use fetchAllPaginated
 * rather than a single unpaginated fetch, for the same reason.
 */
async function getComprehensiveReport(timeframe = 'week') {
  const { startDate, endDate } = computeDateRange(timeframe);
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  const exactCount = async (build) => {
    const { count, error } = await build(supabase.from('leads').select('*', { count: 'exact', head: true }));
    if (error) throw new Error(error.message);
    return count || 0;
  };

  const [assignedCount, bookedCount, appointmentsCount, attendedCount, ageRows, salesRows] = await Promise.all([
    exactCount(q => q.gte('assigned_at', startIso).lte('assigned_at', endIso)),
    exactCount(q => q.not('booked_at', 'is', null).gte('booked_at', startIso).lte('booked_at', endIso)),
    exactCount(q => q.not('booked_at', 'is', null).gte('date_booked', startIso).lte('date_booked', endIso)),
    exactCount(q => q.not('booked_at', 'is', null).in('status', ['Attended', 'Complete']).gte('date_booked', startIso).lte('date_booked', endIso)),
    fetchAllPaginated('leads', 'age', q => q.gte('assigned_at', startIso).lte('assigned_at', endIso).gte('age', 0).lte('age', 100)),
    fetchAllPaginated('sales', 'amount', q => q.gte('created_at', startIso).lte('created_at', endIso)),
  ]);

  const avgAge = ageRows.length > 0 ? ageRows.reduce((s, r) => s + (parseFloat(r.age) || 0), 0) / ageRows.length : null;
  const salesCount = salesRows.length;
  const revenue = salesRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const bookingRate = assignedCount > 0 ? Math.round((bookedCount / assignedCount) * 100) : 0;
  const showUpRate = appointmentsCount > 0 ? Math.round((attendedCount / appointmentsCount) * 100) : 0;
  const conversionRate = attendedCount > 0 ? Math.round((salesCount / attendedCount) * 100) : 0;

  return {
    metric: 'Comprehensive Report',
    timeframe,
    startDate: startIso,
    endDate: endIso,
    leadsAssigned: assignedCount,
    bookingsMade: bookedCount,
    appointmentsScheduled: appointmentsCount,
    appointmentsAttended: attendedCount,
    salesMade: salesCount,
    totalRevenue: Math.round(revenue * 100) / 100,
    averageSaleValue: salesCount > 0 ? Math.round((revenue / salesCount) * 100) / 100 : 0,
    averageLeadAge: avgAge !== null ? Math.round(avgAge * 10) / 10 : null,
    bookingRate: `${bookingRate}%`,
    showUpRate: `${showUpRate}%`,
    conversionRate: `${conversionRate}%`
  };
}

/**
 * Helper: Daily or weekly breakdown across a period. Fetches every matching
 * row ONCE (paginated) and buckets in memory, rather than one DB round trip
 * per day/week - keeps this to 3 queries total regardless of range length.
 */
async function getBreakdown(timeframe, granularity = 'day') {
  const { startDate, endDate } = computeDateRange(timeframe);
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  const [bookedLeads, assignedLeads, sales] = await Promise.all([
    fetchAllPaginated('leads', 'id, booked_at, date_booked, status, has_sale', q =>
      q.not('booked_at', 'is', null).gte('booked_at', startIso).lte('booked_at', endIso)),
    fetchAllPaginated('leads', 'id, assigned_at', q =>
      q.gte('assigned_at', startIso).lte('assigned_at', endIso)),
    fetchAllPaginated('sales', 'id, lead_id, amount, created_at', q =>
      q.gte('created_at', startIso).lte('created_at', endIso)),
  ]);

  // Local (not UTC) calendar date string - toISOString() shifts the date in
  // any non-UTC timezone (e.g. BST is UTC+1, so a UK midnight becomes the
  // previous day in UTC), which silently bucketed everything one day early.
  const localDateStr = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Weeks bucket to their Monday (UK convention), matching computeDateRange.
  const bucketKey = (dateStr) => {
    const d = new Date(dateStr);
    if (granularity === 'week') {
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    }
    return localDateStr(d);
  };

  const buckets = new Map();
  const getBucket = (key) => {
    if (!buckets.has(key)) {
      buckets.set(key, { period: key, leadsAssigned: 0, bookingsMade: 0, salesMade: 0, revenue: 0 });
    }
    return buckets.get(key);
  };

  // Pre-populate every period in the range, so a day/week with zero activity
  // shows as 0 instead of silently not appearing at all. For weekly buckets,
  // start from the Monday-snapped key so stepping by 7 days stays aligned
  // with how real data gets bucketed above (bucketKey() also snaps to Monday).
  const step = granularity === 'week' ? 7 : 1;
  let cursor = granularity === 'week' ? new Date(bucketKey(startDate)) : new Date(startDate);
  for (; cursor <= endDate; cursor.setDate(cursor.getDate() + step)) {
    getBucket(bucketKey(cursor));
  }

  for (const lead of assignedLeads) getBucket(bucketKey(lead.assigned_at)).leadsAssigned++;
  for (const lead of bookedLeads) getBucket(bucketKey(lead.booked_at)).bookingsMade++;
  for (const sale of sales) {
    const bucket = getBucket(bucketKey(sale.created_at));
    bucket.salesMade++;
    bucket.revenue += parseFloat(sale.amount) || 0;
  }

  const breakdown = Array.from(buckets.values())
    .map(b => ({ ...b, revenue: Math.round(b.revenue * 100) / 100 }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    metric: granularity === 'week' ? 'Weekly Breakdown' : 'Daily Breakdown',
    timeframe,
    startDate: startIso,
    endDate: endIso,
    breakdown
  };
}

/**
 * Helper: Sales that came from bookings (i.e. the underlying lead has a
 * booked_at timestamp), vs. total sales in the period. Sales and leads live
 * in separate tables with no PostgREST embed configured between them here,
 * so this joins them manually in batches, the same pattern lead-analytics.js
 * already uses for the same reason.
 */
async function getSalesFromBookings(timeframe = 'week') {
  const { startDate, endDate } = computeDateRange(timeframe);
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  const sales = await fetchAllPaginated('sales', 'id, lead_id, amount, created_at', q =>
    q.gte('created_at', startIso).lte('created_at', endIso));

  const leadIds = [...new Set(sales.map(s => s.lead_id).filter(Boolean))];
  const leadLookup = {};
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const { data, error } = await supabase.from('leads').select('id, name, booked_at').in('id', chunk);
    if (error) throw new Error(error.message);
    for (const lead of data || []) leadLookup[lead.id] = lead;
  }

  const fromBookings = sales.filter(s => s.lead_id && leadLookup[s.lead_id]?.booked_at);
  const totalRevenue = sales.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const revenueFromBookings = fromBookings.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  return {
    metric: 'Sales From Bookings',
    timeframe,
    startDate: startIso,
    endDate: endIso,
    totalSales: sales.length,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    salesFromBookings: fromBookings.length,
    revenueFromBookings: Math.round(revenueFromBookings * 100) / 100,
    percentageFromBookings: sales.length > 0 ? Math.round((fromBookings.length / sales.length) * 100) : 0
  };
}

/**
 * Helper: Execute Supabase query from structure
 */
async function executeQuery(queryStructure) {
  const { table, select, filters, order, limit } = queryStructure;

  // Resolve any user lookups
  const resolvedFilters = await resolveUserLookups(filters);

  // Reject multi-metric selects this executor can't actually run (CASE WHEN,
  // column aliasing, more than one aggregate combined in one select) instead
  // of silently matching the plain isCountQuery substring check below and
  // returning one unrelated total for a question that asked for several
  // different numbers at once (e.g. "comprehensive report" style questions
  // asking for bookings + sales + revenue + average age all together).
  if (select && (/case\s+when/i.test(select) || /\bas\s+\w+/i.test(select) || (select.match(/count\(|sum\(|avg\(|min\(|max\(/gi) || []).length > 1)) {
    throw new Error(`This question needs several different metrics combined in one query ("${select}"), which isn't supported yet. Try asking about one metric at a time (e.g. bookings, sales, or attendance separately).`);
  }

  // Check if this is a "group by column, count(*)" query, e.g. "age, count(*)"
  // Must be checked before isCountQuery below - otherwise the substring match
  // on "count(" would swallow the grouping intent and silently collapse this
  // into a single ungrouped total (which then feeds a hallucinated breakdown
  // downstream, since the requesting question expected a breakdown by column).
  const groupByMatch = select && select.match(/^\s*(\w+)\s*,\s*count\(\*\)\s*$/i);

  // Check if this is a count query
  const isCountQuery = !groupByMatch && select && (select.toLowerCase().includes('count(') || select === 'count');

  // Check if this is an aggregate query (sum, avg, etc.)
  const aggregateMatch = !groupByMatch && select && select.toLowerCase().match(/(sum|avg|min|max)\s*\(\s*(\w+)\s*\)/);
  const isAggregateQuery = !!aggregateMatch;

  // Apply the parsed filter list to a fresh Supabase query builder for the
  // given select. Extracted so both the paginated fetch (group-by/aggregate)
  // and the single-shot fetch (plain row queries) build identical filters.
  const buildFilteredQuery = (selectCols, options) => {
    let q = supabase.from(table).select(selectCols, options);
    if (resolvedFilters && Array.isArray(resolvedFilters)) {
      for (const filter of resolvedFilters) {
        const { column, operator, value } = filter;
        switch (operator) {
          case 'eq': q = q.eq(column, value); break;
          case 'neq': q = q.neq(column, value); break;
          case 'gt': q = q.gt(column, value); break;
          case 'gte': q = q.gte(column, value); break;
          case 'lt': q = q.lt(column, value); break;
          case 'lte': q = q.lte(column, value); break;
          case 'like': q = q.like(column, value); break;
          case 'ilike': q = q.ilike(column, value); break;
          case 'in': q = q.in(column, value); break;
        }
      }
    }
    return q;
  };

  // Fetch every matching row for a column, paginating past Supabase's default
  // 1000-row page size. Required for group-by/aggregate queries - fetching a
  // single unpaginated page silently truncates on any table bigger than 1000
  // rows (leads alone has 12,000+), producing a confidently wrong number
  // instead of an error.
  const fetchAllRows = async (selectCols) => {
    let all = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      const { data, error } = await buildFilteredQuery(selectCols).range(from, from + batchSize - 1);
      if (error) throw new Error(`Database query failed: ${error.message}`);
      all = all.concat(data || []);
      if (!data || data.length < batchSize) break;
      from += batchSize;
    }
    return all;
  };

  // For group-by queries, count occurrences per distinct value in-memory
  if (groupByMatch) {
    const groupColumn = groupByMatch[1];
    const rows = await fetchAllRows(groupColumn);
    const counts = new Map();
    for (const row of rows) {
      const key = row[groupColumn] === null || row[groupColumn] === undefined ? 'Unknown' : row[groupColumn];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let grouped = Array.from(counts.entries()).map(([value, cnt]) => ({ [groupColumn]: value, count: cnt }));
    grouped.sort((a, b) => b.count - a.count);
    if (limit) grouped = grouped.slice(0, limit);
    return grouped;
  }

  // For count queries, use Supabase's exact count feature (not subject to
  // the 1000-row page cap since no rows are actually returned)
  if (isCountQuery) {
    const { count, error } = await buildFilteredQuery('*', { count: 'exact', head: true });
    if (error) throw new Error(`Database query failed: ${error.message}`);
    return [{ count: count || 0 }];
  }

  // For aggregate queries, fetch every matching row and calculate in-memory
  if (isAggregateQuery) {
    const aggregateType = aggregateMatch[1].toLowerCase();
    const column = aggregateMatch[2];
    const data = await fetchAllRows(column);

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

  // Regular row query - order/limit are applied at the DB level as requested
  // (the limit here is a deliberate "top N rows" ask, not an all-rows scan,
  // so no pagination is needed)
  let query = buildFilteredQuery(select || '*');
  if (order) query = query.order(order.column, { ascending: order.ascending });
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(`Database query failed: ${error.message}`);
  return data;
}

/**
 * @route   POST /api/ai-assistant/query
 * @desc    Process natural language query
 * @access  Admin only
 */
router.post('/query', auth, adminAuth, async (req, res) => {
  try {
    const { question, previousQuestion, previousData } = req.body;
    
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
          `Leaderboard for ${leaderboardQuery.metric} in ${leaderboardQuery.timeframe}`,
          { previousQuestion, previousData }
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

    // Step 1b: Check if this needs a multi-metric handler (comprehensive
    // report, daily/weekly breakdown, sales-from-bookings) - these combine
    // several numbers or group by period, which the generic single-table SQL
    // fallback further down cannot do.
    const multiMetricQuery = geminiService.detectMultiMetricQuery(question);

    if (multiMetricQuery) {
      console.log(`📈 Detected multi-metric query: ${multiMetricQuery.type} (${multiMetricQuery.timeframe})`);

      try {
        let multiMetricData;
        let explanation;
        if (multiMetricQuery.type === 'comprehensive') {
          multiMetricData = await getComprehensiveReport(multiMetricQuery.timeframe);
          explanation = `Comprehensive report for ${multiMetricQuery.timeframe}`;
        } else if (multiMetricQuery.type === 'breakdown') {
          multiMetricData = await getBreakdown(multiMetricQuery.timeframe, multiMetricQuery.granularity);
          explanation = `${multiMetricQuery.granularity === 'week' ? 'Weekly' : 'Daily'} breakdown for ${multiMetricQuery.timeframe}`;
        } else if (multiMetricQuery.type === 'salesFromBookings') {
          multiMetricData = await getSalesFromBookings(multiMetricQuery.timeframe);
          explanation = `Sales from bookings for ${multiMetricQuery.timeframe}`;
        }

        const response = await geminiService.formatResponse(
          question,
          multiMetricData,
          explanation,
          { previousQuestion, previousData }
        );

        return res.json({
          question,
          response,
          data: multiMetricData,
          queryType: multiMetricQuery.type,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error(`❌ Multi-metric query failed: ${error.message}`);
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

      if (endpointQuery.needsWideDateRange) {
        // Demographic/breakdown questions ("which age group buys most") aren't
        // asking about a specific week - default to a full year so the answer
        // reflects real overall patterns, not a thin 7-day slice.
        const yearAgo = new Date();
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        params.startDate = yearAgo.toISOString().split('T')[0];
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
          `Fetched data from ${endpointQuery.endpoint} endpoint`,
          { previousQuestion, previousData }
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
    const kpiQuery = geminiService.detectKPIQuery(question);

    if (kpiQuery) {
      // Handle KPI calculation
      console.log(`📊 Detected KPI query: ${kpiQuery.metric} (${kpiQuery.timeframe})`);
      const kpiData = await calculateKPI(kpiQuery.metric, kpiQuery.timeframe);

      const response = await geminiService.formatResponse(
        question,
        kpiData,
        `Calculated ${kpiData.metric}`,
        { previousQuestion, previousData }
      );

      return res.json({
        question,
        response,
        data: kpiData,
        queryType: 'kpi',
        timestamp: new Date().toISOString()
      });
    }

    // Step 1: Convert question to query structure (passing the prior exchange
    // so follow-ups like "give me in percentages" or "what about last week"
    // can be resolved instead of answered with zero context)
    const queryStructure = await geminiService.convertToSQL(question, { previousQuestion, previousData });
    console.log('📊 Generated query structure:', JSON.stringify(queryStructure, null, 2));

    // Step 2: Execute query
    const data = await executeQuery(queryStructure);
    console.log(`✅ Query returned ${Array.isArray(data) ? data.length : 1} result(s)`);

    // Step 3: Format response
    const response = await geminiService.formatResponse(
      question,
      data,
      queryStructure.explanation,
      { previousQuestion, previousData }
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

