#!/usr/bin/env node

/**
 * Check leads table schema to create proper test booking
 */

const dbManager = require('./database-connection-manager');

async function checkLeadsSchema() {
  console.log('🔍 CHECKING: Leads table schema');
  console.log('=============================');

  try {
    // Get one existing lead to see the structure
    const existingLead = await dbManager.query('leads', {
      select: '*',
      limit: 1
    });

    if (existingLead && existingLead.length > 0) {
      console.log('📋 Sample lead structure:');
      console.log(JSON.stringify(existingLead[0], null, 2));

      console.log('\n📊 Available fields:');
      Object.keys(existingLead[0]).forEach(field => {
        console.log(`   - ${field}: ${typeof existingLead[0][field]}`);
      });
    } else {
      console.log('❌ No existing leads found');
    }

  } catch (error) {
    console.error('❌ Failed to check schema:', error);
  }
}

// Run the check
if (require.main === module) {
  checkLeadsSchema();
}

module.exports = checkLeadsSchema;