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
    
    // Check if email credentials are configured
    const emailUser = process.env.EMAIL_USER || process.env.GMAIL_USER;
    const emailPass = process.env.EMAIL_PASSWORD || process.env.GMAIL_PASS;
    
    if (!emailUser || !emailPass) {
      return res.status(500).json({
        message: 'Email credentials not configured',
        details: {
          EMAIL_USER: emailUser ? '✅ Set' : '❌ Not set',
          EMAIL_PASSWORD: emailPass ? '✅ Set' : '❌ Not set',
          GMAIL_USER: process.env.GMAIL_USER ? '✅ Set' : '❌ Not set',
          GMAIL_PASS: process.env.GMAIL_PASS ? '✅ Set' : '❌ Not set'
        },
        solution: 'Set EMAIL_USER and EMAIL_PASSWORD environment variables in Railway'
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
      emailCredentials: {
        EMAIL_USER: process.env.EMAIL_USER ? '✅ Set' : '❌ Not set',
        EMAIL_PASSWORD: process.env.EMAIL_PASSWORD ? '✅ Set' : '❌ Not set',
        GMAIL_USER: process.env.GMAIL_USER ? '✅ Set' : '❌ Not set',
        GMAIL_PASS: process.env.GMAIL_PASS ? '✅ Set' : '❌ Not set'
      },
      smtpConfig: {
        host: 'smtp.gmail.com',
        ports: [465, 587],
        security: ['SSL', 'STARTTLS']
      },
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
        'Ensure EMAIL_USER and EMAIL_PASSWORD are set in Railway environment variables',
        'Use Gmail App Password (16 characters) for EMAIL_PASSWORD',
        'Enable 2-Factor Authentication on Gmail account',
        'Check Railway Pro plan for SMTP outbound connections'
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
