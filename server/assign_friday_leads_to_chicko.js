#!/usr/bin/env node

/**
 * Assign Friday Leads to Chicko
 * Find all leads from the CSV and assign them to Chicko
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const fs = require('fs');
const path = require('path');

// Use service role key for admin operations
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

// Parse CSV data
const csvData = [
  { name: 'Karan Lowe', phone: '7989428912', email: 'crazykaran81@outlook.com' },
  { name: 'Martine Van de Steene', phone: '7885624055', email: 'mvandesteene@yahoo.com' },
  { name: 'Andy Gardner', phone: '7803136806', email: 'andy.gardner35@btinternet.com' },
  { name: 'Ruth farrell', phone: '7957013790', email: 'hopebespoke@gmail.com' },
  { name: 'Tara curry', phone: '7706006007', email: 'tara_embara@icloud.com' },
  { name: 'Angie dawson', phone: '7368429444', email: 'angelaejones71@gmail.com' },
  { name: 'Helen Richardson', phone: '7568170016', email: 'richardson.helen776@gmail.com' },
  { name: 'Paula Mccall', phone: '7488568032', email: 'pmccall3@yahoo.co.uk' },
  { name: 'Shabnam Anam', phone: '7985494131', email: 'shabnam.a.anam@gmail.com' },
  { name: 'Allan', phone: '7590729497', email: 'abruce3631@gmail.com' },
  { name: 'Oliwia Haglauer', phone: '7597960441', email: 'oliwiahaglauer@gmail.com' },
  { name: 'Parisima', phone: '7880902191', email: 'parrysima@yahoo.co.uk' },
  { name: 'Paul Denny', phone: '7393696610', email: 'pdenny1962@gmail.com' },
  { name: 'Ian Aldous', phone: '7901552629', email: 'ian.aldous@solusarc.co.uk' },
  { name: 'Claire Pammenter', phone: '7762152711', email: 'clpammenter@hotmail.co.uk' },
  { name: 'Aaron young', phone: '7949563152', email: 'azzaboibox@gmail.com' },
  { name: 'Geoff Barwise', phone: '7720600890', email: 'gbarwise@aol.com' },
  { name: 'Emma longman', phone: '7939633046', email: 'emmalongman@rocketmail.com' },
  { name: 'Syon Manav Muralibabu Sujatha', phone: '7823614238', email: 'syonmanav2@gmail.com' },
  { name: 'Heloisa Antonia de Freitas Cavalcanti', phone: '7769884419', email: 'heloisaandmarcio@gmail.com' },
  { name: 'Vinujan Rajeswaran', phone: '7888623409', email: 'vinujanvinujan066@gmail.com' },
  { name: 'KYRIAKOS TSOLAKIS', phone: '7362591903', email: 'kyrtsol@hotmail.com' },
  { name: 'Mike Molloy', phone: '7827927342', email: 'michaelmolloy08@me.com' },
  { name: 'Patryk Lesiak', phone: '7564620210', email: 'patryklesiak8907@gmail.com' },
  { name: 'Lesley Fielding', phone: '7880038899', email: 'lesleyf0211@gmail.com' },
  { name: 'Robin Porter', phone: '7872942826', email: 'immigrantmusic@me.com' },
  { name: 'Ana Zachariadis', phone: '7732945386', email: 'aazaxariadi@gmail.com' },
  { name: 'Geoff Cawley', phone: '7880314454', email: 'geoff.cawley@icloud.com' },
  { name: 'Nicki Connor', phone: '7399863770', email: 'dolly3333@hotmail.com' },
  { name: 'Natalie Henshall', phone: '7971069551', email: 'andy8369@gmail.com' },
  { name: 'Jacqueline', phone: '7717873648', email: 'jakerline8@gmail.com' },
  { name: 'Deb', phone: '7591763822', email: 'debrahhill@hotmail.co.uk' },
  { name: 'Carole Saunders', phone: '7572105992', email: 'saunders.rosedale53@yahoo.co.uk' },
  { name: 'Julie Smith', phone: '7939907220', email: 'juliesmith15763@hotmail.co.uk' }
];

async function assignLeadsToChicko() {
  try {
    console.log('🔍 ASSIGNING FRIDAY LEADS TO CHICKO\n');
    console.log(`Total leads to process: ${csvData.length}\n`);

    // Get Chicko's user ID
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, name, email')
      .ilike('name', '%chicko%');

    if (userError) {
      console.error('❌ Error fetching Chicko:', userError);
      return;
    }

    if (!users || users.length === 0) {
      console.error('❌ Chicko user not found!');
      return;
    }

    const chicko = users[0];
    console.log(`✅ Found Chicko: ${chicko.name} (${chicko.id})`);
    console.log(`   Email: ${chicko.email}\n`);

    let foundCount = 0;
    let updatedCount = 0;
    let alreadyAssignedCount = 0;
    let notFoundCount = 0;
    const notFoundLeads = [];

    // Process each lead
    for (const csvLead of csvData) {
      console.log(`\n📋 Processing: ${csvLead.name} (${csvLead.phone})`);

      // Normalize phone number for matching (remove spaces, dashes, etc)
      const normalizedPhone = csvLead.phone.replace(/[\s\-\(\)]/g, '');

      // Try to find the lead by phone number
      const { data: leads, error: searchError } = await supabase
        .from('leads')
        .select('id, name, phone, email, booker_id, status')
        .or(`phone.eq.${normalizedPhone},phone.eq.+44${normalizedPhone},phone.eq.0${normalizedPhone}`);

      if (searchError) {
        console.error(`   ❌ Error searching for lead: ${searchError.message}`);
        continue;
      }

      if (!leads || leads.length === 0) {
        // Try searching by name if phone didn't work
        const { data: leadsByName, error: nameError } = await supabase
          .from('leads')
          .select('id, name, phone, email, booker_id, status')
          .ilike('name', `%${csvLead.name}%`);

        if (nameError || !leadsByName || leadsByName.length === 0) {
          console.log(`   ⚠️  NOT FOUND in database`);
          notFoundCount++;
          notFoundLeads.push(csvLead);
          continue;
        }

        leads.push(...leadsByName);
      }

      // Found the lead(s)
      foundCount++;
      const lead = leads[0]; // Use first match

      console.log(`   ✅ FOUND: ${lead.name} (ID: ${lead.id})`);
      console.log(`      Status: ${lead.status}`);
      console.log(`      Current booker_id: ${lead.booker_id || 'None'}`);

      // Check if already assigned to Chicko
      if (lead.booker_id === chicko.id) {
        console.log(`   ℹ️  Already assigned to Chicko - skipping`);
        alreadyAssignedCount++;
        continue;
      }

      // Update the lead to assign to Chicko
      const { data: updated, error: updateError } = await supabase
        .from('leads')
        .update({
          booker_id: chicko.id,
          assigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', lead.id)
        .select();

      if (updateError) {
        console.error(`   ❌ Error updating lead: ${updateError.message}`);
        continue;
      }

      console.log(`   ✅ REASSIGNED to Chicko!`);
      updatedCount++;
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total leads in CSV: ${csvData.length}`);
    console.log(`✅ Found in database: ${foundCount}`);
    console.log(`✅ Successfully reassigned: ${updatedCount}`);
    console.log(`ℹ️  Already assigned to Chicko: ${alreadyAssignedCount}`);
    console.log(`⚠️  Not found in database: ${notFoundCount}`);

    if (notFoundLeads.length > 0) {
      console.log('\n⚠️  LEADS NOT FOUND IN DATABASE:');
      notFoundLeads.forEach(lead => {
        console.log(`   - ${lead.name} (${lead.phone})`);
      });
    }

    console.log('\n✅ DONE! All Friday leads have been processed.');

  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Run the script
assignLeadsToChicko();

