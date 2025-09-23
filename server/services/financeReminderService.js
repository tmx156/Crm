const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

class FinanceReminderService {
  constructor() {
    this.supabase = null;
    this.emailTransporter = null;
    this.initializeSupabase();
    this.initializeEmail();
  }

  initializeEmail() {
    try {
      this.emailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD
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
      console.log('✅ Finance reminder email service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize finance reminder email service:', error.message);
    }
  }

  getDb() {
    if (!this.db) {
      const dbPath = path.join(__dirname, '..', 'local-crm.db');
      this.db = new Database(dbPath);
    }
    return this.db;
  }

  closeDb() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
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
        id: require('uuid').v4(),
        finance_id: agreement.id,
        lead_id: agreement.lead_id,
        reminder_type: reminderType,
        reminder_date: new Date().toISOString(),
        next_reminder_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'sent',
        sent_at: new Date().toISOString()
      };

      // Record the reminder
      const db = this.getDb();
      const reminderColumns = Object.keys(reminderData);
      const reminderPlaceholders = reminderColumns.map(() => '?').join(', ');
      const reminderValues = Object.values(reminderData);

      db.prepare(`
        INSERT INTO finance_reminders (${reminderColumns.join(', ')}) 
        VALUES (${reminderPlaceholders})
      `).run(...reminderValues);

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
    if (!this.emailTransporter) {
      console.log('📧 Email transporter not available, skipping email reminder');
      return;
    }

    try {
      const dueDate = new Date(agreement.next_payment_date);
      const today = new Date();
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      
      let subject, body;
      
      if (daysUntilDue < 0) {
        // Overdue
        subject = `URGENT: Payment Overdue - ${agreement.agreement_number}`;
        body = this.generateOverdueEmailBody(agreement, Math.abs(daysUntilDue));
      } else if (daysUntilDue <= 3) {
        // Due soon
        subject = `Payment Due Soon - ${agreement.agreement_number}`;
        body = this.generateDueSoonEmailBody(agreement, daysUntilDue);
      } else {
        // Upcoming
        subject = `Upcoming Payment Reminder - ${agreement.agreement_number}`;
        body = this.generateUpcomingEmailBody(agreement, daysUntilDue);
      }

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: agreement.lead_email,
        subject: subject,
        html: body
      };

      const result = await this.emailTransporter.sendMail(mailOptions);
      console.log(`📧 Email reminder sent to ${agreement.lead_email}: ${result.messageId}`);

    } catch (error) {
      console.error('❌ Error sending email reminder:', error.message);
    }
  }

  async sendSMSReminder(agreement) {
    // TODO: Implement SMS sending via BulkSMS or other service
    console.log(`📱 SMS reminder would be sent to ${agreement.lead_phone} for agreement ${agreement.agreement_number}`);
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
        
        <p>This is a reminder that your payment for agreement <strong>${agreement.agreement_number}</strong> is currently overdue.</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: #333;">Payment Details:</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Agreement Number:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${agreement.agreement_number}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Amount Due:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${agreement.payment_amount.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Due Date:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${new Date(agreement.next_payment_date).toLocaleDateString('en-GB')}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Remaining Balance:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${agreement.remaining_amount.toFixed(2)}</td>
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
        
        <p>This is a friendly reminder that your payment for agreement <strong>${agreement.agreement_number}</strong> is due soon.</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: #333;">Payment Details:</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Agreement Number:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${agreement.agreement_number}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Amount Due:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${agreement.payment_amount.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Due Date:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${new Date(agreement.next_payment_date).toLocaleDateString('en-GB')}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Remaining Balance:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${agreement.remaining_amount.toFixed(2)}</td>
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
        
        <p>This is a reminder that your payment for agreement <strong>${agreement.agreement_number}</strong> will be due in ${daysUntilDue} days.</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: #333;">Payment Details:</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Agreement Number:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${agreement.agreement_number}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Amount Due:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${agreement.payment_amount.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Due Date:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">${new Date(agreement.next_payment_date).toLocaleDateString('en-GB')}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;"><strong>Remaining Balance:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #ddd;">£${agreement.remaining_amount.toFixed(2)}</td>
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
      const db = this.getDb();
      
      // Get agreements with payments due within the next 7 days or overdue
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);
      
      const dueAgreements = db.prepare(`
        SELECT f.*, l.name as lead_name, l.email as lead_email, l.phone as lead_phone
        FROM finance f
        LEFT JOIN leads l ON f.lead_id = l.id
        WHERE f.status = 'active' 
          AND f.next_payment_date <= ?
          AND f.remaining_amount > 0
          AND (f.email_reminders = 1 OR f.sms_reminders = 1)
        ORDER BY f.next_payment_date ASC
      `).all(dueDate.toISOString());

      console.log(`📧 Processing ${dueAgreements.length} due payments for reminders`);

      for (const agreement of dueAgreements) {
        // Check if we've already sent a reminder recently (within 3 days)
        const lastReminder = db.prepare(`
          SELECT * FROM finance_reminders 
          WHERE finance_id = ? 
          ORDER BY created_at DESC 
          LIMIT 1
        `).get(agreement.id);

        if (lastReminder) {
          const lastReminderDate = new Date(lastReminder.created_at);
          const daysSinceLastReminder = Math.ceil((new Date() - lastReminderDate) / (1000 * 60 * 60 * 24));
          
          if (daysSinceLastReminder < 3) {
            console.log(`📧 Skipping reminder for ${agreement.agreement_number} - last reminder sent ${daysSinceLastReminder} days ago`);
            continue;
          }
        }

        // Send email reminder
        if (agreement.email_reminders) {
          await this.sendPaymentReminder(agreement, 'email');
        }

        // Send SMS reminder (if implemented)
        if (agreement.sms_reminders) {
          await this.sendPaymentReminder(agreement, 'sms');
        }
      }

      console.log('✅ Finance reminder processing completed');

    } catch (error) {
      console.error('❌ Error processing finance reminders:', error.message);
    } finally {
      this.closeDb();
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
