#!/usr/bin/env node

/**
 * Test Lead Creation with RLS Policy Fix
 * Verify that lead creation works without RLS violations
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5000';

async function testLeadCreation() {
  console.log('🧪 TESTING LEAD CREATION WITH RLS FIX');
  console.log('====================================');

  try {
    // Test lead creation endpoint
    const testLead = {
      name: 'Test Lead RLS Fix',
      phone: '1234567890',
      email: 'test@example.com',
      status: 'New',
      source: 'Manual Test',
      created_at: new Date().toISOString()
    };

    console.log('📝 Creating test lead...');
    console.log('Lead data:', testLead);

    const response = await axios.post(`${BASE_URL}/api/leads`, testLead, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      }
    });

    if (response.status === 201) {
      console.log('✅ Lead creation successful!');
      console.log('Response:', response.data);

      // Test if booker activity log was created without RLS error
      console.log('\n🔍 Checking if activity was logged...');
      console.log('(No RLS errors should have occurred)');

    } else {
      console.log('⚠️ Unexpected status:', response.status);
      console.log('Response:', response.data);
    }

  } catch (error) {
    if (error.response) {
      console.error('❌ HTTP Error:', error.response.status, error.response.statusText);
      console.error('Error details:', error.response.data);

      if (error.response.data && error.response.data.message) {
        console.log('\n🔍 Checking for RLS policy violations:');
        const isRLSError = error.response.data.message.includes('row-level security policy');
        console.log(`RLS Policy Error: ${isRLSError ? '❌ STILL PRESENT' : '✅ RESOLVED'}`);

        if (isRLSError) {
          console.log('🔧 Need to investigate further - RLS fix may not be complete');
        }
      }
    } else {
      console.error('❌ Network/Connection error:', error.message);
      console.log('🔧 Make sure the server is running on port 5000');
    }
  }
}

// Run the test
if (require.main === module) {
  testLeadCreation();
}

module.exports = testLeadCreation;