/**
 * Verify that the email rebuild was successful
 */

require('dotenv').config();

let createClient;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (e) {
  ({ createClient } = require('./server/node_modules/@supabase/supabase-js'));
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function verify() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 EMAIL SYSTEM VERIFICATION');
  console.log('='.repeat(80) + '\n');

  // 1. Count total emails
  const { count: emailCount } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'email');

  console.log(`📧 Total email messages: ${emailCount}`);

  // 2. Check sample emails
  const { data: sampleEmails } = await supabase
    .from('messages')
    .select('id, lead_id, recipient_email, subject')
    .eq('type', 'email')
    .limit(10);

  console.log(`\n📧 Checking ${sampleEmails.length} sample emails for correct lead linking:\n`);

  let correctMatches = 0;
  let orphanedMatches = 0;

  for (const msg of sampleEmails) {
    const { data: lead, error } = await supabase
      .from('leads')
      .select('id, email, name')
      .eq('id', msg.lead_id)
      .maybeSingle();

    if (!lead) {
      console.log(`  ❌ ORPHANED: ${msg.recipient_email} -> lead_id ${msg.lead_id} (LEAD NOT FOUND)`);
      orphanedMatches++;
    } else {
      const match = lead.email.toLowerCase().trim() === msg.recipient_email.toLowerCase().trim();
      if (match) {
        console.log(`  ✅ ${msg.recipient_email} -> ${lead.name} (${lead.email})`);
        correctMatches++;
      } else {
        console.log(`  ❌ MISMATCH: ${msg.recipient_email} -> ${lead.name} (${lead.email})`);
      }
    }
  }

  // 3. Check all lead associations
  console.log(`\n📊 Checking ALL email-to-lead associations...\n`);

  const { data: allEmails } = await supabase
    .from('messages')
    .select('lead_id')
    .eq('type', 'email');

  const uniqueLeadIds = [...new Set(allEmails.map(m => m.lead_id))];
  console.log(`   Total unique lead_ids referenced: ${uniqueLeadIds.length}`);

  let validLeads = 0;
  let orphanedLeads = 0;

  for (const leadId of uniqueLeadIds) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('id', leadId)
      .maybeSingle();

    if (lead) {
      validLeads++;
    } else {
      orphanedLeads++;
      console.log(`   ⚠️  Orphaned lead_id: ${leadId}`);
    }
  }

  // 4. Check duplicate detection
  const { data: duplicateCheck } = await supabase
    .from('messages')
    .select('provider_message_id')
    .eq('type', 'email')
    .not('provider_message_id', 'is', null);

  const uniqueProviderIds = new Set(duplicateCheck.map(m => m.provider_message_id));
  const hasDuplicates = duplicateCheck.length !== uniqueProviderIds.size;

  // 5. Results
  console.log('\n' + '='.repeat(80));
  console.log('✅ VERIFICATION RESULTS');
  console.log('='.repeat(80) + '\n');

  console.log('📊 Sample Check (10 emails):');
  console.log(`   ✅ Correct matches: ${correctMatches}/10`);
  console.log(`   ❌ Orphaned: ${orphanedMatches}/10\n`);

  console.log('📊 Full Database Check:');
  console.log(`   ✅ Valid lead associations: ${validLeads}/${uniqueLeadIds.length}`);
  console.log(`   ❌ Orphaned associations: ${orphanedLeads}/${uniqueLeadIds.length}\n`);

  console.log('📊 Duplicate Detection:');
  console.log(`   Total emails with provider_message_id: ${duplicateCheck.length}`);
  console.log(`   Unique provider_message_ids: ${uniqueProviderIds.size}`);
  console.log(`   ${hasDuplicates ? '❌ DUPLICATES FOUND!' : '✅ No duplicates'}\n`);

  if (orphanedLeads === 0 && correctMatches === sampleEmails.length && !hasDuplicates) {
    console.log('🎉 SUCCESS! Email system is working correctly!');
    console.log('   ✅ All emails linked to valid leads');
    console.log('   ✅ No orphaned associations');
    console.log('   ✅ No duplicate emails');
    console.log('   ✅ Emails should now appear correctly in CRM\n');
    return true;
  } else {
    console.log('⚠️  ISSUES DETECTED:');
    if (orphanedLeads > 0) console.log(`   - ${orphanedLeads} orphaned lead associations`);
    if (correctMatches < sampleEmails.length) console.log(`   - Some emails not correctly matched to leads`);
    if (hasDuplicates) console.log(`   - Duplicate emails detected`);
    console.log('');
    return false;
  }
}

verify().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('\n❌ Verification failed:', error);
  process.exit(1);
});
