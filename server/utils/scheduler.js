const cron = require('node-cron');
const MessagingService = require('./messagingService');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey);

// Get current time in UK (handles GMT/BST automatically)
function getUKTime() {
  const now = new Date();
  const ukString = now.toLocaleString('en-GB', { timeZone: 'Europe/London' });
  // ukString = "09/02/2026, 09:00:00"
  const [datePart, timePart] = ukString.split(', ');
  const [day, month, year] = datePart.split('/').map(Number);
  const [hours, minutes] = timePart.split(':');
  return {
    hours: parseInt(hours),
    minutes: parseInt(minutes),
    day,
    month,
    year,
    time: `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`,
    full: ukString
  };
}

// Get start/end of a UK date as UTC ISO strings for database queries
function getUKDateRange(ukYear, ukMonth, ukDay, offsetDays = 0) {
  const target = new Date(Date.UTC(ukYear, ukMonth - 1, ukDay + offsetDays));
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, '0');
  const d = String(target.getUTCDate()).padStart(2, '0');
  return {
    startISO: `${y}-${m}-${d}T00:00:00.000Z`,
    endISO: `${y}-${m}-${d}T23:59:59.999Z`,
    dateStr: `${y}-${m}-${d}`
  };
}

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
    const uk = getUKTime();
    console.log('[SCHEDULER] =============================================');
    console.log('[SCHEDULER] Starting appointment reminder scheduler');
    console.log(`[SCHEDULER] Server UTC: ${now.toISOString()}`);
    console.log(`[SCHEDULER] UK time:    ${uk.full}`);
    console.log('[SCHEDULER] All times use Europe/London (GMT/BST auto)');
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

    const uk = getUKTime();
    const currentTime = uk.time;

    // Log a heartbeat every 15 minutes (on :00, :15, :30, :45)
    if (uk.minutes % 15 === 0) {
      console.log(`[SCHEDULER] Heartbeat ${currentTime} UK | ticks: ${this.tickCount} | scheduled: ${this.scheduledTime || 'unknown'} | next: ${this.nextRun || 'unknown'}`);
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
      this.lastError = { time: new Date().toISOString(), message: `DB error: ${error.message}` };
      return;
    }

    if (!templates || templates.length === 0) {
      // Only log this once per hour to avoid spam
      if (uk.minutes === 0) {
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
    // Return a human-readable UK time string for the next run
    const uk = getUKTime();
    const [targetH, targetM] = reminderTime.split(':').map(Number);
    const currentMinutes = uk.hours * 60 + uk.minutes;
    const targetMinutes = targetH * 60 + targetM;

    if (targetMinutes > currentMinutes) {
      return `Today at ${reminderTime} UK`;
    } else {
      return `Tomorrow at ${reminderTime} UK`;
    }
  }

  // Preview appointment reminders - returns lead counts without sending
  async previewAppointmentReminders() {
    try {
      const { data: templates, error: templateError } = await supabase
        .from('templates')
        .select('*')
        .eq('type', 'appointment_reminder')
        .eq('is_active', true)
        .limit(1);

      if (templateError) {
        return { total: 0, alreadySent: 0, pending: 0, alreadySentLeads: [], pendingLeads: [], error: templateError.message };
      }
      if (!templates || templates.length === 0) {
        return { total: 0, alreadySent: 0, pending: 0, alreadySentLeads: [], pendingLeads: [], error: 'No active template' };
      }

      const template = templates[0];
      const reminderDays = template.reminder_days || 1;
      const ukNow = getUKTime();
      const { startISO: startOfDayISO, endISO: endOfDayISO, dateStr: targetDateStr } = getUKDateRange(ukNow.year, ukNow.month, ukNow.day, reminderDays);

      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('id, name, status, date_booked, booker_id, email, phone, deleted_at')
        .in('status', ['Booked', 'Confirmed'])
        .gte('date_booked', startOfDayISO)
        .lte('date_booked', endOfDayISO)
        .is('deleted_at', null);

      if (leadsError) {
        return { total: 0, alreadySent: 0, pending: 0, alreadySentLeads: [], pendingLeads: [], error: leadsError.message };
      }
      if (!leads || leads.length === 0) {
        return { total: 0, alreadySent: 0, pending: 0, alreadySentLeads: [], pendingLeads: [], targetDate: targetDateStr };
      }

      const { startISO: todayStartISO } = getUKDateRange(ukNow.year, ukNow.month, ukNow.day);
      const alreadySentLeads = [];
      const pendingLeads = [];

      for (const lead of leads) {
        const { data: existing } = await supabase
          .from('messages')
          .select('id')
          .eq('lead_id', lead.id)
          .eq('template_id', template.id)
          .gte('sent_at', todayStartISO)
          .limit(1);

        if (existing && existing.length > 0) {
          alreadySentLeads.push({ id: lead.id, name: lead.name });
        } else {
          pendingLeads.push({ id: lead.id, name: lead.name });
        }
      }

      return {
        total: leads.length,
        alreadySent: alreadySentLeads.length,
        pending: pendingLeads.length,
        alreadySentLeads,
        pendingLeads,
        targetDate: targetDateStr
      };
    } catch (error) {
      console.error('[SCHEDULER] previewAppointmentReminders error:', error.message);
      return { total: 0, alreadySent: 0, pending: 0, alreadySentLeads: [], pendingLeads: [], error: error.message };
    }
  }

  // Process appointment reminders - called on time match or manual trigger
  // options.force = true skips duplicate check and sends to all leads
  async processAppointmentReminders(options = {}) {
    const { force = false } = options;
    try {
      this.lastRun = new Date().toISOString();
      console.log(`[SCHEDULER] Processing appointment reminders...${force ? ' (FORCE mode - resending to all)' : ''}`);

      // Get active appointment reminder template
      const { data: templates, error: templateError } = await supabase
        .from('templates')
        .select('*')
        .eq('type', 'appointment_reminder')
        .eq('is_active', true)
        .limit(1);

      if (templateError) {
        console.error('[SCHEDULER] Error fetching template:', templateError.message);
        return { sent: 0, skipped: 0, errors: 0, skippedLeads: [], error: templateError.message };
      }

      if (!templates || templates.length === 0) {
        console.log('[SCHEDULER] No active appointment_reminder template found');
        return { sent: 0, skipped: 0, errors: 0, skippedLeads: [], error: 'No template' };
      }

      const template = templates[0];
      const reminderDays = template.reminder_days || 1;
      const reminderTime = template.reminder_time || '09:00';

      console.log(`[SCHEDULER] Template: "${template.name}"`);
      console.log(`[SCHEDULER] Config: ${reminderDays} day(s) before, send at ${reminderTime}`);
      console.log(`[SCHEDULER] Channels: email=${template.send_email}, sms=${template.send_sms}`);

      // Calculate target appointment date using UK date (not UTC)
      const ukNow = getUKTime();
      const { startISO: startOfDayISO, endISO: endOfDayISO, dateStr: targetDateStr } = getUKDateRange(ukNow.year, ukNow.month, ukNow.day, reminderDays);

      console.log(`[SCHEDULER] UK date today: ${ukNow.day}/${ukNow.month}/${ukNow.year}`);
      console.log(`[SCHEDULER] Looking for appointments on: ${targetDateStr} (${reminderDays} day(s) ahead)`);
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
        return { sent: 0, skipped: 0, errors: 0, skippedLeads: [], error: leadsError.message };
      }

      if (!leads || leads.length === 0) {
        console.log(`[SCHEDULER] No leads with appointments on ${targetDateStr}`);
        return { sent: 0, skipped: 0, errors: 0, skippedLeads: [] };
      }

      console.log(`[SCHEDULER] Found ${leads.length} leads to process`);

      let sentCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      const skippedLeads = [];

      for (const lead of leads) {
        try {
          // Duplicate check - skip if force mode is on
          if (!force) {
            const { startISO: todayStartISO } = getUKDateRange(ukNow.year, ukNow.month, ukNow.day);

            const { data: existing, error: dupError } = await supabase
              .from('messages')
              .select('id')
              .eq('lead_id', lead.id)
              .eq('template_id', template.id)
              .gte('sent_at', todayStartISO)
              .limit(1);

            if (dupError) {
              console.error(`[SCHEDULER] Duplicate check error for ${lead.name}: ${dupError.message}`);
              errorCount++;
              continue;
            }

            if (existing && existing.length > 0) {
              skippedCount++;
              skippedLeads.push({ id: lead.id, name: lead.name });
              continue;
            }
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

      return { sent: sentCount, skipped: skippedCount, errors: errorCount, skippedLeads };
    } catch (error) {
      console.error('[SCHEDULER] processAppointmentReminders crashed:', error.message);
      console.error('[SCHEDULER] Stack:', error.stack);
      this.lastError = { time: new Date().toISOString(), message: error.message };
      return { sent: 0, skipped: 0, errors: 0, skippedLeads: [], error: error.message };
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
