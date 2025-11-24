require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const config = require('./server/config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

(async () => {
  console.log('\n' + '='.repeat(80));
  console.log('📧 BOOKING CONFIRMATION EMAIL AUDIT');
  console.log('='.repeat(80) + '\n');

  // 1. Check Email Configuration
  console.log('1️⃣ EMAIL CONFIGURATION CHECK');
  console.log('-'.repeat(80));
  const emailUser = process.env.EMAIL_USER || process.env.GMAIL_USER;
  const emailPass = process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS;
  
  console.log(`   Email Address: ${emailUser || '❌ NOT SET'}`);
  console.log(`   Email Password: ${emailPass ? '✅ SET (' + emailPass.length + ' chars)' : '❌ NOT SET'}`);
  
  if (!emailUser || !emailPass) {
    console.log('\n❌ ERROR: Email credentials not configured!');
    console.log('   Set EMAIL_USER and EMAIL_PASSWORD in .env file\n');
    process.exit(1);
  }
  console.log('');

  // 2. Check Email Service
  console.log('2️⃣ EMAIL SERVICE CHECK');
  console.log('-'.repeat(80));
  try {
    const emailService = require('./server/utils/emailService');
    const transporter = emailService.createTransporter('primary');
    
    if (transporter) {
      console.log('   ✅ Email transporter created successfully');
      console.log(`   ✅ Using account: ${emailUser}`);
    } else {
      console.log('   ❌ Failed to create email transporter');
    }
  } catch (error) {
    console.log(`   ❌ Error loading email service: ${error.message}`);
  }
  console.log('');

  // 3. Check Booking Confirmation Templates
  console.log('3️⃣ BOOKING CONFIRMATION TEMPLATES');
  console.log('-'.repeat(80));
  try {
    const { data: templates, error } = await supabase
      .from('templates')
      .select('*')
      .eq('type', 'booking_confirmation')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.log(`   ❌ Error fetching templates: ${error.message}`);
    } else if (!templates || templates.length === 0) {
      console.log('   ⚠️  No active booking confirmation templates found');
      console.log('   ⚠️  System will use default message if templates are missing');
    } else {
      console.log(`   ✅ Found ${templates.length} active booking confirmation template(s):`);
      templates.forEach((template, idx) => {
        console.log(`      ${idx + 1}. ${template.name} (ID: ${template.id})`);
        console.log(`         Subject: ${template.subject || 'N/A'}`);
        console.log(`         Email Account: ${template.email_account || 'primary'}`);
        console.log(`         Has Email Body: ${!!(template.email_body || template.content)}`);
        console.log(`         Has SMS Body: ${!!template.sms_body}`);
      });
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  console.log('');

  // 4. Check Recent Booking Confirmations Sent
  console.log('4️⃣ RECENT BOOKING CONFIRMATIONS (Last 24 Hours)');
  console.log('-'.repeat(80));
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, name, email, date_booked, booking_history')
      .not('date_booked', 'is', null)
      .gte('date_booked', yesterday.toISOString())
      .order('date_booked', { ascending: false })
      .limit(20);

    if (error) {
      console.log(`   ❌ Error fetching leads: ${error.message}`);
    } else if (!leads || leads.length === 0) {
      console.log('   ℹ️  No bookings found in the last 24 hours');
    } else {
      console.log(`   📋 Found ${leads.length} booking(s) in the last 24 hours:\n`);
      
      let confirmationsSent = 0;
      let confirmationsFailed = 0;
      let noConfirmation = 0;

      for (const lead of leads) {
        // Handle booking_history as JSON string or array
        let history = lead.booking_history || [];
        if (typeof history === 'string') {
          try {
            history = JSON.parse(history);
          } catch (e) {
            history = [];
          }
        }
        if (!Array.isArray(history)) {
          history = [];
        }
        
        const confirmationEntries = history.filter(
          entry => entry && (entry.action === 'BOOKING_CONFIRMATION_SENT' || 
                   entry.action === 'EMAIL_SENT')
        );

        if (confirmationEntries.length > 0) {
          const latest = confirmationEntries[confirmationEntries.length - 1];
          const sentVia = latest.details?.sentVia || latest.details;
          const emailSent = sentVia?.email || latest.details?.email;
          
          if (emailSent) {
            confirmationsSent++;
            console.log(`   ✅ ${lead.name || 'Unknown'} (${lead.email || 'No email'})`);
            console.log(`      Booking: ${new Date(lead.date_booked).toLocaleString()}`);
            console.log(`      Confirmation sent: ${new Date(latest.timestamp).toLocaleString()}`);
            console.log(`      Via: Email${sentVia?.sms ? ' + SMS' : ''}`);
          } else {
            confirmationsFailed++;
            console.log(`   ⚠️  ${lead.name || 'Unknown'} (${lead.email || 'No email'})`);
            console.log(`      Booking: ${new Date(lead.date_booked).toLocaleString()}`);
            console.log(`      Status: Confirmation attempted but email may have failed`);
          }
        } else {
          noConfirmation++;
          console.log(`   ❌ ${lead.name || 'Unknown'} (${lead.email || 'No email'})`);
          console.log(`      Booking: ${new Date(lead.date_booked).toLocaleString()}`);
          console.log(`      Status: No confirmation sent`);
        }
        console.log('');
      }

      console.log('   📊 Summary:');
      console.log(`      ✅ Confirmations sent: ${confirmationsSent}`);
      console.log(`      ⚠️  Confirmations failed: ${confirmationsFailed}`);
      console.log(`      ❌ No confirmation: ${noConfirmation}`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  console.log('');

  // 5. Check Recent Messages (Sent Emails)
  console.log('5️⃣ RECENT SENT EMAILS (Last 24 Hours)');
  console.log('-'.repeat(80));
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('type', 'email')
      .eq('status', 'sent')
      .gte('sent_at', yesterday.toISOString())
      .order('sent_at', { ascending: false })
      .limit(10);

    if (error) {
      console.log(`   ❌ Error fetching messages: ${error.message}`);
    } else if (!messages || messages.length === 0) {
      console.log('   ℹ️  No sent emails found in the last 24 hours');
    } else {
      console.log(`   📧 Found ${messages.length} sent email(s):\n`);
      messages.forEach((msg, idx) => {
        console.log(`   ${idx + 1}. To: ${msg.recipient_email || 'N/A'}`);
        console.log(`      Subject: ${msg.subject || 'N/A'}`);
        console.log(`      Sent: ${new Date(msg.sent_at).toLocaleString()}`);
        console.log(`      Status: ${msg.status}`);
        if (msg.subject && msg.subject.toLowerCase().includes('booking')) {
          console.log(`      ✅ This appears to be a booking confirmation`);
        }
        console.log('');
      });
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  console.log('');

  // 6. Test Email Sending Capability
  console.log('6️⃣ EMAIL SENDING TEST');
  console.log('-'.repeat(80));
  console.log('   ℹ️  To test email sending, create a test booking with sendEmail: true');
  console.log('   ℹ️  Or use the test endpoint if available\n');

  console.log('='.repeat(80));
  console.log('✅ AUDIT COMPLETE');
  console.log('='.repeat(80) + '\n');

})().catch(error => {
  console.error('❌ Audit failed:', error);
  process.exit(1);
});
