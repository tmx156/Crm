const express = require('express');
const { sendEmail } = require('../utils/emailService');
const { auth } = require('../middleware/auth');
const router = express.Router();

// @route   POST /api/email-test/send
// @desc    Test email sending functionality
// @access  Private (Admin only)
router.post('/send', auth, async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    
    // Validate required fields
    if (!to || !subject || !body) {
      return res.status(400).json({ 
        message: 'Missing required fields: to, subject, body' 
      });
    }
    
    // Check if Gmail OAuth credentials are configured
    const emailUser = process.env.EMAIL_USER || process.env.GMAIL_USER;
    const clientId = process.env.GOOGLE_CLIENT_ID;

    if (!emailUser || !clientId) {
      return res.status(500).json({
        message: 'Gmail OAuth credentials not configured',
        details: {
          GMAIL_USER: emailUser ? '✅ Set' : '❌ Not set',
          GOOGLE_CLIENT_ID: clientId ? '✅ Set' : '❌ Not set',
          GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? '✅ Set' : '❌ Not set',
          GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI ? '✅ Set' : '❌ Not set'
        },
        solution: 'Set GMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in Railway. Then authenticate via /api/gmail/auth-url'
      });
    }
    
    console.log('🧪 Testing email sending...');
    console.log(`📧 To: ${to}`);
    console.log(`📧 Subject: ${subject}`);
    console.log(`📧 Body length: ${body.length} characters`);
    
    // Send test email
    const result = await sendEmail(to, subject, body);
    
    if (result.success) {
      console.log('✅ Test email sent successfully');
      res.json({
        success: true,
        message: 'Test email sent successfully',
        details: {
          messageId: result.messageId,
          response: result.response,
          port: result.port
        }
      });
    } else {
      console.error('❌ Test email failed:', result.error);
      res.status(500).json({
        success: false,
        message: 'Test email failed',
        error: result.error,
        code: result.code,
        command: result.command,
        responseCode: result.responseCode
      });
    }
    
  } catch (error) {
    console.error('❌ Email test error:', error);
    res.status(500).json({
      success: false,
      message: 'Email test failed',
      error: error.message
    });
  }
});

// @route   GET /api/email-test/config
// @desc    Check email configuration status
// @access  Private (Admin only)
router.get('/config', auth, async (req, res) => {
  try {
    const config = {
      environment: process.env.NODE_ENV || 'development',
      gmailOAuth: {
        GMAIL_USER: process.env.GMAIL_USER || process.env.EMAIL_USER ? '✅ Set' : '❌ Not set',
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? '✅ Set' : '❌ Not set',
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? '✅ Set' : '❌ Not set',
        GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI ? '✅ Set' : '❌ Not set'
      },
      method: 'Gmail API (OAuth2)',
      railwayInfo: {
        platform: 'Railway',
        nodeVersion: process.version,
        port: process.env.PORT || 5000
      }
    };

    res.json({
      success: true,
      config,
      recommendations: [
        'Ensure GMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are set',
        'Authenticate via /api/gmail/auth-url to connect the Gmail account',
        'Gmail OAuth tokens are stored in Supabase gmail_accounts table'
      ]
    });
    
  } catch (error) {
    console.error('❌ Config check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check configuration',
      error: error.message
    });
  }
});

module.exports = router;
