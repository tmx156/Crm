// const Database = require('better-sqlite3'); // Removed - using Supabase only
const path = require('path');
const { sendEmail: sendActualEmail } = require('./emailService');
const { sendSMS: sendActualSMS } = require('./smsService');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid'); // Use uuid package for reliable ID generation

// Supabase configuration
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

// const getDb = () => {
//   return new Database(path.join(__dirname, '..', 'local-crm.db'));
// }; // Removed - using Supabase only

// Helper function to add booking history entry using Supabase
const MAX_HISTORY_ENTRIES = 50; // Limit history to prevent database bloat
async function addBookingHistoryEntry(leadId, action, performedById, performedByName, details, leadSnapshot) {
  try {
    console.log(`📝 Adding booking history entry for lead ${leadId}, action: ${action}`);

    // Add entry to lead's booking_history array (without leadSnapshot to reduce size)
    const historyEntry = {
      action,
      performed_by: performedById,
      performed_by_name: performedByName,
      details: details || {},
      timestamp: new Date().toISOString()
    };

    // Get current booking history
    const { data: currentLead, error: fetchError } = await supabase
      .from('leads')
      .select('booking_history')
      .eq('id', leadId)
      .single();

    if (fetchError) {
      console.error('❌ Error fetching current booking history:', fetchError);
      return null;
    }

    let currentHistory = currentLead.booking_history || [];

    // Limit history size to prevent database bloat
    if (currentHistory.length >= MAX_HISTORY_ENTRIES) {
      currentHistory = currentHistory.slice(-MAX_HISTORY_ENTRIES + 1); // Keep last N-1 entries
    }

    const updatedHistory = [...currentHistory, historyEntry];

    // Update the lead with new booking history
    const { error: updateError } = await supabase
      .from('leads')
      .update({ booking_history: updatedHistory })
      .eq('id', leadId);

    if (updateError) {
      console.error('❌ Error updating booking history:', updateError);
      throw updateError;
    }

    console.log(`✅ Booking history entry added to lead ${leadId}`);
    return updatedHistory.length - 1; // Return index of new entry
  } catch (error) {
    console.error('❌ Error adding booking history entry:', error);
    // Don't throw - continue without history to prevent booking failure
    console.warn('⚠️ Continuing without booking history entry');
    return null;
  }
}

