const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const dbManager = require('../database-connection-manager');
const { auth, adminAuth } = require('../middleware/auth');
const { analyseLeads, fetchLegacyLeads } = require('../utils/leadAnalysis');
const MessagingService = require('../utils/messagingService');
const { sendSMS, sendAppointmentReminder, sendStatusUpdate, sendCustomMessage } = require('../utils/smsService');
const { v4: uuidv4 } = require('uuid'); // Added for UUID generation
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = 'https://tnltvfzltdeilanxhlvy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubHR2ZnpsdGRlaWxhbnhobHZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxOTk4MzUsImV4cCI6MjA3Mjc3NTgzNX0.T_HaALQeSiCjLkpVuwQZUFnJbuSyRy2wf2kWiqJ99Lc';
const supabase = createClient(supabaseUrl, supabaseKey);

// IMPORTANT: Diary updates should only be triggered by registered users manually
// All upload processes create leads with status 'New' and no dateBooked to prevent
// automatic diary updates. Only manual status changes by users should update the diary.

const router = express.Router();

// TIMEZONE FIX: Helper function to preserve local time when saving to database
const preserveLocalTime = (dateString) => {
  if (!dateString) return null;
  
  // For calendar bookings, the frontend sends a pre-formatted ISO string
  // that already represents the local time we want to store
  // Just return it as-is to avoid any timezone conversions
  
  console.log('🕐 Timezone Fix: Using date as-is from frontend:', {
    input: dateString,
    stored: dateString
  });
  
  return dateString;
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `leads-${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    console.log('🔍 File validation:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      fieldname: file.fieldname
    });
    
    const allowedTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/csv',
      'text/plain' // Some systems report CSV as text/plain
    ];
    
    const allowedExtensions = ['.csv', '.xlsx', '.xls'];
    const hasValidExtension = allowedExtensions.some(ext => 
      file.originalname.toLowerCase().endsWith(ext)
    );
    
    if (allowedTypes.includes(file.mimetype) || hasValidExtension) {
      console.log('✅ File accepted:', file.originalname);
      cb(null, true);
    } else {
      console.log('❌ File rejected:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        reason: 'Invalid file type or extension'
      });
      cb(new Error('Invalid file type. Please upload CSV or Excel files only.'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Helper function to safely parse booking history JSON
const safeParseBookingHistory = (bookingHistory) => {
  if (!bookingHistory) return [];
  
  try {
    if (typeof bookingHistory === 'string') {
      return JSON.parse(bookingHistory);
    }
    if (Array.isArray(bookingHistory)) {
      return bookingHistory;
    }
    return [];
  } catch (error) {
    console.warn('⚠️ Invalid booking_history JSON, using empty array:', error.message);
    return [];
  }
};

// Helper function to add booking history entry
const addBookingHistoryEntry = async (leadId, action, performedBy, performedByName, details, leadSnapshot) => {
  try {
    const historyEntry = {
      action,
      timestamp: new Date(),
      performedBy,
      performedByName,
      details: details || {},
      leadSnapshot: leadSnapshot || {}
    };

    // Fetch current booking history from Supabase
    const leadResult = await dbManager.query('leads', {
      select: 'booking_history',
      eq: { id: leadId }
    });
    const lead = leadResult.length > 0 ? leadResult[0] : null;
    const currentHistory = safeParseBookingHistory(lead?.booking_history);
    const updatedHistory = [...currentHistory, historyEntry];
    
    // Update booking_history as JSON string
    await dbManager.update('leads', { booking_history: JSON.stringify(updatedHistory) }, { id: leadId });
    console.log(`📅 Booking history added: ${action} for lead ${leadId} by ${performedByName}`);
    return true;
  } catch (error) {
    console.error('Error adding booking history:', error);
    return false;
  }
};

// Helper function to create lead snapshot
const createLeadSnapshot = (lead) => {
  return {
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    status: lead.status,
    date_booked: lead.date_booked
  };
};

// Helper function to update user statistics
const updateUserStatistics = async (userId, statusChange) => {
  if (!userId) return;
  try {
    const user = await dbManager.query('users', {
      select: '*',
      eq: { id: userId }
    });
    
    if (!user || user.length === 0) return;
    
    const userData = user[0];
    const updateFields = {};
    
    if (statusChange.from !== statusChange.to) {
      if (statusChange.to === 'Booked') {
        updateFields.bookings_made = (userData.bookings_made || 0) + 1;
      }
      if (statusChange.to === 'Attended') {
        updateFields.show_ups = (userData.show_ups || 0) + 1;
      }
      if (statusChange.from === 'Booked' && statusChange.to === 'Cancelled') {
        updateFields.bookings_made = Math.max((userData.bookings_made || 0) - 1, 0);
      }
    }
    
    if (Object.keys(updateFields).length > 0) {
      await dbManager.update('users', {
        eq: { id: userId },
        data: updateFields
      });
      console.log(`📊 Updated stats for user ${userData.name}: bookings=${updateFields.bookings_made || userData.bookings_made}, showUps=${updateFields.show_ups || userData.show_ups}`);
    }
  } catch (error) {
    console.error('Error updating user statistics:', error);
  }
};

// Helper function to mark all received messages as read when user replies
const markAllReceivedMessagesAsRead = async (leadId) => {
  try {
    const lead = await dbManager.query('leads', {
      select: 'booking_history',
      eq: { id: leadId }
    });
    
    if (!lead || lead.length === 0 || !lead[0].booking_history) {
      return;
    }
    
    const history = JSON.parse(lead[0].booking_history);
    let hasChanges = false;
    
    // Mark all received messages as read
    const updatedHistory = history.map(entry => {
      if (entry.action === 'SMS_RECEIVED' && !entry.details?.read) {
        hasChanges = true;
        return {
          ...entry,
          details: {
            ...entry.details,
            read: true
          }
        };
      }
      return entry;
    });
    
    // Only update if there were changes
    if (hasChanges) {
      await dbManager.update('leads', {
        eq: { id: leadId },
        data: { 
          booking_history: JSON.stringify(updatedHistory),
          updated_at: new Date().toISOString()
        }
      });
      
      console.log(`📖 Marked all received messages as read for lead ${leadId}`);
    }
  } catch (error) {
    console.error('Error marking messages as read:', error);
  }
};

// Helper function to detect HTML links in column values
const detectHtmlLinks = (columnData) => {
  if (!columnData || !Array.isArray(columnData)) return false;
  
  // Check if any value in the column contains HTML/website links
  return columnData.some(value => {
    if (!value || typeof value !== 'string') return false;
    
    const str = value.toLowerCase();
    // Check for various HTML link patterns
    return str.includes('http://') || 
           str.includes('https://') || 
           str.includes('www.') ||
           str.includes('<a ') ||
           str.includes('href=') ||
           str.includes('.com') ||
           str.includes('.org') ||
           str.includes('.net') ||
           str.includes('.co.uk');
  });
};

// Helper function for more permissive column filtering
const filterValidColumns = (leads) => {
  if (!leads || leads.length === 0) return {};
  
  const columnData = {};
  const sampleSize = Math.min(leads.length, 20); // Check first 20 rows for pattern detection
  
  // Extract column data for analysis
  Object.keys(leads[0] || {}).forEach(key => {
    columnData[key] = leads.slice(0, sampleSize).map(lead => lead[key]);
  });
  
  // More permissive filtering - include all columns with data
  const validColumns = {};
  Object.keys(columnData).forEach(key => {
    const hasData = columnData[key].some(value => value && value.toString().trim());
    if (hasData) {
      validColumns[key] = true;
      console.log(`✅ Including column "${key}" - contains data`);
    } else {
      console.log(`❌ Excluding column "${key}" - no data detected`);
    }
  });
  
  return validColumns;
};

// Helper function to detect data type
const detectDataType = (values) => {
  const nonEmptyValues = values.filter(v => v && v.toString().trim());
  if (nonEmptyValues.length === 0) return 'empty';
  
  // Check if all values are numbers
  const allNumbers = nonEmptyValues.every(v => !isNaN(parseFloat(v)));
  if (allNumbers) return 'number';
  
  // Check if values look like phone numbers
  const phonePattern = /^[\d\s\-\+\(\)]+$/;
  const allPhones = nonEmptyValues.every(v => phonePattern.test(v.toString()));
  if (allPhones && nonEmptyValues.some(v => v.toString().length >= 7)) return 'phone';
  
  // Check if values look like emails
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const mostEmails = nonEmptyValues.filter(v => emailPattern.test(v.toString())).length > nonEmptyValues.length * 0.7;
  if (mostEmails) return 'email';
  
  // Check if values look like URLs
  const urlPattern = /^(https?:\/\/|www\.)/i;
  const mostUrls = nonEmptyValues.filter(v => urlPattern.test(v.toString())).length > nonEmptyValues.length * 0.7;
  if (mostUrls) return 'url';
  
  return 'text';
};

// Helper function to check if values look like names
const looksLikeNames = (values) => {
  if (!values || values.length === 0) return false;
  
  // Names typically have letters, spaces, maybe hyphens
  const namePattern = /^[a-zA-Z\s\-'\.]+$/;
  const validNames = values.filter(v => {
    const str = v.toString().trim();
    return str.length >= 2 && str.length <= 50 && namePattern.test(str);
  });
  
  // If more than 70% look like names, it's probably a name column
  return validNames.length > values.length * 0.7;
};

// @route   GET /api/leads
// @desc    Get all leads with pagination and filters
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, booker, search, created_at_start, created_at_end } = req.query;

    // Validate and cap limit to prevent performance issues
    const validatedLimit = Math.min(parseInt(limit) || 50, 100);
    const pageInt = Math.max(parseInt(page) || 1, 1);
    const from = (pageInt - 1) * validatedLimit;
    const to = from + validatedLimit - 1;

    // Build Supabase queries (data + count) with consistent filters
    let dataQuery = supabase
      .from('leads')
      .select('id, name, phone, email, postcode, image_url, booker_id, created_by_user_id, updated_by_user_id, status, date_booked, is_confirmed, has_sale, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    let countQuery = supabase
      .from('leads')
      .select('*', { count: 'exact', head: true });

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin') {
      dataQuery = dataQuery.eq('booker_id', req.user.id);
      countQuery = countQuery.eq('booker_id', req.user.id);
      console.log(`🔒 Role-based filtering: User ${req.user.name} (${req.user.role}) can only see their assigned leads`);
    } else {
      console.log(`👑 Admin access: User ${req.user.name} can see all leads`);
    }

    // Apply status filter
    if (status && status !== 'all') {
      if (status === 'sales') {
        dataQuery = dataQuery.eq('has_sale', 1);
        countQuery = countQuery.eq('has_sale', 1);
      } else {
        dataQuery = dataQuery.eq('status', status);
        countQuery = countQuery.eq('status', status);
      }
    }

    // Optional: filter by specific booker if provided
    if (booker) {
      dataQuery = dataQuery.eq('booker_id', booker);
      countQuery = countQuery.eq('booker_id', booker);
    }
    
    // Apply search filter across multiple fields
    if (search && String(search).trim().length > 0) {
      const term = String(search).trim();
      const like = `%${term}%`;
      // Use OR across common searchable columns
      const orExpr = [
        `name.ilike.${like}`,
        `phone.ilike.${like}`,
        `email.ilike.${like}`,
        `postcode.ilike.${like}`
      ].join(',');
      dataQuery = dataQuery.or(orExpr);
      countQuery = countQuery.or(orExpr);
      console.log(`🔍 Search filter applied across name/phone/email/postcode: ${term}`);
    }

    // Apply created_at date range filter for dashboard
    if (created_at_start && created_at_end) {
      dataQuery = dataQuery
        .gte('created_at', created_at_start)
        .lte('created_at', created_at_end);
      countQuery = countQuery
        .gte('created_at', created_at_start)
        .lte('created_at', created_at_end);
      console.log(`📅 Created date filter applied: ${created_at_start} to ${created_at_end}`);
    }

    // Execute queries
    const [{ data: leads, error: leadsError, count: totalCount }] = await Promise.all([
      dataQuery
    ]);

    if (leadsError) {
      throw leadsError;
    }

    // Get total via separate head count to be safe if not returned
    let total = typeof totalCount === 'number' ? totalCount : 0;
    if (!total) {
      const { count, error: countError } = await countQuery;
      if (countError) throw countError;
      total = count || 0;
    }

    console.log(`🖼️ Debug: Found ${leads?.length || 0} leads from database (total count: ${total})`);
    if (leads && leads.length > 0) {
      console.log(`🖼️ Sample image URLs from database:`);
      leads.slice(0, 3).forEach(lead => {
        console.log(`  ${lead.name}: image_url = "${lead.image_url}"`);
      });
    }

    // Bulk fetch bookers in one query
    // Get all user IDs that need to be fetched (bookers, creators, updaters)
    const bookerIds = [...new Set((leads || []).map(lead => lead.booker_id).filter(Boolean))];
    const creatorIds = [...new Set((leads || []).map(lead => lead.created_by_user_id).filter(Boolean))];
    const updaterIds = [...new Set((leads || []).map(lead => lead.updated_by_user_id).filter(Boolean))];
    const allUserIds = [...new Set([...bookerIds, ...creatorIds, ...updaterIds])];

    let usersMap = {};
    if (allUserIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, name, email')
        .in('id', allUserIds);
      if (!usersError && users) {
        users.forEach(u => { usersMap[u.id] = u; });
      } else if (usersError) {
        console.warn('⚠️ Could not fetch users info:', usersError.message);
      }
    }

    // Transform leads to include booker object (optimized for list view)
    const transformedLeads = (leads || []).map(lead => ({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      postcode: lead.postcode,
      image_url: lead.image_url,
      status: lead.status,
      date_booked: lead.date_booked,
      is_confirmed: lead.is_confirmed,
      has_sale: lead.has_sale,
      created_at: lead.created_at,
      booker: lead.booker_id && usersMap[lead.booker_id] ? {
        id: usersMap[lead.booker_id].id,
        name: usersMap[lead.booker_id].name,
        email: usersMap[lead.booker_id].email
      } : null,
      created_by: lead.created_by_user_id && usersMap[lead.created_by_user_id] ? {
        id: usersMap[lead.created_by_user_id].id,
        name: usersMap[lead.created_by_user_id].name,
        email: usersMap[lead.created_by_user_id].email
      } : null,
      updated_by: lead.updated_by_user_id && usersMap[lead.updated_by_user_id] ? {
        id: usersMap[lead.updated_by_user_id].id,
        name: usersMap[lead.updated_by_user_id].name,
        email: usersMap[lead.updated_by_user_id].email
      } : null
    }));

    console.log(`[DEBUG] /api/leads returned ${transformedLeads.length} leads (total: ${total}) for user ${req.user.name} (${req.user.role})`);
    
    // Debug: Log final response image URLs
    if (transformedLeads.length > 0) {
      console.log(`🖼️ Final API response image URLs:`);
      transformedLeads.slice(0, 3).forEach(lead => {
        console.log(`  ${lead.name}: image_url = "${lead.image_url}"`);
      });
    }

    res.json({
      leads: transformedLeads,
      totalPages: Math.max(1, Math.ceil(total / validatedLimit)),
      currentPage: pageInt,
      total: total,
      limit: validatedLimit
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/calendar
// @desc    Get leads for calendar view
// @access  Private (All logged-in users - special endpoint for calendar)
router.get('/calendar', auth, async (req, res) => {
  try {
    console.log(`📅 Calendar API: Fetching events for user ${req.user.name} (${req.user.role})`);

    // PERFORMANCE: Get pagination and date range from query params
    const { start, end, page = 1, limit = 200, offset = 0 } = req.query;

    // Validate and cap limit to prevent performance issues
    const validatedLimit = Math.min(parseInt(limit) || 200, 500);
    const pageInt = Math.max(parseInt(page) || 1, 1);
    const offsetInt = parseInt(offset) || ((pageInt - 1) * validatedLimit);
    
    console.log(`📅 Date range filter - Start: ${start || 'none'}, End: ${end || 'none'}, Limit: ${validatedLimit}, Page: ${pageInt}, Offset: ${offsetInt}`);

    // PERFORMANCE: Add connection health check
    const startTime = Date.now();
    console.log(`📅 Calendar API: Starting database query at ${new Date().toISOString()}`);

    // Get paginated booked leads using Supabase with date filtering for performance
    let leads, error, totalCount;
    
    // PERFORMANCE: Optimize the query structure
    let query = supabase
      .from('leads')
      .select(`
        id, name, phone, email, status, date_booked, booker_id,
        is_confirmed, booking_status, booking_history, has_sale,
        created_at, updated_at, postcode, notes, image_url
      `)
      .or('date_booked.not.is.null,status.eq.Booked')
      .is('deleted_at', null); // Ensure we don't fetch deleted leads
    
    // PERFORMANCE: Apply date range filter if provided
    if (start && end) {
      // Filter to only events within the date range (with some buffer)
      const startDate = new Date(start);
      const endDate = new Date(end);
      
      // Add 7 days buffer on each side for smooth scrolling
      startDate.setDate(startDate.getDate() - 7);
      endDate.setDate(endDate.getDate() + 7);
      
      query = query
        .gte('date_booked', startDate.toISOString())
        .lte('date_booked', endDate.toISOString());
      
      console.log(`📅 Calendar API: Date range filter applied: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    }
    
    // First get total count for pagination
    const countQuery = supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .or('date_booked.not.is.null,status.eq.Booked')
      .is('deleted_at', null);

    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      startDate.setDate(startDate.getDate() - 7);
      endDate.setDate(endDate.getDate() + 7);

      countQuery
        .gte('date_booked', startDate.toISOString())
        .lte('date_booked', endDate.toISOString());
    }

    // Apply pagination, limit and ordering
    query = query
      .order('date_booked', { ascending: true, nullsLast: true })
      .range(offsetInt, offsetInt + validatedLimit - 1);
    
    // Retry logic with improved error handling and timeouts
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📅 Calendar API: Database query attempt ${attempt}...`);
        
        // Add timeout to prevent hanging
        const queryPromise = query;
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Database query timeout after 10 seconds')), 10000);
        });
        
        const result = await Promise.race([queryPromise, timeoutPromise]);
        
        leads = result.data;
        error = result.error;
        
        const queryTime = Date.now() - startTime;
        
        if (!error && leads) {
          console.log(`📅 Calendar API: Successfully fetched ${leads.length} leads on attempt ${attempt} in ${queryTime}ms`);
          break;
        } else if (attempt < 3) {
          console.log(`📅 Calendar API: Attempt ${attempt} failed in ${queryTime}ms, retrying... Error:`, error?.message);
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempt, 3000))); // Exponential backoff
        }
      } catch (timeoutError) {
        const queryTime = Date.now() - startTime;
        console.error(`❌ Calendar API: Query timed out on attempt ${attempt} after ${queryTime}ms:`, timeoutError.message);
        error = timeoutError;
        
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempt, 3000)));
        }
      }
    }

    // PERFORMANCE: Sorting is now done in the database query for better performance


    // PERFORMANCE FIX: Bulk fetch booker names instead of individual queries
    if (leads && leads.length > 0) {
      // Get unique booker IDs
      const bookerIds = [...new Set(leads.filter(lead => lead.booker_id).map(lead => lead.booker_id))];
      
      if (bookerIds.length > 0) {
        console.log(`📈 Calendar API: Fetching ${bookerIds.length} unique booker names...`);
        
        // Single query to get all booker names
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, name')
          .in('id', bookerIds);
        
        if (!usersError && users) {
          // Create a map for quick lookup
          const usersMap = new Map(users.map(user => [user.id, user]));
          
          // Assign booker names to leads
          leads.forEach(lead => {
            if (lead.booker_id && usersMap.has(lead.booker_id)) {
              lead.booker_name = usersMap.get(lead.booker_id).name;
            }
          });
          
          console.log(`✅ Calendar API: Successfully assigned booker names to leads`);
        } else {
          console.warn('⚠️ Calendar API: Failed to fetch booker names:', usersError?.message);
        }
      }
    }

    // Fetch messages from messages table and merge with booking_history
    if (leads && leads.length > 0) {
      try {
        console.log(`📨 Calendar API: Fetching messages for ${leads.length} leads...`);
        console.log(`📨 Calendar API: Lead IDs: ${leads.map(l => l.id).join(', ')}`);
        
        const leadIds = leads.map(lead => lead.id);
        const { data: messages, error: messagesError } = await supabase
          .from('messages')
          .select('*')
          .in('lead_id', leadIds)
          .order('created_at', { ascending: false });
        
        if (!messagesError && messages) {
          console.log(`📨 Calendar API: Found ${messages.length} messages`);
          
          // Group messages by lead_id
          const messagesByLead = {};
          messages.forEach(message => {
            if (!messagesByLead[message.lead_id]) {
              messagesByLead[message.lead_id] = [];
            }
            messagesByLead[message.lead_id].push(message);
          });
          
          // Merge messages with booking_history for each lead
          leads.forEach(lead => {
            const leadMessages = messagesByLead[lead.id] || [];
            
            // Parse existing booking_history
            let bookingHistory = [];
            try {
              if (lead.booking_history) {
                bookingHistory = typeof lead.booking_history === 'string' 
                  ? JSON.parse(lead.booking_history) 
                  : lead.booking_history;
                if (!Array.isArray(bookingHistory)) {
                  bookingHistory = [];
                }
              }
            } catch (e) {
              console.warn(`⚠️ Invalid booking_history for lead ${lead.id}:`, e.message);
              bookingHistory = [];
            }
            
            // Convert messages to booking_history format
            const messageHistory = leadMessages.map(msg => {
              // Properly determine if message is sent or received based on status
              const isReceived = msg.status === 'received';
              const isSent = msg.status === 'sent';
              
              return {
                action: msg.type === 'sms' ? (isReceived ? 'SMS_RECEIVED' : 'SMS_SENT') : 
                        (isReceived ? 'EMAIL_RECEIVED' : 'EMAIL_SENT'),
                timestamp: msg.created_at || msg.sent_at || new Date().toISOString(),
                performed_by: msg.sent_by || null,
                performed_by_name: msg.sent_by_name || null,
                details: {
                  body: msg.sms_body || msg.content || msg.subject || '',
                  message: msg.sms_body || msg.content || msg.subject || '',
                  subject: msg.subject || '',
                  read: isReceived ? false : true, // Received messages are unread, sent messages are read
                  replied: false,
                  status: msg.status,
                  direction: isReceived ? 'received' : 'sent'
                }
              };
            });
            
            // Merge and deduplicate
            const allHistory = [...bookingHistory, ...messageHistory];
            const seenKeys = new Set();
            const uniqueHistory = allHistory.filter(entry => {
              const key = `${entry.action}_${entry.timestamp}_${entry.details?.body || entry.details?.message || ''}`;
              if (seenKeys.has(key)) return false;
              seenKeys.add(key);
              return true;
            });
            
            // Sort by timestamp (most recent first)
            uniqueHistory.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            
            // Update the lead's booking_history
            lead.booking_history = JSON.stringify(uniqueHistory);
          });
          
          console.log(`✅ Calendar API: Successfully merged messages with booking_history`);
        } else {
          console.warn('⚠️ Calendar API: Failed to fetch messages:', messagesError?.message);
        }
      } catch (messagesError) {
        console.error('❌ Calendar API: Error fetching messages:', messagesError);
      }
    }

    if (error) {
      console.error('❌ Calendar API error after retries:', error);
      
      // PERFORMANCE: Simplified fallback with timeout
      console.log('📅 Calendar API: Trying simplified fallback query...');
      try {
        // Single fallback query with timeout
        const fallbackPromise = supabase
          .from('leads')
          .select(`
            id, name, phone, email, status, date_booked, booker_id,
            is_confirmed, booking_status, booking_history, has_sale,
            created_at, updated_at, postcode, notes, image_url
          `)
          .not('date_booked', 'is', null)
          .is('deleted_at', null)
          .order('date_booked', { ascending: true })
          .limit(parseInt(limit));
        
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Fallback query timeout')), 5000);
        });
        
        const { data: fallbackLeads, error: fallbackError } = await Promise.race([fallbackPromise, timeoutPromise]);
        
        if (!fallbackError && fallbackLeads) {
          leads = fallbackLeads;
          console.log(`📅 Calendar API: Fallback successful, found ${leads.length} leads`);
        } else {
          throw fallbackError || new Error('No data from fallback query');
        }
      } catch (fallbackError) {
        console.error('❌ Calendar API fallback also failed:', fallbackError.message);
        
        // Return a more helpful error message
        return res.status(500).json({ 
          message: 'Database connection issue - calendar temporarily unavailable', 
          error: 'The calendar service is experiencing connectivity issues. Please try refreshing the page.', 
          timestamp: new Date().toISOString()
        });
      }
    }

    console.log(`📅 Calendar API: Found ${leads?.length || 0} calendar events`);
    
    // Debug logging
    if (leads && leads.length > 0) {
      console.log('📅 Calendar events details:');
      leads.forEach((lead, index) => {
        console.log(`  ${index + 1}. ${lead.name} - Status: ${lead.status} - Date: ${lead.date_booked}`);
      });
    } else {
      console.log('📅 No calendar events found. Checking database...');
      
      // Additional debug query
      const { data: debugLeads, error: debugError } = await supabase
        .from('leads')
        .select('id, name, status, date_booked')
        .limit(5);
      
      if (debugError) {
        console.error('📅 Debug query error:', debugError);
      } else {
        console.log(`📅 Debug: Found ${debugLeads?.length || 0} total leads in database`);
        if (debugLeads && debugLeads.length > 0) {
          debugLeads.forEach(lead => {
            console.log(`  - ${lead.name} - Status: ${lead.status} - Date: ${lead.date_booked || 'None'}`);
          });
        }
      }
    }
    
    // Get total count for pagination
    const { count } = await countQuery;
    const totalRecords = count || 0;

    res.json({
      leads: leads,
      events: leads, // Alias for compatibility
      totalPages: Math.max(1, Math.ceil(totalRecords / validatedLimit)),
      currentPage: pageInt,
      total: totalRecords,
      pageSize: validatedLimit,
      hasMore: (offsetInt + leads.length) < totalRecords,
      timestamp: new Date().toISOString(), // Cache busting
      count: leads?.length || 0,
      pagination: {
        page: pageInt,
        limit: validatedLimit,
        offset: offsetInt,
        totalRecords,
        totalPages: Math.max(1, Math.ceil(totalRecords / validatedLimit)),
        hasNextPage: pageInt * validatedLimit < totalRecords,
        hasPrevPage: pageInt > 1
      }
    });
  } catch (error) {
    console.error('Calendar route error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/:id/history
// @desc    Get booking history for a lead
// @access  Private
router.get('/:id([0-9a-fA-F-]{36})/history', auth, async (req, res) => {
  try {
    console.log(`📋 GET /api/leads/${req.params.id}/history - Requested by user ${req.user.name} (${req.user.role})`);

    // Get the lead from Supabase
    const leads = await dbManager.query('leads', {
      select: 'id, booker_id, booking_history',
      eq: { id: req.params.id }
    });

    if (!leads || leads.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = leads[0];

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin' && lead.booker_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only view leads assigned to you.' });
    }

    // Parse booking history
    let bookingHistory = [];
    if (lead.booking_history) {
      try {
        // Check if it's a string (JSON) or already an array
        if (typeof lead.booking_history === 'string') {
          bookingHistory = JSON.parse(lead.booking_history);
        } else if (Array.isArray(lead.booking_history)) {
          bookingHistory = lead.booking_history;
        } else {
          bookingHistory = [];
        }
      } catch (e) {
        console.error('Error parsing booking history:', e);
        bookingHistory = [];
      }
    }

    // Ensure bookingHistory is an array before sorting
    if (!Array.isArray(bookingHistory)) {
      bookingHistory = [];
    }

    // Sort by timestamp (newest first)
    bookingHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      leadId: req.params.id,
      bookingHistory: bookingHistory
    });
  } catch (error) {
    console.error('Get booking history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/legacy
// @desc    Get legacy leads (for admins only)
// @access  Private
router.get('/legacy', auth, async (req, res) => {
  try {
    // Only admins can access legacy data
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Only admins can view legacy data.' });
    }

    console.log(`📋 GET /api/leads/legacy - Requested by user ${req.user.name} (${req.user.role})`);

    // Get legacy leads using Supabase - disabled since is_legacy column doesn't exist in Supabase
    const leads = [];

    console.log('⚠️ Legacy endpoint disabled - is_legacy column not available in Supabase');

    // Transform leads to include booker object
    const transformedLeads = leads.map(lead => ({
      ...lead,
      booker: lead.booker_name ? {
        id: lead.booker,
        name: lead.booker_name,
        email: lead.booker_email
      } : null
    }));

    console.log(`📋 Legacy leads returned: ${transformedLeads.length} leads`);

    res.json({
      leads: transformedLeads,
      total: transformedLeads.length
    });
  } catch (error) {
    console.error('Legacy leads error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/history
// @desc    Add entry to booking history
// @access  Private
router.post('/:id([0-9a-fA-F-]{36})/history', auth, async (req, res) => {
  try {
    const { action, details } = req.body;
    console.log(`📋 POST /api/leads/${req.params.id}/history - Adding ${action} by user ${req.user.name} (${req.user.role})`);
    
    // Get the lead from Supabase
    const leads = await dbManager.query('leads', {
      select: 'id, booker_id',
      eq: { id: req.params.id }
    });

    if (!leads || leads.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = leads[0];

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin' && lead.booker_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only modify leads assigned to you.' });
    }

    // Add booking history entry to Supabase
    const historyEntry = {
      // Don't set id - let database auto-generate it
      lead_id: req.params.id,
      action: action,
      performed_by: req.user.id,
      performed_by_name: req.user.name,
      details: details ? JSON.stringify(details) : null,
      lead_snapshot: JSON.stringify({ lead_id: req.params.id }),
      created_at: new Date().toISOString()
    };

    await dbManager.insert('booking_history', historyEntry);
    res.json({ success: true, message: 'History entry added successfully' });
  } catch (error) {
    console.error('Add booking history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/:id
// @desc    Get single lead
// @access  Private
router.get('/:id([0-9a-fA-F-]{36})', auth, async (req, res) => {
  try {
    // Check if the ID is a valid ObjectId
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }
    
    console.log(`📋 GET /api/leads/${req.params.id} - Requested by user ${req.user.name} (${req.user.role})`);

    // Get the lead from Supabase
    const leads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });

    console.log(`📋 Database query for ID ${req.params.id}: ${leads && leads.length > 0 ? 'Found' : 'Not Found'}`);

    if (!leads || leads.length === 0) {
      console.error(`❌ Get lead error: Lead not found for ID: ${req.params.id}`);
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = leads[0];

    // ROLE-BASED ACCESS CONTROL
    // Only admins can access any lead, bookers and viewers can only access their assigned leads
    if (req.user.role !== 'admin' && lead.booker_id !== req.user.id) {
      console.log(`🚫 Access denied: User ${req.user.name} (${req.user.role}) tried to access lead ${req.params.id} assigned to ${lead.booker_id}`);
      return res.status(403).json({ message: 'Access denied. You can only view leads assigned to you.' });
    }

    console.log(`✅ Lead access granted: User ${req.user.name} (${req.user.role}) accessed lead ${req.params.id}`);

    // Get booker information
    let bookerInfo = null;
    if (lead.booker_id) {
      try {
        const booker = await dbManager.query('users', {
          select: 'name, email',
          eq: { id: lead.booker_id }
        });
        if (booker.length > 0) {
          bookerInfo = {
            id: lead.booker_id,
            name: booker[0].name,
            email: booker[0].email
          };
        }
      } catch (error) {
        console.log(`Could not get booker info for lead ${lead.id}`);
      }
    }

    // Transform lead to include booker object
    const transformedLead = {
      ...lead,
      booker: bookerInfo
    };

    res.json(transformedLead);
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads
// @desc    Create new lead
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    // Filter out empty or invalid _id field to prevent validation errors
    const { _id, ...bodyWithoutId } = req.body;
    const filteredBody = _id && _id !== '' ? { _id, ...bodyWithoutId } : bodyWithoutId;
    
    // Simple deduplication: Check if we're processing the same request within 5 seconds
    const requestKey = `${req.user.id}_${filteredBody.name}_${filteredBody.phone}_${filteredBody.date_booked}`;
    const now = Date.now();
    
    if (!global.recentRequests) global.recentRequests = new Map();
    
    if (global.recentRequests.has(requestKey)) {
      const lastRequest = global.recentRequests.get(requestKey);
      if (now - lastRequest < 5000) { // 5 seconds
        console.log(`🚫 Duplicate request detected for ${filteredBody.name} within 5 seconds, ignoring`);
        return res.status(200).json({ 
          message: 'Request already being processed',
          isDuplicate: true
        });
      }
    }
    
    global.recentRequests.set(requestKey, now);
    
    // Clean up old requests (older than 1 minute)
    for (const [key, timestamp] of global.recentRequests.entries()) {
      if (now - timestamp > 60000) {
        global.recentRequests.delete(key);
      }
    }

    // PERSISTENCE FIX: If we have an _id, we're updating an existing lead from the lead details page
    if (_id && _id !== '') {
      console.log('📊 Updating existing lead from lead details:', _id);
      // Force update instead of create
      const existingLeads = await dbManager.query('leads', {
        select: '*',
        eq: { id: _id }
      });
      
      if (existingLeads && existingLeads.length > 0) {
        // Update the existing lead
        // Remove fields that don't exist in Supabase schema
        const { isReschedule, sendEmail, sendSms, rescheduleReason, ...cleanBodyData } = bodyWithoutId;
        const updateData = {
          ...cleanBodyData,
          date_booked: bodyWithoutId.date_booked ? preserveLocalTime(bodyWithoutId.date_booked) : null,
          status: 'Booked',
          booker_id: req.user.id,
          updated_at: new Date().toISOString(),
          // Convert boolean to integer for database compatibility
          is_confirmed: bodyWithoutId.is_confirmed ? 1 : 0,
          booking_status: bodyWithoutId.booking_status || (isReschedule ? 'Reschedule' : null)
        };
        
        const updateResult = await dbManager.update('leads', updateData, { id: _id });
        
        // Get updated lead
        const updated = await dbManager.query('leads', {
          select: '*',
          eq: { id: _id }
        });
        
        // Send booking confirmation if requested
        try {
          if (updateData.date_booked && (bodyWithoutId.sendEmail || bodyWithoutId.sendSms)) {
            await MessagingService.sendBookingConfirmation(
              _id,
              req.user.id,
              updateData.date_booked,
              { 
                sendEmail: bodyWithoutId.sendEmail || false, 
                sendSms: bodyWithoutId.sendSms || false 
              }
            );
            console.log(`📧 Booking confirmation triggered for lead ${_id}`);
          }
        } catch (e) {
          console.error('❌ Failed to send booking confirmation:', e);
        }
        
        // Emit real-time update
        if (global.io) {
          global.io.emit('lead_updated', {
            lead: updated[0],
            action: 'booking_updated',
            timestamp: new Date()
          });
        }
        
        return res.json({
          success: true,
          lead: updated[0],
          isExistingLead: true,
          message: 'Appointment booked successfully'
        });
      }
    }

    // Map imageUrl to image_url if present
    if (filteredBody.imageUrl) {
      filteredBody.image_url = filteredBody.imageUrl;
      delete filteredBody.imageUrl;
    }
    
    // Remove fields that don't exist in Supabase schema
    const { isReschedule, sendEmail, sendSms, rescheduleReason, ...cleanFilteredBody } = filteredBody;
    const finalBody = cleanFilteredBody;

    console.log('📊 Server: Creating lead with data:', {
      originalId: _id,
      hasValidId: _id && _id !== '',
      finalData: filteredBody
    });

    // Check for existing leads with the same name and phone to prevent duplicates using Supabase
    if (finalBody.name && finalBody.phone) {
      // Normalize phone number for better duplicate detection
      const normalizedPhone = finalBody.phone.replace(/[\s\-\(\)]/g, '');
      const normalizedName = finalBody.name.trim().toLowerCase();
      
      console.log(`📊 Duplicate check: Looking for "${normalizedName}" with phone "${normalizedPhone}"`);
      
      // Use Supabase to check for duplicates
      const existingLeads = await dbManager.query('leads', {
        select: 'id, name, phone, status, date_booked',
        is: { deleted_at: null },
        // Note: Supabase doesn't support complex WHERE clauses like SQLite, so we'll filter in JavaScript
        // This is a limitation we'll need to work around
      });
      
      // Filter for duplicates in JavaScript (not ideal but necessary for now)
      const duplicateLeads = existingLeads.filter(lead => {
        const leadName = lead.name ? lead.name.trim().toLowerCase() : '';
        const leadPhone = lead.phone ? lead.phone.replace(/[\s\-\(\)]/g, '') : '';
        return leadName === normalizedName && (
          lead.phone === finalBody.phone || 
          leadPhone === normalizedPhone || 
          leadPhone === finalBody.phone.replace(/[\s\-\(\)]/g, '')
        );
      });
      
      if (duplicateLeads.length > 0) {
        console.log(`📊 Duplicate detection: Found ${duplicateLeads.length} existing leads for ${finalBody.name} (${finalBody.phone})`);
        
        // If there's an existing lead and we're trying to book it, update the existing lead instead
        if (finalBody.status === 'Booked' && finalBody.date_booked) {
          const existingLead = existingLeads[0];
          console.log(`📊 Updating existing lead ${existingLead.id} instead of creating duplicate`);
          
          // Update the existing lead with booking information
          const updateFields = {
            status: 'Booked',
            date_booked: finalBody.date_booked ? preserveLocalTime(finalBody.date_booked) : null,
            booker_id: req.user.id,
            updated_at: new Date().toISOString()
          };
          
          // Include reschedule-specific fields if this is a reschedule
          if (isReschedule) {
            updateFields.booking_status = finalBody.booking_status || 'Reschedule';
            // Convert boolean to integer for database compatibility
            updateFields.is_confirmed = 0; // Reschedules start as unconfirmed
          }
          
          // Update the existing lead using Supabase
          await dbManager.update('leads', updateFields, { id: existingLead.id });
          
          // Get the updated lead
          const updatedLeads = await dbManager.query('leads', {
            select: '*',
            eq: { id: existingLead.id }
          });
          const updatedLead = updatedLeads[0];

          // Immediately trigger booking confirmation on duplicate-update path as well,
          // because some clients may not issue the subsequent PUT we rely on.
          try {
            if (finalBody.date_booked) {
              await MessagingService.sendBookingConfirmation(
                existingLead.id,
                req.user.id,
                finalBody.date_booked,
                { sendEmail: sendEmail || false, sendSms: sendSms || false }
              );
              console.log(`📧 Booking confirmation triggered (duplicate-update path) for lead ${existingLead.id}`);
            }
          } catch (e) {
            console.error('❌ Failed to send booking confirmation (duplicate-update path):', e);
          }

          // Enhanced real-time update emission
          if (global.io) {
            const updatePayload = {
              lead: updatedLead,
              action: 'update',
              bookerId: updatedLead.booker_id,
              leadId: updatedLead.id,
              timestamp: new Date().toISOString()
            };

            // Emit multiple events for robustness
            global.io.emit('lead_updated', updatePayload);
            global.io.emit('stats_update_needed', {
              type: 'lead_updated',
              bookerId: updatedLead.booker_id,
              leadId: updatedLead.id,
              timestamp: new Date().toISOString()
            });

            // Specific booking activity event for dashboard
            if (updatedLead.status === 'Booked' || updatedLead.date_booked) {
              global.io.emit('booking_activity', {
                action: 'updated',
                booker: updatedLead.booker_id,
                leadName: updatedLead.name,
                dateBooked: updatedLead.date_booked,
                status: updatedLead.status,
                timestamp: new Date().toISOString()
              });
            }

            console.log('📡 EMITTED: Dashboard update events for lead update', {
              leadId: updatedLead.id,
              booker: updatedLead.booker_id,
              status: updatedLead.status
            });
          } else {
            console.warn('⚠️ global.io not available - live updates will not work');
          }
          
          return res.status(200).json({
            message: 'Existing lead updated successfully',
            lead: updatedLead,
            isExistingLead: true  // Add this flag to indicate it was an existing lead
          });
        } else {
          // If not booking, return error about duplicate
          return res.status(400).json({ 
            message: `A lead with the name "${finalBody.name}" and phone "${finalBody.phone}" already exists. Please update the existing lead instead.` 
          });
        }
      }
    }
    
    const uuid = require('uuid');
    const leadId = uuid.v4();
    const leadData = {
      ...finalBody,
      booker: req.user.id,
      id: leadId // Ensure we have a proper ID for SQLite
    };

    // Insert the new lead using Supabase
    const leadToInsert = {
      id: leadData.id,
      name: leadData.name || '',
      phone: leadData.phone || '',
      email: leadData.email || '',
      postcode: leadData.postcode || '',
      image_url: leadData.image_url || '',
      parent_phone: leadData.parent_phone || '',
      age: leadData.age || null,
      booker_id: leadData.booker || null,
      created_by_user_id: req.user.id, // Track who created this booking
      status: leadData.status || 'New',
      date_booked: leadData.date_booked ? preserveLocalTime(leadData.date_booked) : null,
      booking_history: JSON.stringify([]), // booking_history starts empty
      notes: leadData.notes || '',
      // Convert boolean to integer for database compatibility
      is_confirmed: leadData.is_confirmed ? 1 : 0,
      booking_status: leadData.booking_status || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Use service role client for lead creation to bypass RLS and allow activity logging
    const config = require('../config');
    const serviceRoleClient = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey || config.supabase.anonKey
    );

    const { data: insertResult, error: insertError } = await serviceRoleClient
      .from('leads')
      .insert([leadToInsert])
      .select();

    if (insertError) {
      console.error('Create lead error:', insertError);
      
      // Handle RLS policy violations gracefully
      if (insertError.code === '42501') {
        console.warn('⚠️ RLS policy violation during lead creation - this may be due to automatic assignment creation');
        // Try to continue without failing the request
        // The lead might still be created despite the assignment error
      } else {
        return res.status(500).json({ message: 'Server error: ' + insertError.message });
      }
    }

    if (!insertResult || insertResult.length === 0) {
      console.error('Create lead error: No data inserted');
      return res.status(500).json({ message: 'Server error: No data inserted' });
    }

    // Get the inserted lead
    const lead = insertResult[0];

    // Get user information for booking history using Supabase
    let bookerName = 'Unknown User';
    if (leadData.booker) {
      const bookerUser = await dbManager.query('users', {
        select: 'name',
        eq: { id: leadData.booker }
      });
      if (bookerUser && bookerUser.length > 0) {
        bookerName = bookerUser[0].name;
      }
    }

    // Add initial booking history entry if this is a booked lead
    if (leadData.status === 'Booked' && leadData.date_booked) {
      console.log(`📅 Adding INITIAL_BOOKING for new lead ${leadData.name}`);
      await addBookingHistoryEntry(
        lead.id,
        'INITIAL_BOOKING',
        leadData.booker,
        bookerName,
        {
          newDate: leadData.date_booked,
          notes: `Initial booking created for ${leadData.name}`
        },
        createLeadSnapshot(lead)
      );
    }

    // Update user's leads assigned count using Supabase
    if (leadData.booker) {
      try {
        const bookerUser = await dbManager.query('users', {
          select: 'leads_assigned',
          eq: { id: leadData.booker }
        });
        
        if (bookerUser && bookerUser.length > 0) {
          const newCount = (bookerUser[0].leads_assigned || 0) + 1;
          await dbManager.update('users', { leads_assigned: newCount }, { id: leadData.booker });
        }

        // ✅ SCOREBOARD FIX: Set assigned_at timestamp for performance tracking
        await dbManager.update('leads', { 
          assigned_at: new Date().toISOString() 
        }, { id: lead.id });
        
        console.log(`📊 Lead ${lead.name} assigned to booker at ${new Date().toISOString()}`);
      } catch (error) {
        console.error('Failed to update booker leads count:', error);
      }
    }

    // Trigger booking confirmation (email/SMS) for newly created booked leads
    try {
      if (leadData.status === 'Booked' && leadData.date_booked) {
        const { sendEmail, sendSms } = filteredBody || {};
        await MessagingService.sendBookingConfirmation(
          lead.id,
          leadData.booker,
          leadData.date_booked,
          { sendEmail, sendSms }
        );
        console.log(`📧 Booking confirmation triggered for new lead ${lead.id}`);
      }
    } catch (msgErr) {
      console.error('❌ Failed to send booking confirmation for new lead:', msgErr);
    }

    // Enhanced real-time update for lead creation
    if (global.io) {
      const createPayload = {
        lead: lead,
        action: 'create',
        bookerId: lead.booker_id,
        leadId: lead.id,
        timestamp: new Date().toISOString()
      };

      // Emit multiple events for robustness
      global.io.emit('lead_created', createPayload);
      global.io.emit('stats_update_needed', {
        type: 'lead_created',
        bookerId: lead.booker_id,
        leadId: lead.id,
        timestamp: new Date().toISOString()
      });

      // Specific booking activity event for dashboard if it's a booking
      if (lead.status === 'Booked' || lead.date_booked) {
        global.io.emit('booking_activity', {
          action: 'created',
          booker: lead.booker_id,
          leadName: lead.name,
          dateBooked: lead.date_booked,
          status: lead.status,
          timestamp: new Date().toISOString()
        });
      }

      console.log('📡 EMITTED: Dashboard update events for lead creation', {
        leadId: lead.id,
        booker: lead.booker_id,
        status: lead.status,
        isBooking: !!(lead.status === 'Booked' || lead.date_booked)
      });
    } else {
      console.warn('⚠️ global.io not available - live updates will not work');
    }

    res.status(201).json({
      message: 'Lead created successfully',
      lead: lead
    });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ message: 'Server error: ' + error.message });
  }
});

// @route   PUT /api/leads/:id
// @desc    Update lead
// @access  Private
router.put('/:id([0-9a-fA-F-]{36})', auth, async (req, res) => {
  try {
    // Normalize incoming fields from various clients (camelCase vs snake_case)
    if (req.body && req.body.dateBooked && !req.body.date_booked) {
      req.body.date_booked = req.body.dateBooked;
    }
    if (req.body && req.body.timeBooked && !req.body.time_booked) {
      req.body.time_booked = req.body.timeBooked;
    }
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }
    // Get the lead from Supabase
    const leads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });

    if (!leads || leads.length === 0) {
      console.error('Update lead error: Lead not found or deleted');
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = leads[0];
    // ROLE-BASED ACCESS CONTROL for lead updates
    // Admin can update any lead
    // Viewer can update any lead (admin-level access for status changes)
    // Booker can update Confirmed/Unconfirmed on any booking, or other statuses only on their assigned leads
    if (req.user.role !== 'admin' && req.user.role !== 'viewer') {
      // For bookers, check permissions based on status change type
      if (req.user.role === 'booker') {
        const isConfirmationChange = (req.body.is_confirmed !== undefined) ||
                                   (req.body.status === 'Booked' && (req.body.is_confirmed === true || req.body.is_confirmed === false));
        const isAssignedLead = lead.booker_id && lead.booker_id.toString() === req.user.id.toString();
        
        if (!isConfirmationChange && !isAssignedLead) {
          return res.status(403).json({ message: 'Access denied. You can only change Confirmed/Unconfirmed status on any booking, or other statuses on leads assigned to you.' });
        }
      } else {
        // Any other role is denied
        return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
      }
    }
    // Capture original values for history tracking
    const oldStatus = lead.status;
    const oldDateBooked = lead.date_booked;
    const currentUser = req.user;
    // Debug logging for reschedule attempts
    console.log(`🔍 Booking Debug for ${lead.name}:`, {
      oldStatus,
      newStatus: req.body.status,
      oldDateBooked: oldDateBooked ? new Date(oldDateBooked).toISOString() : null,
      newDateBooked: req.body.date_booked ? new Date(req.body.date_booked).toISOString() : null,
      isNewBooking: (oldStatus === 'New' || !oldDateBooked) && req.body.date_booked && req.body.status === 'Booked',
      isReschedule: oldStatus === 'Booked' && req.body.status === 'Booked' && oldDateBooked && req.body.date_booked && new Date(oldDateBooked).getTime() !== new Date(req.body.date_booked).getTime(),
      hasDateChange: oldDateBooked && req.body.date_booked && new Date(oldDateBooked).getTime() !== new Date(req.body.date_booked).getTime()
    });
    // Track changes for booking history
    const isStatusChange = oldStatus !== req.body.status && req.body.status;
    const isDateChange = oldDateBooked && req.body.date_booked && new Date(oldDateBooked).getTime() !== new Date(req.body.date_booked).getTime();
    const isReschedule = oldStatus === 'Booked' && req.body.status === 'Booked' && oldDateBooked && req.body.date_booked && new Date(oldDateBooked).getTime() !== new Date(req.body.date_booked).getTime();
    const isNewBooking = (oldStatus === 'New' || !oldDateBooked) && req.body.date_booked && req.body.status === 'Booked';
    // Handle cancellation - set to Cancelled and clear booking date
    const isCancellation = req.body.status === 'Cancelled' || (req.body.status === 'New' && oldStatus === 'Booked' && !req.body.date_booked);
    // If cancelling, clear dateBooked and keep status as Cancelled
    if (req.body.status === 'Cancelled') {
      req.body.date_booked = null;
      // Keep status as 'Cancelled' instead of changing to 'New'
    }
    // Update the lead - filter out problematic fields and ensure valid data types
    const { _id, ...updateData } = req.body;
    
    // Filter out any fields that might cause SQLite binding issues
    const validUpdateData = {};
    for (const [key, value] of Object.entries(updateData)) {
      // Do not persist transient messaging flags and computed fields
      if (key === 'sendEmail' || key === 'sendSms' || key === 'booker_name' || key === 'booker_email') continue;
      if (value === undefined) continue; // Skip undefined values completely

      // Convert camelCase field names to snake_case for database columns
      const dbKey = key === 'bookingHistory' ? 'booking_history' : 
                    key === 'dateBooked' ? 'date_booked' :
                    key === 'isConfirmed' ? 'is_confirmed' :
                    key === 'hasSale' ? 'has_sale' :
                    key === 'bookingStatus' ? 'booking_status' :
                    key;

      // Convert Date objects to ISO strings
      if (value instanceof Date) {
        validUpdateData[dbKey] = value.toISOString();
        continue;
      }

      const valueType = typeof value;
      if (value === null || valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
        validUpdateData[dbKey] = value;
        continue;
      }

      // For plain objects/arrays, flatten booker and rescheduleReason fields, otherwise store as string or skip
      if (valueType === 'object') {
        if (key === 'booker') {
          // If booker is an object, try to extract id or name, otherwise stringify
          if (value && typeof value === 'object') {
            validUpdateData[dbKey] = value.id || value._id || value.name || JSON.stringify(value);
          } else {
            validUpdateData[dbKey] = String(value);
          }
        } else if (key === 'rescheduleReason') {
          validUpdateData[dbKey] = String(value);
        } else {
          try {
            validUpdateData[dbKey] = JSON.stringify(value);
          } catch (jsonErr) {
            console.warn(`⚠️ Skipping field '${key}' – could not stringify value for SQLite`, jsonErr);
          }
        }
      }
    }
    
    // Fix the SQLite binding issue by ensuring all values are properly converted
    const updateFields = {
      ...validUpdateData,
      updated_by_user_id: req.user.id, // Track who last updated this booking
      updated_at: new Date().toISOString()
    };

    // Filter out any invalid values and convert objects to strings
    const filteredUpdateFields = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (key === 'sendEmail' || key === 'sendSms') continue;
      
      // For certain fields, we want to allow null values to clear them
      const allowNullFields = ['booking_status', 'date_booked', 'reschedule_reason'];
      if (value === null && allowNullFields.includes(key)) {
        filteredUpdateFields[key] = null;
        continue;
      }

      // Special handling for date_booked - always include it if it's defined
      if (key === 'date_booked') {
        if (value === null) {
          filteredUpdateFields[key] = null;
        } else if (value !== undefined) {
          filteredUpdateFields[key] = value;
        }
        continue;
      }

      if (value === null || value === undefined) {
        continue; // Skip null/undefined values for other fields
      }
      
      if (typeof value === 'object') {
        // Convert objects to JSON strings
        try {
          filteredUpdateFields[key] = JSON.stringify(value);
        } catch (jsonErr) {
          console.warn(`⚠️ Skipping field '${key}' – could not stringify value for SQLite`, jsonErr);
          continue;
        }
      } else if (typeof value === 'boolean') {
        // Convert booleans to integers for SQLite
        filteredUpdateFields[key] = value ? 1 : 0;
      } else {
        // Keep strings, numbers as they are
        filteredUpdateFields[key] = value;
      }
    }

    // Update the lead using Supabase
    if (Object.keys(filteredUpdateFields).length > 0) {
      // Convert boolean values to integers for Supabase
      const supabaseUpdateFields = { ...filteredUpdateFields };
      if (supabaseUpdateFields.is_confirmed !== undefined) {
        supabaseUpdateFields.is_confirmed = supabaseUpdateFields.is_confirmed ? 1 : 0;
      }
      
      // ✅ SCOREBOARD FIX: Set booked_at timestamp when status changes to 'Booked'
      if (supabaseUpdateFields.status === 'Booked' && lead.status !== 'Booked') {
        supabaseUpdateFields.booked_at = new Date().toISOString();
        console.log(`📊 Lead ${lead.name} booked at ${supabaseUpdateFields.booked_at}`);
      }
      
      const updateResult = await dbManager.update('leads', supabaseUpdateFields, { id: req.params.id });
      
      if (!updateResult || updateResult.length === 0) {
        console.error('Update lead error: Failed to update lead');
        return res.status(500).json({ message: 'Failed to update lead' });
      }
    }
    
    // Get the updated lead
    const updatedLeadResult = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });
    
    if (!updatedLeadResult || updatedLeadResult.length === 0) {
      console.error('Update lead error: Failed to fetch updated lead');
      return res.status(500).json({ message: 'Failed to fetch updated lead' });
    }

    const updatedLead = updatedLeadResult[0];

    // ✅ SCOREBOARD FIX: Update daily performance metrics after lead update
    if (updatedLead.booker_id) {
      try {
        const bookerAnalytics = require('./booker-analytics');
        await bookerAnalytics.updateDailyPerformance(updatedLead.booker_id);
        console.log(`📊 Updated daily performance for booker ${updatedLead.booker_id}`);
      } catch (perfError) {
        console.error('Failed to update daily performance:', perfError.message);
      }
    }
    // Add booking history entries based on the type of change
    if (isNewBooking) {
      console.log(`📅 Adding INITIAL_BOOKING for lead ${lead.name} (oldStatus: ${oldStatus}, oldDateBooked: ${oldDateBooked})`);
              await addBookingHistoryEntry(
          req.params.id,
          'INITIAL_BOOKING',
          currentUser.id,
          currentUser.name,
        {
          newDate: req.body.date_booked,
          notes: `Appointment booked for ${lead.name}`
        },
        createLeadSnapshot(updatedLead)
      );

      // Trigger booking confirmation (email + optional SMS per template)
      try {
        if (req.body.date_booked) {
          const { sendEmail, sendSms } = req.body;
          await MessagingService.sendBookingConfirmation(
            req.params.id,
            currentUser.id,
            req.body.date_booked,
            { sendEmail, sendSms }
          );
          console.log(`📧 Booking confirmation triggered for lead ${req.params.id}`);
        }
      } catch (msgErr) {
        console.error('❌ Failed to send booking confirmation notification:', msgErr);
      }
    } else if (isReschedule || isDateChange) {
      console.log(`📅 Adding RESCHEDULE for lead ${lead.name} (oldDate: ${oldDateBooked}, newDate: ${req.body.date_booked})`);
              await addBookingHistoryEntry(
          req.params.id,
          'RESCHEDULE',
          currentUser.id,
          currentUser.name,
        {
          oldDate: oldDateBooked,
          newDate: req.body.date_booked,
          oldBookingStatus: lead.booking_status,
          newBookingStatus: req.body.booking_status,
          oldIsConfirmed: lead.is_confirmed,
          newIsConfirmed: req.body.is_confirmed,
          reason: req.body.reschedule_reason || 'Appointment rescheduled',
          notes: `Appointment rescheduled from ${new Date(oldDateBooked).toLocaleString()} to ${new Date(req.body.date_booked).toLocaleString()}. Status reset: ${lead.booking_status || 'none'} → ${req.body.booking_status || 'none'}`
        },
        createLeadSnapshot(updatedLead)
      );

      // Also send updated booking confirmation on reschedule
      try {
        if (req.body.date_booked) {
          const { sendEmail, sendSms } = req.body;
          await MessagingService.sendBookingConfirmation(
            req.params.id,
            currentUser.id,
            req.body.date_booked,
            { sendEmail, sendSms }
          );
          console.log(`📧 Reschedule confirmation sent for lead ${req.params.id}`);
        }
      } catch (msgErr) {
        console.error('❌ Failed to send reschedule confirmation notification:', msgErr);
      }
    } else if (isCancellation) {
      console.log(`📅 Adding CANCELLATION for lead ${lead.name} - moving to Cancelled`);
              await addBookingHistoryEntry(
          req.params.id,
          'CANCELLATION',
          currentUser.id,
          currentUser.name,
        {
          oldStatus: oldStatus,
          newStatus: 'Cancelled',
          oldDate: oldDateBooked,
          reason: req.body.cancellation_reason || 'Appointment cancelled via calendar',
          notes: `Appointment cancelled and lead moved to Cancelled - was scheduled for ${oldDateBooked ? new Date(oldDateBooked).toLocaleString() : 'unknown date'}`
        },
        createLeadSnapshot(updatedLead)
      );
    } else if (isStatusChange) {
      console.log(`📅 Adding STATUS_CHANGE for lead ${lead.name}: ${oldStatus} → ${req.body.status}`);
              await addBookingHistoryEntry(
          req.params.id,
          'STATUS_CHANGE',
          currentUser.id,
          currentUser.name,
        {
          oldStatus: oldStatus,
          newStatus: req.body.status,
          notes: `Status changed from ${oldStatus} to ${req.body.status}`
        },
        createLeadSnapshot(updatedLead)
      );
    }
    // Update user statistics if status changed
    if (oldStatus !== req.body.status && req.body.status && lead.booker) {
      await updateUserStatistics(lead.booker, {
        from: oldStatus,
        to: req.body.status
      });
    }
    // Emit real-time update
    if (global.io) {
      global.io.emit('lead_updated', {
        lead: updatedLead,
        action: 'update',
        timestamp: new Date(),
        statusChange: oldStatus !== req.body.status ? {
          from: oldStatus,
          to: req.body.status
        } : null
      });
      global.io.emit('calendar_sync_needed', {
        type: 'lead_updated',
        leadId: req.params.id,
        timestamp: new Date()
      });
      if (oldStatus !== req.body.status && req.body.status) {
        global.io.emit('diary_updated', {
          type: 'DIARY_UPDATE',
          data: {
            leadId: req.params.id,
            leadName: updatedLead.name,
            oldStatus: oldStatus,
            newStatus: req.body.status,
            dateBooked: req.body.date_booked || updatedLead.date_booked,
            timestamp: new Date().toISOString(),
            updatedBy: currentUser.name,
            updatedAt: new Date().toISOString()
          }
        });
        global.io.emit('booking_update', {
          leadId: req.params.id,
          leadName: updatedLead.name,
          oldStatus: oldStatus,
          newStatus: req.body.status,
          dateBooked: req.body.date_booked || updatedLead.date_booked,
          updatedBy: currentUser.name
        });
        console.log(`📅 Diary update emitted: ${updatedLead.name} - ${oldStatus} → ${req.body.status}`);
      }
    }
    res.json({
      message: 'Lead updated successfully',
      lead: updatedLead
    });
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/no-answer
// @desc    Increment no answer count for retargeting
// @access  Private
router.post('/:id/no-answer', auth, async (req, res) => {
  try {
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }

    const lead = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id },
      is: { deleted_at: null }
    });

    if (!lead || lead.length === 0) {
      console.error('No answer increment error: Lead not found or deleted');
      return res.status(404).json({ message: 'Lead not found' });
    }

    const leadData = lead[0];

    // Check if user can update this lead
    if (req.user.role !== 'admin' && leadData.booker_id && leadData.booker_id.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Initialize retargeting object if it doesn't exist
    let retargeting = {};
    if (leadData.retargeting) {
      try {
        retargeting = JSON.parse(leadData.retargeting);
      } catch (e) {
        retargeting = {};
      }
    }

    if (!retargeting.no_answer_count) {
      retargeting = {
        no_answer_count: 0,
        is_eligible: false,
        status: 'ACTIVE',
        exclude_from_retargeting: false,
        campaigns_sent: []
      };
    }

    // Increment no answer count (max 10)
    const currentCount = retargeting.no_answer_count || 0;
    if (currentCount >= 10) {
      return res.status(400).json({ message: 'Maximum no answer count reached' });
    }

    retargeting.no_answer_count = currentCount + 1;
    retargeting.last_contact_attempt = new Date().toISOString();

    // Update the lead
    await dbManager.update('leads', { retargeting: JSON.stringify(retargeting) }, { id: req.params.id });

    // Check if lead becomes eligible for retargeting (3+ no answers, 3+ weeks old, not booked/converted)
    const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    const isOldEnough = new Date(lead.created_at) <= threeWeeksAgo;
    const hasEnoughNoAnswers = retargeting.no_answer_count >= 3;
    const isEligibleStatus = !['Booked', 'Attended'].includes(lead.status);
    
    if (isOldEnough && hasEnoughNoAnswers && isEligibleStatus && !retargeting.exclude_from_retargeting) {
      retargeting.is_eligible = true;
      retargeting.eligible_since = retargeting.eligible_since || new Date().toISOString();
      
      await dbManager.update('leads', { retargeting: JSON.stringify(retargeting) }, { id: req.params.id });
    }

    // Get the updated lead
    const updatedLeads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });
    const updatedLead = updatedLeads[0];

    // Emit real-time update
    if (global.io) {
      global.io.emit('lead_updated', {
        lead: updatedLead,
        action: 'no_answer_update',
        timestamp: new Date()
      });
    }

    res.json(updatedLead);
  } catch (error) {
    console.error('No answer increment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/leads/:id/assign
// @desc    Assign lead to a different user
// @access  Admin only
router.put('/:id/assign', auth, adminAuth, async (req, res) => {
  try {
    console.log('🔄 Assignment request - Lead ID:', req.params.id, 'Body:', req.body);
    
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }

    const { booker } = req.body;
    
    if (!booker) {
      return res.status(400).json({ message: 'Invalid booker ID format' });
    }
    
    console.log('👤 Assigning lead', req.params.id, 'to booker:', booker);

    // Get the lead using Supabase
    const lead = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id },
      is: { deleted_at: null }
    });

    if (!lead || lead.length === 0) {
      console.error('Assign lead error: Lead not found or deleted');
      return res.status(404).json({ message: 'Lead not found' });
    }

    const leadData = lead[0];
    const oldBookerId = leadData.booker_id;

    // Update the lead - assign booker and change status to Assigned if currently New
    // Use service role client to bypass RLS policies
    const serviceRoleClient = createClient(
      process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
    );

    const { data: updateResult, error: updateError } = await serviceRoleClient
      .from('leads')
      .update({
        booker_id: booker,
        status: leadData.status === 'New' ? 'Assigned' : leadData.status,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (updateError || !updateResult) {
      console.error('Assign lead error: Failed to update lead', updateError);
      
      // Handle RLS policy violations gracefully
      if (updateError?.code === '42501') {
        console.warn('⚠️ RLS policy violation during lead assignment - this may be due to automatic assignment creation');
        // Try to continue without failing the request
        // The lead might still be updated despite the assignment error
      } else {
        return res.status(500).json({ message: 'Failed to assign lead', error: updateError?.message });
      }
    }

    const updatedLead = updateResult;
    
    console.log('✅ Lead assignment completed:', {
      leadId: req.params.id,
      leadName: updatedLead.name,
      newBooker: booker,
      newStatus: updatedLead.status,
      oldBooker: oldBookerId
    });

    // Update user statistics using service role client
    if (oldBookerId && oldBookerId.toString() !== booker) {
      try {
        // Decrease old user's assigned count
        const { data: oldUser } = await serviceRoleClient
          .from('users')
          .select('leads_assigned')
          .eq('id', oldBookerId)
          .single();

        if (oldUser) {
          const newCount = Math.max((oldUser.leads_assigned || 0) - 1, 0);
          await serviceRoleClient
            .from('users')
            .update({ leads_assigned: newCount })
            .eq('id', oldBookerId);
        }

        // Increase new user's assigned count
        const { data: newUser } = await serviceRoleClient
          .from('users')
          .select('leads_assigned')
          .eq('id', booker)
          .single();

        if (newUser) {
          const newCount = (newUser.leads_assigned || 0) + 1;
          await serviceRoleClient
            .from('users')
            .update({ leads_assigned: newCount })
            .eq('id', booker);
        }
      } catch (error) {
        console.error('Failed to update user statistics:', error);
      }
    }

    // Emit real-time update
    if (global.io) {
      global.io.emit('lead_reassigned', {
        lead: updatedLead,
        action: 'reassign',
        timestamp: new Date(),
        oldBooker: oldBookerId,
        newBooker: booker
      });
    }

    res.json(updatedLead);
  } catch (error) {
    console.error('Assign lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/leads/:id
// @desc    Delete lead
// @access  Admin only
router.delete('/:id([0-9a-fA-F-]{36})', auth, adminAuth, async (req, res) => {
  try {
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }

    // Get lead data using Supabase
    const lead = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id },
      is: { deleted_at: null }
    });

    if (!lead || lead.length === 0) {
      console.error('Delete lead error: Lead not found or deleted');
      return res.status(404).json({ message: 'Lead not found' });
    }

    const leadData = lead[0];
    
    // Delete related sales first (cascade delete) using Supabase
    const salesDeleteResult = await dbManager.delete('sales', {
      eq: { lead_id: req.params.id }
    });
    console.log(`🗑️ Deleted ${salesDeleteResult ? salesDeleteResult.length : 0} related sales for lead ${req.params.id}`);
    
    // Delete the lead using Supabase
    const deleteResult = await dbManager.delete('leads', {
      eq: { id: req.params.id }
    });

    if (!deleteResult || deleteResult.length === 0) {
      console.error('Delete lead error: Database delete failed');
      return res.status(500).json({ message: 'Server error' });
    }

    // Update user's leads assigned count using Supabase
    if (leadData.booker_id) {
      const user = await dbManager.query('users', {
        select: 'leads_assigned',
        eq: { id: leadData.booker_id }
      });
      
      if (user && user.length > 0) {
        const newCount = Math.max((user[0].leads_assigned || 0) - 1, 0);
        await dbManager.update('users', {
          eq: { id: leadData.booker_id },
          data: { leads_assigned: newCount }
        });
      }
    }

    // Emit real-time update
    if (global.io) {
      global.io.emit('lead_deleted', {
        leadId: req.params.id,
        action: 'delete',
        timestamp: new Date()
      });

      // Emit sales deletion notification
      if (salesDeleteResult && salesDeleteResult.length > 0) {
        global.io.emit('sales_deleted', {
          action: 'delete',
          deletedCount: salesDeleteResult.length,
          leadId: req.params.id,
          timestamp: new Date()
        });
        console.log(`📡 Emitted sales_deleted event for ${salesDeleteResult.length} sales`);
      }

      // Emit diary update for shared diary synchronization if this was a booked lead
      if (lead.status === 'Booked' || lead.status === 'Attended') {
        global.io.emit('diary_updated', {
          type: 'DIARY_UPDATE',
          data: {
            leadId: req.params.id,
            leadName: lead.name,
            oldStatus: lead.status,
            newStatus: 'Deleted',
            dateBooked: lead.date_booked,
            timestamp: new Date().toISOString(),
            updatedBy: req.user.name,
            updatedAt: new Date().toISOString()
          }
        });
        
        console.log(`📅 Diary update emitted for deleted booking: ${lead.name} - ${lead.status} → Deleted`);
      }
    }

    res.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/leads/bulk
// @desc    Delete multiple leads
// @access  Admin only
router.delete('/bulk', auth, adminAuth, async (req, res) => {
  try {
    console.log('🗑️ Bulk delete request received');
    
    const { leadIds } = req.body;
    
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      console.log('❌ Invalid leadIds array:', leadIds);
      return res.status(400).json({ message: 'Please provide an array of lead IDs' });
    }

    console.log(`🔍 Received ${leadIds.length} lead IDs for deletion`);

    // Clean and validate IDs - convert any potential objects to strings and validate format
    const validatedIds = [];
    const invalidIds = [];

    leadIds.forEach((id, index) => {
      // Handle various ID types and convert to string
      let idString = id;
      if (typeof id === 'object' && id !== null) {
        // If it's an ObjectId or has toString()
        idString = id.toString();
      }
      
      // Debug the ID format
      console.log(`🔍 ID #${index}: '${idString}' (type: ${typeof id}, length: ${idString?.length || 0})`);
      
      // Validate ID format for SQLite UUID
      if (idString && typeof idString === 'string' && idString.length === 36) {
        validatedIds.push(idString);
      } else {
        invalidIds.push(id);
        console.log(`   ❌ Invalid ID: '${idString}' - fails validation`);
      }
    });

    if (invalidIds.length > 0) {
      console.log(`⚠️ Found ${invalidIds.length} invalid IDs out of ${leadIds.length}`);
      console.log('⚠️ Sample invalid IDs:', invalidIds.slice(0, 5));
    }

    if (validatedIds.length === 0) {
      return res.status(400).json({ 
        message: 'No valid lead IDs provided',
        invalidCount: invalidIds.length,
        totalCount: leadIds.length,
        details: 'All provided IDs failed validation. IDs must be valid 36-character UUID strings.',
        invalidIds: invalidIds.slice(0, 10) // Return first 10 invalid IDs for debugging
      });
    }

    // Find all leads to get their details before deletion using Supabase
    const leads = await dbManager.query('leads', {
      select: 'id, name, status, date_booked, booker_id',
      in: { id: validatedIds },
      is: { deleted_at: null }
    });

    if (!leads) {
      console.error('❌ Bulk delete leads error: Database query failed');
      return res.status(500).json({ message: 'Server error' });
    }
    
    console.log(`🔍 Found ${leads.length} leads to delete out of ${validatedIds.length} requested`);
    
    if (leads.length === 0) {
      return res.status(404).json({ 
        message: 'No leads found with provided IDs',
        requestedIds: validatedIds,
        details: 'Leads may have already been deleted or do not exist'
      });
    }

    // Extract the IDs of leads that were actually found
    const foundLeadIds = leads.map(lead => lead.id);

    // Delete related sales first (cascade delete) using Supabase
    try {
      await dbManager.delete('sales', {
        in: { lead_id: foundLeadIds }
      });
      console.log(`🗑️ Deleted related sales for ${foundLeadIds.length} leads`);
    } catch (error) {
      console.error('Failed to delete related sales:', error);
      // Continue with lead deletion even if sales deletion fails
    }

    // Delete all found leads using Supabase
    try {
      await dbManager.delete('leads', {
        in: { id: foundLeadIds }
      });
      console.log(`🗑️ Successfully deleted ${foundLeadIds.length} leads`);
    } catch (deleteError) {
      console.error('❌ Bulk delete leads error: Database delete failed:', deleteError);
      return res.status(500).json({ message: 'Failed to delete leads', error: deleteError.message });
    }

    // Update user's leads assigned count for each deleted lead
    const bookerUpdates = {};
    leads.forEach(lead => {
      if (lead.booker_id) {
        const bookerId = lead.booker_id.toString();
        bookerUpdates[bookerId] = (bookerUpdates[bookerId] || 0) + 1;
      }
    });

    // Update booker counts using Supabase
    for (const bookerId of Object.keys(bookerUpdates)) {
      try {
        const user = await dbManager.query('users', {
          select: 'leads_assigned',
          eq: { id: bookerId }
        });
        
        if (user && user.length > 0) {
          const newCount = Math.max((user[0].leads_assigned || 0) - bookerUpdates[bookerId], 0);
          await dbManager.update('users', { leads_assigned: newCount }, { id: bookerId });
        }
      } catch (error) {
        console.error(`Failed to update booker count for ${bookerId}:`, error);
      }
    }

    // Emit real-time updates
    if (global.io) {
      foundLeadIds.forEach(leadId => {
        global.io.emit('lead_deleted', {
          leadId: leadId,
          action: 'bulk_delete',
          timestamp: new Date()
        });
      });

      // Emit sales deletion notifications
      global.io.emit('sales_deleted', {
        action: 'bulk_delete',
        deletedCount: foundLeadIds.length, // Assume sales were deleted for these leads
        leadIds: foundLeadIds,
        timestamp: new Date()
      });
      console.log(`📡 Emitted sales_deleted event for ${foundLeadIds.length} leads`);

      // Emit diary updates for any booked leads
      leads.forEach(lead => {
        if (lead.status === 'Booked' || lead.status === 'Attended') {
          global.io.emit('diary_updated', {
            type: 'DIARY_UPDATE',
            data: {
              leadId: lead.id,
              leadName: lead.name,
              oldStatus: lead.status,
              newStatus: 'Deleted',
              dateBooked: lead.date_booked,
              timestamp: new Date().toISOString(),
              updatedBy: req.user.name,
              updatedAt: new Date().toISOString()
            }
          });
        }
      });
    }

    const count = leads.length;

    const successMessage = `Successfully deleted ${count} leads`;
    console.log('✅ Bulk delete completed:', successMessage);
    
    res.json({ 
      message: successMessage,
      deletedCount: count,
      requestedCount: leadIds.length
    });
  } catch (error) {
    console.error('❌ Bulk delete leads error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   PUT /api/leads/bulk-assign
// @desc    Assign multiple leads to a user
// @access  Admin only
router.put('/bulk-assign', auth, adminAuth, async (req, res) => {
  try {
    console.log('👥 Bulk assign request received');

    const { leadIds, bookerId } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ message: 'No lead IDs provided' });
    }

    if (!bookerId) {
      return res.status(400).json({ message: 'No booker ID provided' });
    }

    // Create service role client to bypass RLS policies for admin operations
    const serviceRoleClient = createClient(
      process.env.SUPABASE_URL || 'https://tnltvfzltdeilanxhlvy.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
    );

    const { data: bookers, error: bookerError } = await serviceRoleClient
      .from('users')
      .select('id, name, role, is_active, leads_assigned')
      .eq('id', bookerId)
      .single();

    if (bookerError || !bookers) {
      console.error('Error fetching booker:', bookerError);
      return res.status(404).json({ message: 'Booker not found' });
    }

    const booker = bookers;
    if (!booker.is_active) {
      return res.status(400).json({ message: 'Booker is not active' });
    }

    // Get the leads to be assigned - use service role client
    const { data: leads, error: leadsError } = await serviceRoleClient
      .from('leads')
      .select('id, name, booker_id, status')
      .in('id', leadIds);

    if (leadsError || !leads || leads.length === 0) {
      console.error('Error fetching leads:', leadsError);
      return res.status(404).json({ message: 'No leads found' });
    }

    console.log(`📋 Found ${leads.length} leads to assign to ${booker.name}`);

    // Update leads with new booker_id and status - use service role client to bypass RLS
    const { error: updateError } = await serviceRoleClient
      .from('leads')
      .update({
        booker_id: bookerId,
        status: 'Assigned',
        updated_at: new Date().toISOString()
      })
      .in('id', leadIds);

    if (updateError) {
      console.error('Error updating leads:', updateError);
      return res.status(500).json({ message: 'Failed to assign leads', error: updateError.message });
    }

    // Update booker's leads_assigned count
    const currentCount = booker.leads_assigned || 0;
    const newCount = currentCount + leads.length;

    const { error: bookerUpdateError } = await serviceRoleClient
      .from('users')
      .update({ leads_assigned: newCount })
      .eq('id', bookerId);

    if (bookerUpdateError) {
      console.warn('Error updating booker count:', bookerUpdateError);
    }

    // Update previous bookers' counts (if any leads were reassigned)
    const previousBookerIds = [...new Set(leads.map(lead => lead.booker_id).filter(Boolean))];
    for (const prevBookerId of previousBookerIds) {
      if (prevBookerId !== bookerId) {
        try {
          const { data: prevBooker } = await serviceRoleClient
            .from('users')
            .select('leads_assigned')
            .eq('id', prevBookerId)
            .single();

          if (prevBooker) {
            const prevCount = prevBooker.leads_assigned || 0;
            const reassignedCount = leads.filter(lead => lead.booker_id === prevBookerId).length;
            const newPrevCount = Math.max(prevCount - reassignedCount, 0);

            await serviceRoleClient
              .from('users')
              .update({ leads_assigned: newPrevCount })
              .eq('id', prevBookerId);
          }
        } catch (error) {
          console.error(`Failed to update previous booker count for ${prevBookerId}:`, error);
        }
      }
    }

    // Add booking history entries for each lead
    for (const lead of leads) {
      await addBookingHistoryEntry(
        lead.id,
        'bulk_assign',
        req.user.id,
        req.user.name,
        {
          previousBooker: lead.booker_id,
          newBooker: bookerId,
          bookerName: booker.name
        },
        {
          name: lead.name,
          status: 'Assigned',
          booker_id: bookerId
        }
      );
    }

    // Emit real-time updates
    if (global.io) {
      leadIds.forEach(leadId => {
        global.io.emit('lead_updated', {
          leadId: leadId,
          action: 'bulk_assign',
          bookerId: bookerId,
          bookerName: booker.name,
          timestamp: new Date()
        });
      });
    }

    const successMessage = `Successfully assigned ${leads.length} leads to ${booker.name}`;
    console.log('✅ Bulk assign completed:', successMessage);

    res.json({
      message: successMessage,
      assignedCount: leads.length,
      bookerId: bookerId,
      bookerName: booker.name
    });
  } catch (error) {
    console.error('❌ Bulk assign leads error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// DUPLICATE CALENDAR ENDPOINT REMOVED - Using the first one above

// Helper function to get event color based on status
const getEventColor = (status, hasSale, isConfirmed) => {
  if (hasSale) return '#10b981'; // Green for sales
  if (isConfirmed) return '#8b5cf6'; // Purple for confirmed
  switch (status) {
    case 'Booked': return '#3b82f6'; // Blue
    case 'Attended': return '#10b981'; // Green
    case 'Cancelled': return '#ef4444'; // Red
    default: return '#6b7280'; // Gray
  }
};

// @route   GET /api/leads/:id/events
// @desc    Get calendar events for a specific lead
// @access  Private
router.get('/:id/events', auth, async (req, res) => {
  try {
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }

    // Get the lead using Supabase
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', req.params.id)
      .single();

    // If lead exists and has a booker, get the booker name
    if (lead && lead.booker_id) {
      const { data: user } = await supabase
        .from('users')
        .select('name')
        .eq('id', lead.booker_id)
        .single();

      if (user) {
        lead.booker_name = user.name;
      }
    }

    if (leadError || !lead) {
      console.error('Get lead events error:', leadError?.message || 'Lead not found');
      return res.status(404).json({ message: 'Lead not found' });
    }

    // ROLE-BASED ACCESS CONTROL for individual lead events
    if (req.user.role !== 'admin' && lead.booker_id !== req.user.id) {
      console.log(`🚫 Access denied: User ${req.user.name} (${req.user.role}) tried to access lead ${req.params.id} assigned to ${lead.booker_id}`);
      return res.status(403).json({ message: 'Access denied. You can only view leads assigned to you.' });
    }

    // Convert lead to calendar event format
    const events = [];
    
    if (lead.date_booked) {
      const eventDate = new Date(lead.date_booked);
      
      events.push({
        id: lead.id,
        title: `${lead.name} - ${lead.status}`,
        start: eventDate,
        end: new Date(eventDate.getTime() + 15 * 60 * 1000), // 15 minutes duration
        backgroundColor: lead.status === 'Attended' ? '#10b981' : '#3b82f6',
        borderColor: lead.status === 'Attended' ? '#059669' : '#2563eb',
        extendedProps: {
          leadId: lead.id,
          leadName: lead.name,
          phone: lead.phone,
          email: lead.email,
          postcode: lead.postcode,
          status: lead.status,
          notes: lead.notes,
          booker: lead.booker_name || 'Unassigned'
        }
      });
    }

    res.json({ events });
  } catch (error) {
    console.error('Get lead events error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/calendar-public
// @desc    Get leads for calendar view (public endpoint for dashboard)
// @access  Public (for dashboard stats)
router.get('/calendar-public', async (req, res) => {
  try {
    console.log(`📅 Public Calendar API: Fetching events`);

    const { start, end, limit = 200 } = req.query;
    const validatedLimit = Math.min(parseInt(limit) || 200, 500);

    console.log(`📅 Date range filter - Start: ${start || 'none'}, End: ${end || 'none'}, Limit: ${validatedLimit}`);

    let query = supabase
      .from('leads')
      .select(`
        id, name, phone, email, status, date_booked, booker_id,
        is_confirmed, booking_status, booking_history, has_sale,
        created_at, updated_at, postcode, notes, image_url
      `)
      .or('date_booked.not.is.null,status.eq.Booked')
      .is('deleted_at', null);

    if (start && end) {
      query = query
        .gte('date_booked', start)
        .lte('date_booked', end);
    }

    const { data: leads, error } = await query
      .order('date_booked', { ascending: true })
      .limit(validatedLimit);

    if (error) {
      console.error('Public calendar query error:', error);
      return res.status(400).json({ message: 'Database query failed', error: error.message });
    }

    console.log(`📅 Public Calendar API: Found ${leads?.length || 0} events`);

    const events = leads?.map(lead => {
      const date = new Date(lead.date_booked);
      return {
        id: lead.id,
        title: lead.name,
        start: lead.date_booked,
        extendedProps: {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          status: lead.status,
          date_booked: lead.date_booked,
          booker_id: lead.booker_id,
          time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        }
      };
    }) || [];

    res.json({ events });
  } catch (error) {
    console.error('Get public lead events error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/upload-analyze
// @desc    Upload and analyze CSV/Excel file for column mapping
// @access  Admin only
router.post('/upload-analyze', auth, adminAuth, upload.single('file'), async (req, res) => {
  try {
    console.log('📤 File analysis request received');
    console.log('📁 File:', req.file ? req.file.originalname : 'No file');
    
    if (!req.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    let leads = [];

    try {
      // Parse file to get column structure
      if (fileExtension === '.csv') {
        leads = await new Promise((resolve, reject) => {
          const results = [];
          fs.createReadStream(filePath)
            .pipe(csv({
              skipEmptyLines: true,
              skipLinesWithError: true
            }))
            .on('data', (data) => {
              if (Object.keys(data).length > 0) {
                results.push(data);
              }
            })
            .on('end', () => resolve(results))
            .on('error', (error) => {
              console.warn('CSV parsing warning:', error.message);
              resolve(results);
            });
        });
      } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
        try {
          const workbook = xlsx.readFile(filePath);
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          leads = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
        } catch (excelError) {
          console.warn('Excel parsing warning:', excelError.message);
          leads = [];
        }
      }

      console.log(`📊 Parsed ${leads.length} rows from file`);

      if (leads.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ 
          message: 'No data found in file',
          suggestions: [
            'Ensure your file is not empty',
            'Check that your file is saved in CSV or Excel format',
            'If using Excel, make sure data is in the first sheet',
            'Remove any password protection from the file'
          ]
        });
      }

      // Analyze columns and provide sample data
      const columns = Object.keys(leads[0] || {});
      const sampleData = leads.slice(0, 5); // First 5 rows as sample
      
      // Smart column detection
      const suggestedMapping = {};
      const columnStats = {};
      
      // Filter out empty columns and collect stats
      const columnsWithData = [];
      
      columns.forEach(column => {
        const normalizedCol = column.toLowerCase().trim();
        const values = leads.slice(0, Math.min(20, leads.length)).map(row => row[column]);
        
        // Collect stats about the column
        const hasData = values.some(v => v && v.toString().trim());
        columnStats[column] = {
          hasData: hasData,
          sampleValues: values.filter(v => v).slice(0, 3),
          dataType: detectDataType(values)
        };
        
        // Only include columns with data
        if (hasData) {
          columnsWithData.push(column);
          
          // Enhanced auto-detect mappings based on column names
          if (normalizedCol === 'name' || normalizedCol === 'full name' || normalizedCol === 'customer name' || normalizedCol === 'client name') {
            suggestedMapping.name = column;
          } else if (normalizedCol === 'phone' || normalizedCol === 'telephone' || normalizedCol === 'mobile' || normalizedCol === 'phone number') {
            suggestedMapping.phone = column;
          } else if (normalizedCol === 'email' || normalizedCol === 'e-mail' || normalizedCol === 'email address') {
            suggestedMapping.email = column;
          } else if (normalizedCol === 'age' || normalizedCol === 'dob' || normalizedCol.includes('birth')) {
            suggestedMapping.age = column;
          } else if (normalizedCol === 'postcode' || normalizedCol === 'postal code' || normalizedCol === 'zip' || normalizedCol === 'zipcode') {
            suggestedMapping.postcode = column;
          } else if (normalizedCol.includes('image') || normalizedCol.includes('photo') || normalizedCol.includes('pic')) {
            suggestedMapping.imageUrl = column;
          } else if (normalizedCol.includes('parent') && normalizedCol.includes('phone')) {
            suggestedMapping.parentPhone = column;
          }
          // Fallback patterns
          else if (normalizedCol.includes('name') && !normalizedCol.includes('parent') && !normalizedCol.includes('user') && !suggestedMapping.name) {
            suggestedMapping.name = column;
          } else if (normalizedCol.includes('phone') && !normalizedCol.includes('parent') && !suggestedMapping.phone) {
            suggestedMapping.phone = column;
          }
        }
      });
      
      // If no name column detected, try to find one with person names
      if (!suggestedMapping.name) {
        columnsWithData.forEach(column => {
          const values = leads.slice(0, 10).map(row => row[column]).filter(v => v);
          if (values.length > 0 && looksLikeNames(values)) {
            suggestedMapping.name = column;
          }
        });
      }
      
      // Check if this looks like a well-formatted file
      const requiredFieldsDetected = suggestedMapping.name && suggestedMapping.phone;
      const wellFormatted = requiredFieldsDetected && Object.keys(suggestedMapping).length >= 2;
      
      console.log(`📊 Analysis: ${columnsWithData.length} columns with data, ${Object.keys(suggestedMapping).length} auto-detected, well-formatted: ${wellFormatted}`);
      
      // Store file temporarily with unique identifier
      const tempId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const tempFilePath = path.join(path.dirname(filePath), `temp_${tempId}.json`);
      
      // Store parsed data temporarily
      fs.writeFileSync(tempFilePath, JSON.stringify(leads));
      
      // Clean up original uploaded file
      fs.unlinkSync(filePath);

      res.json({
        message: 'File analyzed successfully',
        tempId: tempId,
        columns: columnsWithData, // Only return columns with data
        allColumns: columns, // Keep original for reference
        sampleData: sampleData,
        totalRows: leads.length,
        fileName: req.file.originalname,
        suggestedMapping: suggestedMapping,
        columnStats: columnStats,
        wellFormatted: wellFormatted,
        skippedEmptyColumns: columns.length - columnsWithData.length
      });

    } catch (parseError) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      console.error('File parsing error:', parseError);
      res.status(400).json({ 
        message: 'Error parsing file',
        error: parseError.message
      });
    }

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Upload analysis error:', error);
    res.status(500).json({ 
      message: 'Server error during file analysis',
      error: error.message 
    });
  }
});

// @route   POST /api/leads/upload-process
// @desc    Process leads with column mapping
// @access  Admin only
router.post('/upload-process', auth, adminAuth, async (req, res) => {
  try {
    const { tempId, columnMapping } = req.body;
    
    if (!tempId || !columnMapping) {
      return res.status(400).json({ message: 'Missing tempId or columnMapping' });
    }

    // Find and load temporary file
    const tempFilePath = path.join(__dirname, '../uploads', `temp_${tempId}.json`);
    
    if (!fs.existsSync(tempFilePath)) {
      return res.status(400).json({ message: 'Temporary file not found or expired' });
    }

    const leads = JSON.parse(fs.readFileSync(tempFilePath, 'utf8'));
    
    // Process leads with column mapping
    const processedLeads = [];
    const errors = [];

    for (let i = 0; i < leads.length; i++) {
      const leadData = leads[i];
      const rowNumber = i + 1;

      try {
        // Map columns according to user selection
        const mappedData = {};
        
        Object.keys(columnMapping).forEach(fieldName => {
          const sourceColumn = columnMapping[fieldName];
          // Skip columns marked as 'skip' or empty
          if (sourceColumn && sourceColumn !== 'skip' && leadData[sourceColumn]) {
            mappedData[fieldName] = leadData[sourceColumn];
          }
        });

        // Validate required fields
        if (!mappedData.name && !mappedData.phone) {
          errors.push(`Row ${rowNumber}: Missing both name and phone`);
          continue;
        }

        // Create clean lead object - always as 'New' status to prevent diary updates
        // Map both imageUrl and image_url to image_url
        let finalImageUrl = '';
        if (mappedData.image_url) finalImageUrl = mappedData.image_url.toString().trim();
        else if (mappedData.imageUrl) finalImageUrl = mappedData.imageUrl.toString().trim();

        const cleanLead = {
          name: mappedData.name ? mappedData.name.toString().trim() : `Lead ${rowNumber}`,
          phone: mappedData.phone ? mappedData.phone.toString().trim() : '',
          email: mappedData.email ? mappedData.email.toString().trim() : '',
          postcode: mappedData.postcode ? mappedData.postcode.toString().trim() : '',
          image_url: finalImageUrl,
          parent_phone: mappedData.parent_phone ? mappedData.parent_phone.toString().trim() : '',
          status: 'New', // Always 'New' for uploads - diary should only be updated by registered users
          booker: null, // Never assign booker for uploaded leads
          date_booked: null, // Never set dateBooked for uploaded leads
        };
        
        // Only add age if it has a valid value
        if (mappedData.age) {
          const ageValue = parseInt(mappedData.age);
          if (!isNaN(ageValue)) {
            cleanLead.age = ageValue;
          }
        }

        processedLeads.push(cleanLead);

      } catch (rowError) {
        errors.push(`Row ${rowNumber}: ${rowError.message}`);
      }
    }

    console.log(`✅ Successfully processed ${processedLeads.length} leads`);
    console.log(`❌ Generated ${errors.length} errors`);

    if (processedLeads.length === 0) {
      fs.unlinkSync(tempFilePath);
      return res.status(400).json({ 
        message: 'No valid leads found after processing',
        errors: errors.slice(0, 10)
      });
    }

    // Get existing leads for duplicate detection
    const existingLeads = await dbManager.query('leads', {
      select: 'id, name, phone, email, postcode',
      is: { deleted_at: null }
    });

    if (!existingLeads) {
      console.error('Error fetching existing leads for duplicate detection');
      return res.status(500).json({ message: 'Server error' });
    }

    // Fetch legacy leads for duplicate checking
    console.log('📜 Fetching legacy leads for duplicate checking...');
    const legacyLeads = await fetchLegacyLeads();

    // Analyze leads for duplicates and distance
    console.log('🔍 Analyzing leads for duplicates and distance...');
    console.log(`📊 Found ${existingLeads.length} existing leads for duplicate detection`);
    console.log(`📜 Found ${legacyLeads.length} legacy leads for duplicate detection`);
    console.log(`📤 Processing ${processedLeads.length} uploaded leads`);

    // Debug: show sample of existing leads structure
    if (existingLeads.length > 0) {
      console.log('📋 Sample existing lead structure:', {
        id: existingLeads[0].id,
        hasPhone: !!existingLeads[0].phone,
        hasEmail: !!existingLeads[0].email,
        fields: Object.keys(existingLeads[0])
      });
    }

    const analysisResult = await analyseLeads(processedLeads, existingLeads, legacyLeads);

    // Clean up temporary file
    fs.unlinkSync(tempFilePath);

    res.json({
      message: 'Lead processing complete',
      analysis: analysisResult,
      processedLeads: processedLeads,
      summary: {
        totalRows: leads.length,
        validLeads: processedLeads.length,
        errors: errors.length
      },
      errors: errors.slice(0, 5)
    });

  } catch (error) {
    console.error('Upload processing error:', error);
    res.status(500).json({ 
      message: 'Server error during processing',
      error: error.message 
    });
  }
});

// @route   POST /api/leads/upload (Legacy - keep for backward compatibility)
// @desc    Upload leads from CSV/Excel file (Enhanced - more permissive)
// @access  Admin only
router.post('/upload', auth, adminAuth, (req, res, next) => {
  console.log('🔍 Upload request received:', {
    headers: req.headers,
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length']
  });
  
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('❌ Multer error:', err.message);
      console.error('❌ Multer error details:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File too large. Maximum size is 10MB.' });
      }
      if (err.message.includes('Invalid file type')) {
        return res.status(400).json({ message: 'Invalid file type. Please upload CSV or Excel files only.' });
      }
      return res.status(400).json({ message: err.message });
    }
    console.log('✅ Multer validation passed');
    next();
  });
}, async (req, res) => {
  try {
    console.log('📤 Enhanced upload request received');
    console.log('📁 File:', req.file ? req.file.originalname : 'No file');
    
    if (!req.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    let leads = [];

    try {
      // Improved file parsing with better header handling
      if (fileExtension === '.csv') {
        // Simple CSV parsing without external library
        const csvContent = fs.readFileSync(filePath, 'utf8');
        const lines = csvContent.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          throw new Error('CSV file must have at least a header row and one data row');
        }
        
        // Parse headers
        const headers = lines[0].split(',').map(h => h.trim());
        console.log('🔍 Headers found:', headers);
        
        // Parse data rows
        const results = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          if (values.length === 0 || values.every(v => !v)) continue; // Skip empty rows
          
          const rowData = {};
          headers.forEach((header, index) => {
            rowData[header] = values[index] || '';
          });
          
          console.log('🔍 Row data:', rowData);
          
          // Map headers to standard format
          const mappedData = {};
          Object.keys(rowData).forEach(key => {
            const value = rowData[key];
            const lowerKey = key.toLowerCase();
            
            console.log(`🔍 Mapping key "${key}" (${lowerKey}) to value:`, value);
            
            if (lowerKey.includes('name')) {
              mappedData.name = value;
            } else if (lowerKey === 'age') {
              mappedData.age = value;
            } else if (lowerKey.includes('email')) {
              mappedData.email = value;
            } else if (lowerKey.includes('phone') && !lowerKey.includes('parent')) {
              mappedData.phone = value;
            } else if (lowerKey.includes('postcode') || lowerKey.includes('postal') || lowerKey.includes('zip')) {
              mappedData.postcode = value;
            } else if (lowerKey.includes('image') && lowerKey.includes('url')) {
              mappedData.image_url = value;
            } else if (lowerKey.includes('parent') && lowerKey.includes('phone')) {
              mappedData.parent_phone = value;
            } else {
              // Keep original key if no mapping found
              mappedData[key] = value;
            }
          });
          
          console.log('🔍 Mapped data:', mappedData);
          results.push(mappedData);
        }
        
        leads = results;
      } else if (fileExtension === '.xlsx' || fileExtension === '.xls') {
        try {
          const workbook = xlsx.readFile(filePath);
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          leads = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
          
          // Filter out completely empty rows
          leads = leads.filter(lead => 
            Object.values(lead).some(val => val && val.toString().trim())
          );
        } catch (excelError) {
          console.warn('Excel parsing warning:', excelError.message);
          leads = []; // Continue with empty array if Excel fails
        }
      }

      console.log(`📊 Parsed ${leads.length} rows from file`);
      
      // Debug: Log first few rows to see what we're getting
      if (leads.length > 0) {
        console.log('🔍 First row data:', leads[0]);
        console.log('🔍 Column names:', Object.keys(leads[0]));
      }

      // Process and validate leads data with enhanced permissiveness
      const processedLeads = [];
      const errors = [];
      const warnings = [];

      for (let i = 0; i < leads.length; i++) {
        const leadData = leads[i];
        const rowNumber = i + 1;

        try {
          // Improved column mapping with better field detection
          const normalizedData = {};
          
          // Map data with more flexible matching
          Object.keys(leadData).forEach(key => {
            const value = leadData[key];
            if (!value || value.toString().trim() === '') return;
            
            const normalizedKey = key.toLowerCase().trim();
            
            // More permissive mapping with better field detection
            if (normalizedKey.includes('name') && !normalizedData.name) {
              normalizedData.name = value.toString().trim();
            } else if (normalizedKey.includes('age') && !normalizedData.age) {
              normalizedData.age = value.toString().trim();
            } else if (normalizedKey.includes('email') && !normalizedData.email) {
              normalizedData.email = value.toString().trim();
            } else if (normalizedKey.includes('phone') && !normalizedData.phone) {
              normalizedData.phone = value.toString().trim();
            } else if (normalizedKey.includes('postcode') || normalizedKey.includes('postal') || normalizedKey.includes('zip')) {
              normalizedData.postcode = value.toString().trim();
            } else if (normalizedKey.includes('image') && normalizedKey.includes('url')) {
              normalizedData.image_url = value.toString().trim();
            } else if (normalizedKey.includes('parent') && normalizedKey.includes('phone')) {
              normalizedData.parent_phone = value.toString().trim();
            }
          });

          // More lenient validation - only require name OR phone
          if (!normalizedData.name && !normalizedData.phone) {
            warnings.push(`Row ${rowNumber}: Missing both name and phone - skipping`);
            continue;
          }

          // Create clean lead object with proper field mapping
          const cleanLead = {
            name: normalizedData.name || `Lead ${rowNumber}`,
            phone: normalizedData.phone || '',
            email: normalizedData.email || '',
            postcode: normalizedData.postcode || '',
            image_url: normalizedData.image_url || '',
            parent_phone: normalizedData.parent_phone || '',
            status: 'New', // Always 'New' for uploads
            booker: null, // Never assign booker for uploaded leads
            date_booked: null, // Never set dateBooked for uploaded leads
          };
          
          // Only add age if it has a valid value
          if (normalizedData.age) {
            const ageValue = parseInt(normalizedData.age);
            if (!isNaN(ageValue) && ageValue > 0) {
              cleanLead.age = ageValue;
            }
          }

          // Only add leads with at least a name or phone
          if (cleanLead.name !== `Lead ${rowNumber}` || cleanLead.phone) {
            processedLeads.push(cleanLead);
          }

        } catch (rowError) {
          warnings.push(`Row ${rowNumber}: Processing error - ${rowError.message}`);
          continue; // Skip problematic rows instead of failing
        }
      }

      console.log(`✅ Successfully processed ${processedLeads.length} leads`);
      console.log(`⚠️ Generated ${warnings.length} warnings`);

      // Continue even if there are warnings, as long as we have some valid leads
      if (processedLeads.length === 0) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ 
          message: 'No valid leads found after processing', 
          warnings: warnings.slice(0, 10),
          info: 'Make sure your file contains columns with name or phone data'
        });
      }

      // Get existing leads for duplicate detection
      const existingLeads = await dbManager.query('leads', {
        select: 'id, name, phone, email, postcode',
        is: { deleted_at: null }
      });

      if (!existingLeads) {
        console.error('Error fetching existing leads for duplicate detection');
        return res.status(500).json({ message: 'Server error' });
      }

      // Fetch legacy leads for duplicate checking
      console.log('📜 Fetching legacy leads for duplicate checking...');
      const legacyLeads = await fetchLegacyLeads();

      // Analyze leads for duplicates and distance
      console.log('🔍 Analyzing leads for duplicates and distance...');
      console.log(`📊 Found ${existingLeads.length} existing leads for duplicate detection`);
      console.log(`📜 Found ${legacyLeads.length} legacy leads for duplicate detection`);
      console.log(`📤 Processing ${processedLeads.length} uploaded leads`);

      // Debug: show sample of existing leads structure
      if (existingLeads.length > 0) {
        console.log('📋 Sample existing lead structure:', {
          id: existingLeads[0].id,
          hasPhone: !!existingLeads[0].phone,
          hasEmail: !!existingLeads[0].email,
          fields: Object.keys(existingLeads[0])
        });
      }

      const analysisResult = await analyseLeads(processedLeads, existingLeads, legacyLeads);

      // Clean up uploaded file
      fs.unlinkSync(filePath);

      // Return analysis results with additional info about filtering
      res.json({
        message: 'Lead analysis complete (enhanced mode)',
        analysis: analysisResult,
        processedLeads: processedLeads,
        summary: {
          totalRows: leads.length,
          validLeads: processedLeads.length,
          warnings: warnings.length
        },
        warnings: warnings.slice(0, 5) // Include first 5 warnings for reference
      });

    } catch (parseError) {
      // Clean up uploaded file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      console.error('File parsing error:', parseError);
      
      // More informative error message
      res.status(400).json({ 
        message: 'File processing completed with issues. Some data may have been recovered.',
        error: parseError.message,
        suggestion: 'The upload is more permissive now - try uploading anyway, as partial data might be usable.'
      });
    }

  } catch (error) {
    // Clean up uploaded file
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error('Upload error:', error);
    res.status(500).json({ 
      message: 'Server error during upload',
      error: error.message 
    });
  }
});

