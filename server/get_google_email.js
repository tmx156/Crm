require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const config = require('./config');

(async () => {
  try {
    const email = process.env.EMAIL_USER || process.env.GMAIL_USER;
    
    if (!email) {
      console.error('❌ EMAIL_USER not set');
      process.exit(1);
    }

    console.log(`\n📧 Fetching recent emails from Google for: ${email}\n`);

    // Get OAuth tokens
    const supabase = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey || config.supabase.anonKey
    );

    const { data: account, error } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error || !account) {
      console.error('❌ No OAuth tokens found. Please authenticate first.');
      process.exit(1);
    }

    // Create Gmail client
    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );

    oauth2Client.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      token_type: account.token_type || 'Bearer',
      expiry_date: account.expiry_date
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Search for emails from Google
    console.log('🔍 Searching for emails from Google...\n');
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:google.com OR from:googleusercontent.com OR from:accounts.google.com',
      maxResults: 10
    });

    if (!response.data.messages || response.data.messages.length === 0) {
      console.log('❌ No emails found from Google');
      process.exit(0);
    }

    console.log(`✅ Found ${response.data.messages.length} email(s) from Google\n`);
    console.log('='.repeat(80));

    // Get the most recent one
    const latestMessage = response.data.messages[0];
    const fullMessage = await gmail.users.messages.get({
      userId: 'me',
      id: latestMessage.id,
      format: 'full'
    });

    const message = fullMessage.data;
    const headers = message.payload.headers;

    // Extract headers
    const getHeader = (name) => {
      const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return header ? header.value : null;
    };

    const from = getHeader('From');
    const to = getHeader('To');
    const subject = getHeader('Subject');
    const date = getHeader('Date');

    console.log('\n📧 EMAIL FROM GOOGLE:\n');
    console.log(`From: ${from}`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Date: ${date}`);
    console.log(`Message ID: ${message.id}`);
    console.log('\n' + '-'.repeat(80) + '\n');

    // Extract body
    const extractBody = (payload) => {
      let body = '';
      
      const getBodyFromPart = (part) => {
        if (!part) return '';
        
        if (part.mimeType === 'text/plain' && part.body && part.body.data) {
          const base64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
          const padding = '='.repeat((4 - base64.length % 4) % 4);
          return Buffer.from(base64 + padding, 'base64').toString('utf8');
        }
        
        if (part.mimeType === 'text/html' && part.body && part.body.data) {
          const base64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
          const padding = '='.repeat((4 - base64.length % 4) % 4);
          const html = Buffer.from(base64 + padding, 'base64').toString('utf8');
          // Simple HTML to text
          return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
        }
        
        if (part.parts) {
          for (const subPart of part.parts) {
            const text = getBodyFromPart(subPart);
            if (text) return text;
          }
        }
        
        return '';
      };
      
      if (payload) {
        body = getBodyFromPart(payload);
      }
      
      return body || 'No content available';
    };

    const body = extractBody(message.payload);
    console.log('CONTENT:\n');
    console.log(body);
    console.log('\n' + '='.repeat(80) + '\n');

    // Check for attachments
    const parts = message.payload.parts || [];
    const attachments = [];
    
    const checkParts = (partList) => {
      for (const part of partList) {
        if (part.filename && part.body && part.body.attachmentId) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size
          });
        }
        if (part.parts) {
          checkParts(part.parts);
        }
      }
    };
    
    checkParts(parts);
    
    if (attachments.length > 0) {
      console.log('📎 ATTACHMENTS:');
      attachments.forEach(att => {
        console.log(`   - ${att.filename} (${att.mimeType}, ${att.size} bytes)`);
      });
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();

