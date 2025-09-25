#!/usr/bin/env node

/**
 * Email Poller Diagnostic Script
 * Tests Gmail IMAP connection and finds missing emails
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const EMAIL_USER = process.env.EMAIL_USER || process.env.GMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

class EmailDiagnostic {
  constructor() {
    this.client = null;
    this.results = {
      configuration: { passed: false, issues: [] },
      connection: { passed: false, issues: [] },
      authentication: { passed: false, issues: [] },
      emailRetrieval: { passed: false, issues: [] },
      missingEmails: []
    };
  }

  async runDiagnostic() {
    console.log('🔍 EMAIL POLLER DIAGNOSTIC');
    console.log('=' .repeat(50));
    console.log('');

    await this.testConfiguration();
    await this.testConnection();
    await this.testAuthentication();
    await this.findRecentEmails();
    await this.findMissingEmails();

    this.printResults();
  }

  async testConfiguration() {
    console.log('⚙️ Testing Configuration...');

    const tests = [
      {
        name: 'EMAIL_USER configured',
        test: () => !!EMAIL_USER,
        value: EMAIL_USER || 'Not set'
      },
      {
        name: 'EMAIL_PASSWORD configured',
        test: () => !!EMAIL_PASS,
        value: EMAIL_PASS ? 'Set (length: ' + EMAIL_PASS.length + ')' : 'Not set'
      },
      {
        name: 'SUPABASE_URL configured',
        test: () => !!SUPABASE_URL,
        value: SUPABASE_URL ? 'Set' : 'Not set'
      }
    ];

    let configIssues = [];
    let passed = 0;

    for (const test of tests) {
      const result = test.test();
      console.log(`   ${result ? '✅' : '❌'} ${test.name}: ${test.value}`);

      if (result) {
        passed++;
      } else {
        configIssues.push(test.name);
      }
    }

    this.results.configuration.passed = passed === tests.length;
    this.results.configuration.issues = configIssues;

    if (!EMAIL_USER || !EMAIL_PASS) {
      console.log('   ⚠️ Email credentials missing - email poller cannot work!');
    }

    console.log('');
  }

  async testConnection() {
    console.log('🔌 Testing Gmail IMAP Connection...');

    if (!EMAIL_USER || !EMAIL_PASS) {
      console.log('   ⏭️ Skipping connection test - credentials not configured');
      this.results.connection.issues.push('Missing credentials');
      return;
    }

    try {
      console.log('   📧 Attempting to connect to imap.gmail.com:993...');

      this.client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        logger: false,
        socketTimeout: 30000,
        idleTimeout: 30000,
        emitLogs: false,
        tls: {
          rejectUnauthorized: false,
          servername: 'imap.gmail.com',
          minVersion: 'TLSv1.2'
        },
        connectionTimeout: 30000
      });

      await this.client.connect();
      console.log('   ✅ Connected to Gmail IMAP successfully');

      await this.client.mailboxOpen('INBOX');
      console.log('   ✅ INBOX opened successfully');

      this.results.connection.passed = true;

    } catch (error) {
      console.log(`   ❌ Connection failed: ${error.message}`);
      this.results.connection.issues.push(error.message);

      if (error.message.includes('authentication')) {
        console.log('   💡 Possible solutions:');
        console.log('      - Enable 2-factor authentication on Gmail');
        console.log('      - Generate App Password (16 characters)');
        console.log('      - Use App Password instead of regular password');
      } else if (error.message.includes('Too many simultaneous connections')) {
        console.log('   💡 Gmail connection limit reached');
        console.log('      - Wait a few minutes and try again');
        console.log('      - Close other IMAP connections');
      }
    }

    console.log('');
  }

  async testAuthentication() {
    console.log('🔐 Testing Authentication...');

    if (!this.client || !this.results.connection.passed) {
      console.log('   ⏭️ Skipping auth test - no connection established');
      return;
    }

    try {
      // Test by getting mailbox info
      const mailboxInfo = await this.client.status('INBOX', { messages: true, recent: true, unseen: true });
      console.log(`   ✅ Authentication successful`);
      console.log(`   📊 Mailbox info: ${mailboxInfo.messages} total messages, ${mailboxInfo.unseen} unseen`);

      this.results.authentication.passed = true;
      this.results.authentication.mailboxInfo = mailboxInfo;

    } catch (error) {
      console.log(`   ❌ Authentication test failed: ${error.message}`);
      this.results.authentication.issues.push(error.message);
    }

    console.log('');
  }

  async findRecentEmails() {
    console.log('📬 Searching for Recent Emails...');

    if (!this.client || !this.results.connection.passed) {
      console.log('   ⏭️ Skipping email search - no connection established');
      return;
    }

    try {
      // Get emails from last 7 days
      const since = new Date();
      since.setDate(since.getDate() - 7);

      console.log(`   🔍 Searching for emails since ${since.toISOString().split('T')[0]}...`);

      const searchResults = await this.client.search({
        since: since
      });

      console.log(`   📧 Found ${searchResults.length} emails in last 7 days`);

      if (searchResults.length > 0) {
        // Get details of recent emails
        const recentEmails = [];
        const limit = Math.min(searchResults.length, 10); // Limit to 10 most recent

        console.log(`   📋 Getting details for ${limit} most recent emails...`);

        for (let i = 0; i < limit; i++) {
          try {
            const uid = searchResults[i];
            const message = await this.client.fetchOne(uid, {
              envelope: true,
              source: true
            });

            const parsed = await simpleParser(message.source);

            const email = {
              uid: uid,
              from: message.envelope.from?.[0]?.address,
              subject: message.envelope.subject,
              date: message.envelope.date,
              body: parsed.text ? parsed.text.substring(0, 200) + '...' : 'No text content'
            };

            recentEmails.push(email);
            console.log(`     ${i+1}. From: ${email.from} | Subject: "${email.subject}" | Date: ${email.date?.toISOString()}`);

          } catch (emailError) {
            console.log(`     ❌ Error processing email ${i+1}: ${emailError.message}`);
          }
        }

        this.results.emailRetrieval.passed = recentEmails.length > 0;
        this.results.emailRetrieval.recentEmails = recentEmails;

      } else {
        console.log('   ℹ️ No emails found in the last 7 days');
        this.results.emailRetrieval.passed = true; // No emails is OK
      }

    } catch (error) {
      console.log(`   ❌ Email search failed: ${error.message}`);
      this.results.emailRetrieval.issues.push(error.message);
    }

    console.log('');
  }

  async findMissingEmails() {
    console.log('🕵️ Looking for Missing Emails in CRM...');

    if (!this.results.emailRetrieval.recentEmails || this.results.emailRetrieval.recentEmails.length === 0) {
      console.log('   ⏭️ No recent emails to check against CRM');
      return;
    }

    try {
      // Get all email addresses that should be in our system
      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('id, name, email')
        .not('email', 'is', null);

      if (leadsError) {
        throw leadsError;
      }

      console.log(`   👥 Found ${leads?.length || 0} leads with email addresses`);

      // Get existing email messages in CRM
      const { data: existingEmails, error: emailsError } = await supabase
        .from('messages')
        .select('id, lead_id, content, subject, created_at')
        .eq('type', 'email')
        .order('created_at', { ascending: false });

      if (emailsError) {
        throw emailsError;
      }

      console.log(`   📧 Found ${existingEmails?.length || 0} email messages in CRM`);

      // Create a map of lead emails
      const leadEmailMap = new Map();
      leads?.forEach(lead => {
        if (lead.email) {
          leadEmailMap.set(lead.email.toLowerCase(), lead);
        }
      });

      // Check which recent emails are missing from CRM
      const missingEmails = [];

      for (const email of this.results.emailRetrieval.recentEmails) {
        if (!email.from) continue;

        const fromEmail = email.from.toLowerCase();
        const lead = leadEmailMap.get(fromEmail);

        if (lead) {
          // This email is from a known lead - check if it exists in CRM
          const existsInCrm = existingEmails?.some(existing => {
            const existingDate = new Date(existing.created_at);
            const emailDate = new Date(email.date);
            const timeDiff = Math.abs(existingDate.getTime() - emailDate.getTime());
            const sameContent = existing.subject === email.subject;

            // Match if within 5 minutes and same subject, or exact content match
            return (timeDiff < 5 * 60 * 1000 && sameContent) ||
                   existing.content?.includes(email.body?.substring(0, 50));
          });

          if (!existsInCrm) {
            missingEmails.push({
              ...email,
              lead: lead,
              reason: 'Email from known lead not found in CRM'
            });
          }
        } else {
          // Email from unknown sender
          missingEmails.push({
            ...email,
            lead: null,
            reason: 'Email from unknown sender (no lead with this email)'
          });
        }
      }

      console.log(`   📊 Analysis complete: ${missingEmails.length} emails missing from CRM`);

      if (missingEmails.length > 0) {
        console.log('   ⚠️ Missing emails found:');
        missingEmails.forEach((missing, i) => {
          console.log(`     ${i+1}. From: ${missing.from}`);
          console.log(`        Subject: "${missing.subject}"`);
          console.log(`        Date: ${missing.date?.toISOString()}`);
          console.log(`        Lead: ${missing.lead ? `${missing.lead.name} (ID: ${missing.lead.id})` : 'Unknown'}`);
          console.log(`        Reason: ${missing.reason}`);
          console.log('');
        });
      } else {
        console.log('   ✅ All recent emails from known leads found in CRM');
      }

      this.results.missingEmails = missingEmails;

    } catch (error) {
      console.log(`   ❌ Missing email analysis failed: ${error.message}`);
    }

    console.log('');
  }

  async cleanup() {
    if (this.client) {
      try {
        await this.client.close();
        console.log('🔌 Disconnected from Gmail IMAP');
      } catch (error) {
        console.log('⚠️ Error during cleanup:', error.message);
      }
    }
  }

  printResults() {
    console.log('🎯 DIAGNOSTIC RESULTS SUMMARY');
    console.log('=' .repeat(50));

    const categories = [
      { name: 'Configuration', key: 'configuration' },
      { name: 'IMAP Connection', key: 'connection' },
      { name: 'Authentication', key: 'authentication' },
      { name: 'Email Retrieval', key: 'emailRetrieval' }
    ];

    let totalPassed = 0;

    categories.forEach(category => {
      const result = this.results[category.key];
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${category.name}`);

      if (result.issues && result.issues.length > 0) {
        result.issues.forEach(issue => {
          console.log(`  ⚠️ ${issue}`);
        });
      }

      if (result.passed) totalPassed++;
    });

    console.log('');
    console.log(`📊 Overall: ${totalPassed}/${categories.length} categories passed`);

    if (this.results.missingEmails.length > 0) {
      console.log(`⚠️ ${this.results.missingEmails.length} emails found that are missing from CRM`);
    } else {
      console.log('✅ No missing emails detected');
    }

    console.log('');
    console.log('📋 NEXT STEPS:');

    if (totalPassed < categories.length) {
      console.log('1. 🔧 Fix the configuration/connection issues above');
      console.log('2. 🔄 Restart your CRM server after fixes');
      console.log('3. 📧 Send a test email and monitor logs');
    } else {
      console.log('1. 🔄 Restart your CRM server to start the email poller');
      console.log('2. 📧 Send a test email to verify processing');
      console.log('3. 📋 Monitor server logs for email processing messages');
    }

    if (this.results.missingEmails.length > 0) {
      console.log('4. 🔄 The email poller will process new emails once started');
      console.log('5. 🕰️ Historical emails may need manual processing');
    }
  }
}

// Run diagnostic
async function runDiagnostic() {
  const diagnostic = new EmailDiagnostic();

  try {
    await diagnostic.runDiagnostic();
  } catch (error) {
    console.error('❌ Diagnostic failed:', error);
  } finally {
    await diagnostic.cleanup();
  }
}

if (require.main === module) {
  runDiagnostic().catch(console.error);
}

module.exports = EmailDiagnostic;