class MessagingService {
  // Process template variables
  static processTemplate(template, lead, user, bookingDate = null, bookerInfo = null) {
    // Validate inputs
    if (!template) {
      console.error('❌ Template is null or undefined');
      return {
        subject: 'Booking Notification',
        email_body: 'Your booking has been confirmed.',
        sms_body: 'Your booking has been confirmed.'
      };
    }

    // Debug: Check template structure
    console.log('🔍 Template structure:', {
      hasSubject: !!template.subject,
      hasContent: !!template.content,
      hasEmailBody: !!template.email_body,
      hasSmsBody: !!template.sms_body,
      templateKeys: Object.keys(template)
    });

    let processedTemplate = {
      subject: template.subject || 'Booking Notification',
      // Prioritize specific body fields over generic content to avoid long SMS
      email_body: template.email_body || template.content || 'Your booking has been confirmed.',
      sms_body: template.sms_body || template.content || 'Your booking has been confirmed.'
    };

    // Validate required parameters
    if (!lead) {
      console.error('❌ Lead is null or undefined');
      return {
        subject: 'Booking Notification',
        email_body: 'Your booking has been confirmed.',
        sms_body: 'Your booking has been confirmed.'
      };
    }

    if (!user) {
      console.error('❌ User is null or undefined');
      return {
        subject: 'Booking Notification',
        email_body: 'Your booking has been confirmed.',
        sms_body: 'Your booking has been confirmed.'
      };
    }

    // Common variables
    const variables = {
      '{leadName}': lead.name || 'Valued Customer',
      '{leadEmail}': lead.email || '',
      '{leadPhone}': lead.phone || '',
      '{userName}': user.name || 'System',
      '{userEmail}': user.email || '',
      '{bookerName}': bookerInfo ? bookerInfo.name : 'N/A',
      '{bookerEmail}': bookerInfo ? bookerInfo.email : 'N/A',
      '{bookingDate}': bookingDate ? new Date(bookingDate).toLocaleDateString('en-GB') : '',
      '{bookingTime}': bookingDate ? new Date(bookingDate).toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        timeZone: 'UTC' // Keep UTC time to match calendar
      }) : '',
      '{companyName}': 'The Editorial Co',
      '{currentDate}': new Date().toLocaleDateString(),
      '{currentTime}': new Date().toLocaleTimeString()
    };

    // Replace variables in all fields with safety checks
    Object.keys(variables).forEach(key => {
      const value = variables[key] || ''; // Ensure value is never undefined
      try {
        if (processedTemplate.subject && typeof processedTemplate.subject === 'string') {
          processedTemplate.subject = processedTemplate.subject.replace(new RegExp(key, 'g'), value);
        }
        if (processedTemplate.email_body && typeof processedTemplate.email_body === 'string') {
          processedTemplate.email_body = processedTemplate.email_body.replace(new RegExp(key, 'g'), value);
        }
        if (processedTemplate.sms_body && typeof processedTemplate.sms_body === 'string') {
          processedTemplate.sms_body = processedTemplate.sms_body.replace(new RegExp(key, 'g'), value);
        }
      } catch (error) {
        console.error(`❌ Error replacing variable ${key}:`, error);
        console.error('Template content:', processedTemplate);
      }
    });

    return processedTemplate;
  }

  // Send booking confirmation
  static async sendBookingConfirmation(leadId, userId, bookingDate, options = {}) {
    try {
      // Get lead using Supabase
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        console.error('Error fetching lead:', leadError);
        throw new Error('Lead not found');
      }

      // Get booker info separately using manual join
      let bookerInfo = null;
      if (lead.booker_id) {
        const { data: booker, error: bookerError } = await supabase
          .from('users')
          .select('name, email')
          .eq('id', lead.booker_id)
          .single();

        if (!bookerError && booker) {
          bookerInfo = booker;
        }
      }

      // Get user using Supabase
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        console.error('Error fetching user:', userError);
        throw new Error('User not found');
      }

      // Get booking confirmation template using Supabase
      let template = null;

      // If a specific templateId is provided, use that template
      if (options.templateId) {
        const { data: specificTemplate, error: specificError } = await supabase
          .from('templates')
          .select('*')
          .eq('id', options.templateId)
          .single();

        if (specificError) {
          console.error('Error fetching specific template:', specificError);
        } else {
          template = specificTemplate;
        }
      }

      // If no specific template or it failed, get the default booking confirmation template
      if (!template) {
        const { data: templates, error: templateError } = await supabase
          .from('templates')
          .select('*')
          .eq('type', 'booking_confirmation')
          .eq('is_active', true)
          .limit(1);

        if (templateError) {
          console.error('Error fetching template:', templateError);
          return null;
        }

        if (!templates || templates.length === 0) {
          console.log('❌ No booking confirmation template found');
          return null;
        }

        template = templates[0];
      }
      console.log('✅ Found template:', {
        id: template.id,
        name: template.name,
        type: template.type,
        hasSubject: !!template.subject,
        hasEmailBody: !!template.email_body,
        hasSmsBody: !!template.sms_body,
        hasContent: !!template.content,
        emailBodyLength: template.email_body?.length || 0,
        smsBodyLength: template.sms_body?.length || 0,
        contentLength: template.content?.length || 0
      });

      const processedTemplate = this.processTemplate(template, lead, user, bookingDate, bookerInfo);

      // Determine effective channels (override template defaults if options provided)
      const effectiveSendEmail = typeof options.sendEmail === 'boolean' ? options.sendEmail : !!template.send_email;
      const effectiveSendSms = typeof options.sendSms === 'boolean' ? options.sendSms : !!template.send_sms;

      // If neither channel selected, do nothing
      if (!effectiveSendEmail && !effectiveSendSms) {
        console.log('ℹ️ Booking confirmation suppressed (both email and SMS unchecked)');
        return null;
      }

      // Create message record using Supabase
      const messageId = uuidv4();
      console.log(`📝 Generated message ID: ${messageId}`);
      const { data: messageResult, error: messageError } = await supabase
        .from('messages')
        .insert({
          id: messageId,
          lead_id: leadId,
          type: (effectiveSendEmail && effectiveSendSms) ? 'both' : (effectiveSendEmail ? 'email' : 'sms'),
          content: effectiveSendEmail ? processedTemplate.email_body : processedTemplate.sms_body,
          status: 'sent',
          email_status: effectiveSendEmail ? 'sent' : null,
          subject: effectiveSendEmail ? processedTemplate.subject : null,
          recipient_email: effectiveSendEmail ? lead.email : null,
          recipient_phone: effectiveSendSms ? lead.phone : null,
          sent_by: userId && userId !== 'system' ? userId : null,
          sent_by_name: user?.name || 'System',
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error creating message record:', messageError);
        // Continue with sending even if logging fails
      }

      const message = {
        id: messageResult?.id,
        lead_id: leadId,
        type: (effectiveSendEmail && effectiveSendSms) ? 'both' : (effectiveSendEmail ? 'email' : 'sms'),
        subject: processedTemplate.subject,
        email_body: processedTemplate.email_body,
        sms_body: processedTemplate.sms_body,
        recipient_email: lead.email,
        recipient_phone: lead.phone,
        sent_by: userId,
        booking_date: bookingDate,
        attachments: []
      };

      // Load template attachments if present
      try {
        console.log(`📎 [MSG-${messageResult?.id || 'NEW'}] Loading attachments for template ID: ${template.id}`);

        // Get template with attachments from Supabase
        const { data: tpl, error: templateError } = await supabase
          .from('templates')
          .select('attachments')
          .eq('id', template.id)
          .single();

        if (templateError) {
          console.error(`📎 [MSG-${messageResult?.id || 'NEW'}] Error fetching template attachments:`, templateError.message);
        }
        
        if (tpl && tpl.attachments) {
          console.log(`📎 [MSG-${messageResult?.id || 'NEW'}] Found attachments data: ${tpl.attachments}`);
          
          try {
            const arr = JSON.parse(tpl.attachments);
            console.log(`📎 [MSG-${messageResult?.id || 'NEW'}] Parsed attachments array:`, arr);
            
            if (Array.isArray(arr) && arr.length > 0) {
              const fs = require('fs');
              const supabaseStorage = require('./supabaseStorage');
              message.attachments = [];
              
              // Process attachments synchronously to avoid race conditions
              for (const [idx, a] of arr.entries()) {
                console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Processing attachment:`, a);

                if (a.url) {
                  console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Original URL: ${a.url}`);

                  // Check if this is a Supabase Storage URL
                  if (a.url.includes('supabase.co/storage/v1/object/public/template-attachments/')) {
                    console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Detected Supabase Storage URL`);

                    // Extract filename from URL
                    const urlParts = a.url.split('/');
                    const filename = urlParts[urlParts.length - 1];

                    try {
                      console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Downloading from Supabase Storage: ${filename}`);

                      // Download file from Supabase Storage
                      const downloadResult = await supabaseStorage.downloadFile(filename);

                      if (downloadResult.success && downloadResult.buffer) {
                        console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Download successful, buffer size: ${downloadResult.buffer.length} bytes`);

                        // Create temporary file
                        const tempDir = path.join(__dirname, '..', 'uploads', 'temp_email_attachments');
                        if (!fs.existsSync(tempDir)) {
                          fs.mkdirSync(tempDir, { recursive: true });
                          console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Created temp directory: ${tempDir}`);
                        }

                        const tempFilePath = path.join(tempDir, filename);
                        fs.writeFileSync(tempFilePath, downloadResult.buffer);

                        // Verify file was written
                        const stats = fs.statSync(tempFilePath);
                        console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] File written successfully: ${stats.size} bytes`);

                        const attachment = {
                          filename: a.originalName || a.filename || filename,
                          path: tempFilePath
                        };
                        message.attachments.push(attachment);
                        console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] ✅ Downloaded and attached: ${attachment.filename}`);
                      } else {
                        console.error(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] ❌ Download failed: ${downloadResult.error || 'No buffer returned'}`);
                      }
                    } catch (downloadError) {
                      console.error(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] ❌ Error downloading from Supabase Storage:`, downloadError.message);
                      console.error(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Error stack:`, downloadError.stack);
                    }
                  } else {
                    // Handle legacy local file paths
                    console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Detected legacy local file path`);

                    const cleanUrl = a.url.replace(/^\//, ''); // Remove leading slash
                    let filePath = path.join(__dirname, '..', cleanUrl);

                    console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Clean URL: ${cleanUrl}`);
                    console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Constructed path: ${filePath}`);

                    // If file doesn't exist, try alternative path constructions
                    if (!fs.existsSync(filePath)) {
                      console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] File not found, trying alternative paths...`);

                      // Try absolute path from project root
                      const alternativePath1 = path.resolve(process.cwd(), cleanUrl);
                      console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Trying path 1: ${alternativePath1}`);

                      if (fs.existsSync(alternativePath1)) {
                        filePath = alternativePath1;
                        console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] ✅ Found at alternative path 1`);
                      } else {
                        // Try with server directory prefix
                        const alternativePath2 = path.resolve(__dirname, '..', '..', cleanUrl);
                        console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] Trying path 2: ${alternativePath2}`);

                        if (fs.existsSync(alternativePath2)) {
                          filePath = alternativePath2;
                          console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] ✅ Found at alternative path 2`);
                        } else {
                          console.warn(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] ❌ File not found at any location: ${filePath}`);
                        }
                      }
                    }

                    // Final check if file exists
                    if (fs.existsSync(filePath)) {
                      const attachment = {
                        filename: a.originalName || a.filename || `attachment_${idx}`,
                        path: filePath
                      };
                      message.attachments.push(attachment);
                      console.log(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] ✅ Added attachment: ${attachment.filename} from ${filePath}`);
                    } else {
                      console.warn(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] ❌ File not found at any location: ${filePath}`);
                    }
                  }
                } else {
                  console.warn(`📎 [MSG-${messageResult?.id || 'NEW'}][${idx}] ❌ No URL found in attachment data`);
                }
              }
              
              console.log(`📎 [MSG-${messageResult?.id || 'NEW'}] Final attachments count: ${message.attachments.length}/${arr.length}`);
            } else {
              console.log(`📎 [MSG-${messageResult?.id || 'NEW'}] No valid attachments array found`);
            }
          } catch (parseError) {
            console.error(`📎 [MSG-${messageResult?.id || 'NEW'}] Error parsing attachments JSON:`, parseError.message);
            console.error(`📎 [MSG-${messageResult?.id || 'NEW'}] Raw attachments data:`, tpl.attachments);
          }
        } else {
          console.log(`📎 [MSG-${messageResult?.id || 'NEW'}] No attachments found for template`);
        }

        // Note: No need to close Supabase connection
      } catch (dbError) {
        console.error(`📎 [MSG-${messageResult?.id || 'NEW'}] Database error loading attachments:`, dbError.message);
      }

      // Send actual messages according to effective channels
      if (effectiveSendEmail) {
        // Use email account from options or template
        const emailAccount = options.emailAccount || template.email_account || 'primary';
        await this.sendEmail(message, emailAccount);
      }
      if (effectiveSendSms) {
        await this.sendSMS(message);
      }

      return message;
    } catch (error) {
      console.error('Error sending booking confirmation:', error);
      throw error;
    }
  }

  // Send appointment reminder
  static async sendAppointmentReminder(leadId, userId, bookingDate, reminderDays = 5) {
    try {
      // Get lead using Supabase
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        console.error('Error fetching lead for reminder:', leadError);
        throw new Error('Lead not found');
      }

      // Get booker info separately using manual join
      let bookerInfo = null;
      if (lead.booker_id) {
        const { data: booker, error: bookerError } = await supabase
          .from('users')
          .select('name, email')
          .eq('id', lead.booker_id)
          .single();

        if (!bookerError && booker) {
          bookerInfo = booker;
        }
      }

      // Get user using Supabase - fall back to a system user if userId is null/invalid
      let user = null;
      if (userId) {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .single();

        if (!userError && userData) {
          user = userData;
        }
      }

      // If user not found (e.g. booker_id was null), create a system placeholder
      if (!user) {
        console.log(`⚠️ User not found for ID "${userId}", using system placeholder for reminder`);
        user = { id: null, name: 'System', email: '' };
      }

      // Get appointment reminder template using Supabase
      const { data: templates, error: templateError } = await supabase
        .from('templates')
        .select('*')
        .eq('type', 'appointment_reminder')
        .eq('is_active', true)
        .limit(1);

      if (templateError) {
        console.error('Error fetching reminder template:', templateError);
        return null;
      }

      if (!templates || templates.length === 0) {
        console.log('No appointment reminder template found');
        return null;
      }

      const template = templates[0];
      const effectiveSendEmail = !!template.send_email;
      const effectiveSendSms = !!template.send_sms;
      const emailAccount = template.email_account || 'primary';

      // If neither channel selected, do nothing
      if (!effectiveSendEmail && !effectiveSendSms) {
        console.log('ℹ️ Appointment reminder suppressed (both email and SMS unchecked)');
        return null;
      }

      const processedTemplate = this.processTemplate(template, lead, user, bookingDate, bookerInfo);

      // Create message record using Supabase
      const reminderMessageId = uuidv4();
      console.log(`📝 Generated reminder message ID: ${reminderMessageId}`);
      const { data: messageResult, error: messageError } = await supabase
        .from('messages')
        .insert({
          id: reminderMessageId,
          lead_id: leadId,
          type: (effectiveSendEmail && effectiveSendSms) ? 'both' :
                effectiveSendEmail ? 'email' : 'sms',
          content: effectiveSendEmail ? processedTemplate.email_body : processedTemplate.sms_body,
          status: 'sent',
          email_status: effectiveSendEmail ? 'sent' : null,
          subject: effectiveSendEmail ? processedTemplate.subject : null,
          recipient_email: effectiveSendEmail ? lead.email : null,
          recipient_phone: effectiveSendSms ? lead.phone : null,
          sent_by: user.id || null,
          sent_by_name: user.name || 'System',
          template_id: template.id || null,
          sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error creating reminder message record:', messageError);
        // Continue with sending even if logging fails
      }

      const message = {
        id: messageResult?.id,
        lead_id: leadId,
        type: (effectiveSendEmail && effectiveSendSms) ? 'both' :
              effectiveSendEmail ? 'email' : 'sms',
        subject: processedTemplate.subject,
        email_body: processedTemplate.email_body,
        sms_body: processedTemplate.sms_body,
        recipient_email: lead.email,
        recipient_phone: lead.phone,
        sent_by: user.id || null,
        sent_by_name: user.name || 'System',
        booking_date: bookingDate,
        reminder_days: reminderDays,
        attachments: []
      };

      // Load template attachments if present
      try {
        if (template.attachments) {
          const arr = typeof template.attachments === 'string'
            ? JSON.parse(template.attachments)
            : template.attachments;

          if (Array.isArray(arr) && arr.length > 0) {
            const fs = require('fs');
            const supabaseStorage = require('./supabaseStorage');

            for (const a of arr) {
              if (a.url && a.url.includes('supabase.co/storage/v1/object/public/template-attachments/')) {
                const urlParts = a.url.split('/');
                const filename = urlParts[urlParts.length - 1];
                try {
                  const downloadResult = await supabaseStorage.downloadFile(filename);
                  if (downloadResult.success && downloadResult.buffer) {
                    const tempDir = path.join(__dirname, '..', 'uploads', 'temp_email_attachments');
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                    const tempFilePath = path.join(tempDir, filename);
                    fs.writeFileSync(tempFilePath, downloadResult.buffer);
                    message.attachments.push({ filename: a.originalName || a.filename || filename, path: tempFilePath });
                    console.log(`📎 Reminder attachment loaded: ${a.originalName || filename}`);
                  }
                } catch (dlErr) {
                  console.error(`📎 Failed to download reminder attachment: ${dlErr.message}`);
                }
              }
            }
          }
        }
      } catch (attErr) {
        console.error('📎 Error loading reminder attachments:', attErr.message);
      }

      // Send actual messages based on template channel settings
      if (effectiveSendEmail) {
        await this.sendEmail(message, emailAccount);
      }
      if (effectiveSendSms) {
        await this.sendSMS(message);
      }

      return message;
    } catch (error) {
      console.error('Error sending appointment reminder:', error);
      throw error;
    }
  }

  // Send email
  static async sendEmail(message, emailAccount = 'primary') {
    const messageId = message.id || 'unknown';
    console.log('\n' + '='.repeat(80));
    console.log(`📧 [EMAIL SEND ATTEMPT]`);
    console.log('='.repeat(80));
    console.log(`📧 Message ID: ${messageId}`);
    console.log(`📧 Lead ID:    ${message.lead_id}`);
    console.log(`📧 To:         ${message.recipient_email}`);
    console.log(`📧 Subject:    ${message.subject}`);
    console.log(`📧 Email Account: ${emailAccount}`);
    console.log(`📧 Body Length: ${message.email_body ? message.email_body.length : 0} characters`);

    // Log attachments information
    if (message.attachments && message.attachments.length > 0) {
      console.log(`📎 Attachments: ${message.attachments.length} files`);
      message.attachments.forEach((att, idx) => {
        console.log(`   ${idx + 1}. ${att.filename} (${att.path ? '✅ Path exists' : '❌ No path'})`);
      });
    } else {
      console.log(`📎 Attachments: None`);
    }

    console.log('-' .repeat(80));
  
    try {
      if (!message.recipient_email || !message.subject || !message.email_body) {
        const errorMsg = `📩 [MSG-${messageId}] Missing required fields: ${!message.recipient_email ? 'recipient_email, ' : ''}${!message.subject ? 'subject, ' : ''}${!message.email_body ? 'email_body' : ''}`.replace(/, $/, '');
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      console.log('📤 Sending email via Gmail API...');
      
      // Actually send the email using the email service
      const startTime = Date.now();
      const emailResult = await sendActualEmail(
        message.recipient_email,
        message.subject,
        message.email_body,
        message.attachments || [],
        emailAccount // Pass the email account key
      );
      
      const timeTaken = Date.now() - startTime;
      
      if (emailResult.success) {
        console.log('\n' + '✅'.repeat(40));
        console.log('✅ EMAIL SENT SUCCESSFULLY');
        console.log('✅'.repeat(40));
        console.log(`✅ Message ID: ${emailResult.messageId || 'N/A'}`);
        console.log(`✅ Response:   ${emailResult.response || 'No response'}`);
        console.log(`✅ Time Taken: ${timeTaken}ms`);
      } else {
        console.log('\n' + '❌'.repeat(40));
        console.log('❌ EMAIL SEND FAILED');
        console.log('❌'.repeat(40));
        console.log(`❌ Error: ${emailResult.error || 'Unknown error'}`);
        console.log(`❌ Code:  ${emailResult.code || 'N/A'}`);
      }
      
      // Update message status based on actual email result using Supabase
      const status = emailResult.success ? 'sent' : 'failed';
      const errorMessage = emailResult.error || (emailResult.success ? null : 'Unknown error');

      console.log(`📩 [MSG-${messageId}] Updating message status to: ${status}`);

      const { error: updateError } = await supabase
        .from('messages')
        .update({
          email_status: status,
          status: status,
          error_message: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', message.id);

      if (updateError) {
        console.error(`❌ Error updating message ${messageId}:`, updateError);
      } else {
        console.log(`✅ Message ${messageId} updated successfully`);
      }

      // Email is already stored in the messages table - no need to duplicate in booking_history
      console.log(`📩 [MSG-${messageId}] Email stored in messages table, skipping booking_history`);
      
      console.log(`✅ [MSG-${messageId}] Email processing completed. Status: ${status}`);
      console.log(`   - Email sent: ${emailResult.success ? '✅ Yes' : '❌ No'}`);
      console.log(`   - Error: ${errorMessage || 'None'}`);

      // Note: No need to close Supabase connection

      // Notify clients to refresh inbox in real-time
      if (global.io) {
        global.io.emit('messages_synced', {
          totalSynced: 1,
          totalSkipped: 0,
          source: 'email_send',
          timestamp: new Date().toISOString()
        });
      }
      return emailResult.success;
      
    } catch (error) {
      console.error(`❌ [MSG-${messageId}] Error in sendEmail:`, error);
      
      // Update message status to failed using Supabase
      try {
        const errorMessage = error.message || 'Unknown error';

        console.error(`📩 [MSG-${messageId}] Updating message status to failed with error:`, errorMessage);

        const { error: updateError } = await supabase
          .from('messages')
          .update({
            email_status: 'failed',
            status: 'failed',
            error_message: errorMessage,
            updated_at: new Date().toISOString()
          })
          .eq('id', message.id);

        if (updateError) {
          console.error(`❌ Error updating failed message ${messageId}:`, updateError);
        }
        
        // Add error to booking history
        try {
          await addBookingHistoryEntry(
            message.lead_id,
            'EMAIL_FAILED',
            message.sent_by,
            message.sent_by_name || 'System',
            {
              subject: message.subject || 'No subject',
              error: errorMessage,
              direction: 'outbound',
              channel: 'email',
              status: 'failed',
              messageId: messageId
            },
            message
          );
        } catch (historyError) {
          console.error(`❌ [MSG-${messageId}] Error adding failed email to history:`, historyError);
          // Continue - don't let history errors break the process
        }

        // Note: No need to close Supabase connection
      } catch (dbError) {
        console.error(`❌ [MSG-${messageId}] Error updating database:`, dbError);
      }
      
      // Still notify clients to refresh so failures reflect in UI
      if (global.io) {
        global.io.emit('messages_synced', {
          totalSynced: 0,
          totalSkipped: 0,
          source: 'email_send_failed',
          timestamp: new Date().toISOString()
        });
      }
      
      return false;
    }  
  }

  // Send SMS
  static async sendSMS(message) {
    const messageId = message.id || 'unknown';
    console.log('\n' + '='.repeat(80));
    console.log(`📨 [SMS SEND ATTEMPT]`);
    console.log('='.repeat(80));
    console.log(`📨 Message ID: ${messageId}`);
    console.log(`📨 Lead ID:    ${message.lead_id}`);
    console.log(`📨 To:         ${message.recipient_phone}`);
    console.log(`📨 Body Length: ${message.sms_body ? message.sms_body.length : 0} characters`);
    console.log('-'.repeat(80));

    try {
      if (!message.recipient_phone || !message.sms_body) {
        const errorMsg = `📲 [MSG-${messageId}] Missing required fields: ${!message.recipient_phone ? 'recipient_phone, ' : ''}${!message.sms_body ? 'sms_body' : ''}`.replace(/, $/, '');
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      console.log('📤 Sending SMS via BulkSMS...');

      const startTime = Date.now();
      const smsResult = await sendActualSMS(message.recipient_phone, message.sms_body);
      const timeTaken = Date.now() - startTime;

      const wasSuccessful = !!(smsResult && smsResult.success);

      if (wasSuccessful) {
        console.log('\n' + '✅'.repeat(40));
        console.log('✅ SMS SENT SUCCESSFULLY');
        console.log('✅'.repeat(40));
        console.log(`✅ Provider:   ${smsResult.provider || 'bulksms'}`);
        console.log(`✅ Message ID: ${smsResult.messageId || 'N/A'}`);
        console.log(`✅ Status:     ${smsResult.status || 'submitted'}`);
        console.log(`✅ Time Taken: ${timeTaken}ms`);
      } else {
        console.log('\n' + '❌'.repeat(40));
        console.log('❌ SMS SEND FAILED');
        console.log('❌'.repeat(40));
        console.log(`❌ Error: ${smsResult && smsResult.error ? smsResult.error : 'Unknown error'}`);
      }

      // Update message status in Supabase
      const status = wasSuccessful ? 'sent' : 'failed';
      const errorMessage = wasSuccessful ? null : (smsResult && smsResult.error ? smsResult.error : 'Unknown error');

      console.log(`📨 [MSG-${messageId}] Updating message status to: ${status}`);

      const { error: updateError } = await supabase
        .from('messages')
        .update({
          status: status,
          error_message: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', message.id);

      if (updateError) {
        console.error(`❌ Error updating SMS message ${messageId}:`, updateError);
      } else {
        console.log(`✅ SMS message ${messageId} updated successfully`);
      }

      // SMS is already stored in the messages table - no need to duplicate in booking_history
      console.log(`📨 [MSG-${messageId}] SMS stored in messages table, skipping booking_history`);

      // Real-time event for SMS send attempts (no notification bell)
      if (global.io) {
        try {
          global.io.emit('messages_synced', {
            totalSynced: wasSuccessful ? 1 : 0,
            totalSkipped: 0,
            source: wasSuccessful ? 'sms_send' : 'sms_send_failed',
            timestamp: new Date().toISOString()
          });
        } catch {}
      }

      return wasSuccessful;
    } catch (error) {
      console.error(`❌ [MSG-${messageId}] Error in sendSMS:`, error);

      // Update status to failed using Supabase
      try {
        const errorMessage = error.message || 'Unknown error';

        const { error: updateError } = await supabase
          .from('messages')
          .update({
            status: 'failed',
            error_message: errorMessage,
            updated_at: new Date().toISOString()
          })
          .eq('id', message.id);

        if (updateError) {
          console.error(`❌ Error updating failed SMS message ${messageId}:`, updateError);
        }

        try {
          await addBookingHistoryEntry(
            message.lead_id,
            'SMS_FAILED',
            message.sent_by,
            message.sent_by_name || 'System',
            {
              body: message.sms_body || 'No body',
              direction: 'outbound',
              channel: 'sms',
              status: 'failed',
              error: errorMessage,
              messageId: messageId
            },
            message
          );
        } catch (historyError) {
          console.error(`❌ [MSG-${messageId}] Error adding failed SMS to booking history:`, historyError);
          // Continue - don't let history errors break the process
        }
      } catch (dbError) {
        console.error(`❌ [MSG-${messageId}] Error updating database for SMS failure:`, dbError);
        // Note: No database connection to close with Supabase
      }

      if (global.io) {
        try {
          global.io.emit('messages_synced', {
            totalSynced: 0,
            totalSkipped: 0,
            source: 'sms_send_failed',
            timestamp: new Date().toISOString()
          });
        } catch {}
      }

      return false;
    }
  }

  // Stub for logging received SMS (to be called by future reply API)
  static async logSMSReceived(leadId, from, body) {
    const historyEntry = JSON.stringify({
      action: 'SMS_RECEIVED',
      timestamp: new Date().toISOString(),
      performed_by: null,
      performed_by_name: from || 'Lead',
      details: {
        body,
        direction: 'received',
        channel: 'sms',
        status: 'received'
      }
    });

    // For SQLite, we'll just log this for now
    console.log(`SMS received for lead ${leadId}: ${historyEntry}`);
  }

  // Get message history for a lead using Supabase
  static async getMessageHistory(leadId) {
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select(`
          *,
          templates (
            name,
            type
          )
        `)
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error getting message history:', error);
        return [];
      }

      // Transform the data to match the expected format
      const transformedMessages = messages.map(msg => ({
        ...msg,
        template_name: msg.templates?.name,
        template_type: msg.templates?.type
      }));

      return transformedMessages || [];
    } catch (error) {
      console.error('Error getting message history:', error);
      return [];
    }
  }

  // Schedule appointment reminders (legacy method - now handled by scheduler)
  static async scheduleAppointmentReminders() {
    console.log('Appointment reminders are now handled by the scheduler');
  }
}

module.exports = MessagingService; 