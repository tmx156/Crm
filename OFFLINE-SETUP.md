# CRM Offline Development Setup

## Quick Start

### Option 1: Batch File (Windows)
```bash
# Double-click or run:
start-offline.bat
```

### Option 2: PowerShell (Windows)
```powershell
# Right-click and "Run with PowerShell" or run:
.\start-offline.ps1
```

### Option 3: Manual Start
```bash
# Terminal 1 - Start Server
cd server
npm start

# Terminal 2 - Start Client  
cd client
npm start
```

## What Gets Started

- **Server**: http://localhost:5000
- **Client**: http://localhost:3000
- **Database**: Uses Supabase (online)

## Stopping Everything

```bash
# Run the stop script:
stop-offline.bat

# Or manually kill Node processes:
taskkill /f /im node.exe
```

## Prerequisites

Make sure you have:
1. Node.js installed
2. Dependencies installed:
   ```bash
   npm run install-deps
   ```

## Environment Variables

For offline development, create a `.env` file in the root directory:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# JWT Secret
JWT_SECRET=your_jwt_secret

# Email Configuration
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password

# SMS Configuration
BULKSMS_USERNAME=your_bulksms_username
BULKSMS_PASSWORD=your_bulksms_password
```

## Troubleshooting

### Port Already in Use
```bash
# Kill processes using ports 3000 and 5000
netstat -ano | findstr :3000
netstat -ano | findstr :5000
taskkill /PID <PID_NUMBER> /F
```

### Dependencies Not Installed
```bash
npm run install-deps
```

### Database Connection Issues
- Check your Supabase credentials in `.env`
- Ensure Supabase project is active
- Verify network connection

## Features Available Offline

✅ **Full CRM functionality**
✅ **Real-time WebSocket updates**
✅ **Email sending (if configured)**
✅ **SMS sending (if configured)**
✅ **Database operations**
✅ **User authentication**
✅ **Booking management**
✅ **Sales tracking**
✅ **Reports and analytics**

## Notes

- The offline setup uses the same Supabase database as production
- All features work exactly the same as production
- Perfect for development and testing
- No need for Railway deployment during development

