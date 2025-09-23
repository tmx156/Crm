#!/usr/bin/env node

/**
 * Migration Script: Move Template Attachments to Supabase Storage
 * 
 * This script migrates existing template attachments from local filesystem
 * to Supabase Storage for Railway deployment compatibility.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const supabaseStorage = require('./utils/supabaseStorage');

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey);

async function migrateAttachments() {
  console.log('🚀 Starting attachment migration to Supabase Storage...');
  
  try {
    // 1. Get all templates with attachments
    console.log('📋 Fetching templates with attachments...');
    const { data: templates, error: fetchError } = await supabase
      .from('templates')
      .select('id, name, attachments')
      .not('attachments', 'is', null);

    if (fetchError) {
      console.error('❌ Error fetching templates:', fetchError);
      return;
    }

    console.log(`📊 Found ${templates.length} templates with attachments`);

    let migratedCount = 0;
    let errorCount = 0;

    // 2. Process each template
    for (const template of templates) {
      console.log(`\n📝 Processing template: ${template.name} (ID: ${template.id})`);
      
      try {
        const attachments = JSON.parse(template.attachments);
        
        if (!Array.isArray(attachments) || attachments.length === 0) {
          console.log('⚠️ No valid attachments found, skipping...');
          continue;
        }

        console.log(`📎 Found ${attachments.length} attachments`);

        const updatedAttachments = [];

        // 3. Process each attachment
        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          console.log(`📎 [${i + 1}/${attachments.length}] Processing: ${attachment.originalName || attachment.filename}`);

          // Check if already migrated (Supabase URL)
          if (attachment.url && attachment.url.includes('supabase.co/storage/v1/object/public/template-attachments/')) {
            console.log('✅ Already migrated to Supabase Storage, skipping...');
            updatedAttachments.push(attachment);
            continue;
          }

          // Try to find local file
          let localFilePath = null;
          
          if (attachment.url) {
            const cleanUrl = attachment.url.replace(/^\//, '');
            const possiblePaths = [
              path.join(__dirname, 'uploads', cleanUrl),
              path.resolve(process.cwd(), cleanUrl),
              path.resolve(__dirname, '..', cleanUrl)
            ];

            for (const possiblePath of possiblePaths) {
              if (fs.existsSync(possiblePath)) {
                localFilePath = possiblePath;
                console.log(`📁 Found local file: ${localFilePath}`);
                break;
              }
            }
          }

          if (!localFilePath) {
            console.warn('⚠️ Local file not found, skipping migration...');
            updatedAttachments.push(attachment);
            continue;
          }

          // 4. Upload to Supabase Storage
          try {
            const uploadResult = await supabaseStorage.uploadFile(
              localFilePath,
              attachment.filename,
              attachment.mimetype || 'application/octet-stream'
            );

            if (uploadResult.success) {
              console.log('✅ Successfully uploaded to Supabase Storage');
              
              // Update attachment with new URL
              const updatedAttachment = {
                ...attachment,
                url: uploadResult.url
              };
              
              updatedAttachments.push(updatedAttachment);
              migratedCount++;
            } else {
              console.error('❌ Failed to upload:', uploadResult.error);
              updatedAttachments.push(attachment); // Keep original
              errorCount++;
            }
          } catch (uploadError) {
            console.error('❌ Upload error:', uploadError.message);
            updatedAttachments.push(attachment); // Keep original
            errorCount++;
          }
        }

        // 5. Update template with migrated attachments
        if (updatedAttachments.length > 0) {
          const { error: updateError } = await supabase
            .from('templates')
            .update({ attachments: JSON.stringify(updatedAttachments) })
            .eq('id', template.id);

          if (updateError) {
            console.error('❌ Failed to update template:', updateError);
            errorCount++;
          } else {
            console.log('✅ Template updated successfully');
          }
        }

      } catch (parseError) {
        console.error('❌ Error parsing attachments:', parseError.message);
        errorCount++;
      }
    }

    // 6. Summary
    console.log('\n🎉 Migration completed!');
    console.log(`📊 Summary:`);
    console.log(`   ✅ Successfully migrated: ${migratedCount} attachments`);
    console.log(`   ❌ Errors: ${errorCount} attachments`);
    console.log(`   📋 Templates processed: ${templates.length}`);

    if (migratedCount > 0) {
      console.log('\n💡 Next steps:');
      console.log('   1. Test email sending with attachments');
      console.log('   2. Verify attachments are accessible');
      console.log('   3. Consider cleaning up local files after verification');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateAttachments()
    .then(() => {
      console.log('🏁 Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateAttachments };
