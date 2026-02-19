const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/emailService');

class FinanceReminderService {
  constructor() {
    // Use the same Supabase configuration as the main app
    const supabaseUrl = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';

    this.supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Finance reminder service initialized (using centralized Gmail API)');
  }

  async sendPaymentReminder(agreement, reminderType = 'email') {
    try {
      if (reminderType === 'email' && !agreement.email_reminders) {
        console.log(`📧 Email reminders disabled for agreement ${agreement.agreement_number}`);
        return false;
      }

      if (reminderType === 'sms' && !agreement.sms_reminders) {
        console.log(`📱 SMS reminders disabled for agreement ${agreement.agreement_number}`);
        return false;
      }

      const reminderData = {
        finance_id: agreement.id,
        lead_id: agreement.lead_id,
        reminder_type: reminderType,
        reminder_date: new Date().toISOString(),
        next_reminder_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'sent',
        sent_at: new Date().toISOString()
      };

      // Record the reminder in Supabase
      const { error: insertError } = await this.supabase
        .from('finance_reminders')
        .insert(reminderData);

      if (insertError) {
        console.error('❌ Error recording reminder:', insertError.message);
        return false;
      }

      // Send the actual reminder
      if (reminderType === 'email') {
        await this.sendEmailReminder(agreement);
      } else if (reminderType === 'sms') {
        await this.sendSMSReminder(agreement);
      }

      console.log(`✅ ${reminderType.toUpperCase()} reminder sent for agreement ${agreement.agreement_number} to ${agreement.lead_name}`);
      return true;

    } catch (error) {
      console.error(`❌ Error sending ${reminderType} reminder:`, error.message);
      return false;
    }
  }

  async sendEmailReminder(agreement) {
    try {
      const dueDate = new Date(agreement.next_payment_date || agreement.due_date);
      const today = new Date();
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

      let subject, body;

      if (daysUntilDue < 0) {
        subject = `URGENT: Payment Overdue - ${agreement.agreement_number || 'Finance Agreement'}`;
        body = this.generateOverdueEmailBody(agreement, Math.abs(daysUntilDue));
      } else if (daysUntilDue <= 3) {
        subject = `Payment Due Soon - ${agreement.agreement_number || 'Finance Agreement'}`;
        body = this.generateDueSoonEmailBody(agreement, daysUntilDue);
      } else {
        subject = `Upcoming Payment Reminder - ${agreement.agreement_number || 'Finance Agreement'}`;
        body = this.generateUpcomingEmailBody(agreement, daysUntilDue);
      }

      const result = await sendEmail(agreement.lead_email, subject, body);
      if (result.success) {
        console.log(`📧 Email reminder sent to ${agreement.lead_email}: ${result.messageId}`);
      } else {
        console.error(`❌ Email reminder failed for ${agreement.lead_email}: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Error sending email reminder:', error.message);
    }
  }

  async sendSMSReminder(agreement) {
    // TODO: Implement SMS sending via BulkSMS or other service
    console.log(`📱 SMS reminder would be sent to ${agreement.lead_phone} for agreement ${agreement.agreement_number || 'Finance Agreement'}`);
  }

  generateOverdueEmailBody(agreement, daysOverdue) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #fee; border: 1px solid #fcc; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <h2 style="color: #c33; margin: 0;">⚠️ Payment Overdue</h2>
          <p style="color: #c33; margin: 10px 0 0 0; font-weight: bold;">
            Your payment is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue
          </p>
        </div>

        <h1 style="color: #333; margin-bottom: 20px;">Payment Reminder</h1>

        <p>Dear ${agreement.lead_name},</p>

        <p>This is a reminder that your payment for agreement <strong>${agreement.agreement_number || 'Finance Agreement'}</strong> is currently overdue.</p>

        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: #333;">Payment Details:</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Agreement Number:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${agreement.agreement_number || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Amount Due:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${(agreement.amount || agreement.payment_amount || 0).toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Due Date:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${new Date(agreement.next_payment_date || agreement.due_date).toLocaleDateString('en-GB')}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Remaining Balance:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${((agreement.amount || agreement.payment_amount || 0) - (agreement.paid_date ? (agreement.amount || agreement.payment_amount || 0) : 0)).toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: #856404;">Important Notice:</h3>
          <p style="margin: 0; color: #856404;">
            Late payments may incur additional fees and could affect your credit rating.
            Please make your payment as soon as possible to avoid any further charges.
          </p>
        </div>

        <p>To make your payment, please contact us immediately or visit our office during business hours.</p>

        <p>If you have any questions or need to discuss payment arrangements, please don't hesitate to contact us.</p>

        <p>Best regards,<br>
        <strong>Finance Team</strong><br>
        Modelling Studio CRM</p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666; text-align: center;">
          This is an automated reminder. Please do not reply to this email.
        </p>
      </div>
    `;
  }

  generateDueSoonEmailBody(agreement, daysUntilDue) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <h2 style="color: #856404; margin: 0;">⏰ Payment Due Soon</h2>
          <p style="color: #856404; margin: 10px 0 0 0; font-weight: bold;">
            Your payment is due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}
          </p>
        </div>

        <h1 style="color: #333; margin-bottom: 20px;">Payment Reminder</h1>

        <p>Dear ${agreement.lead_name},</p>

        <p>This is a friendly reminder that your payment for agreement <strong>${agreement.agreement_number || 'Finance Agreement'}</strong> is due soon.</p>

        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: #333;">Payment Details:</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Agreement Number:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${agreement.agreement_number || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Amount Due:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${(agreement.amount || agreement.payment_amount || 0).toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Due Date:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${new Date(agreement.next_payment_date || agreement.due_date).toLocaleDateString('en-GB')}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Remaining Balance:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${((agreement.amount || agreement.payment_amount || 0) - (agreement.paid_date ? (agreement.amount || agreement.payment_amount || 0) : 0)).toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <p>To avoid any late fees, please ensure your payment is received by the due date.</p>

        <p>If you have any questions or need assistance, please don't hesitate to contact us.</p>

        <p>Best regards,<br>
        <strong>Finance Team</strong><br>
        Modelling Studio CRM</p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666; text-align: center;">
          This is an automated reminder. Please do not reply to this email.
        </p>
      </div>
    `;
  }

  generateUpcomingEmailBody(agreement, daysUntilDue) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #333; margin-bottom: 20px;">Upcoming Payment Reminder</h1>

        <p>Dear ${agreement.lead_name},</p>

        <p>This is a reminder that your payment for agreement <strong>${agreement.agreement_number || 'Finance Agreement'}</strong> will be due in ${daysUntilDue} days.</p>

        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: #333;">Payment Details:</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Agreement Number:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${agreement.agreement_number || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Amount Due:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${(agreement.amount || agreement.payment_amount || 0).toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Due Date:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${new Date(agreement.next_payment_date || agreement.due_date).toLocaleDateString('en-GB')}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Remaining Balance:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${((agreement.amount || agreement.payment_amount || 0) - (agreement.paid_date ? (agreement.amount || agreement.payment_amount || 0) : 0)).toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <p>Please ensure your payment is ready for the due date to avoid any late fees.</p>

        <p>If you have any questions or need assistance, please don't hesitate to contact us.</p>

        <p>Best regards,<br>
        <strong>Finance Team</strong><br>
        Modelling Studio CRM</p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666; text-align: center;">
          This is an automated reminder. Please do not reply to this email.
        </p>
      </div>
    `;
  }

  async processDuePayments() {
    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7); // Check payments due within 7 days

      // Get finance records with payments due within the next 7 days or overdue
      const { data: dueAgreements, error } = await this.supabase
        .from('finance')
        .select(`
          *,
          leads!inner (
            name,
            email,
            phone
          )
        `)
        .eq('payment_status', 'Pending')
        .lte('due_date', dueDate.toISOString())
        .gt('amount', 0)
        .or('email_reminders.eq.true,sms_reminders.eq.true')
        .order('due_date', { ascending: true });

      if (error) {
        console.error('❌ Error fetching due payments:', error.message);
        return;
      }

      console.log(`📧 Processing ${dueAgreements.length} due payments for reminders`);

      for (const agreement of dueAgreements) {
        try {
          // Check if we've already sent a reminder recently (within 3 days)
          const { data: reminders, error: reminderError } = await this.supabase
            .from('finance_reminders')
            .select('*')
            .eq('finance_id', agreement.id)
            .order('created_at', { ascending: false })
            .limit(1);

          const lastReminder = reminders && reminders.length > 0 ? reminders[0] : null;

          if (!reminderError && lastReminder) {
            const lastReminderDate = new Date(lastReminder.created_at);
            const daysSinceLastReminder = Math.ceil((new Date() - lastReminderDate) / (1000 * 60 * 60 * 24));

            if (daysSinceLastReminder < 3) {
              console.log(`📧 Skipping reminder for agreement ${agreement.agreement_number || agreement.id} - last reminder sent ${daysSinceLastReminder} days ago`);
              continue;
            }
          }

          // Prepare agreement data for reminder
          const agreementData = {
            id: agreement.id,
            lead_id: agreement.lead_id,
            lead_name: agreement.leads?.name || 'Valued Customer',
            lead_email: agreement.leads?.email,
            lead_phone: agreement.leads?.phone,
            agreement_number: agreement.agreement_number || `FIN-${agreement.id.slice(0, 8)}`,
            payment_amount: agreement.amount,
            remaining_amount: agreement.amount, // You might want to track this separately
            next_payment_date: agreement.due_date,
            email_reminders: agreement.email_reminders !== false,
            sms_reminders: agreement.sms_reminders === true
          };

          // Send email reminder
          if (agreement.email_reminders !== false && agreement.leads?.email) {
            await this.sendPaymentReminder(agreementData, 'email');
          }

          // Send SMS reminder (if implemented)
          if (agreement.sms_reminders === true && agreement.leads?.phone) {
            await this.sendPaymentReminder(agreementData, 'sms');
          }

        } catch (agreementError) {
          console.error(`❌ Error processing agreement ${agreement.id}:`, agreementError.message);
        }
      }

      console.log('✅ Finance reminder processing completed');

    } catch (error) {
      console.error('❌ Error processing finance reminders:', error.message);
    }
  }

  async startReminderScheduler() {
    console.log('🚀 Starting finance reminder scheduler...');

    // Process reminders every 6 hours
    setInterval(async () => {
      console.log('⏰ Running scheduled finance reminder check...');
      await this.processDuePayments();
    }, 6 * 60 * 60 * 1000); // 6 hours

    // Also run once immediately
    await this.processDuePayments();
  }
}

module.exports = FinanceReminderService;
