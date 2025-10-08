// 🚨 WARNING: SQLite functionality has been temporarily disabled during migration to Supabase
// This route needs to be updated to use Supabase instead of SQLite
// Many functions in this file will not work until properly migrated

const express = require('express');
// DISABLED: // DISABLED: const Database = require('better-sqlite3');
const path = require('path');
const { auth, adminAuth } = require('../middleware/auth');
const MessagingService = require('../utils/messagingService');

const getDb = () => {
  return new Database(path.join(__dirname, '..', 'local-crm.db'));
};

const router = express.Router();

// @route   GET /api/retargeting/eligible
// @desc    Get leads eligible for retargeting
// @access  Admin only
router.get('/eligible', auth, adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    
    // Find leads that are eligible for retargeting
    const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    
    const db = getDb();
    
    const leads = db.prepare(`
      SELECT l.*, u.name as booker_name, u.email as booker_email
      FROM leads l
      LEFT JOIN users u ON l.booker_id = u.id
      WHERE l.status NOT IN ('Booked', 'Attended')
        AND l.created_at <= ?
        AND l.deleted_at IS NULL
      ORDER BY l.created_at ASC
      LIMIT ? OFFSET ?
    `).all(threeWeeksAgo.toISOString(), limit, offset);
    
    db.close();

    // Filter leads based on retargeting criteria (since we can't do complex JSONB queries easily)
    const eligibleLeads = leads?.filter(lead => {
      const retargeting = lead.retargeting || {};
      return (
        (retargeting.noAnswerCount || 0) >= 3 &&
        retargeting.excludeFromRetargeting !== true &&
        retargeting.status !== 'OPTED_OUT'
      );
    }) || [];

    // Mark eligible leads that aren't already marked
    const db2 = getDb();
    for (const lead of eligibleLeads) {
      if (!lead.retargeting?.isEligible) {
        const updatedRetargeting = {
          ...lead.retargeting,
          isEligible: true,
          eligibleSince: new Date().toISOString()
        };
        
        db2.prepare(`
          UPDATE leads 
          SET retargeting = ? 
          WHERE id = ?
        `).run(JSON.stringify(updatedRetargeting), lead.id);
      }
    }
    db2.close();

    res.json({
      leads: eligibleLeads,
      totalPages: Math.ceil(eligibleLeads.length / limit),
      currentPage: parseInt(page),
      total: eligibleLeads.length,
      canStartCampaign: eligibleLeads.length >= 100
    });
  } catch (error) {
    console.error('Get eligible leads error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/retargeting/templates
// @desc    Get retargeting email templates
// @access  Admin only
router.get('/templates', auth, adminAuth, async (req, res) => {
  try {
    const db = getDb();
    
    const templates = db.prepare(`
      SELECT * FROM templates
      WHERE type IN ('retargeting_gentle', 'retargeting_urgent', 'retargeting_final')
        AND is_active = 1
      ORDER BY type ASC
    `).all();
    
    db.close();
    res.json(templates || []);
  } catch (error) {
    console.error('Get retargeting templates error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/retargeting/campaign/start
// @desc    Start a retargeting campaign
// @access  Admin only
router.post('/campaign/start', auth, adminAuth, async (req, res) => {
  try {
    const { templateType, leadIds } = req.body;

    if (!templateType || !['retargeting_gentle', 'retargeting_urgent', 'retargeting_final'].includes(templateType)) {
      return res.status(400).json({ message: 'Invalid template type' });
    }

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ message: 'No leads selected for campaign' });
    }

    const db = getDb();
    
    // Get the template
    const template = db.prepare(`
      SELECT * FROM templates
      WHERE type = ? AND is_active = 1
    `).get(templateType);

    if (!template) {
      db.close();
      return res.status(404).json({ message: 'Template not found' });
    }

    // Get the leads
    const placeholders = leadIds.map(() => '?').join(',');
    const leads = db.prepare(`
      SELECT * FROM leads WHERE id IN (${placeholders})
    `).all(...leadIds);

    // Filter leads that are eligible and not opted out
    const eligibleLeads = leads?.filter(lead => {
      const retargeting = lead.retargeting || {};
      return (
        retargeting.isEligible === true &&
        retargeting.status !== 'OPTED_OUT'
      );
    }) || [];

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Send emails to each lead
    for (const lead of eligibleLeads) {
      try {
        // Replace template variables
        const personalizedSubject = template.subject
          .replace(/{leadName}/g, lead.name)
          .replace(/{companyName}/g, 'Avensis Models');

        const personalizedBody = (template.email_body || template.content || '')
          .replace(/{leadName}/g, lead.name)
          .replace(/{leadEmail}/g, lead.email)
          .replace(/{leadPhone}/g, lead.phone)
          .replace(/{companyName}/g, 'Avensis Models')
          .replace(/{originalContactDate}/g, new Date(lead.created_at).toLocaleDateString());

        // Send email using messaging service
        await MessagingService.sendEmail(
          lead.email,
          personalizedSubject,
          personalizedBody,
          template.id
        );

        // Update lead's campaign history
        const currentRetargeting = lead.retargeting || {};
        const campaignsSent = currentRetargeting.campaignsSent || [];
        
        campaignsSent.push({
          templateType: templateType,
          templateId: template.id,
          sentAt: new Date().toISOString()
        });

        const updatedRetargeting = {
          ...currentRetargeting,
          campaignsSent
        };

        db.prepare(`
          UPDATE leads 
          SET retargeting = ? 
          WHERE id = ?
        `).run(JSON.stringify(updatedRetargeting), lead.id);

        successCount++;
      } catch (error) {
        console.error(`Error sending retargeting email to ${lead.email}:`, error);
        errorCount++;
        errors.push({
          leadId: lead.id,
          leadName: lead.name,
          error: error.message
        });
      }
    }

    // Emit real-time update
    if (global.io) {
      global.io.emit('retargeting_campaign_completed', {
        templateType,
        successCount,
        errorCount,
        timestamp: new Date()
      });
    }

    db.close();
    res.json({
      message: 'Retargeting campaign completed',
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Start retargeting campaign error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/retargeting/opt-out/:leadId
// @desc    Opt out a lead from retargeting campaigns
// @access  Admin only
router.post('/opt-out/:leadId', auth, adminAuth, async (req, res) => {
  try {
    const db = getDb();
    
    // Get current lead data
    const lead = db.prepare(`
      SELECT * FROM leads WHERE id = ?
    `).get(req.params.leadId);

    if (!lead) {
      db.close();
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Update retargeting status
    const updatedRetargeting = {
      ...lead.retargeting,
      status: 'OPTED_OUT',
      isEligible: false,
      excludeFromRetargeting: true
    };

    db.prepare(`
      UPDATE leads 
      SET retargeting = ? 
      WHERE id = ?
    `).run(JSON.stringify(updatedRetargeting), req.params.leadId);

    // Get updated lead
    const updatedLead = db.prepare(`
      SELECT * FROM leads WHERE id = ?
    `).get(req.params.leadId);

    db.close();
    res.json({
      message: 'Lead opted out from retargeting',
      lead: updatedLead
    });
  } catch (error) {
    console.error('Opt out lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/retargeting/stats
// @desc    Get retargeting statistics
// @access  Admin only
router.get('/stats', auth, adminAuth, async (req, res) => {
  try {
    const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    
    const db = getDb();
    
    // Get all leads to calculate stats (since complex JSONB queries are difficult)
    const allLeads = db.prepare(`
      SELECT * FROM leads WHERE created_at <= ?
    `).all(threeWeeksAgo.toISOString());
    
    db.close();

    // Calculate statistics
    let eligibleCount = 0;
    let totalNoAnswerLeads = 0;
    let optedOutCount = 0;
    let campaignsGentle = 0;
    let campaignsUrgent = 0;
    let campaignsFinal = 0;
    let respondedCount = 0;

    allLeads?.forEach(lead => {
      const retargeting = lead.retargeting || {};
      
      if (retargeting.isEligible === true && retargeting.status !== 'OPTED_OUT') {
        eligibleCount++;
      }
      
      if ((retargeting.noAnswerCount || 0) >= 3) {
        totalNoAnswerLeads++;
      }
      
      if (retargeting.status === 'OPTED_OUT') {
        optedOutCount++;
      }
      
      if (retargeting.status === 'RESPONDED') {
        respondedCount++;
      }
      
      const campaignsSent = retargeting.campaignsSent || [];
      campaignsSent.forEach(campaign => {
        if (campaign.templateType === 'retargeting_gentle') campaignsGentle++;
        if (campaign.templateType === 'retargeting_urgent') campaignsUrgent++;
        if (campaign.templateType === 'retargeting_final') campaignsFinal++;
      });
    });

    res.json({
      eligibleForRetargeting: eligibleCount,
      totalNoAnswerLeads,
      optedOut: optedOutCount,
      campaignsSent: {
        gentle: campaignsGentle,
        urgent: campaignsUrgent,
        final: campaignsFinal,
        total: campaignsGentle + campaignsUrgent + campaignsFinal
      },
      responded: respondedCount,
      canStartCampaign: eligibleCount >= 100
    });
  } catch (error) {
    console.error('Get retargeting stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 