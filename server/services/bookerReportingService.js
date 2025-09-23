const dbManager = require('../database-connection-manager');
const nodemailer = require('nodemailer');
const config = require('../config');

class BookerReportingService {
  constructor() {
    this.emailTransporter = null;
    this.initializeEmailTransporter();
  }

  initializeEmailTransporter() {
    try {
      this.emailTransporter = nodemailer.createTransporter({
        service: 'gmail',
        auth: {
          user: config.email.gmailUser,
          pass: config.email.gmailPass
        },
        connectionTimeout: 60000, // 60 seconds - increased for Gmail
        greetingTimeout: 30000,   // 30 seconds - increased for Gmail
        socketTimeout: 60000,    // 60 seconds - increased for Gmail
        pool: true, // Use connection pooling
        maxConnections: 5, // Maximum number of connections
        maxMessages: 100, // Maximum messages per connection
        rateDelta: 20000, // Rate limiting
        rateLimit: 5 // Maximum messages per rateDelta
      });
      console.log('✅ Booker Reporting Service: Email transporter initialized');
    } catch (error) {
      console.error('❌ Failed to initialize email transporter:', error);
    }
  }

  // Generate daily performance report for all bookers
  async generateDailyReport(date = new Date().toISOString().split('T')[0]) {
    try {
      console.log(`📊 Generating daily booker report for ${date}`);

      // Get all bookers
      const bookers = await dbManager.query('users', {
        select: 'id, name, email, role',
        eq: { role: 'booker' }
      });

      const reportData = {
        date,
        totalBookers: bookers.length,
        activeBookers: 0,
        teamTotals: {
          leadsAssigned: 0,
          leadsBooked: 0,
          leadsAttended: 0,
          salesMade: 0,
          totalRevenue: 0
        },
        bookerPerformance: []
      };

      // Get performance data for each booker
      for (const booker of bookers) {
        const performance = await this.getBookerDailyPerformance(booker.id, date);
        reportData.bookerPerformance.push({
          booker: {
            id: booker.id,
            name: booker.name,
            email: booker.email
          },
          performance
        });

        // Add to team totals
        reportData.teamTotals.leadsAssigned += performance.leads_assigned || 0;
        reportData.teamTotals.leadsBooked += performance.leads_booked || 0;
        reportData.teamTotals.leadsAttended += performance.leads_attended || 0;
        reportData.teamTotals.salesMade += performance.sales_made || 0;
        reportData.teamTotals.totalRevenue += parseFloat(performance.total_sale_amount || 0);

        // Count active bookers (those with any activity)
        if (performance.leads_assigned > 0 || performance.leads_booked > 0) {
          reportData.activeBookers++;
        }
      }

      // Sort by performance (leads booked descending)
      reportData.bookerPerformance.sort((a, b) =>
        (b.performance.leads_booked || 0) - (a.performance.leads_booked || 0)
      );

      return reportData;
    } catch (error) {
      console.error('Error generating daily report:', error);
      throw error;
    }
  }

  // Generate monthly performance report
  async generateMonthlyReport(year = new Date().getFullYear(), month = new Date().getMonth() + 1) {
    try {
      const monthStr = `${year}-${month.toString().padStart(2, '0')}`;
      console.log(`📊 Generating monthly booker report for ${monthStr}`);

      // Get all bookers
      const bookers = await dbManager.query('users', {
        select: 'id, name, email, role',
        eq: { role: 'booker' }
      });

      const reportData = {
        month: monthStr,
        year,
        monthNumber: month,
        totalBookers: bookers.length,
        teamTotals: {
          leadsAssigned: 0,
          leadsBooked: 0,
          leadsAttended: 0,
          salesMade: 0,
          totalRevenue: 0,
          workingDays: this.getWorkingDaysInMonth(year, month)
        },
        bookerPerformance: [],
        topPerformers: {
          byRevenue: null,
          byConversion: null,
          byBookings: null
        }
      };

      // Get monthly performance data for each booker
      for (const booker of bookers) {
        const performance = await this.getBookerMonthlyPerformance(booker.id, year, month);

        const bookerData = {
          booker: {
            id: booker.id,
            name: booker.name,
            email: booker.email
          },
          performance,
          averagePerDay: {
            leadsAssigned: performance.total_leads_assigned / reportData.teamTotals.workingDays,
            leadsBooked: performance.total_leads_booked / reportData.teamTotals.workingDays,
            revenue: performance.total_sale_amount / reportData.teamTotals.workingDays
          }
        };

        reportData.bookerPerformance.push(bookerData);

        // Add to team totals
        reportData.teamTotals.leadsAssigned += performance.total_leads_assigned || 0;
        reportData.teamTotals.leadsBooked += performance.total_leads_booked || 0;
        reportData.teamTotals.leadsAttended += performance.total_leads_attended || 0;
        reportData.teamTotals.salesMade += performance.total_sales_made || 0;
        reportData.teamTotals.totalRevenue += parseFloat(performance.total_sale_amount || 0);
      }

      // Identify top performers
      reportData.topPerformers.byRevenue = [...reportData.bookerPerformance]
        .sort((a, b) => (b.performance.total_sale_amount || 0) - (a.performance.total_sale_amount || 0))[0];

      reportData.topPerformers.byConversion = [...reportData.bookerPerformance]
        .sort((a, b) => (b.performance.average_conversion_rate || 0) - (a.performance.average_conversion_rate || 0))[0];

      reportData.topPerformers.byBookings = [...reportData.bookerPerformance]
        .sort((a, b) => (b.performance.total_leads_booked || 0) - (a.performance.total_leads_booked || 0))[0];

      return reportData;
    } catch (error) {
      console.error('Error generating monthly report:', error);
      throw error;
    }
  }

