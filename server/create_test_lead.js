#!/usr/bin/env node

/**
 * Create Test Lead for Email Poller
 * Creates a lead for tmx565@googlemail.com so we can test email processing
 */

const config = require('./config');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

async function createTestLead() {
    console.log('📋 CREATING TEST LEAD FOR EMAIL POLLER');
    console.log('=====================================');

    const supabase = createClient(config.supabase.url, config.supabase.anonKey);

    try {
        // Check if lead already exists
        const { data: existing, error: checkError } = await supabase
            .from('leads')
            .select('id, name, email')
            .ilike('email', 'tmx565@googlemail.com')
            .single();

        if (checkError && checkError.code !== 'PGRST116') {
            throw checkError;
        }

        if (existing) {
            console.log(`✅ Lead already exists: ${existing.name} (${existing.email})`);
            console.log(`   ID: ${existing.id}`);
            return existing;
        }

        // Create new lead
        const leadId = randomUUID();
        const now = new Date().toISOString();

        const { data: newLead, error: insertError } = await supabase
            .from('leads')
            .insert({
                id: leadId,
                name: 'Test Lead - Email Poller',
                email: 'tmx565@googlemail.com',
                phone: '+44123456789',
                status: 'active',
                source: 'email_test',
                booking_history: JSON.stringify([]),
                created_at: now,
                updated_at: now
            })
            .select()
            .single();

        if (insertError) {
            throw insertError;
        }

        console.log(`✅ Created new lead: ${newLead.name}`);
        console.log(`   Email: ${newLead.email}`);
        console.log(`   ID: ${newLead.id}`);
        console.log('\n🎯 Result: Email poller will now process emails from tmx565@googlemail.com');

        return newLead;

    } catch (error) {
        console.error('❌ Failed to create test lead:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    createTestLead();
}

module.exports = createTestLead;