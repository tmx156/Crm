// Vercel API handler - Entry point for all API routes
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Load centralized configuration
const config = require('../server/config');

// Set environment variables from config for backward compatibility
process.env.BULKSMS_USERNAME = config.sms.username;
process.env.BULKSMS_PASSWORD = config.sms.password;
process.env.BULKSMS_FROM_NUMBER = config.sms.fromNumber;
process.env.BULKSMS_POLL_ENABLED = config.sms.pollEnabled.toString();
process.env.BULKSMS_POLL_INTERVAL_MS = config.sms.pollInterval.toString();

process.env.EMAIL_USER = config.email.user;
process.env.EMAIL_PASSWORD = config.email.password;
process.env.GMAIL_USER = config.email.gmailUser;
process.env.GMAIL_PASS = config.email.gmailPass;
process.env.RESEND_API_KEY = config.email.resendApiKey;
process.env.RESEND_FROM_EMAIL = config.email.resendFromEmail;

process.env.SUPABASE_URL = config.supabase.url;
process.env.SUPABASE_ANON_KEY = config.supabase.anonKey;
process.env.JWT_SECRET = config.JWT_SECRET;

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-domain.vercel.app'] 
    : true,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Import routes
const authRoutes = require('../server/routes/auth-simple');
const leadRoutes = require('../server/routes/leads');
const userRoutes = require('../server/routes/users');
const statsRoutes = require('../server/routes/stats');
const templateRoutes = require('../server/routes/templates');
const salesRoutes = require('../server/routes/sales-supabase');
const messageRoutes = require('../server/routes/messages');
const messagesListRoutes = require('../server/routes/messages-list');
const retargetingRoutes = require('../server/routes/retargeting');
const financeRoutes = require('../server/routes/finance');
const uploadRoutes = require('../server/routes/upload');
const bookerAnalyticsRoutes = require('../server/routes/booker-analytics');
const performanceRoutes = require('../server/routes/performance');

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/messages-list', messagesListRoutes);
app.use('/api/retargeting', retargetingRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/booker-analytics', bookerAnalyticsRoutes);
app.use('/api/performance', performanceRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});

module.exports = app;
