# Railway Deployment Guide - CRM System

## 🚀 Quick Deployment Steps

### 1. Push Code to GitHub
```bash
git push origin main
```

### 2. Railway Environment Variables

Set these in your Railway dashboard (Settings → Variables):

#### Required Variables
```env
# Supabase Database
SUPABASE_URL=https://tnltvfzltdeilanxhlvy.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# JWT Authentication
JWT_SECRET=your-secure-jwt-secret-here
JWT_EXPIRE=30d

# Node Environment
NODE_ENV=production
CI=false
NODE_OPTIONS=--max-old-space-size=2048
```

#### Optional Variables (for SMS/Email features)
```env
# BulkSMS Configuration
BULKSMS_USERNAME=tmx2566
BULKSMS_PASSWORD=Booker100
BULKSMS_FROM_NUMBER=+447786201100
BULKSMS_POLL_ENABLED=true
BULKSMS_POLL_INTERVAL_MS=60000

# Email Configuration (Gmail)
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
GMAIL_USER=your-email@gmail.com
GMAIL_PASS=your-app-password
```

### 3. Railway Configuration Files

✅ **railway.json** - Main configuration
- Build command: `npm run railway:build`
- Start command: `npm run railway:start`
- Health check: `/api/health`
- Networking: Supabase + Gmail/SMTP allowed

✅ **nixpacks.toml** - Build configuration
- Node.js 18
- Production mode
- Optimized build process

✅ **Dockerfile** - Container configuration
- Node.js 18 Alpine
- Multi-stage build
- Production optimized

✅ **package.json** - Scripts
- `railway:build`: Install deps + Build client
- `railway:start`: Start server

### 4. Deploy to Railway

#### Option A: Connect GitHub Repository
1. Go to Railway dashboard
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your `tmx156/Crm` repository
5. Railway will auto-detect configuration

#### Option B: Railway CLI
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link project
railway link

# Deploy
railway up
```

### 5. Post-Deployment Verification

Check these endpoints:
- `https://your-app.railway.app/api/health` - Health check
- `https://your-app.railway.app/api/status` - Server status
- `https://your-app.railway.app` - Frontend

### 6. Monitor Logs
```bash
railway logs
```

Or view in Railway dashboard → Deployments → Logs

## 📋 Pre-Deployment Checklist

- [x] Code committed to Git
- [x] Railway.json configured
- [x] Nixpacks.toml configured
- [x] Dockerfile present
- [x] Build scripts working
- [ ] Environment variables set in Railway
- [ ] GitHub repository connected to Railway
- [ ] Domain configured (optional)

## 🔒 Security Notes

1. **NEVER commit sensitive data** (.env is gitignored)
2. **Use Railway's environment variables** for all secrets
3. **Rotate JWT_SECRET** regularly
4. **Use SUPABASE_SERVICE_ROLE_KEY** for admin operations only

## 🐛 Troubleshooting

### Build Fails
- Check Railway logs for errors
- Verify all dependencies are in package.json
- Ensure Node.js version is 18+

### App Doesn't Start
- Check environment variables are set
- Verify SUPABASE_URL and keys are correct
- Check health endpoint: `/api/health`

### Database Connection Issues
- Verify Supabase credentials
- Check Railway networking allows Supabase domain
- Ensure RLS policies are configured

### WebSocket Issues
- Railway supports WebSockets by default
- Check Socket.IO connection in logs
- Verify CORS settings in server

## 📊 Performance Optimization

Railway configuration includes:
- Node.js memory limit: 2GB
- Auto-restart on failure
- Health check monitoring (5min timeout)
- Optimized outbound connections

## 🔄 Continuous Deployment

Once connected to GitHub:
1. Push to `main` branch
2. Railway auto-detects changes
3. Builds and deploys automatically
4. Zero-downtime deployment

## 📞 Support

- Railway Docs: https://docs.railway.app
- Supabase Docs: https://supabase.com/docs
- CRM Issues: https://github.com/tmx156/Crm/issues

---

## Current Deployment Status

**Repository:** https://github.com/tmx156/Crm.git
**Branch:** main
**Last Commit:** Update CRM features (image handling, user management, messaging)
**Ready for Railway:** ✅ YES

**Next Step:** Push to GitHub and connect to Railway

