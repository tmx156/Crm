# Railway Environment Variables Setup

## 🔧 Required Environment Variables

Copy and paste these into your Railway dashboard (Settings → Variables):

### Core Configuration

```
SUPABASE_URL=https://tnltvfzltdeilanxhlvy.supabase.co
```

```
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc
```

```
SUPABASE_SERVICE_ROLE_KEY=<GET_FROM_SUPABASE_DASHBOARD>
```
**⚠️ Important:** Get this from Supabase Dashboard → Settings → API → service_role key

### JWT Configuration

```
JWT_SECRET=<GENERATE_RANDOM_SECRET>
```
**💡 Tip:** Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

```
JWT_EXPIRE=30d
```

### Node.js Configuration

```
NODE_ENV=production
```

```
CI=false
```

```
NODE_OPTIONS=--max-old-space-size=2048
```

---

## 📱 SMS Configuration (Optional)

Only add if you want SMS functionality:

```
BULKSMS_USERNAME=tmx2566
```

```
BULKSMS_PASSWORD=Booker100
```

```
BULKSMS_FROM_NUMBER=+447786201100
```

```
BULKSMS_POLL_ENABLED=true
```

```
BULKSMS_POLL_INTERVAL_MS=60000
```

---

## 📧 Email Configuration (Optional)

Only add if you want email functionality:

```
EMAIL_USER=your-email@gmail.com
```

```
EMAIL_PASSWORD=your-gmail-app-password
```

```
GMAIL_USER=your-email@gmail.com
```

```
GMAIL_PASS=your-gmail-app-password
```

**📌 Note:** Use Gmail App Password, not your regular password
1. Enable 2FA on Gmail
2. Go to: https://myaccount.google.com/apppasswords
3. Generate app password for "Mail"

---

## 📊 Facebook Conversions API (Optional)

Only add if you want offline event tracking for Facebook Ads:

```
FB_PIXEL_ID=802266729380312
```

```
FB_ACCESS_TOKEN=<YOUR_FB_ACCESS_TOKEN>
```
**⚠️ Important:** Get this from Facebook Events Manager → Settings → Generate Access Token. Tokens expire — regenerate if events stop flowing.

```
FB_TEST_EVENT_CODE=
```
**💡 Tip:** Set this temporarily to test events in Facebook Events Manager → Test Events tab. Clear it for production.

```
FB_EVENT_SOURCE_URL=
```
**💡 Tip:** Set this to your website URL (e.g., https://yoursite.com) for website-origin leads.

---

## ✅ Quick Setup Checklist

1. [ ] Set `SUPABASE_URL`
2. [ ] Set `SUPABASE_ANON_KEY`
3. [ ] Set `SUPABASE_SERVICE_ROLE_KEY` (get from Supabase)
4. [ ] Generate and set `JWT_SECRET`
5. [ ] Set `JWT_EXPIRE=30d`
6. [ ] Set `NODE_ENV=production`
7. [ ] Set `CI=false`
8. [ ] Set `NODE_OPTIONS=--max-old-space-size=2048`
9. [ ] (Optional) Add SMS credentials
10. [ ] (Optional) Add Email credentials

---

## 🚀 How to Set Variables in Railway

### Method 1: Railway Dashboard
1. Go to your Railway project
2. Click on your service
3. Go to "Variables" tab
4. Click "New Variable"
5. Add each variable name and value
6. Click "Add" or save

### Method 2: Railway CLI
```bash
railway variables set SUPABASE_URL="https://tnltvfzltdeilanxhlvy.supabase.co"
railway variables set NODE_ENV="production"
# ... repeat for each variable
```

### Method 3: Bulk Import
1. Create a `.env` file locally (don't commit!)
2. Copy all variables
3. In Railway dashboard → Variables → "Raw Editor"
4. Paste all variables
5. Click "Update Variables"

---

## 🔒 Security Best Practices

1. ✅ Never commit `.env` files to Git
2. ✅ Rotate `JWT_SECRET` periodically
3. ✅ Use `SUPABASE_SERVICE_ROLE_KEY` only on backend
4. ✅ Keep Gmail App Passwords secure
5. ✅ Use different secrets for dev/production

---

## 🧪 Testing After Setup

Once deployed, test these endpoints:

```bash
# Health check
curl https://your-app.railway.app/api/health

# Status check
curl https://your-app.railway.app/api/status
```

Expected responses:
- Health: `{ "status": "ok", "database": "connected" }`
- Status: Should return server info

---

## 🐛 Troubleshooting

### "Database connection failed"
- Check `SUPABASE_URL` is correct
- Verify `SUPABASE_ANON_KEY` is valid
- Ensure Railway networking allows Supabase

### "JWT error" or "Invalid token"
- Verify `JWT_SECRET` is set
- Check `JWT_SECRET` is same across all instances
- Ensure no extra spaces in the variable

### "Email/SMS not working"
- These are optional features
- Check credentials are correct
- Verify Railway networking allows outbound connections
- Check logs for specific errors

---

## 📊 Current Configuration Status

**Repository:** https://github.com/tmx156/Crm.git
**Branch:** main
**Status:** ✅ Pushed to GitHub
**Railway:** Ready for deployment

**Next Steps:**
1. Set environment variables in Railway
2. Connect GitHub repo to Railway (or use Railway CLI)
3. Railway will auto-deploy
4. Monitor logs for any issues

