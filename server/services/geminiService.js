/**
 * Google Gemini AI Service
 * Handles natural language queries and converts them to database queries
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

class GeminiService {
  constructor() {
    this.apiKey = config.gemini?.apiKey || process.env.GEMINI_API_KEY;
    this.genAI = null;
    this.model = null;
    
    if (this.apiKey) {
      try {
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        const modelName = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
        this.model = this.genAI.getGenerativeModel({ model: modelName });
        console.log(`✅ Gemini AI service initialized with ${modelName}`);
      } catch (error) {
        console.error('❌ Failed to initialize Gemini AI:', error.message);
      }
    } else {
      console.warn('⚠️ Gemini API key not found. AI Assistant will not work.');
    }
  }

  isAvailable() {
    return !!this.model;
  }

  /**
   * Wraps model.generateContent with a single retry on rate-limit (429)
   * errors, using Google's own suggested retryDelay from the error body when
   * present (capped at 20s) instead of guessing. Free-tier quota is easy to
   * hit under normal use (multiple admins asking questions back-to-back) -
   * one short wait turns a guaranteed-visible error into a normal response
   * most of the time.
   */
  async generateContentWithRetry(prompt, maxRetries = 1) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.model.generateContent(prompt);
      } catch (error) {
        const message = error?.message || '';
        const is429 = error?.status === 429 || /429|rate.?limit|quota/i.test(message);
        if (!is429 || attempt >= maxRetries) throw error;

        const match = /"retryDelay":"(\d+(?:\.\d+)?)s"/.exec(message);
        const delaySeconds = match ? Math.min(parseFloat(match[1]) + 1, 20) : 5;
        console.warn(`⏳ Gemini rate-limited, retrying in ${delaySeconds}s (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      }
    }
  }

  /**
   * Database schema for context
   */
  getDatabaseSchema() {
    return `
Database Schema:

1. users table:
   - id (UUID)
   - name (text)
   - email (text)
   - role (text): 'admin', 'booker', 'closer'
   - created_at (timestamp)

2. leads table:
   - id (UUID)
   - name (text)
   - phone (text)
   - email (text)
   - age (integer) - valid range is 0-100. A small number of rows contain data-entry errors (e.g. a birth year or full birthdate typed into this field, like 1900 or 18061979) which are NOT real ages. ALWAYS add filters {"column":"age","operator":"gte","value":0} and {"column":"age","operator":"lte","value":100} when computing an average/min/max/typical age or any age-based statistic, otherwise a handful of garbage values will wildly skew the result.
   - postcode (text)
   - status (text): 'New', 'Assigned', 'Contacted', 'Booked', 'Attended', 'Cancelled', 'No Answer', 'Not Interested', 'Sale'
   - date_booked (timestamp) - when the appointment is scheduled (future date)
   - booked_at (timestamp) - when the booking action was made (tracks conversion)
   - assigned_at (timestamp) - when lead was assigned to booker
   - booker_id (UUID) - references users.id
   - created_by_user_id (UUID)
   - has_sale (integer): 0 or 1
   - created_at (timestamp)
   - updated_at (timestamp)

3. sales table:
   - id (UUID)
   - lead_id (UUID) - references leads.id
   - user_id (UUID) - who made the sale
   - amount (numeric)
   - payment_method (text)
   - payment_type (text): 'full_payment', 'finance'
   - payment_status (text)
   - status (text)
   - created_at (timestamp)
   - updated_at (timestamp)

4. messages table:
   - id (UUID)
   - lead_id (UUID) - references leads.id
   - type (text): 'sms', 'email'
   - content (text) - SMS body (legacy column)
   - sms_body (text)
   - email_body (text)
   - subject (text) - email subject
   - recipient_email (text)
   - sent_by (UUID) - references users.id
   - sent_by_name (text)
   - status (text): e.g. 'sent', 'received', 'failed'
   - email_status (text)
   - read_status (text)
   - delivery_status (text)
   - error_message (text)
   - sent_at (timestamp)
   - created_at (timestamp)

IMPORTANT: Understanding Bookings vs Status
- A "booking" is ANY lead with a booked_at timestamp (regardless of current status)
- Leads progress: New → Assigned → Booked → Attended → Sale
- Once booked, they keep booked_at timestamp even when status changes to Attended/Sale
- Status shows CURRENT state, booked_at shows if they were EVER booked

Common Queries:
- Total Bookings Made: COUNT leads WHERE booked_at IS NOT NULL (NOT status = 'Booked')
- Bookings This Week: WHERE booked_at >= start_of_week
- Leads Assigned: WHERE assigned_at >= date_range
- Appointments Scheduled This Week: WHERE date_booked >= current_week_start AND date_booked <= current_week_end
- Appointments Scheduled Next Week: WHERE date_booked >= next_week_start AND date_booked <= next_week_end
- Sales from Bookings: JOIN sales ON sales.lead_id = leads.id WHERE leads.booked_at IS NOT NULL
- Booking Rate: (COUNT booked_at) / (COUNT assigned_at) * 100
- Show Up Rate: (COUNT status = 'Attended') / (COUNT booked_at) * 100
- Sales Conversion Rate: (COUNT has_sale = 1) / (COUNT status = 'Attended') * 100
- Messages/Texts Sent: COUNT messages WHERE type = 'sms' AND sent_at >= date_range
- Emails Sent: COUNT messages WHERE type = 'email' AND sent_at >= date_range
- Messages for a Lead: messages WHERE lead_id = '<lead id>' ORDER BY created_at

Date Filters:
- Weeks run Monday to Sunday (UK convention)
- This week: >= start of current week (Monday)
- Last week: >= start of last week (Monday) AND <= end of last week (Sunday) - NOT the same range as this week
- Leads assigned today: assigned_at >= today AND assigned_at < tomorrow
- Bookings made today: booked_at >= today AND booked_at < tomorrow
- Appointments scheduled for today: date_booked >= today AND date_booked < tomorrow
`;
  }

  /**
   * Detect if question should use a CRM endpoint instead of raw SQL
   */
  detectEndpointQuery(question) {
    const lowerQuestion = question.toLowerCase();

    // Note: comprehensive-report / daily-breakdown-report / monthly-breakdown-report
    // / sales-from-bookings used to be matched here, pointing at HTTP routes that
    // don't exist anywhere in the server. detectMultiMetricQuery() below now
    // handles these questions instead, dispatching to real in-process handlers.

    // Daily Activities queries
    if ((lowerQuestion.includes('daily') || lowerQuestion.includes('today')) &&
        lowerQuestion.includes('analytic')) {
      return { endpoint: 'dailyAnalytics', needsDate: true };
    }

    if (lowerQuestion.includes('hourly') || lowerQuestion.includes('hour by hour')) {
      return { endpoint: 'hourlyActivity', needsDate: true };
    }

    if (lowerQuestion.includes('team performance') || lowerQuestion.includes('team stats')) {
      return { endpoint: 'teamPerformance', needsDate: true };
    }

    // Calendar queries. Word-level check (not an exact phrase) so "appointments
    // are scheduled" / "appointments that are scheduled" etc. still match -
    // "What appointments are scheduled for tomorrow?" is one of the example
    // questions shown on the page and must actually route here.
    if (lowerQuestion.includes('calendar') ||
        (lowerQuestion.includes('appointment') && lowerQuestion.includes('schedul')) ||
        (lowerQuestion.includes('booking') && lowerQuestion.includes('schedul'))) {
      return { endpoint: 'calendar', needsDateRange: true };
    }

    // Dashboard
    if (lowerQuestion.includes('dashboard') || lowerQuestion.includes('overview')) {
      return { endpoint: 'dashboard', needsNothing: true };
    }

    // Demographic queries (age, area/postcode breakdowns) - these need a real
    // join between leads and sales, which the generic SQL fallback cannot do.
    // Word-boundary matches only - a plain includes('age') also matches
    // "average", "message", "manage", etc. and misroutes them here.
    if (/\bages?\b/.test(lowerQuestion) ||
        lowerQuestion.includes('demographic') ||
        lowerQuestion.includes('postcode') ||
        /\bareas?\b/.test(lowerQuestion) ||
        (/\bregions?\b/.test(lowerQuestion) && (lowerQuestion.includes('sale') || lowerQuestion.includes('lead')))) {
      return { endpoint: 'leadAnalyticsSummary', needsWideDateRange: true };
    }

    return null;
  }

  /**
   * Detect multi-metric questions (comprehensive report, daily/weekly
   * breakdown, sales-from-bookings) that need several numbers combined or
   * grouped by period at once - the generic SQL fallback can only run one
   * single-table aggregate/group-by per question, so these need their own
   * dedicated handlers (see getComprehensiveReport/getBreakdown/
   * getSalesFromBookings in ai-assistant.js).
   */
  detectMultiMetricQuery(question) {
    const lowerQuestion = question.toLowerCase();

    if (lowerQuestion.includes('sales from bookings') ||
        lowerQuestion.includes('sales came from') ||
        lowerQuestion.includes('sales details') ||
        lowerQuestion.includes('which bookings converted')) {
      return { type: 'salesFromBookings', timeframe: this.extractTimeframe(lowerQuestion, 'week') };
    }

    if (lowerQuestion.includes('comprehensive') ||
        lowerQuestion.includes('full report') ||
        (lowerQuestion.includes('kpi') && (lowerQuestion.includes('report') || lowerQuestion.includes('summary')))) {
      return { type: 'comprehensive', timeframe: this.extractTimeframe(lowerQuestion, 'week') };
    }

    if (lowerQuestion.includes('daily breakdown') ||
        lowerQuestion.includes('day by day') ||
        lowerQuestion.includes('each day') ||
        lowerQuestion.includes('by day')) {
      return { type: 'breakdown', granularity: 'day', timeframe: this.extractTimeframe(lowerQuestion, 'week') };
    }

    if (lowerQuestion.includes('weekly breakdown') ||
        lowerQuestion.includes('monthly breakdown') ||
        lowerQuestion.includes('week by week') ||
        lowerQuestion.includes('by week')) {
      return { type: 'breakdown', granularity: 'week', timeframe: this.extractTimeframe(lowerQuestion, 'month') };
    }

    return null;
  }

  /**
   * Extract a timeframe keyword from a question. Shared by leaderboard and
   * KPI detection so both interpret "last week" etc. identically.
   * Checks "last X" before the generic "X" match, since "last week" also
   * contains the substring "week".
   */
  extractTimeframe(lowerQuestion, defaultTimeframe = 'week') {
    if (lowerQuestion.includes('yesterday')) return 'yesterday';
    if (lowerQuestion.includes('today')) return 'today';
    if (lowerQuestion.includes('last month')) return 'last_month';
    if (lowerQuestion.includes('last week')) return 'last_week';
    if (lowerQuestion.includes('this month') || lowerQuestion.includes('month')) return 'month';
    if (lowerQuestion.includes('this week') || lowerQuestion.includes('week')) return 'week';
    return defaultTimeframe;
  }

  /**
   * Detect if question is asking for leaderboard/rankings
   */
  detectLeaderboardQuery(question) {
    const lowerQuestion = question.toLowerCase();
    const timeframe = this.extractTimeframe(lowerQuestion, 'week');

    // Detect "most bookings" queries
    if ((lowerQuestion.includes('who') || lowerQuestion.includes('which')) &&
        (lowerQuestion.includes('most booking') || lowerQuestion.includes('top booking') ||
         lowerQuestion.includes('best booking') || lowerQuestion.includes('highest booking'))) {
      return { metric: 'most_bookings', timeframe };
    }

    // Detect "most revenue" queries
    if ((lowerQuestion.includes('who') || lowerQuestion.includes('which')) &&
        (lowerQuestion.includes('most revenue') || lowerQuestion.includes('most money') ||
         lowerQuestion.includes('most sales') || lowerQuestion.includes('highest revenue') ||
         lowerQuestion.includes('most spent') || lowerQuestion.includes('biggest earner'))) {
      return { metric: 'most_revenue', timeframe };
    }

    // Detect "top performer" queries
    if (lowerQuestion.includes('top performer') || lowerQuestion.includes('best performer') ||
        lowerQuestion.includes('top booker') || lowerQuestion.includes('best booker')) {
      return { metric: 'most_bookings', timeframe };
    }

    return null;
  }

  /**
   * Detect if question is asking for a KPI calculation
   */
  detectKPIQuery(question) {
    const lowerQuestion = question.toLowerCase();
    const timeframe = this.extractTimeframe(lowerQuestion, 'week');

    if (lowerQuestion.includes('booking rate') ||
        (lowerQuestion.includes('booking') && lowerQuestion.includes('rate'))) {
      return { metric: 'booking_rate', timeframe };
    }

    if (lowerQuestion.includes('show up rate') || lowerQuestion.includes('showup rate') ||
        (lowerQuestion.includes('show') && lowerQuestion.includes('rate'))) {
      return { metric: 'show_up_rate', timeframe };
    }

    if (lowerQuestion.includes('sales conversion') || lowerQuestion.includes('conversion rate')) {
      return { metric: 'sales_conversion_rate', timeframe };
    }

    return null;
  }

  /**
   * Convert natural language to SQL query
   */
  async convertToSQL(question, context = {}) {
    if (!this.isAvailable()) {
      throw new Error('Gemini AI service is not available. Please configure GEMINI_API_KEY.');
    }

    const today = new Date();
    const currentDate = today.toISOString().split('T')[0];

    // Weeks run Monday-Sunday (UK convention). getDay(): 0=Sun..6=Sat,
    // so days-since-Monday = (day + 6) % 7.
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    currentWeekStart.setHours(0, 0, 0, 0);
    const weekStartDate = currentWeekStart.toISOString();

    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(currentWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(currentWeekStart);
    lastWeekEnd.setMilliseconds(-1); // one tick before this week's Monday 00:00 = last Sunday 23:59:59.999

    const followUpContext = context.previousQuestion
      ? `\nConversation context (the current question may be a follow-up to this):\nPrevious question: "${context.previousQuestion}"\nPrevious data returned: ${JSON.stringify(context.previousData)}\nIf the current question is a vague follow-up (e.g. "in percentages", "what about last week", "break that down further"), use the previous question's subject to figure out what's being asked now. If it needs a number the previous data doesn't contain (e.g. a total, to turn a previous subset count into a percentage), generate a query for that missing number and say so in "explanation" (e.g. "This is the total count needed to turn the previous 1,896 cancelled leads into a percentage").\n`
      : '';

    const prompt = `You are a SQL query generator for a Supabase (PostgreSQL) database.

${this.getDatabaseSchema()}

Current date: ${currentDate}
Weeks run Monday to Sunday.
Start of this week (Monday): ${weekStartDate}
Start of last week (Monday): ${lastWeekStart.toISOString()}
End of last week (Sunday): ${lastWeekEnd.toISOString()}
${followUpContext}
User question: "${question}"

CRITICAL RULES (STRICT):
1. Generate ONLY a SELECT query (no INSERT, UPDATE, DELETE, DROP, etc.)
2. Use Supabase syntax (not traditional SQL)
3. Return ONLY the query structure as JSON, no explanations, no markdown
4. Use proper date comparisons
5. Always use table names without quotes
6. For "this week", use: date >= '${weekStartDate}'
6b. For "last week", use: date >= '${lastWeekStart.toISOString()}' AND date <= '${lastWeekEnd.toISOString()}' (do NOT use this week's range)
7. For "today", use: date >= '${currentDate}' AND date < '${currentDate}'::date + interval '1 day'
8. NEVER count bookings by status='Booked' - ALWAYS use booked_at IS NOT NULL
9. NEVER hallucinate data - only use columns that exist in schema
10. If you can't answer with available data, say so in explanation

Return format (JSON only):
{
  "table": "table_name",
  "select": "columns or * or count(*) or sum(column) or avg(column)",
  "filters": [
    {"column": "column_name", "operator": "eq|gt|gte|lt|lte|like|ilike", "value": "value"}
  ],
  "order": {"column": "column_name", "ascending": true/false},
  "limit": number,
  "explanation": "Brief explanation of what this query does"
}

Supported aggregates:
- count(*) - count rows
- sum(column_name) - sum numeric values
- avg(column_name) - average numeric values
- min(column_name) - minimum value
- max(column_name) - maximum value

Examples:

1. Question: "How many bookings did Chicko make on Friday?"
Response:
{
  "table": "leads",
  "select": "id, name, phone, booked_at",
  "filters": [
    {"column": "booker_id", "operator": "eq", "value": "BOOKER_ID_LOOKUP:Chicko"},
    {"column": "booked_at", "operator": "gte", "value": "2025-10-10T00:00:00Z"},
    {"column": "booked_at", "operator": "lt", "value": "2025-10-11T00:00:00Z"}
  ],
  "explanation": "Get all leads booked by Chicko on Friday (using booked_at, not status)"
}

2. Question: "What's our total revenue this month?"
Response:
{
  "table": "sales",
  "select": "sum(amount)",
  "filters": [
    {"column": "created_at", "operator": "gte", "value": "2025-10-01T00:00:00Z"},
    {"column": "created_at", "operator": "lt", "value": "2025-11-01T00:00:00Z"}
  ],
  "explanation": "Calculate total revenue for October 2025"
}

3. Question: "What's the average sale value this week?"
Response:
{
  "table": "sales",
  "select": "avg(amount)",
  "filters": [
    {"column": "created_at", "operator": "gte", "value": "${weekStartDate}"}
  ],
  "explanation": "Calculate average sale amount for this week"
}

Important: 
- For user lookups, use format: "BOOKER_ID_LOOKUP:name" - this will be replaced with actual ID
- For counting, use "count(*)" in select
- Always include relevant columns for context
`;

    try {
      const result = await this.generateContentWithRetry(prompt);
      const response = await result.response;
      const text = response.text();

      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI did not return valid JSON');
      }

      const queryStructure = JSON.parse(jsonMatch[0]);
      return queryStructure;
    } catch (error) {
      console.error('❌ Gemini query conversion error:', error);
      throw new Error('Failed to convert question to database query: ' + error.message);
    }
  }

  /**
   * Generate a natural language response
   */
  async formatResponse(question, data, queryExplanation, context = {}) {
    if (!this.isAvailable()) {
      // Fallback response without AI
      return this.generateFallbackResponse(data);
    }

    const followUpContext = context.previousQuestion
      ? `\nThis may be a follow-up to the previous exchange:\nPrevious question: "${context.previousQuestion}"\nPrevious data: ${JSON.stringify(context.previousData)}\nIf the current question needs both the previous data and the new data together (e.g. "in percentages" needs a previous subset count divided by a newly-fetched total), combine them and show the calculation's result. Only use numbers that appear in the previous data or the new data below - never invent one to complete the picture.\n`
      : '';

    const prompt = `You are a helpful assistant analyzing CRM data for a UK business. All monetary amounts are in GBP - always format them with £, never $.

User asked: "${question}"

Query performed: ${queryExplanation}

Data returned: ${JSON.stringify(data, null, 2)}
${followUpContext}
Generate a concise, helpful response in plain English. Include:
1. Direct answer to the question
2. Key numbers/statistics
3. Brief insights if relevant

CRITICAL: Only state numbers, names, or facts that literally appear in "Data returned" (or the previous data, if this is a follow-up) above. Never invent, estimate, or guess a statistic to fill a gap. If the data is empty, doesn't contain what's needed to answer the question, or looks like it doesn't match the question (e.g. a single total when a breakdown was asked for), say so plainly instead of making something up.

Keep it under 4 sentences. Use emojis sparingly for clarity.`;

    try {
      const result = await this.generateContentWithRetry(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('❌ Response formatting error:', error);
      return this.generateFallbackResponse(data);
    }
  }

  /**
   * Fallback response without AI (used when Gemini is unavailable or every
   * retry was rate-limited). Must still surface the REAL data that was
   * already fetched - a vague "Query completed successfully" with real
   * numbers sitting right there unused is exactly the kind of unhelpful,
   * uninformative answer this assistant should never give.
   */
  generateFallbackResponse(data) {
    if (data === null || data === undefined) {
      return 'No results found.';
    }

    // Leaderboard shape: { metric, timeframe, leaderboard: [...] }
    if (data.leaderboard && Array.isArray(data.leaderboard)) {
      if (data.leaderboard.length === 0) {
        return `No data found for ${data.metric || 'this query'}${data.timeframe ? ` (${data.timeframe})` : ''}.`;
      }
      const lines = data.leaderboard.slice(0, 5).map((entry, i) => {
        const parts = [entry.name].filter(Boolean);
        if (entry.bookingsMade !== undefined) parts.push(`${entry.bookingsMade} bookings`);
        if (entry.salesMade !== undefined) parts.push(`${entry.salesMade} sales`);
        if (entry.totalRevenue !== undefined) parts.push(`£${entry.totalRevenue}`);
        return `${i + 1}. ${parts.join(' - ')}`;
      });
      return `${data.metric || 'Results'}${data.timeframe ? ` (${data.timeframe})` : ''}:\n${lines.join('\n')}`;
    }

    // Daily/weekly breakdown shape: { metric, breakdown: [...] }
    if (data.breakdown && Array.isArray(data.breakdown)) {
      const lines = data.breakdown.map(b => {
        const parts = [`${b.period}:`];
        if (b.leadsAssigned !== undefined) parts.push(`${b.leadsAssigned} assigned`);
        if (b.bookingsMade !== undefined) parts.push(`${b.bookingsMade} bookings`);
        if (b.salesMade !== undefined) parts.push(`${b.salesMade} sales`);
        if (b.revenue !== undefined) parts.push(`£${b.revenue}`);
        return parts.join(' ');
      });
      return `${data.metric || 'Breakdown'}:\n${lines.join('\n')}`;
    }

    // KPI shape: { metric, value, ... }
    if (data.metric && data.value !== undefined) {
      return `${data.metric}: ${data.value}`;
    }

    // Plain array of rows (generic SQL result, e.g. count/aggregate queries)
    if (Array.isArray(data)) {
      if (data.length === 0) return 'No results found.';
      if (data.length === 1 && data[0] && typeof data[0] === 'object') {
        return Object.entries(data[0]).map(([k, v]) => `${k}: ${v}`).join(', ');
      }
      return `Found ${data.length} result(s): ${JSON.stringify(data.slice(0, 5))}`;
    }

    // Any other flat object (e.g. comprehensive report) - list its fields
    if (typeof data === 'object') {
      const entries = Object.entries(data).filter(([, v]) => v !== null && typeof v !== 'object');
      if (entries.length > 0) {
        return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
      }
    }

    return `Query completed. Raw data: ${JSON.stringify(data)}`;
  }

  /**
   * Get example questions
   */
  getExampleQuestions() {
    return [
      // Leaderboard Queries (FASTEST - pre-built)
      "Who made the most bookings this week?",
      "Who made the most bookings this month?",
      "Who made the most bookings today?",
      "Who has the most revenue this week?",
      "Who has the most revenue this month?",
      "Who is the top booker?",
      "Who is the best performer this week?",
      "Which booker made the most money?",

      // Reports Page Queries (use endpoints)
      "Show me the comprehensive report for this week",
      "Give me a daily breakdown of bookings",
      "Show me the monthly breakdown",
      "What sales came from my bookings?",

      // Daily Activities (use endpoints)
      "Show me today's analytics",
      "What's the hourly activity for today?",
      "Show me team performance today",

      // Calendar Queries (use endpoints)
      "Show me the calendar for this week",
      "What appointments are scheduled for tomorrow?",

      // KPI Queries (calculated)
      "What's our booking rate this week?",
      "What's the show up rate?",
      "What's our sales conversion rate?",

      // Direct Database Queries
      "How many bookings did Chicko make on Friday?",
      "How many bookings were made this week?",

      // Sales Queries
      "What's our total revenue this month?",
      "What's the average sale value this week?",

      // Message Queries
      "How many texts did we send today?",
      "How many emails were sent this week?"
    ];
  }
}

// Export singleton instance
module.exports = new GeminiService();

