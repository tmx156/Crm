const cron = require('node-cron');
const MessagingService = require('./messagingService');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey);

class Scheduler {
  constructor() {
    this.cronJob = null;
    this.isRunning = false;
    this.lastRun = null;
    this.lastTick = null;
    this.nextRun = null;
    this.scheduledTime = null;
    this.tickCount = 0;
    this.lastError = null;
  }

  start() {
    if (this.isRunning) {
      console.log('[SCHEDULER] Already running');
      return;
    }

    const now = new Date();
    console.log('[SCHEDULER] =============================================');
    console.log('[SCHEDULER] Starting appointment reminder scheduler');
    console.log(`[SCHEDULER] Server time: ${now.toISOString()}`);
    console.log(`[SCHEDULER] Server hour: ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`);
    console.log(`[SCHEDULER] Timezone offset: UTC${now.getTimezoneOffset() === 0 ? '' : (now.getTimezoneOffset() > 0 ? '-' : '+') + Math.abs(now.getTimezoneOffset() / 60)}`);
    console.log('[SCHEDULER] Cron: every minute (* * * * *)');
    console.log('[SCHEDULER] =============================================');

    this.isRunning = true;

    this.cronJob = cron.schedule('* * * * *', async () => {
      try {
        await this.tick();
      } catch (error) {
        this.lastError = { time: new Date().toISOString(), message: error.message };
        console.error('[SCHEDULER] Tick crashed:', error.message);
      }
    });

    // Verify cron is running with a one-time check after 65 seconds
    setTimeout(() => {
      if (this.tickCount === 0) {
        console.error('[SCHEDULER] WARNING: Cron has not ticked after 65 seconds!');
      } else {
        console.log(`[SCHEDULER] Cron verified working (${this.tickCount} ticks so far)`);
      }
    }, 65000);

    console.log('[SCHEDULER] Started successfully');
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.isRunning = false;
    this.nextRun = null;
    this.scheduledTime = null;
    console.log('[SCHEDULER] Stopped');
  }

  async tick() {
    this.tickCount++;
    this.lastTick = new Date().toISOString();

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Log a heartbeat every 15 minutes (on :00, :15, :30, :45)
    if (now.getMinutes() % 15 === 0) {
      console.log(`[SCHEDULER] Heartbeat ${currentTime} | ticks: ${this.tickCount} | scheduled: ${this.scheduledTime || 'unknown'} | next: ${this.nextRun || 'unknown'}`);
    }

    // Fetch the template's configured time
    const { data: templates, error } = await supabase
      .from('templates')
      .select('reminder_time')
      .eq('type', 'appointment_reminder')
      .eq('is_active', true)
      .limit(1);

    if (error) {
      console.error(`[SCHEDULER] DB error fetching template: ${error.message}`);
      this.lastError = { time: now.toISOString(), message: `DB error: ${error.message}` };
      return;
    }

    if (!templates || templates.length === 0) {
      // Only log this once per hour to avoid spam
      if (now.getMinutes() === 0) {
        console.log('[SCHEDULER] No active appointment_reminder template found');
      }
      return;
    }

    const reminderTime = templates[0].reminder_time || '09:00';
    this.scheduledTime = reminderTime;
    this.nextRun = this.calculateNextRun(reminderTime);

    // Exact match: HH:MM === HH:MM
    if (currentTime === reminderTime) {
      console.log(`[SCHEDULER] TIME MATCH! ${currentTime} === ${reminderTime} - processing reminders...`);
      await this.processAppointmentReminders();
    }
  }

  calculateNextRun(reminderTime) {
    const [h, m] = reminderTime.split(':').map(Number);
    const now = new Date();
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.toISOString();
  }

