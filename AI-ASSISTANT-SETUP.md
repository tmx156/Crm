# AI Assistant Setup Guide

## 🤖 Overview

The AI Assistant allows admin users to query CRM data using natural language questions. It uses Google's Gemini AI (free tier) to convert questions into database queries.

## ✨ Features

- **Natural Language Queries**: Ask questions in plain English
- **Admin Only**: Restricted to admin users for security
- **Free Tier**: Uses Google Gemini's generous free tier (60 requests/minute)
- **Chat Interface**: Beautiful chat interface with history
- **Smart Query Generation**: Automatically converts questions to safe database queries
- **Example Questions**: Built-in examples to get started

## 📋 Prerequisites

- Admin access to the CRM
- Google account (free)
- 5 minutes for setup

## 🚀 Setup Instructions

### Step 1: Get Your Free Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click **"Create API Key"** (no credit card required!)
4. Copy the generated API key

### Step 2: Add API Key to Environment

Add the following line to your `.env` file in the project root:

```env
GEMINI_API_KEY=your_api_key_here
```

Replace `your_api_key_here` with the actual key you copied.

### Step 3: Restart the Server

```bash
# If running locally
npm run dev

# If deployed on Railway
# The server will restart automatically after updating environment variables
```

### Step 4: Access the AI Assistant

1. Login as an admin user
2. Look for **"AI Assistant"** in the navigation menu (with 🤖 icon)
3. Click to open the AI Assistant page
4. Start asking questions!

## 💬 Example Questions

Here are some questions you can ask:

### Bookings
- "How many bookings did Chicko make on Friday?"
- "Show me all bookings for tomorrow"
- "How many bookings do we have this week?"
- "Who made the most bookings this month?"

### Sales
- "How many sales have we made this week?"
- "What's our total revenue this month?"
- "What's the average sale value this week?"
- "Show me all finance sales"

### Analytics
- "Who is the top booker this month?"
- "Which bookers have the highest conversion rate?"
- "What's our conversion rate this week?"

### Leads
- "How many leads are currently assigned but not contacted?"
- "Show me all cancelled bookings this week"
- "How many new leads do we have?"

## 🔒 Security Features

- ✅ **Admin Only Access**: Only admin role can access
- ✅ **Read-Only Queries**: AI can only generate SELECT queries
- ✅ **SQL Injection Protection**: All queries go through Supabase
- ✅ **Rate Limiting**: Protected by Gemini's rate limits
- ✅ **No Data Modification**: Cannot INSERT, UPDATE, or DELETE

## 🌐 Deployment on Railway

If you're deploying on Railway:

1. Go to your Railway project dashboard
2. Click on your service
3. Go to **Variables** tab
4. Add: `GEMINI_API_KEY` = `your_key_here`
5. Railway will automatically restart the service

## 🆓 Pricing

**Google Gemini Free Tier:**
- 60 requests per minute
- Completely free
- No credit card required
- Perfect for team usage

This is more than enough for a CRM team to use throughout the day!

## 🐛 Troubleshooting

### "AI service is not configured" error

**Solution:** 
- Make sure you added `GEMINI_API_KEY` to your `.env` file
- Restart the server after adding the key
- Check that the key is correct (no extra spaces)

### "Failed to process query" error

**Solution:**
- Check your internet connection
- Verify the Gemini API key is still valid
- Try a simpler question to test

### No results showing

**Solution:**
- Check that the question is specific enough
- Try one of the example questions first
- Make sure you have data in your database

## 📊 Technical Details

### Architecture

```
User Question
    ↓
Frontend (AIAssistant.js)
    ↓
Backend API (/api/ai-assistant/query)
    ↓
Gemini Service (converts to SQL)
    ↓
Supabase Query Execution
    ↓
Formatted Response
    ↓
Chat Display
```

### Files Created

**Backend:**
- `server/services/geminiService.js` - Gemini AI integration
- `server/routes/ai-assistant.js` - API endpoints
- `server/config/index.js` - Updated with Gemini config

**Frontend:**
- `client/src/pages/AIAssistant.js` - Main UI component
- `client/src/App.js` - Added route
- `client/src/components/Layout.js` - Added navigation

## 🎯 Future Enhancements

Possible future additions:
- Voice input for questions
- Export results to CSV
- Save favorite queries
- Query history persistence
- Multi-language support
- Custom query templates

## 🤝 Support

If you encounter issues:
1. Check this guide first
2. Verify your API key is configured
3. Try the example questions
4. Check browser console for errors

## 📝 Notes

- The AI Assistant learns your database schema automatically
- Questions are processed in real-time (usually under 2 seconds)
- Chat history is stored in browser session (cleared on refresh)
- All queries are logged for monitoring

---

**Created:** October 2025  
**Version:** 1.0  
**Status:** ✅ Production Ready