  // Get individual booker daily performance
  async getBookerDailyPerformance(userId, date) {
    try {
      // Check if we have cached daily performance data
      const cachedPerformance = await dbManager.query('daily_booker_performance', {
        select: '*',
        eq: { user_id: userId, performance_date: date }
      });

      if (cachedPerformance.length > 0) {
        return cachedPerformance[0];
      }

      // Calculate performance from scratch if not cached
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Get leads for this user and date
      const leads = await dbManager.query('leads', {
        select: 'id, status, assigned_at, booked_at, last_contacted_at, has_sale, sale_amount, updated_at',
        eq: { booker_id: userId }
      });

      // Calculate metrics
      const performance = {
        user_id: userId,
        performance_date: date,
        leads_assigned: leads.filter(l =>
          l.assigned_at && new Date(l.assigned_at) >= startOfDay && new Date(l.assigned_at) <= endOfDay
        ).length,
        leads_contacted: leads.filter(l =>
          l.last_contacted_at && new Date(l.last_contacted_at) >= startOfDay && new Date(l.last_contacted_at) <= endOfDay
        ).length,
        leads_booked: leads.filter(l =>
          l.status === 'Booked' && l.booked_at && new Date(l.booked_at) >= startOfDay && new Date(l.booked_at) <= endOfDay
        ).length,
        leads_attended: leads.filter(l =>
          l.status === 'Attended' && l.updated_at && new Date(l.updated_at) >= startOfDay && new Date(l.updated_at) <= endOfDay
        ).length,
        leads_cancelled: leads.filter(l =>
          l.status === 'Cancelled' && l.updated_at && new Date(l.updated_at) >= startOfDay && new Date(l.updated_at) <= endOfDay
        ).length,
        sales_made: leads.filter(l =>
          l.has_sale && l.updated_at && new Date(l.updated_at) >= startOfDay && new Date(l.updated_at) <= endOfDay
        ).length,
        total_sale_amount: leads
          .filter(l => l.has_sale && l.updated_at && new Date(l.updated_at) >= startOfDay && new Date(l.updated_at) <= endOfDay)
          .reduce((sum, l) => sum + parseFloat(l.sale_amount || 0), 0)
      };

      // Calculate conversion rates
      performance.conversion_rate = performance.leads_assigned > 0
        ? (performance.leads_booked / performance.leads_assigned * 100).toFixed(2)
        : 0;

      performance.show_up_rate = performance.leads_booked > 0
        ? (performance.leads_attended / performance.leads_booked * 100).toFixed(2)
        : 0;

      // Cache the performance data
      try {
        await dbManager.insert('daily_booker_performance', {
          ...performance,
          created_at: new Date().toISOString()
        });
      } catch (insertError) {
        console.warn('Failed to cache daily performance (may already exist):', insertError.message);
      }

      return performance;
    } catch (error) {
      console.error('Error getting booker daily performance:', error);
      throw error;
    }
  }

