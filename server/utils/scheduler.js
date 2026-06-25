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

    // Fetch ALL active reminder templates (not just first)
    const { data: templates, error } = await supabase
      .from('templates')
      .select('*')
      .eq('type', 'appointment_reminder')
      .eq('is_active', true);

    if (error) {
      console.error(`[SCHEDULER] DB error fetching templates: ${error.message}`);
      this.lastError = { time: new Date().toISOString(), message: `DB error: ${error.message}` };
      return;
    }

    if (!templates || templates.length === 0) {
      if (uk.minutes === 0) console.log('[SCHEDULER] No active appointment_reminder templates found');
      return;
    }

    // Build a summary of scheduled times for heartbeat
    const scheduleSummary = templates.map(t => `${t.email_account || 'primary'}@${t.reminder_time}`).join(', ');
    if (uk.minutes % 15 === 0) {
      console.log(`[SCHEDULER] Heartbeat ${currentTime} UK | ticks: ${this.tickCount} | templates: ${scheduleSummary}`);
    }

    // Fire each template whose reminder_time matches current UK minute
    for (const template of templates) {
      const reminderTime = template.reminder_time || '09:00';
      if (currentTime === reminderTime) {
        console.log(`[SCHEDULER] TIME MATCH! ${currentTime} → template "${template.name}" (${template.email_account || 'primary'})`);
        await this.processAppointmentRemindersForTemplate(template);
      }
    }

    // Update next-run display using the soonest upcoming template time
    const nextTemplate = templates
      .map(t => ({ ...t, time: t.reminder_time || '09:00' }))
      .sort((a, b) => a.time.localeCompare(b.time))
      .find(t => t.time > currentTime) || templates[0];
    this.scheduledTime = nextTemplate.reminder_time || '09:00';
    this.nextRun = this.calculateNextRun(this.scheduledTime);
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

  // Preview appointment reminders - returns per-template lead counts without sending
  async previewAppointmentReminders() {
    try {
      const { data: templates, error: templateError } = await supabase
        .from('templates')
        .select('*')
        .eq('type', 'appointment_reminder')
        .eq('is_active', true);

      if (templateError) {
        return { total: 0, alreadySent: 0, pending: 0, alreadySentLeads: [], pendingLeads: [], error: templateError.message };
      }
      if (!templates || templates.length === 0) {
        return { total: 0, alreadySent: 0, pending: 0, alreadySentLeads: [], pendingLeads: [], error: 'No active template' };
      }

      const ukNow = getUKTime();
      const { startISO: todayStartISO } = getUKDateRange(ukNow.year, ukNow.month, ukNow.day);

      let totalAlreadySent = [], totalPending = [];

      for (const template of templates) {
        const reminderDays = template.reminder_days || 1;
        const templateAccount = template.email_account || 'primary';
        const { startISO, endISO, dateStr: targetDateStr } = getUKDateRange(ukNow.year, ukNow.month, ukNow.day, reminderDays);

        const { data: allLeads } = await supabase
          .from('leads')
          .select('id, name, booking_account')
          .in('status', ['Booked', 'Confirmed'])
          .gte('date_booked', startISO)
          .lte('date_booked', endISO)
          .is('deleted_at', null);

        const leads = (allLeads || []).filter(lead => {
          const la = lead.booking_account || 'primary';
          return la === templateAccount;
        });

        for (const lead of leads) {
          const { data: existing } = await supabase
            .from('messages').select('id')
            .eq('lead_id', lead.id).eq('template_id', template.id)
            .gte('sent_at', todayStartISO).limit(1);

          const entry = { id: lead.id, name: lead.name, template: template.name, targetDate: targetDateStr };
          if (existing && existing.length > 0) totalAlreadySent.push(entry);
          else totalPending.push(entry);
        }
      }

      return {
        total: totalAlreadySent.length + totalPending.length,
        alreadySent: totalAlreadySent.length,
        pending: totalPending.length,
        alreadySentLeads: totalAlreadySent,
        pendingLeads: totalPending
      };
    } catch (error) {
      console.error('[SCHEDULER] previewAppointmentReminders error:', error.message);
      return { total: 0, alreadySent: 0, pending: 0, alreadySentLeads: [], pendingLeads: [], error: error.message };
    }
  }

  // Manual trigger: runs ALL active reminder templates (used by API endpoints)
  async processAppointmentReminders(options = {}) {
    const { data: templates } = await supabase
      .from('templates')
      .select('*')
      .eq('type', 'appointment_reminder')
      .eq('is_active', true);

    if (!templates || templates.length === 0) {
      return { sent: 0, skipped: 0, errors: 0, skippedLeads: [], error: 'No template' };
    }

    let totalSent = 0, totalSkipped = 0, totalErrors = 0, allSkipped = [];
    for (const template of templates) {
      const result = await this.processAppointmentRemindersForTemplate(template, options);
      totalSent    += result.sent;
      totalSkipped += result.skipped;
      totalErrors  += result.errors;
      allSkipped    = allSkipped.concat(result.skippedLeads || []);
    }
    return { sent: totalSent, skipped: totalSkipped, errors: totalErrors, skippedLeads: allSkipped };
  }

  // Core per-template processor — called by tick() and processAppointmentReminders()
  // Matches leads to templates by booking_account so the right brand sends the reminder.
  async processAppointmentRemindersForTemplate(template, options = {}) {
    const { force = false } = options;
    this.lastRun = new Date().toISOString();

    const reminderDays   = template.reminder_days || 1;
    const reminderTime   = template.reminder_time || '09:00';
    const templateAccount = template.email_account || 'primary';

    console.log(`[SCHEDULER] ─── Template: "${template.name}" | account: ${templateAccount} | ${reminderDays}d before | ${reminderTime}`);

    const ukNow = getUKTime();
    const { startISO, endISO, dateStr: targetDateStr } = getUKDateRange(ukNow.year, ukNow.month, ukNow.day, reminderDays);
    console.log(`[SCHEDULER]   Target date: ${targetDateStr}`);

    // Fetch leads with appointments on the target date
    const { data: allLeads, error: leadsError } = await supabase
      .from('leads')
      .select('id, name, status, date_booked, booker_id, email, phone, deleted_at, booking_account')
      .in('status', ['Booked', 'Confirmed'])
      .gte('date_booked', startISO)
      .lte('date_booked', endISO)
      .is('deleted_at', null);

    if (leadsError) {
      console.error('[SCHEDULER] Error fetching leads:', leadsError.message);
      return { sent: 0, skipped: 0, errors: 0, skippedLeads: [] };
    }

    // Filter leads by account ownership
    const leads = (allLeads || []).filter(lead => {
      const leadAccount = lead.booking_account || 'primary';
      // Exact match only — no fallback. A Camry lead with no Camry template gets nothing.
      return leadAccount === templateAccount;
    });

    console.log(`[SCHEDULER]   ${leads.length} lead(s) matched for this template`);

    let sentCount = 0, skippedCount = 0, errorCount = 0;
    const skippedLeads = [];
    const { startISO: todayStartISO } = getUKDateRange(ukNow.year, ukNow.month, ukNow.day);

    for (const lead of leads) {
      try {
        if (!force) {
          const { data: existing } = await supabase
            .from('messages')
            .select('id')
            .eq('lead_id', lead.id)
            .eq('template_id', template.id)
            .gte('sent_at', todayStartISO)
            .limit(1);

          if (existing && existing.length > 0) {
            skippedCount++;
            skippedLeads.push({ id: lead.id, name: lead.name });
            continue;
          }
        }

        console.log(`[SCHEDULER]   Sending to: ${lead.name} (${lead.email || 'no email'})`);
        await MessagingService.sendAppointmentReminder(
          lead.id,
          lead.booker_id,
          lead.date_booked,
          reminderDays,
          { templateId: template.id }
        );
        console.log(`[SCHEDULER]   Sent OK: ${lead.name}`);
        sentCount++;
      } catch (err) {
        console.error(`[SCHEDULER]   FAILED for ${lead.name}: ${err.message}`);
        errorCount++;
      }
    }

    console.log(`[SCHEDULER]   Done: ${sentCount} sent, ${skippedCount} skipped, ${errorCount} errors`);
    return { sent: sentCount, skipped: skippedCount, errors: errorCount, skippedLeads };
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
