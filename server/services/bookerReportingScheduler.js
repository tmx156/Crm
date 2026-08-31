const cron = require('node-cron');
const BookerReportingService = require('./bookerReportingService');

class BookerReportingScheduler {
  constructor() {
    this.reportingService = new BookerReportingService();
    this.dailyJob = null;
    this.monthlyJob = null;
    this.isRunning = false;
  }

  // Start the scheduled reporting
  start() {
    if (this.isRunning) {
      console.log('📊 Booker Reporting Scheduler already running');
      return;
    }

    console.log('🚀 Starting Booker Reporting Scheduler...');

    // Schedule daily reports to run at 8:00 AM every day
    this.dailyJob = cron.schedule('0 8 * * *', async () => {
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];

        console.log(`📊 Running scheduled daily report for ${dateStr}`);
        await this.reportingService.runDailyReportAutomation(dateStr);
      } catch (error) {
        console.error('❌ Scheduled daily report failed:', error);
      }
    }, {
      scheduled: false,
      timezone: "Europe/London"
    });

    // Schedule monthly reports to run on the 1st of each month at 9:00 AM
    this.monthlyJob = cron.schedule('0 9 1 * *', async () => {
      try {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const year = lastMonth.getFullYear();
        const month = lastMonth.getMonth() + 1;

        console.log(`📊 Running scheduled monthly report for ${year}-${month}`);
        await this.reportingService.runMonthlyReportAutomation(year, month);
      } catch (error) {
        console.error('❌ Scheduled monthly report failed:', error);
      }
    }, {
      scheduled: false,
      timezone: "Europe/London"
    });

    // Start the jobs
    this.dailyJob.start();
    this.monthlyJob.start();
    this.isRunning = true;

    console.log('✅ Booker Reporting Scheduler started successfully');
    console.log('📅 Daily reports: 8:00 AM every day (previous day data)');
    console.log('📅 Monthly reports: 9:00 AM on 1st of each month (previous month data)');
  }

  // Stop the scheduled reporting
  stop() {
    if (!this.isRunning) {
      console.log('📊 Booker Reporting Scheduler not running');
      return;
    }

    console.log('🛑 Stopping Booker Reporting Scheduler...');

    if (this.dailyJob) {
      this.dailyJob.stop();
      this.dailyJob = null;
    }

    if (this.monthlyJob) {
      this.monthlyJob.stop();
      this.monthlyJob = null;
    }

    this.isRunning = false;
    console.log('✅ Booker Reporting Scheduler stopped');
  }

  // Get scheduler status
  getStatus() {
    return {
      isRunning: this.isRunning,
      nextDailyRun: this.dailyJob ? this.dailyJob.nextDates(1)[0] : null,
      nextMonthlyRun: this.monthlyJob ? this.monthlyJob.nextDates(1)[0] : null
    };
  }

  // Manually trigger daily report
  async triggerDailyReport(date = null) {
    try {
      const targetDate = date || new Date().toISOString().split('T')[0];
      console.log(`🔄 Manually triggering daily report for ${targetDate}`);

      const result = await this.reportingService.runDailyReportAutomation(targetDate);
      console.log(`✅ Manual daily report completed for ${targetDate}`);

      return result;
    } catch (error) {
      console.error(`❌ Manual daily report failed for ${targetDate}:`, error);
      throw error;
    }
  }

  // Manually trigger monthly report
  async triggerMonthlyReport(year = null, month = null) {
    try {
      const now = new Date();
      const targetYear = year || now.getFullYear();
      const targetMonth = month || now.getMonth() + 1;

      console.log(`🔄 Manually triggering monthly report for ${targetYear}-${targetMonth}`);

      const result = await this.reportingService.runMonthlyReportAutomation(targetYear, targetMonth);
      console.log(`✅ Manual monthly report completed for ${targetYear}-${targetMonth}`);

      return result;
    } catch (error) {
      console.error(`❌ Manual monthly report failed for ${targetYear}-${targetMonth}:`, error);
      throw error;
    }
  }

  // Update all booker performance metrics for a specific date
  async updateAllBookerMetrics(date = null) {
    try {
      const targetDate = date || new Date().toISOString().split('T')[0];
      console.log(`🔄 Updating all booker metrics for ${targetDate}`);

      // Get all bookers
      const dbManager = require('../database-connection-manager');
      const bookers = await dbManager.query('users', {
        select: 'id, name',
        eq: { role: 'booker' }
      });

      let updatedCount = 0;
      for (const booker of bookers) {
        try {
          await this.reportingService.getBookerDailyPerformance(booker.id, targetDate);
          updatedCount++;
          console.log(`✅ Updated metrics for ${booker.name}`);
        } catch (error) {
          console.error(`❌ Failed to update metrics for ${booker.name}:`, error);
        }
      }

      console.log(`✅ Updated metrics for ${updatedCount}/${bookers.length} bookers`);
      return { success: true, updated: updatedCount, total: bookers.length };
    } catch (error) {
      console.error(`❌ Failed to update booker metrics for ${targetDate}:`, error);
      throw error;
    }
  }

  // Health check for the scheduler
  healthCheck() {
    return {
      status: this.isRunning ? 'running' : 'stopped',
      dailyJobActive: this.dailyJob ? this.dailyJob.running : false,
      monthlyJobActive: this.monthlyJob ? this.monthlyJob.running : false,
      nextRuns: this.getStatus(),
      lastHealthCheck: new Date().toISOString()
    };
  }
}

// Create singleton instance
const schedulerInstance = new BookerReportingScheduler();

module.exports = schedulerInstance;