  // Get individual booker monthly performance
  async getBookerMonthlyPerformance(userId, year, month) {
    try {
      const monthStr = `${year}-${month.toString().padStart(2, '0')}-01`;

      // Check if we have cached monthly performance data
      const cachedPerformance = await dbManager.query('monthly_booker_performance', {
        select: '*',
        eq: { user_id: userId, performance_month: monthStr }
      });

      if (cachedPerformance.length > 0) {
        return cachedPerformance[0];
      }

      // Calculate from daily performance records
      const firstDay = new Date(year, month - 1, 1);
      const lastDay = new Date(year, month, 0);

      const dailyPerformances = await dbManager.query('daily_booker_performance', {
        select: '*',
        eq: { user_id: userId },
        gte: { performance_date: firstDay.toISOString().split('T')[0] },
        lte: { performance_date: lastDay.toISOString().split('T')[0] }
      });

      // Aggregate monthly metrics
      const monthlyPerformance = dailyPerformances.reduce((acc, daily) => ({
        total_leads_assigned: acc.total_leads_assigned + (daily.leads_assigned || 0),
        total_leads_contacted: acc.total_leads_contacted + (daily.leads_contacted || 0),
        total_leads_booked: acc.total_leads_booked + (daily.leads_booked || 0),
        total_leads_attended: acc.total_leads_attended + (daily.leads_attended || 0),
        total_leads_cancelled: acc.total_leads_cancelled + (daily.leads_cancelled || 0),
        total_sales_made: acc.total_sales_made + (daily.sales_made || 0),
        total_sale_amount: acc.total_sale_amount + parseFloat(daily.total_sale_amount || 0),
        working_days: acc.working_days + (daily.leads_assigned > 0 || daily.leads_booked > 0 ? 1 : 0)
      }), {
        total_leads_assigned: 0,
        total_leads_contacted: 0,
        total_leads_booked: 0,
        total_leads_attended: 0,
        total_leads_cancelled: 0,
        total_sales_made: 0,
        total_sale_amount: 0,
        working_days: 0
      });

      // Calculate averages
      monthlyPerformance.average_conversion_rate = monthlyPerformance.total_leads_assigned > 0
        ? (monthlyPerformance.total_leads_booked / monthlyPerformance.total_leads_assigned * 100).toFixed(2)
        : 0;

      monthlyPerformance.average_show_up_rate = monthlyPerformance.total_leads_booked > 0
        ? (monthlyPerformance.total_leads_attended / monthlyPerformance.total_leads_booked * 100).toFixed(2)
        : 0;

      // Cache the monthly performance
      try {
        await dbManager.insert('monthly_booker_performance', {
          user_id: userId,
          performance_month: monthStr,
          ...monthlyPerformance,
          created_at: new Date().toISOString()
        });
      } catch (insertError) {
        console.warn('Failed to cache monthly performance (may already exist):', insertError.message);
      }

      return monthlyPerformance;
    } catch (error) {
      console.error('Error getting booker monthly performance:', error);
      throw error;
    }
  }

  // Send daily report email to admin
  async sendDailyReportEmail(reportData, adminEmails = []) {
    if (!this.emailTransporter || adminEmails.length === 0) {
      console.log('📧 Skipping daily report email - no transporter or admin emails');
      return;
    }

    try {
      const emailHtml = this.generateDailyReportHtml(reportData);

      const mailOptions = {
        from: config.email.gmailUser,
        to: adminEmails.join(','),
        subject: `Daily Booker Performance Report - ${reportData.date}`,
        html: emailHtml
      };

      await this.emailTransporter.sendMail(mailOptions);
      console.log(`✅ Daily report email sent to ${adminEmails.length} admin(s)`);
    } catch (error) {
      console.error('❌ Failed to send daily report email:', error);
    }
  }

  // Send monthly report email to admin
  async sendMonthlyReportEmail(reportData, adminEmails = []) {
    if (!this.emailTransporter || adminEmails.length === 0) {
      console.log('📧 Skipping monthly report email - no transporter or admin emails');
      return;
    }

    try {
      const emailHtml = this.generateMonthlyReportHtml(reportData);

      const mailOptions = {
        from: config.email.gmailUser,
        to: adminEmails.join(','),
        subject: `Monthly Booker Performance Report - ${reportData.month}`,
        html: emailHtml
      };

      await this.emailTransporter.sendMail(mailOptions);
      console.log(`✅ Monthly report email sent to ${adminEmails.length} admin(s)`);
    } catch (error) {
      console.error('❌ Failed to send monthly report email:', error);
    }
  }

