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
        // Try the latest model name
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
        console.log('✅ Gemini AI service initialized with gemini-2.0-flash-exp');
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
   - age (integer)
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

Date Filters:
- This week: >= start of current week (Sunday)
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

    // Reports page queries
    if (lowerQuestion.includes('comprehensive') ||
        lowerQuestion.includes('full report') ||
        (lowerQuestion.includes('kpi') && (lowerQuestion.includes('report') || lowerQuestion.includes('summary')))) {
      return { endpoint: 'comprehensiveReport', needsDateRange: true };
    }

    if (lowerQuestion.includes('daily breakdown') ||
        lowerQuestion.includes('day by day') ||
        lowerQuestion.includes('each day')) {
      return { endpoint: 'dailyBreakdown', needsDateRange: true };
    }

    if (lowerQuestion.includes('weekly breakdown') ||
        lowerQuestion.includes('monthly breakdown') ||
        lowerQuestion.includes('week by week')) {
      return { endpoint: 'monthlyBreakdown', needsDateRange: true };
    }

    if (lowerQuestion.includes('sales from bookings') ||
        lowerQuestion.includes('sales details') ||
        lowerQuestion.includes('which bookings converted')) {
      return { endpoint: 'salesFromBookings', needsDateRange: true };
    }

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

    // Calendar queries
    if (lowerQuestion.includes('calendar') ||
        lowerQuestion.includes('appointments scheduled') ||
        lowerQuestion.includes('bookings scheduled')) {
      return { endpoint: 'calendar', needsDateRange: true };
    }

    // Dashboard
    if (lowerQuestion.includes('dashboard') || lowerQuestion.includes('overview')) {
      return { endpoint: 'dashboard', needsNothing: true };
    }

    return null;
  }

  /**
   * Detect if question is asking for leaderboard/rankings
   */
  detectLeaderboardQuery(question) {
    const lowerQuestion = question.toLowerCase();

    // Extract timeframe
    let timeframe = 'week'; // default
    if (lowerQuestion.includes('today')) timeframe = 'today';
    else if (lowerQuestion.includes('this month') || lowerQuestion.includes('month')) timeframe = 'month';
    else if (lowerQuestion.includes('this week') || lowerQuestion.includes('week')) timeframe = 'week';

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

    if (lowerQuestion.includes('booking rate') ||
        (lowerQuestion.includes('booking') && lowerQuestion.includes('rate'))) {
      return 'booking_rate';
    }

    if (lowerQuestion.includes('show up rate') || lowerQuestion.includes('showup rate') ||
        (lowerQuestion.includes('show') && lowerQuestion.includes('rate'))) {
      return 'show_up_rate';
    }

    if (lowerQuestion.includes('sales conversion') || lowerQuestion.includes('conversion rate')) {
      return 'sales_conversion_rate';
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
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - today.getDay());
    const weekStartDate = currentWeekStart.toISOString();

    const prompt = `You are a SQL query generator for a Supabase (PostgreSQL) database.

${this.getDatabaseSchema()}

Current date: ${currentDate}
Start of this week (Sunday): ${weekStartDate}

User question: "${question}"

CRITICAL RULES (STRICT):
1. Generate ONLY a SELECT query (no INSERT, UPDATE, DELETE, DROP, etc.)
2. Use Supabase syntax (not traditional SQL)
3. Return ONLY the query structure as JSON, no explanations, no markdown
4. Use proper date comparisons
5. Always use table names without quotes
6. For "this week", use: date >= '${weekStartDate}'
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
      const result = await this.model.generateContent(prompt);
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
  async formatResponse(question, data, queryExplanation) {
    if (!this.isAvailable()) {
      // Fallback response without AI
      return this.generateFallbackResponse(data);
    }

    const prompt = `You are a helpful assistant analyzing CRM data.

User asked: "${question}"

Query performed: ${queryExplanation}

Data returned: ${JSON.stringify(data, null, 2)}

Generate a concise, helpful response in plain English. Include:
1. Direct answer to the question
2. Key numbers/statistics
3. Brief insights if relevant

Keep it under 4 sentences. Use emojis sparingly for clarity.`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('❌ Response formatting error:', error);
      return this.generateFallbackResponse(data);
    }
  }

  /**
   * Fallback response without AI
   */
  generateFallbackResponse(data) {
    if (!data || data.length === 0) {
      return 'No results found.';
    }

    if (Array.isArray(data)) {
      return `Found ${data.length} result(s).`;
    }

    return 'Query completed successfully.';
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
      "What's the average sale value this week?"
    ];
  }
}

// Export singleton instance
module.exports = new GeminiService();

