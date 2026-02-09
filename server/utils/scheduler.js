const cron = require('node-cron');
const MessagingService = require('./messagingService');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// Use centralized config for Supabase
const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey);

class Scheduler {
  constructor() {
    this.cronJob = null;
    this.isRunning = false;
    this.lastRun = null;
    this.nextRun = null;
    this.scheduledTime = null;
  }

  // Start the scheduler - checks every minute for an exact time match
  start() {
    if (this.isRunning) {
      console.log('Scheduler is already running');
      return;
    }

    console.log('🕐 Starting appointment reminder scheduler (cron)...');
    this.isRunning = true;

    // Run every minute, check if current HH:MM matches the template's reminder_time
    this.cronJob = cron.schedule('* * * * *', async () => {
      try {
        await this.tick();
      } catch (error) {
        console.error('Scheduler tick error:', error);
      }
    });

    console.log('✅ Scheduler running - checks every minute for exact time match');
  }

  // Stop the scheduler
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.isRunning = false;
    this.nextRun = null;
    this.scheduledTime = null;
    console.log('🛑 Appointment reminder scheduler stopped');
  }

  // Lightweight tick - runs every minute, only does work when time matches exactly
  async tick() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Fetch the template's configured time (quick query)
    const { data: templates, error } = await supabase
      .from('templates')
      .select('reminder_time')
      .eq('type', 'appointment_reminder')
      .eq('is_active', true)
      .limit(1);

    if (error || !templates || templates.length === 0) return;

    const reminderTime = templates[0].reminder_time || '09:00';
    this.scheduledTime = reminderTime;
    this.nextRun = this.calculateNextRun(reminderTime);

    // Exact match: HH:MM === HH:MM
    if (currentTime === reminderTime) {
      console.log(`🔔 Time match! ${currentTime} === ${reminderTime} - sending reminders...`);
      await this.processAppointmentReminders(true);
    }
  }

  // Calculate when the next run will be
  calculateNextRun(reminderTime) {
    const [h, m] = reminderTime.split(':').map(Number);
    const now = new Date();
    const next = new Date(now);
    next.setHours(h, m, 0, 0);

    // If the time already passed today, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next.toISOString();
  }

  // Process appointment reminders
  // skipTimeCheck = true for both cron match and manual triggers
  async processAppointmentReminders(skipTimeCheck = false) {
    try {
      this.lastRun = new Date().toISOString();
      console.log('🔔 Processing appointment reminders...');

      // Get active appointment reminder template from Supabase
      const { data: templates, error: templateError } = await supabase
        .from('templates')
        .select('*')
        .eq('type', 'appointment_reminder')
        .eq('is_active', true)
        .limit(1);

      if (templateError) {
        console.error('Error fetching appointment reminder template:', templateError);
        return;
      }

      if (!templates || templates.length === 0) {
        console.log('No active appointment reminder template found');
        return;
      }

      const template = templates[0];
      const reminderDays = template.reminder_days || 1;
      const reminderTime = template.reminder_time || '09:00';

      console.log(`📋 Using template: "${template.name}" (remind ${reminderDays} day(s) before, at ${reminderTime})`);

      // Calculate the target date for reminders
      // If reminderDays = 1, we look for appointments tomorrow
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() + reminderDays);

      const startOfDay = new Date(reminderDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(reminderDate);
      endOfDay.setHours(23, 59, 59, 999);

      if (isNaN(startOfDay.getTime()) || isNaN(endOfDay.getTime())) {
        console.error('Invalid date calculated for reminders');
        return;
      }

      const startOfDayISO = startOfDay.toISOString();
      const endOfDayISO = endOfDay.toISOString();

      // Find leads with appointments on the reminder date from Supabase
      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('id, name, status, date_booked, booker_id, email, phone, deleted_at')
        .in('status', ['Booked', 'Confirmed'])
        .gte('date_booked', startOfDayISO)
        .lte('date_booked', endOfDayISO)
        .is('deleted_at', null);

      if (leadsError) {
        console.error('Error fetching leads for reminders:', leadsError);
        return;
      }

      if (!leads || leads.length === 0) {
        console.log(`No leads with appointments on ${reminderDate.toDateString()}`);
        return;
      }

      console.log(`Found ${leads.length} leads with appointments on ${reminderDate.toDateString()}`);

      let sentCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const lead of leads) {
        try {
          // Check if reminder already sent today (prevent duplicates)
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          const startOfTodayISO = startOfToday.toISOString();

          const { data: existingReminders, error: reminderCheckError } = await supabase
            .from('messages')
            .select('id')
            .eq('lead_id', lead.id)
            .eq('template_id', template.id)
            .gte('sent_at', startOfTodayISO)
            .limit(1);

          if (reminderCheckError) {
            console.error(`Error checking existing reminders for ${lead.name}:`, reminderCheckError);
            errorCount++;
            continue;
          }

          if (existingReminders && existingReminders.length > 0) {
            console.log(`⏭️  Reminder already sent today for ${lead.name}`);
            skippedCount++;
            continue;
          }

          // Send the reminder via MessagingService (which uses Supabase)
          await MessagingService.sendAppointmentReminder(
            lead.id,
            lead.booker_id,
            lead.date_booked,
            reminderDays
          );

          console.log(`📧 Appointment reminder sent for ${lead.name}`);
          sentCount++;
        } catch (error) {
          console.error(`Error sending reminder for ${lead.name}:`, error.message);
          errorCount++;
        }
      }

      this.nextRun = this.calculateNextRun(reminderTime);
      console.log(`✅ Appointment reminders completed: ${sentCount} sent, ${skippedCount} skipped, ${errorCount} errors`);
      console.log(`📅 Next run scheduled for: ${this.nextRun}`);
    } catch (error) {
      console.error('Error processing appointment reminders:', error);
    }
  }

  // Send immediate reminder for a specific lead
  async sendImmediateReminder(leadId, userId) {
    try {
      // Get lead from Supabase
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .is('deleted_at', null)
        .single();

      if (leadError || !lead) {
        throw new Error('Lead not found');
      }

      await MessagingService.sendAppointmentReminder(
        leadId,
        userId,
        lead.date_booked,
        0 // Immediate reminder
      );

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
      nextRun: this.nextRun,
      scheduledTime: this.scheduledTime
    };
  }
}

// Create singleton instance
const scheduler = new Scheduler();

module.exports = scheduler;