// @route   POST /api/leads/bulk-create
// @desc    Bulk create leads after analysis approval
// @access  Admin only
router.post('/bulk-create', auth, adminAuth, async (req, res) => {
  try {
    const { leads } = req.body;
    
    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ message: 'No leads provided' });
    }

    console.log(`🔄 Starting bulk import of ${leads.length} leads by user ${req.user.id}`);
    
    let importedCount = 0;
    let duplicateCount = 0;
    const importErrors = [];
    const importedLeads = [];

    for (let leadData of leads) {
      // Map both imageUrl and image_url to image_url
      if (leadData.imageUrl && !leadData.image_url) {
        leadData.image_url = leadData.imageUrl;
      }
      if (leadData.image_url && leadData.imageUrl) {
        delete leadData.imageUrl;
      }
      try {
        // Enhanced duplicate check: phone, email, and name+phone combinations
        const duplicateChecks = [];
        
        // Check phone duplicates
        if (leadData.phone) {
          const phoneDuplicates = await dbManager.query('leads', {
            select: 'id, name, phone',
            eq: { phone: leadData.phone },
            is: { deleted_at: null }
          });
          if (phoneDuplicates && phoneDuplicates.length > 0) {
            duplicateChecks.push(`Phone: ${leadData.phone} matches existing lead ${phoneDuplicates[0].name}`);
          }
        }
        
        // Check email duplicates
        if (leadData.email) {
          const emailDuplicates = await dbManager.query('leads', {
            select: 'id, name, email',
            eq: { email: leadData.email },
            is: { deleted_at: null }
          });
          if (emailDuplicates && emailDuplicates.length > 0) {
            duplicateChecks.push(`Email: ${leadData.email} matches existing lead ${emailDuplicates[0].name}`);
          }
        }
        
        // Check name+phone combination duplicates
        if (leadData.name && leadData.phone) {
          const namePhoneDuplicates = await dbManager.query('leads', {
            select: 'id, name, phone',
            eq: { name: leadData.name, phone: leadData.phone },
            is: { deleted_at: null }
          });
          if (namePhoneDuplicates && namePhoneDuplicates.length > 0) {
            duplicateChecks.push(`Name+Phone: ${leadData.name} + ${leadData.phone} already exists`);
          }
        }

        if (duplicateChecks.length > 0) {
          duplicateCount++;
          importErrors.push(`Duplicate found for ${leadData.name}: ${duplicateChecks.join(', ')}`);
          console.log(`❌ Duplicate skipped: ${leadData.name} - ${duplicateChecks.join(', ')}`);
          continue;
        }

        // Prepare lead data with proper ID and booker assignment
        const leadToInsert = {
          id: uuidv4(),
          name: leadData.name,
          phone: leadData.phone,
          email: leadData.email,
          postcode: leadData.postcode,
          image_url: leadData.image_url,
          parent_phone: leadData.parent_phone,
          age: leadData.age,
          booker_id: null, // Never assign booker for uploaded leads
          status: 'New', // Always create uploaded leads as 'New'
          date_booked: null, // Never set dateBooked for uploaded leads
          is_confirmed: 0, // Convert boolean to integer for database compatibility
          booking_status: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        // If retargeting is present and is an object, stringify it
        if (leadToInsert.retargeting && typeof leadToInsert.retargeting === 'object') {
          leadToInsert.retargeting = JSON.stringify(leadToInsert.retargeting);
        }
        
        // Insert the lead using Supabase
        await dbManager.insert('leads', leadToInsert);
        
        importedLeads.push(leadToInsert);
        importedCount++;
        console.log(`✅ Imported: ${leadToInsert.name} (${leadToInsert.phone})`);

        // Update user's leads assigned count
        const users = await dbManager.query('users', {
          select: 'leads_assigned',
          eq: { id: req.user.id }
        });
        
        if (users && users.length > 0) {
          await dbManager.update('users', req.user.id, {
            leads_assigned: (users[0].leads_assigned || 0) + 1
          });
        }
      } catch (error) {
        importErrors.push(`Failed to import ${leadData.name}: ${error.message}`);
      }
    }

    // Emit real-time update
    if (global.io && importedCount > 0) {
      global.io.emit('leads_bulk_imported', {
        count: importedCount,
        action: 'bulk_import',
        timestamp: new Date()
      });
      
      global.io.emit('stats_update_needed', {
        type: 'bulk_import',
        timestamp: new Date()
      });
    }
    
    console.log(`📊 Bulk import completed: ${importedCount} imported, ${duplicateCount} duplicates skipped, ${importErrors.length} errors`);
    
    res.json({
      message: `Successfully imported ${importedCount} leads${duplicateCount > 0 ? `, ${duplicateCount} duplicates skipped` : ''}`,
      imported: importedCount,
      duplicates: duplicateCount,
      total: leads.length,
      errors: importErrors.length > 0 ? importErrors.slice(0, 10) : undefined,
      leads: importedLeads
    });

  } catch (error) {
    console.error('Bulk create error:', error);
    res.status(500).json({ message: 'Server error during bulk create: ' + error.message });
  }
});

