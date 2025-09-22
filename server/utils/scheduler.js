const MessagingService = require('./messagingService');
const Database = require('better-sqlite3');
const path = require('path');

class Scheduler {
  constructor() {
    this.reminderInterval = null;
    this.isRunning = false;
  }

  // Start the scheduler
  start() {
    if (this.isRunning) {
      console.log('Scheduler is already running');
      return;
    }

    console.log('🕐 Starting message scheduler...');
    this.isRunning = true;

    // Run appointment reminders every hour
    this.reminderInterval = setInterval(async () => {
      try {
        await this.processAppointmentReminders();
      } catch (error) {
        console.error('Error processing appointment reminders:', error);
      }
    }, 60 * 60 * 1000); // Every hour

    // Run immediately on startup
    this.processAppointmentReminders();
  }

  // Stop the scheduler
  stop() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 Message scheduler stopped');
  }

  // Process appointment reminders
  async processAppointmentReminders() {
    try {
      console.log('🔔 Processing appointment reminders...');

      // Use SQLite for consistency
      const dbPath = path.join(__dirname, '../local-crm.db');
      const db = new Database(dbPath);

      // Get appointment reminder template
      const template = db.prepare(`
        SELECT * FROM templates 
        WHERE type = ? AND is_active = ? 
        LIMIT 1
      `).get('appointment_reminder', 1);

      if (!template) {
        console.log('No appointment reminder template found');
        db.close();
        return;
      }

      // Calculate the target date for reminders
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() + (template.reminder_days || 1));

      // Find leads with appointments on the reminder date
      const startOfDay = new Date(reminderDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(reminderDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Validate dates before converting to ISO string
      if (isNaN(startOfDay.getTime()) || isNaN(endOfDay.getTime())) {
        console.error('Invalid date calculated for reminders');
        db.close();
        return;
      }

      // Use safe date formatting
      const startOfDayISO = startOfDay.toISOString();
      const endOfDayISO = endOfDay.toISOString();

      const leads = db.prepare(`
        SELECT l.*, u.name as booker_name
        FROM leads l
        LEFT JOIN users u ON l.booker_id = u.id
        WHERE l.status IN (?, ?) 
          AND l.date_booked >= ? 
          AND l.date_booked <= ?
          AND l.deleted_at IS NULL
      `).all('Booked', 'Confirmed', startOfDayISO, endOfDayISO);

      console.log(`Found ${leads.length} leads with appointments on ${reminderDate.toDateString()}`);

      for (const lead of leads) {
        try {
          // Check if reminder already sent today
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);

          // Validate date before converting to ISO string
          const startOfTodayISO = isNaN(startOfToday.getTime()) ? new Date().toISOString() : startOfToday.toISOString();

          const existingReminders = db.prepare(`
            SELECT * FROM messages 
            WHERE lead_id = ? 
              AND template_id = ? 
              AND sent_at >= ?
            LIMIT 1
          `).all(lead.id, template.id, startOfTodayISO);

          if (existingReminders.length === 0) {
            await MessagingService.sendAppointmentReminder(
              lead.id,
              lead.booker_id,
              lead.date_booked,
              template.reminder_days
            );
            console.log(`📧 Appointment reminder sent for ${lead.name}`);
          } else {
            console.log(`📧 Reminder already sent today for ${lead.name}`);
          }
        } catch (error) {
          console.error(`Error sending reminder for ${lead.name}:`, error);
        }
      }

      db.close();
      console.log('✅ Appointment reminders processing completed');
    } catch (error) {
      console.error('Error processing appointment reminders:', error);
    }
  }

  // Send immediate reminder for a specific lead
  async sendImmediateReminder(leadId, userId) {
    try {
      const dbPath = path.join(__dirname, '../local-crm.db');
      const db = new Database(dbPath);

      const lead = db.prepare(`
        SELECT l.*, u.name as booker_name
        FROM leads l
        LEFT JOIN users u ON l.booker_id = u.id
        WHERE l.id = ? AND l.deleted_at IS NULL
      `).get(leadId);

      if (!lead) {
        throw new Error('Lead not found');
      }

      await MessagingService.sendAppointmentReminder(
        leadId,
        userId,
        lead.date_booked,
        0 // Immediate reminder
      );

      db.close();
      console.log(`📧 Immediate reminder sent for ${lead.name}`);
      return true;
    } catch (error) {
      console.error('Error sending immediate reminder:', error);
      return false;
    }
  }

  // Get scheduler status
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      nextRun: this.nextRun
    };
  }
}

// Create singleton instance
const scheduler = new Scheduler();

module.exports = scheduler; 