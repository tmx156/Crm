#!/usr/bin/env node

/**
 * Database Migration: Add imap_uid column to messages table
 * This column is required for email duplicate prevention
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

async function addImapUidColumn() {
    console.log('📋 ADDING IMAP_UID COLUMN TO MESSAGES TABLE');
    console.log('==========================================');

    // Create Supabase client with service role key for DDL operations
    const supabaseUrl = config.supabase.url;
    const serviceRoleKey = config.supabase.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
        console.error('❌ Service role key required for database schema changes');
        console.log('💡 Add SUPABASE_SERVICE_ROLE_KEY to your .env file');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    try {
        console.log('🔍 Checking current messages table structure...');

        // Check if column already exists
        const { data: columns, error: columnsError } = await supabase
            .rpc('get_table_columns', { table_name: 'messages' })
            .single();

        if (columnsError) {
            // If RPC doesn't exist, try direct SQL
            const { data, error } = await supabase
                .from('information_schema.columns')
                .select('column_name')
                .eq('table_name', 'messages')
                .eq('column_name', 'imap_uid');

            if (error) {
                throw new Error(`Failed to check table structure: ${error.message}`);
            }

            if (data && data.length > 0) {
                console.log('✅ imap_uid column already exists');
                return;
            }
        }

        console.log('📝 Adding imap_uid column to messages table...');

        // Add the column using SQL
        const { data: result, error: alterError } = await supabase.rpc('exec_sql', {
            query: `
                ALTER TABLE messages
                ADD COLUMN IF NOT EXISTS imap_uid TEXT;

                -- Add index for performance on duplicate checks
                CREATE INDEX IF NOT EXISTS idx_messages_imap_uid_lead_id
                ON messages(imap_uid, lead_id)
                WHERE imap_uid IS NOT NULL;

                -- Add comment
                COMMENT ON COLUMN messages.imap_uid IS 'IMAP UID for email duplicate prevention';
            `
        });

        if (alterError) {
            // If RPC doesn't work, try direct ALTER TABLE
            console.log('⚠️ RPC method failed, trying direct SQL execution...');

            // Alternative: Use a simple INSERT to test permissions, then throw descriptive error
            const { error: testError } = await supabase
                .from('messages')
                .select('id')
                .limit(1);

            if (testError) {
                throw new Error(`Database access error: ${testError.message}`);
            }

            throw new Error('Cannot execute DDL statements with current permissions. Manual SQL execution required.');
        }

        console.log('✅ Successfully added imap_uid column to messages table');
        console.log('✅ Created index for efficient duplicate checking');

        // Verify the column was added
        const { data: verification, error: verifyError } = await supabase
            .from('messages')
            .select('id, imap_uid')
            .limit(1);

        if (verifyError && !verifyError.message.includes('does not exist')) {
            throw verifyError;
        }

        if (verifyError && verifyError.message.includes('does not exist')) {
            throw new Error('Column addition failed - imap_uid still does not exist');
        }

        console.log('✅ Column verification successful');

        console.log('\n🎯 MIGRATION COMPLETED');
        console.log('======================');
        console.log('✅ imap_uid column added to messages table');
        console.log('✅ Database index created for performance');
        console.log('✅ Email poller can now prevent duplicates');
        console.log('\nNext step: Restart your CRM server to apply the updated email poller');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);

        if (error.message.includes('permission') || error.message.includes('DDL')) {
            console.log('\n💡 MANUAL SQL REQUIRED:');
            console.log('Run this SQL in your Supabase SQL editor:');
            console.log('');
            console.log('-- Add imap_uid column for email duplicate prevention');
            console.log('ALTER TABLE messages ADD COLUMN IF NOT EXISTS imap_uid TEXT;');
            console.log('');
            console.log('-- Add index for performance');
            console.log('CREATE INDEX IF NOT EXISTS idx_messages_imap_uid_lead_id');
            console.log('ON messages(imap_uid, lead_id) WHERE imap_uid IS NOT NULL;');
            console.log('');
            console.log('-- Add comment');
            console.log("COMMENT ON COLUMN messages.imap_uid IS 'IMAP UID for email duplicate prevention';");
        }

        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    addImapUidColumn();
}

module.exports = addImapUidColumn;