// @route   PATCH /api/leads/:id/notes
// @desc    Update lead notes - ALL USERS CAN EDIT NOTES
// @access  Private (all authenticated users can update notes)
router.patch('/:id/notes', auth, async (req, res) => {
  try {
    const { notes, oldNotes } = req.body;
    
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }

    console.log(`📝 Notes update requested by ${req.user.name} (${req.user.role}) for lead ${req.params.id}`);

    // Get the lead
    const leads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id },
      is: { deleted_at: null }
    });

    if (!leads || leads.length === 0) {
      console.error('Update notes error: Lead not found or deleted');
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = leads[0];

    // ALL USERS CAN EDIT NOTES - NO ACCESS RESTRICTIONS
    console.log(`✅ Access granted: ${req.user.name} can edit notes for lead ${lead.name}`);

    // Store old notes for history comparison
    const previousNotes = lead.notes || '';
    const newNotes = notes || '';

    // Update notes
    await dbManager.update('leads', {
      notes: newNotes,
      updated_at: new Date().toISOString()
    }, { id: req.params.id });

    // Get updated lead
    const updatedLeads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });
    const updatedLead = updatedLeads[0];

    // Add to booking history with detailed information
    await addBookingHistoryEntry(
      req.params.id,
      'NOTES_UPDATED',
      req.user.id,
      req.user.name,
      {
        oldNotes: previousNotes,
        newNotes: newNotes,
        updatedBy: req.user.name,
        timestamp: new Date().toISOString(),
        changeType: previousNotes ? 'modified' : 'added',
        characterCount: newNotes.length
      },
      createLeadSnapshot(updatedLead)
    );


    // Emit real-time update
    if (global.io) {
      // Emit both events for compatibility
      global.io.emit('lead_updated', {
        leadId: req.params.id,
        action: 'notes_updated',
        updatedBy: req.user.name,
        timestamp: new Date(),
        notes: newNotes
      });
      
      // Also emit specific notes_updated event
      global.io.emit('notes_updated', {
        leadId: req.params.id,
        updatedBy: req.user.name,
        timestamp: new Date(),
        notes: newNotes,
        leadName: lead.name
      });
    }

    console.log(`✅ Notes updated successfully by ${req.user.name} for lead ${lead.name}`);

    res.json({ 
      message: 'Notes updated successfully',
      lead: updatedLead,
      updatedBy: req.user.name,
      timestamp: new Date()
    });

  } catch (error) {
    console.error('Update notes error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/:id/tags
// @desc    Get tags for a lead
// @access  Private
router.get('/:id/tags', auth, async (req, res) => {
  try {
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }

    // Get the lead with booker info using Supabase
    const lead = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });

    if (!lead || lead.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const leadData = lead[0];
    
    // Get booker info if booker_id exists
    let bookerInfo = null;
    if (leadData.booker_id) {
      const booker = await dbManager.query('users', {
        select: 'name, email',
        eq: { id: leadData.booker_id }
      });
      if (booker && booker.length > 0) {
        bookerInfo = booker[0];
      }
    }

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin' && lead.booker !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only view leads assigned to you.' });
    }

    // Parse tags from JSON string
    let tags = [];
    try {
      tags = leadData.tags ? JSON.parse(leadData.tags) : [];
    } catch (e) {
      console.error('Error parsing tags:', e);
      tags = [];
    }

    res.json({ tags });
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/leads/:id/tags
// @desc    Update tags for a lead
// @access  Private
router.put('/:id/tags', auth, async (req, res) => {
  try {
    const { tags } = req.body;
    
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }

    if (!Array.isArray(tags)) {
      return res.status(400).json({ message: 'Tags must be an array' });
    }

    // Get the lead for access control using Supabase
    const lead = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });

    if (!lead || lead.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const leadData = lead[0];

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin' && leadData.booker_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only modify leads assigned to you.' });
    }

    // Remove duplicates and validate tags
    const uniqueTags = [...new Set(tags)].filter(tag => 
      typeof tag === 'string' && tag.trim().length > 0
    );

    // Update tags using Supabase
    const tagsJson = JSON.stringify(uniqueTags);
    const updateResult = await dbManager.update('leads', {
      eq: { id: req.params.id },
      data: { tags: tagsJson }
    });

    if (!updateResult || updateResult.length === 0) {
      return res.status(500).json({ message: 'Failed to update tags' });
    }

    // Get updated lead
    const updatedLead = updateResult[0];

    // Add to booking history
    await addBookingHistoryEntry(
      req.params.id,
      'TAGS_UPDATE',
      req.user.id,
      req.user.name,
      {
        tags: uniqueTags,
        updatedBy: req.user.name,
        timestamp: new Date()
      },
      createLeadSnapshot(updatedLead)
    );


    // Emit real-time update
    if (global.io) {
      global.io.emit('lead_updated', {
        leadId: req.params.id,
        action: 'tags_updated',
        updatedBy: req.user.name,
        tags: uniqueTags,
        timestamp: new Date()
      });
    }

    res.json({ 
      message: 'Tags updated successfully',
      tags: uniqueTags,
      lead: updatedLead
    });

  } catch (error) {
    console.error('Update tags error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/tags
// @desc    Add a single tag to a lead
// @access  Private
router.post('/:id/tags', auth, async (req, res) => {
  try {
    const { tag } = req.body;
    
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }

    if (!tag || typeof tag !== 'string' || tag.trim().length === 0) {
      return res.status(400).json({ message: 'Valid tag is required' });
    }

    // Get the lead with current tags
    const leads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });

    if (!leads || leads.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = leads[0];

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin' && lead.booker_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only modify leads assigned to you.' });
    }

    // Parse current tags
    let currentTags = [];
    try {
      currentTags = lead.tags ? JSON.parse(lead.tags) : [];
    } catch (e) {
      console.error('Error parsing current tags:', e);
      currentTags = [];
    }

    // Add new tag if not already present
    const newTag = tag.trim();
    if (!currentTags.includes(newTag)) {
      currentTags.push(newTag);
    }

    // Update tags
    const tagsJson = JSON.stringify(currentTags);
    await dbManager.update('leads', req.params.id, { tags: tagsJson });

    // Get updated lead
    const updatedLeads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });
    const updatedLead = updatedLeads[0];

    // Add to booking history
    await addBookingHistoryEntry(
      req.params.id,
      'TAG_ADDED',
      req.user.id,
      req.user.name,
      {
        tag: newTag,
        updatedBy: req.user.name,
        timestamp: new Date()
      },
      createLeadSnapshot(updatedLead)
    );


    // Emit real-time update
    if (global.io) {
      global.io.emit('lead_updated', {
        leadId: req.params.id,
        action: 'tag_added',
        updatedBy: req.user.name,
        tag: newTag,
        timestamp: new Date()
      });
    }

    res.json({ 
      message: 'Tag added successfully',
      tags: currentTags,
      addedTag: newTag,
      lead: updatedLead
    });

  } catch (error) {
    console.error('Add tag error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/leads/:id/tags/:tag
// @desc    Remove a specific tag from a lead
// @access  Private
router.delete('/:id/tags/:tag', auth, async (req, res) => {
  try {
    const { tag } = req.params;
    
    if (!req.params.id) {
      return res.status(400).json({ message: 'Invalid lead ID format' });
    }

    if (!tag) {
      return res.status(400).json({ message: 'Tag is required' });
    }

    // Get the lead with current tags
    const leads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });

    if (!leads || leads.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = leads[0];

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin' && lead.booker_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only modify leads assigned to you.' });
    }

    // Parse current tags
    let currentTags = [];
    try {
      currentTags = lead.tags ? JSON.parse(lead.tags) : [];
    } catch (e) {
      console.error('Error parsing current tags:', e);
      currentTags = [];
    }

    // Remove the tag
    const updatedTags = currentTags.filter(t => t !== tag);

    // Update tags
    const tagsJson = JSON.stringify(updatedTags);
    await dbManager.update('leads', req.params.id, { tags: tagsJson });

    // Get updated lead
    const updatedLeads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });
    const updatedLead = updatedLeads[0];

    // Add to booking history
    await addBookingHistoryEntry(
      req.params.id,
      'TAG_REMOVED',
      req.user.id,
      req.user.name,
      {
        tag: tag,
        updatedBy: req.user.name,
        timestamp: new Date()
      },
      createLeadSnapshot(updatedLead)
    );


    // Emit real-time update
    if (global.io) {
      global.io.emit('lead_updated', {
        leadId: req.params.id,
        action: 'tag_removed',
        updatedBy: req.user.name,
        tag: tag,
        timestamp: new Date()
      });
    }

    res.json({ 
      message: 'Tag removed successfully',
      tags: updatedTags,
      removedTag: tag,
      lead: updatedLead
    });

  } catch (error) {
    console.error('Remove tag error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PATCH /api/leads/:id/reject
// @desc    Reject a lead with a reason
// @access  Private (Admin and Booker only)
router.patch('/:id/reject', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!req.params.id || !reason) {
      return res.status(400).json({ message: 'Invalid lead ID or reason' });
    }

    // ROLE-BASED ACCESS CONTROL
    if (req.user.role !== 'admin' && req.user.role !== 'booker') {
      return res.status(403).json({ message: 'Access denied. Only admins and bookers can reject leads.' });
    }

    // Get the lead first to check if it exists and for history tracking
    const leads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id },
      is: { deleted_at: null }
    });
    
    if (!leads || leads.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = leads[0];

    // Check if user has permission to reject this lead (admin can reject any, booker can only reject their own)
    if (req.user.role !== 'admin' && lead.booker_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only reject leads assigned to you.' });
    }

    const now = new Date().toISOString();
    
    // Update the lead status
    await dbManager.update('leads', req.params.id, {
      status: 'Rejected',
      reject_reason: reason,
      rejected_at: now,
      date_booked: null
    });
    
    const updatedLeads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });
    const updatedLead = updatedLeads[0];
    
    // Add booking history entry for rejection
    try {
      await addBookingHistoryEntry(
        req.params.id,
        'LEAD_REJECTED',
        req.user.id,
        req.user.name,
        {
          reason: reason,
          previousStatus: lead.status,
          previousDateBooked: lead.date_booked
        },
        createLeadSnapshot(updatedLead)
      );
    } catch (historyError) {
      console.error('Failed to add rejection history entry:', historyError);
      // Don't fail the request if history tracking fails
    }


    // Emit real-time update
    if (global.io) {
      global.io.emit('lead_updated', {
        leadId: req.params.id,
        action: 'rejected',
        timestamp: new Date()
      });
      global.io.emit('calendar_update_needed', {
        type: 'lead_rejected',
        leadId: req.params.id
      });
    }

    res.json({ success: true, lead: updatedLead });
  } catch (error) {
    console.error('Reject lead error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/send-sms
// @desc    Send SMS to a lead
// @access  Private
router.post('/:id/send-sms', auth, async (req, res) => {
  try {
    const { message, type } = req.body;
    if (!req.params.id || !message) {
      return res.status(400).json({ message: 'Invalid lead ID or message' });
    }

    const leads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });

    if (!leads || leads.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = leads[0];

    // Check if lead has a phone number
    if (!lead.phone) {
      return res.status(400).json({ message: 'Lead does not have a phone number' });
    }

    let smsResult;
    switch (type) {
      case 'booking_confirmation':
        smsResult = await MessagingService.sendBookingConfirmation(lead.id, req.user.id, message, { sendEmail: false, sendSms: true });
        break;
      case 'appointment_reminder':
        smsResult = await sendAppointmentReminder(lead, message);
        break;
      case 'status_update':
        smsResult = await sendStatusUpdate(lead, message);
        break;
      case 'custom':
      default:
        smsResult = await sendCustomMessage(lead.phone, message);
        break;
    }

    if (smsResult.success) {
      // Add to booking history with provider status and ID
      await addBookingHistoryEntry(
        req.params.id,
        'SMS_SENT',
        req.user.id,
        req.user.name,
        {
          message: message,
          type: type,
          phone: lead.phone,
          status: (smsResult.status || 'submitted'),
          provider: 'bulksms',
          messageId: smsResult.messageId || null,
          timestamp: new Date()
        },
        createLeadSnapshot(lead)
      );

        // Mark all received messages as read when user replies
        await markAllReceivedMessagesAsRead(req.params.id);
        
        // Emit socket event to update calendar notifications
        if (req.io) {
          req.io.emit('lead_updated', { 
            leadId: req.params.id,
            type: 'messages_read'
          });
        }

      res.json({ 
        success: true, 
        message: 'SMS sent successfully',
        sid: smsResult.sid
      });
    } else {
      // Record a failed attempt for visibility in conversation
      try {
        await addBookingHistoryEntry(
          req.params.id,
          'SMS_FAILED',
          req.user.id,
          req.user.name,
          {
            message: message,
            type: type,
            phone: lead.phone,
            status: 'failed',
            error_message: smsResult.error || 'Unknown error',
            timestamp: new Date()
          },
          createLeadSnapshot(lead)
        );
      } catch {}
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send SMS',
        error: smsResult.error
      });
    }

  } catch (error) {
    console.error('Send SMS error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/send-booking-confirmation
// @desc    Send booking confirmation SMS
// @access  Private
router.post('/:id/send-booking-confirmation', auth, async (req, res) => {
  try {
    const { appointmentDate } = req.body;
    if (!req.params.id || !appointmentDate) {
      return res.status(400).json({ message: 'Invalid lead ID or appointment date' });
    }

    const leads = await dbManager.query('leads', {
      select: '*',
      eq: { id: req.params.id }
    });

    if (!leads || leads.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const lead = leads[0];

    if (!lead.phone) {
      return res.status(400).json({ message: 'Lead does not have a phone number' });
    }

    const smsResult = await MessagingService.sendBookingConfirmation(lead.id, req.user.id, appointmentDate, { sendEmail: false, sendSms: true });

    if (smsResult.success) {
      // Add to booking history
      await addBookingHistoryEntry(
        req.params.id,
        'BOOKING_CONFIRMATION_SENT',
        req.user.id,
        req.user.name,
        {
          appointmentDate: appointmentDate,
          phone: lead.phone,
          timestamp: new Date()
        },
        createLeadSnapshot(lead)
      );

      res.json({ 
        success: true, 
        message: 'Booking confirmation SMS sent successfully',
        provider: smsResult.provider || 'bulksms',
        messageId: smsResult.messageId || null,
        status: smsResult.status || 'submitted'
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send booking confirmation SMS',
        error: smsResult.error
      });
    }

  } catch (error) {
    console.error('Send booking confirmation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/send-email
// @desc    Send an email to a lead
// @access  Private
router.post('/:id/send-email', auth, async (req, res) => {
  try {
    const leadId = req.params.id;
    const { subject, body, templateId } = req.body;
    if (!leadId || !subject || !body) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    const leads = await dbManager.query('leads', {
      select: '*',
      eq: { id: leadId }
    });
    
    if (!leads || leads.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    const lead = leads[0];
    
    // Optionally fetch template if templateId provided (for logging/template tracking)
    let template = null;
    if (templateId) {
      const templates = await dbManager.query('templates', {
        select: '*',
        eq: { id: templateId }
      });
      template = templates[0] || null;
    }
    // Insert message into database first to get an ID
    const messageData = {
      id: uuidv4(),
      lead_id: lead.id,
      template_id: templateId || null,
      type: 'email',
      subject: subject,
      email_body: body,
      recipient_email: lead.email,
      recipient_phone: lead.phone,
      sent_by: req.user.id,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    
    await dbManager.insert('messages', messageData);

    // Construct message object for MessagingService with database ID
    const message = {
      id: messageData.id,
      recipient_email: lead.email,
      recipient_name: lead.name,
      subject: subject,
      email_body: body,
      lead_id: lead.id,
      template_id: templateId || null,
      type: 'email',
      sent_by: req.user.id,
      sent_by_name: req.user.name,
      status: 'pending',
      created_at: new Date().toISOString(),
      channel: 'email',
    };
    
    // Send email using MessagingService
    const result = await MessagingService.sendEmail(message);
    
    // Add EMAIL_SENT to booking history
    await addBookingHistoryEntry(
      lead.id,
      'EMAIL_SENT',
      req.user.id,
      req.user.name,
      {
        subject: subject,
        body: body,
        direction: 'sent',
        channel: 'email',
        status: result ? 'sent' : 'failed',
        recipient: lead.email
      }
    );
    
    if (result) {
      return res.json({ success: true, message: 'Email sent successfully' });
    } else {
      return res.status(500).json({ success: false, message: 'Failed to send email' });
    }
  } catch (error) {
    console.error('Error sending email to lead:', error);
    return res.status(500).json({ message: 'Server error: ' + error.message });
  }
});

// Quick Status Update endpoint for the UI buttons
router.patch('/:id/quick-status', auth, async (req, res) => {
  try {
    const { statusButton } = req.body;
    const leadId = req.params.id;
    
    if (!statusButton) {
      return res.status(400).json({ message: 'Status button is required' });
    }

    // Status mappings for Quick Status Update buttons
    const statusMappings = {
      'Confirm': {
        status: 'Booked',
        is_confirmed: true,
        description: 'Confirm appointment'
      },
      'Unconfirmed': {
        status: 'Booked', 
        is_confirmed: false,
        description: 'Book but keep unconfirmed'
      },
      'Arrived': {
        status: 'Attended',
        is_confirmed: true,
        description: 'Customer has arrived'
      },
      'Left': {
        status: 'Attended',
        is_confirmed: true,
        description: 'Customer has left after appointment'
      },
      'No Sale': {
        status: 'Attended',
        is_confirmed: true,
        has_sale: 0,
        description: 'Attended but no sale made'
      },
      'No Show': {
        status: 'No Show',
        is_confirmed: false,
        description: 'Customer did not show up'
      },
      'Cancel': {
        status: 'Cancelled',
        is_confirmed: false,
        date_booked: null,
        description: 'Cancel appointment'
      },
      'Complete': {
        status: 'Attended',
        is_confirmed: true,
        has_sale: 1,
        description: 'Appointment completed with sale'
      },
      'Reject Lead': {
        status: 'Rejected',
        is_confirmed: false,
        date_booked: null,
        description: 'Reject this lead'
      }
    };

    // Get the lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (leadError || !lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    if (req.user.role !== 'admin' && req.user.role !== 'viewer') {
      if (req.user.role === 'booker' && lead.booker_id !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Get status mapping
    const statusMapping = statusMappings[statusButton];
    if (!statusMapping) {
      return res.status(400).json({ message: 'Invalid status button' });
    }

    const oldStatus = lead.status;
    const updateData = {
      status: statusMapping.status,
      is_confirmed: statusMapping.is_confirmed,
      updated_at: new Date().toISOString()
    };

    // Handle special cases
    if (statusMapping.has_sale !== undefined) {
      updateData.has_sale = statusMapping.has_sale;
    }
    if (statusMapping.date_booked !== undefined) {
      updateData.date_booked = statusMapping.date_booked;
    }

    // Update the lead
    const { data: updatedLead, error: updateError } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', leadId)
      .select()
      .single();

    if (updateError) {
      console.error('Quick status update error:', updateError);
      return res.status(500).json({ message: 'Failed to update lead' });
    }

    // Add to booking history
    await addBookingHistoryEntry(
      leadId,
      'QUICK_STATUS_UPDATE',
      req.user.id,
      req.user.name,
      {
        oldStatus: oldStatus,
        newStatus: statusMapping.status,
        buttonPressed: statusButton,
        description: statusMapping.description
      },
      createLeadSnapshot(updatedLead)
    );

    // Update user statistics if status changed
    if (oldStatus !== statusMapping.status && updatedLead.booker_id) {
      await updateUserStatistics(updatedLead.booker_id, {
        from: oldStatus,
        to: statusMapping.status
      });
    }

    // Emit real-time update
    if (global.io) {
      global.io.emit('lead_updated', {
        lead: updatedLead,
        action: 'quick_status_update',
        statusChange: {
          from: oldStatus,
          to: statusMapping.status,
          button: statusButton
        },
        timestamp: new Date()
      });
      
      // Emit calendar update
      global.io.emit('calendar_sync_needed', {
        type: 'status_updated',
        leadId: leadId,
        newStatus: statusMapping.status,
        timestamp: new Date()
      });

      // Emit diary update for calendar
      global.io.emit('diary_updated', {
        type: 'DIARY_UPDATED',
        data: {
          leadId: leadId,
          leadName: updatedLead.name,
          oldStatus: oldStatus,
          newStatus: statusMapping.status,
          dateBooked: updatedLead.date_booked,
          timestamp: new Date().toISOString(),
          updatedBy: req.user.name,
          updatedAt: new Date().toISOString()
        }
      });
    }

    console.log(`📅 Quick Status Update: ${updatedLead.name} - ${oldStatus} → ${statusMapping.status} (${statusButton})`);

    res.json({
      message: 'Status updated successfully',
      lead: updatedLead,
      statusChange: {
        from: oldStatus,
        to: statusMapping.status,
        button: statusButton
      }
    });

  } catch (error) {
    console.error('Quick status update error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/public
// @desc    Get leads for dashboard (temporary fix for authentication issue)
// @access  Public (temporary)
router.get('/public', async (req, res) => {
  try {
    const { date_booked_start, date_booked_end, limit } = req.query;

    console.log('📊 PUBLIC LEADS API: Dashboard requesting lead details');
    console.log(`📅 Date range: ${date_booked_start} to ${date_booked_end}`);

    let queryOptions = {
      select: '*'
    };

    // Apply date filters - support both date_booked and created_at
    if (date_booked_start && date_booked_end) {
      queryOptions.gte = { date_booked: date_booked_start };
      queryOptions.lte = { date_booked: date_booked_end };
    }

    // Support created_at filtering for daily activity dashboard
    const { created_at_start, created_at_end, updated_at_start, updated_at_end } = req.query;
    if (created_at_start && created_at_end) {
      queryOptions.gte = { created_at: created_at_start };
      queryOptions.lte = { created_at: created_at_end };
      console.log(`📅 Public leads filtering by creation date: ${created_at_start} to ${created_at_end}`);
    }

    // Support updated_at filtering for booking activity (when bookings were MADE)
    if (updated_at_start && updated_at_end) {
      queryOptions.gte = { updated_at: updated_at_start };
      queryOptions.lte = { updated_at: updated_at_end };
      console.log(`📅 Public leads filtering by updated date (bookings made): ${updated_at_start} to ${updated_at_end}`);
    }

    // Apply limit
    if (limit) {
      queryOptions.limit = parseInt(limit);
    }

    const leads = await dbManager.query('leads', queryOptions);

    console.log(`📊 PUBLIC LEADS RESULT: Found ${leads.length} leads`);
    res.json({ leads });

  } catch (error) {
    console.error('❌ Public leads error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 