  // Generate HTML for daily report email
  generateDailyReportHtml(reportData) {
    const topPerformers = reportData.bookerPerformance.slice(0, 3);

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #3B82F6; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: #F8FAFC; padding: 15px; border-radius: 6px; text-align: center; border-left: 4px solid #3B82F6; }
        .metric-value { font-size: 24px; font-weight: bold; color: #1F2937; }
        .metric-label { font-size: 12px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; }
        .performance-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .performance-table th, .performance-table td { padding: 12px; text-align: left; border-bottom: 1px solid #E5E7EB; }
        .performance-table th { background-color: #F9FAFB; font-weight: 600; color: #374151; }
        .rank { font-weight: bold; }
        .rank-1 { color: #F59E0B; }
        .rank-2 { color: #6B7280; }
        .rank-3 { color: #92400E; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB; text-align: center; color: #6B7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="color: #1F2937; margin: 0;">Daily Booker Performance Report</h1>
          <p style="color: #6B7280; margin: 10px 0 0 0;">${reportData.date}</p>
        </div>

        <div class="summary">
          <div class="metric-card">
            <div class="metric-value">${reportData.activeBookers}/${reportData.totalBookers}</div>
            <div class="metric-label">Active Bookers</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${reportData.teamTotals.leadsAssigned}</div>
            <div class="metric-label">Leads Assigned</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${reportData.teamTotals.leadsBooked}</div>
            <div class="metric-label">Leads Booked</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">£${reportData.teamTotals.totalRevenue.toFixed(2)}</div>
            <div class="metric-label">Total Revenue</div>
          </div>
        </div>

        <h2 style="color: #1F2937; margin-bottom: 15px;">Top Performers</h2>
        <table class="performance-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Booker</th>
              <th>Assigned</th>
              <th>Booked</th>
              <th>Conversion</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            ${topPerformers.map((bp, index) => `
              <tr>
                <td class="rank rank-${index + 1}">${index + 1}</td>
                <td>${bp.booker.name}</td>
                <td>${bp.performance.leads_assigned || 0}</td>
                <td>${bp.performance.leads_booked || 0}</td>
                <td>${bp.performance.conversion_rate || 0}%</td>
                <td>£${parseFloat(bp.performance.total_sale_amount || 0).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="footer">
          <p>This report was automatically generated by your CRM system.</p>
          <p>Generated at ${new Date().toLocaleString()}</p>
        </div>
      </div>
    </body>
    </html>
    `;
  }

  // Generate HTML for monthly report email
  generateMonthlyReportHtml(reportData) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 900px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #3B82F6; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric-card { background: #F8FAFC; padding: 15px; border-radius: 6px; text-align: center; border-left: 4px solid #3B82F6; }
        .metric-value { font-size: 24px; font-weight: bold; color: #1F2937; }
        .metric-label { font-size: 12px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; }
        .top-performers { margin-bottom: 30px; }
        .performer-card { background: #FEF3C7; padding: 15px; margin: 10px 0; border-radius: 6px; border-left: 4px solid #F59E0B; }
        .performer-name { font-weight: bold; color: #92400E; }
        .performer-stats { color: #6B7280; font-size: 14px; margin-top: 5px; }
        .performance-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .performance-table th, .performance-table td { padding: 12px; text-align: left; border-bottom: 1px solid #E5E7EB; }
        .performance-table th { background-color: #F9FAFB; font-weight: 600; color: #374151; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB; text-align: center; color: #6B7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="color: #1F2937; margin: 0;">Monthly Booker Performance Report</h1>
          <p style="color: #6B7280; margin: 10px 0 0 0;">${reportData.month}</p>
        </div>

        <div class="summary">
          <div class="metric-card">
            <div class="metric-value">${reportData.totalBookers}</div>
            <div class="metric-label">Total Bookers</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${reportData.teamTotals.leadsAssigned}</div>
            <div class="metric-label">Leads Assigned</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${reportData.teamTotals.leadsBooked}</div>
            <div class="metric-label">Leads Booked</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">£${reportData.teamTotals.totalRevenue.toFixed(2)}</div>
            <div class="metric-label">Total Revenue</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${reportData.teamTotals.workingDays}</div>
            <div class="metric-label">Working Days</div>
          </div>
        </div>

        <div class="top-performers">
          <h2 style="color: #1F2937; margin-bottom: 15px;">Top Performers</h2>

          <div class="performer-card">
            <div class="performer-name">🏆 Highest Revenue: ${reportData.topPerformers.byRevenue?.booker.name || 'N/A'}</div>
            <div class="performer-stats">£${parseFloat(reportData.topPerformers.byRevenue?.performance.total_sale_amount || 0).toFixed(2)} total revenue</div>
          </div>

          <div class="performer-card">
            <div class="performer-name">🎯 Best Conversion: ${reportData.topPerformers.byConversion?.booker.name || 'N/A'}</div>
            <div class="performer-stats">${reportData.topPerformers.byConversion?.performance.average_conversion_rate || 0}% conversion rate</div>
          </div>

          <div class="performer-card">
            <div class="performer-name">📈 Most Bookings: ${reportData.topPerformers.byBookings?.booker.name || 'N/A'}</div>
            <div class="performer-stats">${reportData.topPerformers.byBookings?.performance.total_leads_booked || 0} total bookings</div>
          </div>
        </div>

        <h2 style="color: #1F2937; margin-bottom: 15px;">Complete Performance Table</h2>
        <table class="performance-table">
          <thead>
            <tr>
              <th>Booker</th>
              <th>Assigned</th>
              <th>Booked</th>
              <th>Attended</th>
              <th>Sales</th>
              <th>Revenue</th>
              <th>Conversion</th>
              <th>Show-up</th>
            </tr>
          </thead>
          <tbody>
            ${reportData.bookerPerformance.map(bp => `
              <tr>
                <td>${bp.booker.name}</td>
                <td>${bp.performance.total_leads_assigned || 0}</td>
                <td>${bp.performance.total_leads_booked || 0}</td>
                <td>${bp.performance.total_leads_attended || 0}</td>
                <td>${bp.performance.total_sales_made || 0}</td>
                <td>£${parseFloat(bp.performance.total_sale_amount || 0).toFixed(2)}</td>
                <td>${bp.performance.average_conversion_rate || 0}%</td>
                <td>${bp.performance.average_show_up_rate || 0}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="footer">
          <p>This report was automatically generated by your CRM system.</p>
          <p>Generated at ${new Date().toLocaleString()}</p>
        </div>
      </div>
    </body>
    </html>
    `;
  }

  // Helper function to get working days in a month
  getWorkingDaysInMonth(year, month) {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let workingDays = 0;

    for (let date = new Date(firstDay); date <= lastDay; date.setDate(date.getDate() + 1)) {
      const dayOfWeek = date.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday (0) or Saturday (6)
        workingDays++;
      }
    }

    return workingDays;
  }

  // Get admin email addresses
  async getAdminEmails() {
    try {
      const admins = await dbManager.query('users', {
        select: 'email',
        eq: { role: 'admin' }
      });
      return admins.map(admin => admin.email).filter(email => email);
    } catch (error) {
      console.error('Error getting admin emails:', error);
      return [];
    }
  }

  // Run daily report automation
  async runDailyReportAutomation(date = new Date().toISOString().split('T')[0]) {
    try {
      console.log(`🚀 Running daily report automation for ${date}`);

      // Generate report
      const reportData = await this.generateDailyReport(date);

      // Get admin emails
      const adminEmails = await this.getAdminEmails();

      // Send email if admins exist
      if (adminEmails.length > 0) {
        await this.sendDailyReportEmail(reportData, adminEmails);
      }

      // Update all booker daily performance metrics
      const bookers = await dbManager.query('users', {
        select: 'id',
        eq: { role: 'booker' }
      });

      for (const booker of bookers) {
        await this.getBookerDailyPerformance(booker.id, date);
      }

      console.log(`✅ Daily report automation completed for ${date}`);
      return reportData;
    } catch (error) {
      console.error(`❌ Daily report automation failed for ${date}:`, error);
      throw error;
    }
  }

  // Run monthly report automation
  async runMonthlyReportAutomation(year = new Date().getFullYear(), month = new Date().getMonth() + 1) {
    try {
      console.log(`🚀 Running monthly report automation for ${year}-${month}`);

      // Generate report
      const reportData = await this.generateMonthlyReport(year, month);

      // Get admin emails
      const adminEmails = await this.getAdminEmails();

      // Send email if admins exist
      if (adminEmails.length > 0) {
        await this.sendMonthlyReportEmail(reportData, adminEmails);
      }

      console.log(`✅ Monthly report automation completed for ${year}-${month}`);
      return reportData;
    } catch (error) {
      console.error(`❌ Monthly report automation failed for ${year}-${month}:`, error);
      throw error;
    }
  }
}

module.exports = BookerReportingService;