  // Process appointment reminders - called on time match or manual trigger
  async processAppointmentReminders() {
    try {
      this.lastRun = new Date().toISOString();
      console.log('[SCHEDULER] Processing appointment reminders...');

      // Get active appointment reminder template
      const { data: templates, error: templateError } = await supabase
        .from('templates')
        .select('*')
        .eq('type', 'appointment_reminder')
        .eq('is_active', true)
        .limit(1);

      if (templateError) {
        console.error('[SCHEDULER] Error fetching template:', templateError.message);
        return { sent: 0, skipped: 0, errors: 0, error: templateError.message };
      }

      if (!templates || templates.length === 0) {
        console.log('[SCHEDULER] No active appointment_reminder template found');
        return { sent: 0, skipped: 0, errors: 0, error: 'No template' };
      }

      const template = templates[0];
      const reminderDays = template.reminder_days || 1;
      const reminderTime = template.reminder_time || '09:00';

      console.log(`[SCHEDULER] Template: "${template.name}"`);
      console.log(`[SCHEDULER] Config: ${reminderDays} day(s) before, send at ${reminderTime}`);
      console.log(`[SCHEDULER] Channels: email=${template.send_email}, sms=${template.send_sms}`);

      // Calculate target appointment date
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() + reminderDays);

      const startOfDay = new Date(reminderDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(reminderDate);
      endOfDay.setHours(23, 59, 59, 999);

      const startOfDayISO = startOfDay.toISOString();
      const endOfDayISO = endOfDay.toISOString();

      console.log(`[SCHEDULER] Looking for appointments on: ${reminderDate.toDateString()}`);
      console.log(`[SCHEDULER] Query range: ${startOfDayISO} to ${endOfDayISO}`);

      // Find leads with appointments on that date
      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('id, name, status, date_booked, booker_id, email, phone, deleted_at')
        .in('status', ['Booked', 'Confirmed'])
        .gte('date_booked', startOfDayISO)
        .lte('date_booked', endOfDayISO)
        .is('deleted_at', null);

      if (leadsError) {
        console.error('[SCHEDULER] Error fetching leads:', leadsError.message);
        return { sent: 0, skipped: 0, errors: 0, error: leadsError.message };
      }

      if (!leads || leads.length === 0) {
        console.log(`[SCHEDULER] No leads with appointments on ${reminderDate.toDateString()}`);
        return { sent: 0, skipped: 0, errors: 0 };
      }

      console.log(`[SCHEDULER] Found ${leads.length} leads to process`);

      let sentCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const lead of leads) {
        try {
          // Duplicate check - already sent today?
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);

          const { data: existing, error: dupError } = await supabase
            .from('messages')
            .select('id')
            .eq('lead_id', lead.id)
            .eq('template_id', template.id)
            .gte('sent_at', startOfToday.toISOString())
            .limit(1);

          if (dupError) {
            console.error(`[SCHEDULER] Duplicate check error for ${lead.name}: ${dupError.message}`);
            errorCount++;
            continue;
          }

          if (existing && existing.length > 0) {
            skippedCount++;
            continue;
          }

          // Send the reminder
          console.log(`[SCHEDULER] Sending to: ${lead.name} (${lead.email || 'no email'})`);
          await MessagingService.sendAppointmentReminder(
            lead.id,
            lead.booker_id,
            lead.date_booked,
            reminderDays
          );

          console.log(`[SCHEDULER] Sent OK: ${lead.name}`);
          sentCount++;
        } catch (error) {
          console.error(`[SCHEDULER] FAILED for ${lead.name}: ${error.message}`);
          errorCount++;
        }
      }

      this.nextRun = this.calculateNextRun(reminderTime);
      console.log('[SCHEDULER] =============================================');
      console.log(`[SCHEDULER] COMPLETE: ${sentCount} sent, ${skippedCount} skipped, ${errorCount} errors`);
      console.log(`[SCHEDULER] Next run: ${this.nextRun}`);
      console.log('[SCHEDULER] =============================================');

      return { sent: sentCount, skipped: skippedCount, errors: errorCount };
    } catch (error) {
      console.error('[SCHEDULER] processAppointmentReminders crashed:', error.message);
      console.error('[SCHEDULER] Stack:', error.stack);
      this.lastError = { time: new Date().toISOString(), message: error.message };
      return { sent: 0, skipped: 0, errors: 0, error: error.message };
    }
  }

  // Send immediate reminder for a specific lead
  async sendImmediateReminder(leadId, userId) {
    try {
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .is('deleted_at', null)
        .single();

      if (leadError || !lead) {
        throw new Error('Lead not found');
      }

      await MessagingService.sendAppointmentReminder(leadId, userId, lead.date_booked, 0);
      console.log(`[SCHEDULER] Immediate reminder sent for ${lead.name}`);
      return true;
    } catch (error) {
      console.error('[SCHEDULER] Immediate reminder error:', error.message);
      return false;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      lastTick: this.lastTick,
      nextRun: this.nextRun,
      scheduledTime: this.scheduledTime,
      tickCount: this.tickCount,
      lastError: this.lastError
    };
  }
}

const scheduler = new Scheduler();
module.exports = scheduler;
