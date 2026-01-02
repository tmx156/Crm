import React, { useState, useEffect, useRef, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {
  FiCalendar, FiClock, FiMapPin, FiUser, FiX, FiPhone, FiMail,
  FiFileText, FiWifi, FiActivity, FiCheckCircle,
  FiExternalLink, FiCheck, FiSettings, FiEdit, FiMessageSquare,
  FiChevronDown, FiChevronUp, FiChevronLeft, FiChevronRight, FiSearch, FiDownload
} from 'react-icons/fi';
import axios from 'axios';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import SaleModal from '../components/SaleModal';
import ImageLightbox from '../components/ImageLightbox';
import LazyImage from '../components/LazyImage';
import { getOptimizedImageUrl } from '../utils/imageUtils';

const Calendar = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showAllMessages, setShowAllMessages] = useState(false);
  // Toggle to expand additional quick status actions
  const [showMoreStatuses, setShowMoreStatuses] = useState(false);
  
  // PERFORMANCE: Cache for loaded date ranges - Track which date ranges have been loaded
  const [loadedRanges, setLoadedRanges] = useState(new Set());

  const [showLeadFormModal, setShowLeadFormModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const calendarRef = useRef(null);
  const { socket, subscribeToCalendarUpdates, subscribeToLeadUpdates, isConnected, emitCalendarUpdate } = useSocket();
  const [leadForm, setLeadForm] = useState({
    _id: '',
    name: '',
    phone: '',
    email: '',
    postcode: '',
    status: 'New',
    notes: '',
    image_url: '',
    isReschedule: false
  });
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [selectedSale, setSelectedSale] = useState(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [bookingTemplates, setBookingTemplates] = useState([]);
  const [updatingNotes, setUpdatingNotes] = useState(false);
  const [isBookingInProgress, setIsBookingInProgress] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentView, setCurrentView] = useState('dayGridMonth');
  const [currentDate, setCurrentDate] = useState(new Date());

  // Reject lead modal state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('Duplicate');
  const [rejecting, setRejecting] = useState(false);
  
  // Image lightbox state
  const [lightboxImage, setLightboxImage] = useState(null);

  // Memoize fetchEvents to prevent unnecessary re-renders
  const [isFetching, setIsFetching] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState(0);
  const fetchTimeoutRef = useRef(null);
  
  const getEventColor = useCallback((status, hasSale, isConfirmed = false) => {
    // Special case: If lead has a sale and status is 'Attended', show as blue (Complete)
    if (hasSale && status?.toLowerCase() === 'attended') {
      return '#3b82f6'; // blue-500 for complete status
    }
    
    if (hasSale) return '#2563eb'; // professional blue for leads with a sale
    switch (status?.toLowerCase()) {
      case 'new':
        return '#ea580c'; // professional orange
      case 'unconfirmed':
        return '#f97316'; // orange-500 to match quick status button
      case 'confirmed':
        return '#10b981'; // emerald-500 to match quick status button
      case 'unassigned':
        return '#6b7280'; // gray for unassigned booked leads
      case 'booked':
        return '#1e40af'; // professional blue for booked leads
      case 'arrived':
        return '#e06666'; // red to match quick status button
      case 'left':
        return '#000000'; // black to match quick status button
      case 'on show':
        return '#d97706'; // professional amber
      case 'no sale':
        return '#dc2626'; // red-600 to match quick status button
      case 'attended':
        return '#3b82f6'; // blue-500 for attended status
      case 'complete':
        return '#3b82f6'; // blue-500 for complete status
      case 'cancelled':
        return '#f43f5e'; // rose-500 to match quick status button
      case 'no show':
        return '#f59e0b'; // amber-500 to match quick status button
      case 'assigned':
        return '#7c3aed'; // professional purple
      case 'contacted':
        return '#0891b2'; // professional cyan
      case 'interested':
        return '#059669'; // professional green
      case 'not interested':
        return '#dc2626'; // professional red
      case 'callback':
        return '#7c3aed'; // professional purple
      case 'rescheduled':
        return '#ea580c'; // professional orange
      case 'reschedule':
        return '#ea580c'; // professional orange
      default:
        return '#6b7280'; // gray for unknown statuses
    }
  }, []); // Empty dependency array since this function is pure
  
  // Memoize fetchEvents to prevent recreating it on every render
  const fetchEvents = useCallback(async (force = false) => {
    // If force refresh, clear the cache
    if (force) {
      console.log('📅 Force refresh: Clearing calendar cache');
      setLoadedRanges(new Set());
      setEvents([]);
    }
    
    // Prevent multiple simultaneous calls
    if (isFetching && !force) {
      console.log('📅 Calendar: Fetch already in progress, skipping...');
      return;
    }
    
    // Increased debounce for better performance (minimum 3 seconds between fetches)
    const now = Date.now();
    if (!force && now - lastFetchTime < 3000) {
      console.log('📅 Calendar: Fetch debounced, too soon since last fetch');
      return;
    }
    
    // Clear any pending fetch timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = null;
    }
    
    // Set fetching state
    setIsFetching(true);
    setLastFetchTime(now);
    
    try {
      console.log(`📅 Fetching calendar events...`);
      
      // PERFORMANCE: Get visible date range from calendar to only fetch relevant events
      const calendarApi = calendarRef.current?.getApi();
      let dateParams = '';
      let rangeKey = null;
      let startDate = null;
      let endDate = null;
      
      if (calendarApi && calendarApi.view) {
        const view = calendarApi.view;
        // Only fetch visible calendar dates (no buffer needed for month navigation)
        startDate = new Date(view.activeStart);
        endDate = new Date(view.activeEnd);
      } else {
        // Fallback: Use current month if calendar not yet initialized
        const now = new Date();
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        console.log('📅 Calendar not initialized, using current month range');
      }

      // Create range key for tracking
      rangeKey = `${startDate.toISOString()}_${endDate.toISOString()}`;
      
      // Check if this range was already loaded (unless force refresh)
      if (!force && loadedRanges.has(rangeKey)) {
        console.log('📅 Range already loaded, skipping fetch:', rangeKey);
        setIsFetching(false);
        return;
      }

      dateParams = `&start=${startDate.toISOString()}&end=${endDate.toISOString()}`;
      console.log(`📅 Fetching events for range: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`);

      // Use the new calendar endpoint with date filtering
      // Increased limit to 600 for better calendar coverage
      const cacheBuster = `?t=${Date.now()}${dateParams}&limit=600`;
      const response = await axios.get(`/api/leads/calendar${cacheBuster}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        timeout: 15000 // 15 second timeout (reduced from 30s)
      });

      const leads = response.data.leads || [];
      console.log(`📅 Received ${leads.length} leads from server`);
      
      // Debug logging
      if (leads.length === 0) {
        console.log('📅 No leads received from server. Full response:', response.data);
      } else {
        console.log('📅 Leads received:', leads.map(lead => ({
          name: lead.name,
          status: lead.status,
          date_booked: lead.date_booked
        })));
      }
      
      // Validate leads data
      const validLeads = leads.filter(lead => {
        // Comprehensive validation
        if (!lead) {
          console.warn('⚠️ Skipping null/undefined lead');
          return false;
        }
        
        if (!lead.id) {
          console.warn('⚠️ Lead missing ID:', lead);
          return false;
        }
        
        // Allow leads without booking dates - they'll be handled in the event mapping
        return true;
      });
      
      // Convert leads to calendar events - include both dated and undated booked leads
      // Debug: Check image_url presence in leads
      const leadsWithImages = validLeads.filter(l => l.image_url && l.image_url !== '');
      console.log(`📸 Calendar: ${leadsWithImages.length} out of ${validLeads.length} leads have image_url`);
      if (leadsWithImages.length > 0) {
        console.log('📸 Sample leads with images:', leadsWithImages.slice(0, 3).map(l => ({ name: l.name, image_url: l.image_url, hasImageUrl: !!l.image_url, imageUrlLength: l.image_url?.length })));
      }
      
      // Check if ALL leads have the image_url property (even if empty)
      const leadsWithImageUrlProperty = validLeads.filter(l => 'image_url' in l);
      console.log(`📸 Leads with image_url property: ${leadsWithImageUrlProperty.length}/${validLeads.length}`);
      
      const serverEvents = validLeads
        .filter(lead => {
          const hasBookingDate = lead.date_booked && lead.date_booked !== null && lead.date_booked !== 'null';
          const isBookedWithoutDate = lead.status === 'Booked' && !lead.date_booked;
          const isNotDeleted = !lead.deleted_at;

          // Allow leads with booking dates OR leads with status "Booked" (even without dates)
          return (hasBookingDate || isBookedWithoutDate) && isNotDeleted;
        })
        .map(lead => {
          // Parse the booking date more robustly
          let startDate;

          if (lead.date_booked && lead.date_booked !== null && lead.date_booked !== 'null') {
            // Lead has a booking date
            startDate = new Date(lead.date_booked);
            if (isNaN(startDate.getTime())) {
              console.warn(`Invalid date for lead ${lead.name}: ${lead.date_booked}`);
              return null;
            }
          } else if (lead.status === 'Booked') {
            // Lead is booked but no date set - use updated_at as booking date (when it was actually booked)
            if (lead.updated_at) {
              startDate = new Date(lead.updated_at);
            } else {
              // Fallback to today's date if no updated_at
              startDate = new Date();
              startDate.setHours(9, 0, 0, 0); // Set to 9 AM today
            }
          } else {
            // Should not happen due to filter, but just in case
            return null;
          }
          
          // Create end date (default to 15 minutes after start)
          const endDate = new Date(startDate);
          endDate.setMinutes(endDate.getMinutes() + 30);
          
          // Parse booking history for SMS notification icon
          let bookingHistory = lead.booking_history || [];
          
          // Ensure bookingHistory is always an array
          if (!Array.isArray(bookingHistory)) {
            try {
              bookingHistory = typeof bookingHistory === 'string' ? JSON.parse(bookingHistory) : [];
            } catch (e) {
              console.warn('Failed to parse bookingHistory:', e);
              bookingHistory = [];
            }
          }
          
          // Determine display status - prioritize booking_status, then confirmation status, then regular status
          let displayStatus;
          const hasBookingDate = lead.date_booked && lead.date_booked !== null && lead.date_booked !== 'null';

          if (lead.booking_status) {
            displayStatus = lead.booking_status; // Reschedule, Arrived, Left, No Show, No Sale
          } else if (lead.status === 'Booked') {
            if (!hasBookingDate && lead.updated_at) {
              displayStatus = 'Booked'; // Booked with actual booking date (updated_at)
            } else if (!hasBookingDate) {
              displayStatus = 'Unassigned'; // Booked but no date info
            } else {
              displayStatus = lead.is_confirmed ? 'Confirmed' : 'Unconfirmed';
            }
          } else {
            displayStatus = lead.status;
          }
          
          const isBookingStatus = ['Reschedule', 'Arrived', 'Left', 'No Show', 'No Sale'].includes(displayStatus);
          
          // PERFORMANCE: Simplified title construction
          const event = {
            id: lead.id,
            title: `${lead.name} - ${displayStatus || lead.status}`,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            allDay: false,
            backgroundColor: getEventColor(displayStatus, lead.hasSale, lead.is_confirmed),
            borderColor: getEventColor(displayStatus, lead.hasSale, lead.is_confirmed),
            extendedProps: {
              lead: {
                ...lead,
                bookingHistory: bookingHistory  // Use parsed array instead of string
              },
              phone: lead.phone,
              status: lead.status,
              displayStatus: displayStatus, // Store what status to display
              booker: lead.booker?.name || lead.booker_name || 'N/A',
              isConfirmed: lead.is_confirmed || false
            }
          };
          
          return event;
        })
        .filter(event => event !== null); // Remove any null events from invalid dates

      console.log(`📅 Calendar: Created ${serverEvents.length} server events`);

      // Prevent duplicate events by using a Set to track unique event IDs
      const uniqueEventIds = new Set();
      const finalEvents = serverEvents.filter(event => {
        if (uniqueEventIds.has(event.id)) {
          console.warn(`📅 Duplicate event found for lead: ${event.title}`);
          return false;
        }
        uniqueEventIds.add(event.id);
        return true;
      });

      console.log(`📅 Calendar: Final events array has ${finalEvents.length} unique events`);

      // Mark this range as loaded if we have a rangeKey
      if (rangeKey) {
        setLoadedRanges(prev => new Set([...prev, rangeKey]));
        console.log(`📅 Marked range as loaded: ${rangeKey}`);
      }

      // DIARY-STYLE LOADING: Merge new events with existing ones (no duplicates)
      setEvents(prevEvents => {
        const existingIds = new Set(prevEvents.map(e => e.id));
        const newUniqueEvents = finalEvents.filter(e => !existingIds.has(e.id));
        const mergedEvents = [...prevEvents, ...newUniqueEvents];
        console.log(`📅 Merging ${newUniqueEvents.length} new events with ${prevEvents.length} existing events = ${mergedEvents.length} total events`);
        return mergedEvents;
      });

      // Check for highlighting after events are set (reduced timeout for performance)
      setTimeout(() => {
        checkForHighlighting(finalEvents);
      }, 50);
    } catch (error) {
      console.group('❌ Calendar Events Fetch Error');
      console.error('Detailed Error:', error);
      
      // Detailed error logging
      if (error.response) {
        // The request was made and the server responded with a status code
        console.error('Response Status:', error.response.status);
        console.error('Response Data:', error.response.data);
        console.error('Response Headers:', error.response.headers);
        
        // Specific error handling based on status
        switch (error.response.status) {
          case 401:
            console.error('Authentication failed. Token may be expired.');
            // Optionally trigger logout or token refresh
            break;
          case 403:
            console.error('Access denied. Check user permissions.');
            break;
          case 404:
            console.error('Calendar endpoint not found.');
            break;
          case 500:
            console.error('Server-side error occurred.');
            break;
          default:
            console.error(`Unexpected status code: ${error.response.status}`);
            break;
        }
      } else if (error.request) {
        // The request was made but no response was received
        console.error('No response received:', error.request);
      } else {
        // Something happened in setting up the request
        console.error('Error setting up request:', error.message);
      }
      console.groupEnd();

      // Fallback error handling
      setEvents(prevEvents => {
        if (prevEvents.length === 0) {
          // Provide a helpful message or empty state
          console.warn('📅 No events could be loaded. Check your connection or permissions.');
          return [];
        }
        return prevEvents;
      });
    } finally {
      // Always reset fetching state
      setIsFetching(false);
    }
  }, []); // Empty dependency array - function doesn't need to recreate

  // Fetch booking confirmation templates
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        console.log('📋 Fetching booking confirmation templates...');
        const response = await axios.get('/api/templates?type=booking_confirmation&isActive=true', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        console.log('📋 Templates response:', response.data);
        console.log('📋 Number of templates:', response.data?.length || 0);
        setBookingTemplates(response.data || []);
        // Set the first template as default if available
        if (response.data && response.data.length > 0) {
          setSelectedTemplateId(response.data[0]._id);
          console.log('📋 Default template selected:', response.data[0].name, response.data[0]._id);
        } else {
          console.warn('⚠️ No active booking confirmation templates found');
        }
      } catch (error) {
        console.error('❌ Error fetching booking templates:', error);
        setBookingTemplates([]);
      }
    };
    fetchTemplates();
  }, []);

  // Use useEffect WITHOUT fetchEvents as dependency to prevent loops
  useEffect(() => {
    // PERFORMANCE: Single initial fetch after mount
    const initialFetch = setTimeout(() => {
      console.log('📅 Initial calendar data fetch');
      fetchEvents(true); // Force first fetch
    }, 100); // Small delay to let calendar render first
    
    // Check if there's lead data from the leads page
    const bookingLead = localStorage.getItem('bookingLead');
    if (bookingLead) {
      try {
        const leadData = JSON.parse(bookingLead);
        console.log('📊 Loading booking data from localStorage:', leadData);
        setLeadForm({
          _id: leadData.id, // Preserve the lead ID
          name: leadData.name || '',
          phone: leadData.phone || '',
          email: leadData.email || '',
          postcode: leadData.postcode || '',
          status: 'Booked', // Set status to Booked when coming from leads page
          notes: leadData.notes || '',
          image_url: leadData.image_url || '',
          isReschedule: leadData.isReschedule || false
        });
        console.log('📊 Set leadForm with ID:', leadData.id);
        // Clear the localStorage data after a delay to prevent race conditions
        setTimeout(() => {
          localStorage.removeItem('bookingLead');
        }, 1000);
        // Show a contextual notification based on current status
        setTimeout(() => {
          const action = leadData.isReschedule ? 'reschedule' : (leadData.currentStatus?.toLowerCase() === 'booked' ? 'reschedule' : 'book');
          const message = `Lead data for ${leadData.name} has been loaded. Click on a time slot to ${action} the appointment.`;
          alert(message);
        }, 500);
      } catch (error) {
        console.error('Error parsing lead data:', error);
        localStorage.removeItem('bookingLead');
      }
    }

    // Check if there's a refresh trigger from LeadDetail
    const refreshTrigger = localStorage.getItem('calendarRefreshTrigger');
    if (refreshTrigger) {
      console.log('📅 Calendar: Refresh trigger detected, refreshing events');
      fetchEvents();
      localStorage.removeItem('calendarRefreshTrigger');
    }
    
    // Cleanup
    return () => {
      clearTimeout(initialFetch);
    };
  }, []); // Empty dependency array - only run once on mount

  // Consolidated real-time updates with proper debouncing
  useEffect(() => {
    console.log('📅 Calendar: Setting up real-time updates and polling...');
    
    let refreshTimeout = null;
    let pollingInterval = null;
    let unsubscribeCalendar = null;
    let unsubscribeLeads = null;
    
    const debouncedFetch = () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      refreshTimeout = setTimeout(() => {
        fetchEvents();
      }, 5000); // Increased to 5 seconds for better performance
    };
    
    // Setup subscriptions
    if (subscribeToCalendarUpdates) {
      unsubscribeCalendar = subscribeToCalendarUpdates((update) => {
        console.log('📅 Calendar: Real-time calendar update received', update);
        setLastUpdated(new Date());
        debouncedFetch(); // Use debounced fetch
      });
    }

    if (subscribeToLeadUpdates) {
      unsubscribeLeads = subscribeToLeadUpdates((update) => {
        console.log('📅 Calendar: Real-time lead update received', update);
        setLastUpdated(new Date());
        
        // Update calendar events when leads change - but be smarter about it
        switch (update.type) {
          case 'LEAD_CREATED':
          case 'LEAD_DELETED':
            console.log('📅 Calendar: Refreshing events due to', update.type);
            debouncedFetch(); // Use debounced fetch
            break;
          case 'LEAD_UPDATED':
            // For status updates, only refresh if the lead has a booking date
            const lead = update.data?.lead;
            if (lead && lead.date_booked) {
              console.log('📅 Calendar: Refreshing events due to booking-related update');
              debouncedFetch(); // Use debounced fetch
            }
            break;
          case 'LEAD_ASSIGNED':
          case 'NOTES_UPDATED':
          case 'messages_read':
            // These don't typically affect calendar visibility, so skip refresh
            console.log('📅 Calendar: Skipping refresh for', update.type);
            break;
          default:
            break;
        }
      });
    }
    
    // Reduced polling frequency to prevent overloading
    pollingInterval = setInterval(() => {
      console.log('📅 Calendar: Polling for updates...');
      debouncedFetch(); // Use debounced fetch
    }, 120000); // Poll every 2 minutes for better performance

    return () => {
      console.log('📅 Calendar: Cleaning up real-time subscriptions and polling...');
      
      // Clean up subscriptions
      if (unsubscribeCalendar) {
        unsubscribeCalendar();
      }
      if (unsubscribeLeads) {
        unsubscribeLeads();
      }
      
      // Clean up intervals and timeouts
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      
      console.log('📅 Calendar: Cleaned up real-time subscriptions and polling');
    };
  }, [subscribeToCalendarUpdates, subscribeToLeadUpdates, fetchEvents]); // Include fetchEvents in dependencies

  // Create a debounced fetch function that can be used throughout the component
  const debouncedFetchEvents = useCallback(() => {
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }
    fetchTimeoutRef.current = setTimeout(() => {
      fetchEvents();
    }, 3000); // Increased to 3 seconds for better performance
  }, [fetchEvents]);

  // Realtime: update open calendar modal conversation instantly on inbound SMS
  useEffect(() => {
    if (!socket) return;
    const handleSmsReceived = (data) => {
      try {
        if (!data || !data.leadId) return;
        if (!selectedEvent) return;
        const openLeadId = selectedEvent.extendedProps?.lead?.id;
        if (openLeadId && data.leadId === openLeadId) {
          const existing = selectedEvent.extendedProps.lead.bookingHistory || selectedEvent.extendedProps.lead.booking_history || [];
          // Avoid duplicates by timestamp/content
          const dup = existing.some((e) => {
            try {
              return (
                e && e.action === 'SMS_RECEIVED' &&
                (e.details?.body || e.details?.message) === data.content &&
                new Date(e.timestamp).getTime() === new Date(data.timestamp).getTime()
              );
            } catch { return false; }
          });
          if (!dup) {
            const newEntry = {
              action: 'SMS_RECEIVED',
              timestamp: data.timestamp,
              details: {
                body: data.content,
                sender: data.phone,
                direction: 'received',
                channel: 'sms',
                status: 'received',
                read: false
              }
            };
            const updatedHistory = [...existing, newEntry];
            const updatedLead = {
              ...selectedEvent.extendedProps.lead,
              bookingHistory: updatedHistory
            };
            // Update snapshot in place so modal stays open and live-updates
            setSelectedEvent(prev => prev ? ({
              ...prev,
              extendedProps: { ...prev.extendedProps, lead: updatedLead }
            }) : prev);
          }
        }
      } catch {}
    };
    // Handle message sent notifications (booking confirmations)
    const handleMessageSent = (data) => {
      console.log('📧 ========== MESSAGE SENT NOTIFICATION ==========');
      console.log('📧 Status:', data.status);
      console.log('📧 Type:', data.type);
      console.log('📧 Lead ID:', data.leadId);
      console.log('📧 Channels:', data.channels);
      if (data.status === 'success') {
        console.log('📧 Email Account:', data.emailAccountName);
        console.log('📧 Email Account Key:', data.emailAccount);
        console.log('📧 SMS Provider:', data.smsProvider);
      } else {
        console.log('📧 Error:', data.error);
      }
      console.log('📧 ==============================================');

      if (data.status === 'success') {
        // Show success notification with details
        const details = [];
        if (data.channels.email) {
          details.push(`Email via ${data.emailAccountName || 'email'}`);
        }
        if (data.channels.sms) {
          details.push(`SMS via ${data.smsProvider || 'SMS'}`);
        }

        const message = `✅ ${data.message || 'Booking confirmation sent: ' + details.join(' and ')}`;
        alert(message);
      } else if (data.status === 'error') {
        // Show error notification
        alert(`❌ ${data.message || 'Failed to send booking confirmation'}`);
      }
    };

    // Listen for both event names to ensure compatibility
    socket.on('sms_received', handleSmsReceived);
    socket.on('message_received', handleSmsReceived);
    socket.on('message_sent', handleMessageSent);

    return () => {
      socket.off('sms_received', handleSmsReceived);
      socket.off('message_received', handleSmsReceived);
      socket.off('message_sent', handleMessageSent);
    };
  }, [socket, selectedEvent]);

  const checkForHighlighting = (eventsToCheck) => {
    // Check if there's a booking to highlight from Daily Diary
    const highlightBooking = localStorage.getItem('highlightBooking');
    if (highlightBooking) {
      try {
        const bookingData = JSON.parse(highlightBooking);
        
        // Find the target event
        const targetEvent = eventsToCheck.find(event => 
          event.id === bookingData.leadId || 
          event.extendedProps?.lead?.name === bookingData.leadName
        );
        
        // Navigate to the specific date and highlight the booking
        setTimeout(() => {
          const calendarApi = calendarRef.current?.getApi();
          if (calendarApi) {
            // Navigate to the booking date
            calendarApi.gotoDate(bookingData.date);
            
            if (targetEvent) {
              // Show event details
              setTimeout(() => {
                setSelectedEvent(targetEvent);
                setShowEventModal(true);
              }, 500);
            }
          }
          
          // Show notification
          alert(`Navigated to ${bookingData.leadName}'s booking on ${new Date(bookingData.date).toLocaleDateString()}`);
        }, 1000);
        
        // Clear the localStorage data
        localStorage.removeItem('highlightBooking');
      } catch (error) {
        console.error('Error parsing highlight booking data:', error);
        localStorage.removeItem('highlightBooking');
      }
    }
  };


  const getStatusBadgeClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'new':
        return 'status-badge status-new';
      case 'confirmed':
        return 'status-badge status-booked';
      case 'booked':
        return 'status-badge status-booked';
      case 'attended':
        return 'status-badge status-attended';
      case 'complete':
        return 'status-badge status-attended';
      case 'cancelled':
        return 'status-badge status-cancelled';
      case 'no show':
        return 'status-badge status-cancelled';
      case 'reschedule':
        return 'status-badge status-reschedule';
      default:
        return 'status-badge status-new';
    }
  };

  // Create a stable snapshot of a FullCalendar EventApi to avoid losing
  // references when the calendar re-renders on live updates (e.g. new SMS)
  const createEventSnapshot = (eventApi) => {
    if (!eventApi) return null;
    return {
      id: eventApi.id,
      title: eventApi.title,
      start: eventApi.start ? new Date(eventApi.start) : null,
      end: eventApi.end ? new Date(eventApi.end) : null,
      allDay: !!eventApi.allDay,
      backgroundColor: eventApi.backgroundColor,
      borderColor: eventApi.borderColor,
      extendedProps: {
        ...(eventApi.extendedProps || {})
      }
    };
  };

  const handleEventClick = async (clickInfo) => {
    // Debug logging
    console.log('📅 Event clicked:', clickInfo.event.title);
    console.log('📸 Event image_url:', clickInfo.event.extendedProps?.lead?.image_url);
    console.log('📋 Full event extendedProps:', clickInfo.event.extendedProps);

    // Store a stable plain-object snapshot so live updates don't close the modal
    setSelectedEvent(createEventSnapshot(clickInfo.event));
    setShowEventModal(true);
    setShowAllMessages(false);
    // Don't fetch sale details on modal open - only fetch if needed
    setSelectedSale(null);

    // REMOVED: Booking history API call - was causing 403 errors and blocking calendar render
    // Booking history is already included in the calendar events response
  };



  const handleDateTimeClick = (clickInfo) => {
    // Get current view
    const calendarApi = calendarRef.current.getApi();
    const currentView = calendarApi.view.type;
    
    if (currentView === 'dayGridMonth') {
      // If in month view, switch to day view
      const dateStr = clickInfo.dateStr || clickInfo.startStr;
      calendarApi.changeView('timeGridDay', dateStr);
    } else if (currentView === 'timeGridDay' || currentView === 'timeGridWeek') {
      // If in day or week view, open lead form for time slot booking
      // Handle both dateClick and select events
      const selectedDateTime = clickInfo.date || clickInfo.start || new Date(clickInfo.dateStr || clickInfo.startStr);
      
      // Check if the selected time is within business hours (10 AM - 5:45 PM)
      const hour = selectedDateTime.getHours();
      const minute = selectedDateTime.getMinutes();

      if (hour < 10 || (hour >= 17 && minute > 45)) {
        alert('Please select a time between 10:00 AM and 5:45 PM');
        return;
      }
      
      // Round to nearest 15-minute interval
      const roundedMinutes = Math.round(minute / 15) * 15;
      selectedDateTime.setMinutes(roundedMinutes, 0, 0);
      
      // Debug logging for timezone handling
      console.log('🕐 Click Debug:', {
        originalClickInfo: clickInfo,
        selectedDateTime: selectedDateTime.toISOString(),
        selectedDateTimeLocal: selectedDateTime.toLocaleString(),
        selectedDateTimeUTC: selectedDateTime.toUTCString(),
        hour: selectedDateTime.getHours(),
        minute: selectedDateTime.getMinutes(),
        timezoneOffset: selectedDateTime.getTimezoneOffset()
      });
      
      setSelectedDate({
        ...clickInfo,
        dateStr: selectedDateTime.toISOString(),
        date: selectedDateTime
      });
      setSendEmail(true);
      setSendSms(true);
      setShowLeadFormModal(true);
    }
  };



  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setLeadForm(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSaveBooking = async () => {
    if (isBookingInProgress) {
      console.log('📊 Booking already in progress, ignoring duplicate request');
      return;
    }

    if (!leadForm.name || !leadForm.phone) {
      alert('Please fill in required fields (Name and Phone)');
      return;
    }

    console.log('📅 ========== SAVE BOOKING START ==========');
    console.log('📅 Lead Form:', leadForm);
    console.log('📅 Is Reschedule:', leadForm.isReschedule);
    console.log('📅 Send Email:', sendEmail);
    console.log('📅 Send SMS:', sendSms);
    console.log('📅 Selected Template ID:', selectedTemplateId);
    console.log('📅 Available Templates:', bookingTemplates.map(t => ({ id: t._id, name: t.name })));
    console.log('📅 ========================================');

    setIsBookingInProgress(true);

    // Use the clicked time directly from selectedDate, but ensure we're working with local time
    const selectedDateTime = selectedDate.date || new Date(selectedDate.dateStr);
    const endDateTime = new Date(selectedDateTime);
    endDateTime.setMinutes(endDateTime.getMinutes() + 30); // 30-minute booking slots to match calendar intervals
    
    // TIMEZONE FIX: Preserve exact local time without UTC conversion
    const year = selectedDateTime.getFullYear();
    const month = selectedDateTime.getMonth();
    const date = selectedDateTime.getDate();
    const hours = selectedDateTime.getHours();
    const minutes = selectedDateTime.getMinutes();
    
    // Create a new date with the same local time components
    const localDateTime = new Date(year, month, date, hours, minutes, 0, 0);
    const localEndDateTime = new Date(year, month, date, hours, minutes + 30, 0, 0);
    
    // Create ISO string that preserves local time (avoiding UTC conversion)
    // This is the key fix - we manually construct the ISO string to avoid timezone shifts
    const localISOString = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`;
    
    // Debug logging to show the time handling
    console.log('🕐 Time Debug:', {
      originalSelectedDate: selectedDate,
      selectedDateTime: selectedDateTime.toISOString(),
      selectedDateTimeLocal: selectedDateTime.toLocaleString(),
      selectedDateTimeUTC: selectedDateTime.toUTCString(),
      localDateTime: localDateTime.toISOString(),
      localDateTimeLocal: localDateTime.toLocaleString(),
      endDateTime: endDateTime.toISOString(),
      endDateTimeLocal: endDateTime.toLocaleString(),
      timezoneOffset: selectedDateTime.getTimezoneOffset(),
      hour: selectedDateTime.getHours(),
      minute: selectedDateTime.getMinutes(),
      localHour: localDateTime.getHours(),
      localMinute: localDateTime.getMinutes()
    });
    
    // Create a temporary event ID to track this booking
    const tempEventId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Get current user from localStorage or context
      const currentUser = JSON.parse(localStorage.getItem('user')) || {};
      
              // Debug logging to understand the booking flow
        console.log('📊 Booking Debug Info:', {
          leadFormId: leadForm._id,
          leadFormIdType: typeof leadForm._id,
          leadFormIdLength: leadForm._id ? leadForm._id.length : 0,
          isExistingLead: leadForm._id && leadForm._id !== '',
          leadForm: leadForm,
        selectedDateTime: localDateTime.toISOString()
      });
      
                    // PERSISTENCE FIX: Handle existing leads from lead details properly
      const { _id, ...leadDataWithoutId } = leadForm;
      const createData = {
        ...leadDataWithoutId,
        date_booked: localISOString,
        // Include the _id if we have one (from lead details page)
        ...((_id && _id !== '') ? { _id } : {}),
        status: 'Booked',
        is_confirmed: leadForm.isReschedule ? 0 : 0, // Reset to unconfirmed (0) when rescheduling, 0 for new bookings
        booker: currentUser._id || currentUser.id || '507f1f77bcf86cd799439012',
        // Add reschedule fields if this is a reschedule
        ...(leadForm.isReschedule && {
          booking_status: 'Reschedule', // Set to new Reschedule status to indicate rescheduling
          rescheduleReason: `Appointment rescheduled via calendar to ${localDateTime.toLocaleString()}`
        })
      };
      
      console.log('📊 Creating/updating lead with data:', {
        hasExistingId: !!_id,
        finalData: createData
      });
      
      console.log('📤 Sending booking request with:', {
        ...createData,
        sendEmail,
        sendSms,
        templateId: selectedTemplateId
      });

      const response = await axios.post('/api/leads', { ...createData, sendEmail, sendSms, templateId: selectedTemplateId });

      console.log('✅ Booking API response:', response.data);

      if (response.data.success || response.data.lead || response.data) {
        const leadResult = response.data.lead || response.data;
        
        // Check if this was an existing lead that was updated
        const isExistingLead = response.data.isExistingLead || false;
        
        // Create the final calendar event with the real lead ID
        // Use same display logic as fetchEvents - show "Unconfirmed" for new bookings, "Confirmed" only when manually changed
        const displayStatus = leadResult.is_confirmed ? 'Confirmed' : 'Unconfirmed';
        const newEvent = {
          id: leadResult.id || tempEventId,
          title: `${leadForm.name} - ${displayStatus}`,
          start: localDateTime,
          end: localEndDateTime,
          backgroundColor: getEventColor(displayStatus, leadResult.hasSale, leadResult.is_confirmed),
          borderColor: getEventColor(displayStatus, leadResult.hasSale, leadResult.is_confirmed),
          extendedProps: {
            lead: {
              ...leadResult,
              bookingHistory: Array.isArray(leadResult.bookingHistory) ? leadResult.bookingHistory : (leadResult.booking_history || [])
            },
            phone: leadForm.phone,
            status: 'Booked',
            displayStatus: displayStatus, // Store display status for consistency
            booker: currentUser.name || 'Current User',
            isConfirmed: leadResult.is_confirmed || false
          }
        };
        
        // Update events array properly - remove temp event if exists and add real event
        setEvents(prevEvents => {
          const filteredEvents = prevEvents.filter(event => event.id !== tempEventId);
          // If it's an existing lead, also remove any duplicate events with the same lead ID
          const finalEvents = isExistingLead 
            ? filteredEvents.filter(event => event.id !== leadResult.id)
            : filteredEvents;
          return [...finalEvents, newEvent];
        });
        
        // Emit real-time update to other clients
        emitCalendarUpdate({
          type: 'booking_created',
          lead: leadResult,
          event: newEvent,
          timestamp: new Date()
        });
        
        const message = isExistingLead 
          ? `✅ Appointment updated successfully for ${leadForm.name}!`
          : `✅ Appointment booked successfully for ${leadForm.name}!`;
        alert(message);

        // No direct SMS send here; backend handles according to sendEmail/sendSms flags
        
        // Log the action for debugging
        console.log(`📅 Booking action: ${isExistingLead ? 'Updated existing lead' : 'Created new lead'} for ${leadForm.name}`);
        
        // Force refresh calendar events to ensure consistency with server
        setTimeout(() => {
          console.log('📅 Refreshing calendar after booking to ensure consistency');
          fetchEvents();
        }, 2000); // Increased delay to 2 seconds
        
        // Additional refresh after 5 seconds to catch any delayed updates
        setTimeout(() => {
          console.log('📅 Second refresh to catch any delayed updates');
          fetchEvents();
        }, 5000);
      }
    } catch (error) {
      console.error('Error creating booking:', error);
      console.error('Error details:', {
        status: error.response?.status,
        message: error.response?.data?.message,
        data: error.response?.data,
        formData: leadForm
      });
      
      // Check if this is a validation error or server error
      if (error.response && error.response.status === 400) {
        alert(`❌ Booking failed: ${error.response.data.message || 'Invalid data provided'}`);
        return; // Don't create local event for validation errors
      }
      
      if (error.response && error.response.status === 401) {
        alert(`❌ Authentication required. Please log in again.`);
        return;
      }
      
      if (error.response && error.response.status === 403) {
        alert(`❌ Access denied. You don't have permission to create bookings.`);
        return;
      }
      
      // For server/network errors, create local event as fallback
      const fallbackEvent = {
        id: tempEventId,
        title: `${leadForm.name} - Booked (Pending)`,
        start: localDateTime,
        end: localEndDateTime,
        backgroundColor: '#FFA500', // Orange for pending
        borderColor: '#FFA500',
        extendedProps: {
          lead: leadForm,
          phone: leadForm.phone,
          status: 'Booked',
          booker: 'Current User',
          isPending: true // Mark as pending confirmation
        }
      };
      
      setEvents(prevEvents => [...prevEvents, fallbackEvent]);
      
      // Show appropriate message
      if (error.code === 'NETWORK_ERROR' || !navigator.onLine) {
        alert(`📱 Booking saved locally for ${leadForm.name}. Will sync when connection is restored.`);
      } else {
        alert(`⚠️ Booking created locally for ${leadForm.name}. Please check your connection.`);
      }
      
      // Try to sync pending bookings after a delay
      setTimeout(() => {
        retryPendingBookings();
      }, 5000);
    } finally {
      setIsBookingInProgress(false);
    }

    // Reset form and close modal
    setLeadForm({
      _id: '',
      name: '',
      phone: '',
      email: '',
      postcode: '',
      status: 'New',
      notes: '',
      image_url: ''
    });
    setShowLeadFormModal(false);
    setIsBookingInProgress(false);
    
    // Refresh calendar events to show the updated booking
    setTimeout(() => {
      fetchEvents();
    }, 500);
  };

  // Function to retry pending bookings
  const retryPendingBookings = async () => {
    const pendingEvents = events.filter(event => event.extendedProps?.isPending);
    
    for (const event of pendingEvents) {
      try {
        const leadData = {
          ...event.extendedProps.lead,
          date_booked: event.start.toISOString(),
          status: 'Booked'
        };
        
        const response = await axios.post('/api/leads', leadData);
        
        if (response.data.success || response.data.lead) {
          const leadResult = response.data.lead || response.data;
          
          // Update the event to confirmed status
          setEvents(prevEvents => 
            prevEvents.map(evt => 
              evt.id === event.id 
                ? {
                    ...evt,
                    id: leadResult.id,
                    title: evt.title.replace(' (Pending)', ''),
                    backgroundColor: getEventColor('Booked', leadResult.hasSale),
                    borderColor: getEventColor('Booked', leadResult.hasSale),
                    extendedProps: {
                      ...evt.extendedProps,
                      lead: leadResult,
                      isPending: false,
                      isConfirmed: true
                    }
                  }
                : evt
            )
          );
        }
      } catch (error) {
        console.log(`Failed to sync pending booking for ${event.extendedProps.lead.name}`);
      }
    }
  };

  const formatEventTime = (event) => {
    const start = new Date(event.start);
    const end = event.end ? new Date(event.end) : start;
    
    return `${start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })} - ${end.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })}`;
  };

  const handleEventStatusChange = async (newStatus) => {
    if (!selectedEvent || !selectedEvent.extendedProps?.lead) {
      alert('No lead data available for this event.');
      return;
    }

    // ROLE-BASED ACCESS CONTROL for booking status changes
    // Only admin, booker, and viewer can change booking status
    if (!(user?.role === 'admin' || user?.role === 'booker' || user?.role === 'viewer')) {
      alert('Access denied. You do not have permission to change booking status.');
      return;
    }

    // For bookers: can change Confirmed/Unconfirmed/Cancelled on any booking, but other statuses only on their assigned leads
    if (user?.role === 'booker') {
      const isConfirmationChange = newStatus === 'Confirmed' || newStatus === 'Unconfirmed';
      const isCancellationChange = newStatus === 'Cancelled';
      const isAssignedLead = selectedEvent.extendedProps?.lead?.booker === user.id;
      
      if (!isConfirmationChange && !isCancellationChange && !isAssignedLead) {
        alert('Access denied. You can only change Confirmed/Unconfirmed/Cancelled status on any booking, or other statuses on leads assigned to you.');
        return;
      }
    }

    // Viewers have admin-level access for status changes (no restrictions)

    const leadName = selectedEvent.extendedProps.lead.name || selectedEvent.title.split(' - ')[0];
    const oldStatus = selectedEvent.extendedProps.status;
    
    // Special handling for cancellation
    if (newStatus === 'Cancelled') {
      const confirmationMessage = `Are you sure you want to cancel ${leadName}'s appointment?\n\n` +
        `This will:\n` +
        `• Remove the booking from the calendar\n` +
        `• Move the lead status to "Cancelled"\n` +
        `• Preserve the original booking date for tracking\n` +
        `• Update the daily diary\n\n` +
        `This action cannot be undone.`;

      if (!window.confirm(confirmationMessage)) {
        return;
      }
    } else if (newStatus === 'Confirmed') {
      if (!window.confirm(`Are you sure you want to confirm ${leadName}'s appointment?\n\nThis will mark the booking as confirmed but keep it on the calendar.`)) {
        return;
      }
    } else if (newStatus === 'Unconfirmed') {
      if (!window.confirm(`Set ${leadName}'s appointment to Unconfirmed?`)) {
        return;
      }
    } else {
      if (!window.confirm(`Are you sure you want to change ${leadName}'s status to "${newStatus}"?`)) {
        return;
      }
    }

    try {
      // Prepare update data
      let updateData = {
        ...selectedEvent.extendedProps.lead
      };

      // For cancellation, set status to Cancelled but preserve the original booking date
      if (newStatus === 'Cancelled') {
        updateData = {
          ...updateData,
          status: 'Cancelled', // Set to Cancelled status
          // Keep date_booked preserved for tracking history in daily activities
          cancellation_reason: 'Appointment cancelled via calendar'
        };
      } else if (newStatus === 'Confirmed') {
        // For confirmation, keep the status as 'Booked' but add a confirmed flag
        updateData = {
          ...updateData,
          status: 'Booked', // Keep as Booked
          is_confirmed: 1, // Add confirmation flag
          booking_status: null // Clear any previous booking status (like 'Arrived')
        };
      } else if (newStatus === 'Unconfirmed') {
        // For unconfirmed, keep as Booked but ensure confirmed flag is false
        updateData = {
          ...updateData,
          status: 'Booked',
          is_confirmed: 0,
          booking_status: null // Clear any previous booking status (like 'Arrived')
        };
      } else if (newStatus === 'Reschedule' || newStatus === 'Arrived' || newStatus === 'Left' || newStatus === 'No Show' || newStatus === 'No Sale') {
        // For these statuses, keep as Booked but store the actual status in a custom field
        updateData = {
          ...updateData,
          status: 'Booked',
          booking_status: newStatus, // Store the actual status here
          is_confirmed: newStatus === 'Reschedule' ? 0 : null // Reset to unconfirmed for Reschedule, null for others
        };
      } else {
        // For other status changes, update the status normally and clear booking_status
        updateData = {
          ...updateData,
          status: newStatus,
          booking_status: null // Clear any previous booking status
        };
      }

      const response = await axios.put(`/api/leads/${selectedEvent.id}`, updateData);

      if (response.data.success || response.data.lead) {
        const updatedLead = response.data.lead || response.data;
        
        // Update the event in the calendar
        if (newStatus === 'Cancelled') {
          // Remove the event from calendar completely
          setEvents(prevEvents => prevEvents.filter(event => event.id !== selectedEvent.id));
          setShowEventModal(false);
          
          alert(`❌ Successfully cancelled ${leadName}'s appointment. The lead has been moved to "Cancelled" status.`);
        } else {
          // For confirmed bookings, show a special title
          const eventTitle = newStatus === 'Confirmed'
            ? `${leadName} - Booked (Confirmed)`
            : newStatus === 'Unconfirmed'
              ? `${leadName} - Booked (Unconfirmed)`
              : (newStatus === 'Reschedule' || newStatus === 'Arrived' || newStatus === 'Left' || newStatus === 'No Show' || newStatus === 'No Sale')
                ? `${leadName} - ${newStatus}`
                : `${leadName} - ${newStatus}`;
          
          const updatedEvent = {
            ...selectedEvent,
            title: eventTitle,
            backgroundColor: getEventColor(
              newStatus === 'Confirmed' ? 'Booked' : (newStatus === 'Unconfirmed' ? 'Unconfirmed' : newStatus),
              updatedLead.hasSale,
              newStatus === 'Confirmed'
            ),
            borderColor: getEventColor(
              newStatus === 'Confirmed' ? 'Booked' : (newStatus === 'Unconfirmed' ? 'Unconfirmed' : newStatus),
              updatedLead.hasSale,
              newStatus === 'Confirmed'
            ),
            extendedProps: {
              ...selectedEvent.extendedProps,
              status: (newStatus === 'Confirmed' || newStatus === 'Unconfirmed' || newStatus === 'Reschedule' || newStatus === 'Arrived' || newStatus === 'Left' || newStatus === 'No Show' || newStatus === 'No Sale') ? 'Booked' : newStatus,
              displayStatus: newStatus, // Store what status to display
              isConfirmed: newStatus === 'Confirmed' ? true : (newStatus === 'Unconfirmed' ? false : (newStatus === 'Reschedule' || newStatus === 'Arrived' || newStatus === 'Left' || newStatus === 'No Show' || newStatus === 'No Sale') ? (newStatus === 'Reschedule' ? 0 : null) : selectedEvent.extendedProps?.isConfirmed || false),
              bookingStatus: (newStatus === 'Reschedule' || newStatus === 'Arrived' || newStatus === 'Left' || newStatus === 'No Show' || newStatus === 'No Sale') ? newStatus : undefined,
              lead: updatedLead
            }
          };
          setEvents(prevEvents => {
            const newEvents = prevEvents.map(event => 
              event.id === selectedEvent.id ? updatedEvent : event
            );
            console.log(`📅 Calendar: Updated event ${selectedEvent.id} status to ${newStatus}. Events count: ${newEvents.length}`);
            return newEvents;
          });
          setSelectedEvent(updatedEvent);
          
          // Force a delayed refresh to ensure server sync, but don't remove the local update
          setTimeout(() => {
            console.log(`📅 Calendar: Delayed refresh after ${newStatus} status change`);
            // Use debounced fetch to prevent race conditions
            debouncedFetchEvents();
          }, 1500);
          
          // Show success message with visual feedback
          const statusEmoji = {
            'Confirmed': '✅',
            'Unconfirmed': '🔄',
            'Reschedule': '📅',
            'Arrived': '🚗',
            'Left': '🚪',
            'No Sale': '❌',
            'Attended': '✅', 
            'Complete': '✅',
            'Cancelled': '❌',
            'No Show': '⏰',
            'New': '🆕'
          };
          
          const successMessage = newStatus === 'Confirmed' 
            ? `✅ Successfully confirmed ${leadName}'s appointment`
            : `${statusEmoji[newStatus] || '✅'} Successfully updated ${leadName}'s status to "${newStatus}"`;
          
          alert(successMessage);
        }
        
        // Emit diary update for synchronization
        try {
          if (newStatus === 'Confirmed' || oldStatus === 'Confirmed' ||
              newStatus === 'Booked' || oldStatus === 'Booked' || 
              newStatus === 'Attended' || oldStatus === 'Attended' ||
              newStatus === 'Complete' || oldStatus === 'Complete' ||
              newStatus === 'Cancelled' || oldStatus === 'Cancelled' ||
              newStatus === 'No Show' || oldStatus === 'No Show' ||
              newStatus === 'Unconfirmed' || oldStatus === 'Unconfirmed' ||
              newStatus === 'Reschedule' || oldStatus === 'Reschedule' ||
              newStatus === 'Arrived' || oldStatus === 'Arrived' ||
              newStatus === 'Left' || oldStatus === 'Left' ||
              newStatus === 'On Show' || oldStatus === 'On Show' ||
              newStatus === 'No Sale' || oldStatus === 'No Sale') {
            
            await axios.post('/api/stats/diary-update', {
              leadId: selectedEvent.id,
              leadName: leadName,
              oldStatus: oldStatus,
              newStatus: newStatus === 'Cancelled' ? 'Cancelled' : (newStatus === 'Confirmed' ? 'Booked' : (newStatus === 'Unconfirmed' ? 'Booked' : newStatus)),
              dateBooked: selectedEvent.start,
              timestamp: new Date().toISOString()
            });
          }
        } catch (diaryError) {
          console.warn('Diary update failed:', diaryError);
        }
        
        // Emit real-time calendar update
        emitCalendarUpdate({
          type: 'status_changed',
          lead: updatedLead,
          event: newStatus === 'Cancelled' ? null : selectedEvent,
          oldStatus: oldStatus,
          newStatus: newStatus === 'Cancelled' ? 'Cancelled' : (newStatus === 'Confirmed' ? 'Booked' : newStatus),
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error updating event status:', error);
      
      // More detailed error reporting
      let errorMessage = 'Failed to update status. Please try again.';
      if (error.response) {
        // Server responded with error status
        errorMessage = `Server error: ${error.response.data?.message || error.response.statusText}`;
      } else if (error.request) {
        // Request was made but no response received
        errorMessage = 'Network error: Could not reach server. Please check your connection.';
      } else {
        // Something else happened
        errorMessage = `Error: ${error.message}`;
      }
      
      alert(errorMessage);
    }
  };

  const handleRejectLead = () => {
    if (!selectedEvent || !selectedEvent.extendedProps?.lead) {
      alert('No lead data available for this event.');
      return;
    }

    const leadName = selectedEvent.extendedProps.lead.name || selectedEvent.title.split(' - ')[0];
    
    if (!window.confirm(`Are you sure you want to reject ${leadName}?\n\nThis will:\n• Move the lead to "Rejected" status\n• Remove the booking from the calendar\n• This action cannot be undone.`)) {
      return;
    }

    setShowRejectModal(true);
  };

  const handleConfirmReject = async () => {
    if (!selectedEvent?.id) return;
    
    setRejecting(true);
    try {
      const response = await axios.patch(`/api/leads/${selectedEvent.id}/reject`, { 
        reason: rejectReason 
      });
      
      if (response.data.success || response.data.lead) {
        const leadName = selectedEvent.extendedProps.lead.name || selectedEvent.title.split(' - ')[0];
        
        // Remove the event from calendar completely
        setEvents(prevEvents => prevEvents.filter(event => event.id !== selectedEvent.id));
        setShowEventModal(false);
        setShowRejectModal(false);
        
        alert(`❌ Successfully rejected ${leadName}. The lead has been moved to "Rejected" status.`);
        
        // Force a delayed refresh to ensure server sync
        setTimeout(() => {
          debouncedFetchEvents();
        }, 1500);
      }
    } catch (error) {
      console.error('Error rejecting lead:', error);
      alert('Failed to reject lead. Please try again.');
    } finally {
      setRejecting(false);
    }
  };

  const handleRescheduleAppointment = () => {
    if (!selectedEvent || !selectedEvent.extendedProps?.lead) {
      alert('No lead data available for this event.');
      return;
    }

    const leadName = selectedEvent.extendedProps.lead.name || selectedEvent.title.split(' - ')[0];

    if (!window.confirm(`Are you sure you want to reschedule ${leadName}'s appointment?`)) {
      return;
    }

    console.log('📅 Starting reschedule for:', leadName);
    console.log('📅 Current template selected:', selectedTemplateId);
    console.log('📅 Available templates:', bookingTemplates.length);

    // Load the lead data into the form for rescheduling
    setLeadForm({
      _id: selectedEvent.extendedProps.lead.id,
      name: selectedEvent.extendedProps.lead.name || '',
      phone: selectedEvent.extendedProps.lead.phone || '',
      email: selectedEvent.extendedProps.lead.email || '',
      postcode: selectedEvent.extendedProps.lead.postcode || '',
      status: 'Booked', // Keep as booked for rescheduling
      notes: selectedEvent.extendedProps.lead.notes || '',
      image_url: selectedEvent.extendedProps.lead.image_url || '',
      isReschedule: true
    });

    // Close the event modal and open the booking form
    setShowEventModal(false);
    setSendEmail(true);
    setSendSms(true);

    // Ensure a template is selected - use first template if none selected
    if (!selectedTemplateId && bookingTemplates.length > 0) {
      console.log('⚠️ No template selected, setting default template:', bookingTemplates[0].name);
      setSelectedTemplateId(bookingTemplates[0]._id);
    }

    setShowLeadFormModal(true);

    // Set the selected date to the current event date for easy rescheduling
    if (selectedEvent.start) {
      const dt = new Date(selectedEvent.start);
      setSelectedDate({ dateStr: dt.toISOString(), date: dt });
    }

    console.log('📅 Reschedule modal opened - Template ID:', selectedTemplateId || bookingTemplates[0]?._id);
  };

  // Navigation functions for day-specific booking browsing
  const getEventsForSelectedDay = () => {
    if (!selectedEvent?.start) return [];
    
    const selectedDate = new Date(selectedEvent.start);
    const dayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    
    return events.filter(event => {
      const eventDate = new Date(event.start);
      return eventDate >= dayStart && eventDate < dayEnd;
    }).sort((a, b) => new Date(a.start) - new Date(b.start));
  };

  const navigateToPreviousBooking = () => {
    const dayEvents = getEventsForSelectedDay();
    const currentIndex = dayEvents.findIndex(event => event.id === selectedEvent.id);
    
    if (currentIndex > 0) {
      const prevEvent = dayEvents[currentIndex - 1];
      console.log('📸 Navigating to previous event:', prevEvent.title, 'Image URL:', prevEvent.extendedProps?.lead?.image_url);
      setSelectedEvent(createEventSnapshot(prevEvent));
    }
  };

  const navigateToNextBooking = () => {
    const dayEvents = getEventsForSelectedDay();
    const currentIndex = dayEvents.findIndex(event => event.id === selectedEvent.id);
    
    if (currentIndex < dayEvents.length - 1) {
      const nextEvent = dayEvents[currentIndex + 1];
      console.log('📸 Navigating to next event:', nextEvent.title, 'Image URL:', nextEvent.extendedProps?.lead?.image_url);
      setSelectedEvent(createEventSnapshot(nextEvent));
    }
  };

  const getNavigationState = () => {
    const dayEvents = getEventsForSelectedDay();
    const currentIndex = dayEvents.findIndex(event => event.id === selectedEvent.id);
    
    return {
      canGoPrevious: currentIndex > 0,
      canGoNext: currentIndex < dayEvents.length - 1,
      currentIndex: currentIndex + 1,
      totalEvents: dayEvents.length
    };
  };

  const handleEditNotes = () => {
    const currentNotes = selectedEvent.extendedProps?.lead?.notes || '';
    setNotesText(currentNotes);
    setEditingNotes(true);
  };

  const handleSaveNotes = async () => {
    if (!selectedEvent?.id) return;
    
    const currentNotes = selectedEvent.extendedProps?.lead?.notes || '';
    const newNotes = notesText.trim();
    
    // Don't save if notes haven't changed
    if (currentNotes === newNotes) {
      setEditingNotes(false);
      return;
    }
    
    setUpdatingNotes(true);
    try {
      const response = await axios.patch(`/api/leads/${selectedEvent.id}/notes`, {
        notes: newNotes,
        oldNotes: currentNotes
      });
      
      // Update the event with new notes
      setEvents(prevEvents => 
        prevEvents.map(event => 
          event.id === selectedEvent.id 
            ? {
                ...event,
                extendedProps: {
                  ...event.extendedProps,
                  lead: {
                    ...event.extendedProps.lead,
                    notes: newNotes
                  }
                }
              }
            : event
        )
      );
      
      // Update selectedEvent
      setSelectedEvent(prev => ({
        ...prev,
        extendedProps: {
          ...prev.extendedProps,
          lead: {
            ...prev.extendedProps.lead,
            notes: newNotes
          }
        }
      }));
      
      setEditingNotes(false);
      
      // Show success message with details
      const changeType = currentNotes ? 'modified' : 'added';
      alert(`Notes ${changeType} successfully by ${response.data.updatedBy}!`);
      
    } catch (error) {
      console.error('Error updating notes:', error);
      if (error.response?.status === 403) {
        alert('Access denied. You may not have permission to edit this lead.');
      } else {
        alert('Failed to update notes. Please try again.');
      }
    } finally {
      setUpdatingNotes(false);
    }
  };

  const handleCancelNotes = () => {
    setEditingNotes(false);
    setNotesText('');
  };

  const getBookingPreview = () => {
    if (!selectedDate) return null;
    
    const selectedDateTime = selectedDate.date;
    const endDateTime = new Date(selectedDateTime);
    endDateTime.setHours(endDateTime.getHours() + 1); // 1-hour slots
    
    return {
      date: selectedDateTime.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      time: `${selectedDateTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })} - ${endDateTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })}`
    };
  };

  // Helper function to check if a lead has messages needing a reply
  // const hasRepliedMessages = (leadId) => {
  //   try {
  //     console.log(`🕵️ DEBUGGING Lead ID: ${leadId}`);
      
  //     // Find the lead in events
  //     const lead = events.find(event => 
  //       event.leadId === leadId || 
  //       event.id === leadId || 
  //       (event.title && event.title.includes('Tim Wilson'))
  //     );
      
  //     console.log('🕵️ LEAD FOUND:', JSON.stringify(lead, null, 2));
      
  //     if (!lead) {
  //       console.log(`❌ NO LEAD FOUND for ID: ${leadId}`);
  //       return false;
  //     }
      
  //     // Check booking history
  //     const bookingHistory = lead.booking_history || 
  //                            lead.bookingHistory || 
  //                            lead.extendedProps?.lead?.bookingHistory || 
  //                            [];
      
  //     console.log('🔍 FULL BOOKING HISTORY:', JSON.stringify(bookingHistory, null, 2));
      
  //     // Filter SMS messages
  //     const smsMessages = bookingHistory.filter(h => 
  //       ['SMS_SENT', 'SMS_RECEIVED'].includes(h.action)
  //     );
      
  //     console.log('📱 SMS MESSAGES:', JSON.stringify(smsMessages, null, 2));
      
  //     // If no SMS messages, no need for reply
  //     if (smsMessages.length === 0) {
  //       console.log('❌ NO SMS MESSAGES FOUND');
  //       return false;
  //     }
      
  //     // Sort messages by timestamp (most recent first)
  //     smsMessages.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      
  //     // Check the most recent message
  //     const mostRecentSms = smsMessages[0];
      
  //     console.log('🕒 MOST RECENT SMS:', JSON.stringify(mostRecentSms, null, 2));
      
  //     // Detailed check for reply status
  //     const needsReply = mostRecentSms.action === 'SMS_RECEIVED' && 
  //       (!mostRecentSms.details || mostRecentSms.details.replied !== true);
      
  //     console.log(`🚨 NEEDS REPLY: ${needsReply}`);
  //     console.log(`📨 Most recent SMS action: ${mostRecentSms.action}`);
  //     console.log(`📨 Most recent SMS details: ${JSON.stringify(mostRecentSms.details)}`);
      
  //     return needsReply;
  //   } catch (error) {
  //     console.error('🔥 ERROR in hasRepliedMessages:', error);
  //     return false;
  //   }
  // };

  // Customize event rendering to include message indicator
  // const renderEventContent = (eventInfo) => {
  //   const lead = eventInfo.event.extendedProps;
  //   const hasUnrepliedMessage = hasRepliedMessages(lead.id || lead.leadId);

  //   return (
  //     <div className="flex items-center justify-between">
  //       <div className="flex items-center space-x-2">
  //         <span>{eventInfo.timeText}</span>
  //         {hasUnrepliedMessage && (
  //           <span className="relative ml-1">
  //             <FiMessageSquare className="inline-block text-gray-400" />
  //             <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-white" />
  //           </span>
  //         )}
  //       </div>
  //       <span>{eventInfo.event.title}</span>
  //     </div>
  //   );
  // };

  // Export calendar day to CSV
  const handleExportCalendar = async () => {
    try {
      // Get the exact date from the calendar API
      const calendarApi = calendarRef.current.getApi();
      const viewDate = calendarApi.getDate();

      // Format date in local timezone to avoid UTC conversion issues
      const year = viewDate.getFullYear();
      const month = String(viewDate.getMonth() + 1).padStart(2, '0');
      const day = String(viewDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      console.log(`📥 Exporting calendar for ${dateStr}...`);
      console.log(`📅 View date:`, viewDate);
      console.log(`📅 Formatted date string:`, dateStr);

      const response = await axios.get(`/api/leads/calendar/export-csv?date=${dateStr}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        responseType: 'blob'
      });

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `calendar_${dateStr}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      console.log(`✅ Calendar exported successfully for ${dateStr}`);
    } catch (error) {
      console.error('Error exporting calendar:', error);
      alert('Failed to export calendar. Please try again.');
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4 lg:space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 w-full sm:w-auto">
          <div className="w-full sm:w-auto">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-lg sm:text-xl font-semibold text-gray-900">Calendar</h1>

              {/* Real-time Connection Status */}
              <div className="flex items-center space-x-1 sm:space-x-2">
                <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${
                  isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                }`}></div>
                <span className={`text-xs ${
                  isConnected ? 'text-green-600' : 'text-red-600'
                }`}>
                  {isConnected ? 'Live' : 'Offline'}
                </span>
              </div>

              {/* Event Count - hide on very small screens */}
              <div className="hidden sm:flex items-center space-x-2 sm:space-x-3 text-xs text-gray-500">
                <span>📅 {events.length}</span>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              {events.length} events • Updated {lastUpdated.toLocaleTimeString()}
            </p>
          </div>
        </div>

        {/* Legend - wrap on mobile */}
        <div className="flex items-center space-x-2 sm:space-x-4 w-full sm:w-auto overflow-x-auto">
          <div className="flex items-center space-x-2 text-xs sm:text-sm text-gray-600 whitespace-nowrap">
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 sm:w-3 sm:h-3 bg-blue-500 rounded"></div>
              <span className="hidden sm:inline">New</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 sm:w-3 sm:h-3 bg-green-500 rounded"></div>
              <span className="hidden sm:inline">Booked</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 sm:w-3 sm:h-3 bg-purple-500 rounded"></div>
              <span className="hidden sm:inline">Attended</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 sm:w-3 sm:h-3 bg-red-500 rounded"></div>
              <span className="hidden sm:inline">Cancelled</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar and Export Button */}
      <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative w-full sm:max-w-md">
          <div className="absolute inset-y-0 left-0 pl-2 sm:pl-3 flex items-center pointer-events-none">
            <FiSearch className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search leads..."
            className="block w-full pl-8 sm:pl-10 pr-8 sm:pr-10 py-2 border border-gray-300 rounded-md text-sm bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          {searchTerm && (
            <div className="absolute inset-y-0 right-0 pr-2 sm:pr-3 flex items-center">
              <button
                onClick={() => setSearchTerm('')}
                className="text-gray-400 hover:text-gray-600 focus:outline-none touch-target"
              >
                <FiX className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
            </div>
          )}
          {searchTerm && (
            <p className="mt-2 text-xs sm:text-sm text-gray-600">
              Found {events.filter(event => {
                const search = searchTerm.toLowerCase();
                const leadName = event.extendedProps?.lead?.name || event.title || '';
                const leadPhone = event.extendedProps?.phone || '';
                const leadEmail = event.extendedProps?.lead?.email || '';
                return (
                  leadName.toLowerCase().includes(search) ||
                  leadPhone.includes(search) ||
                  leadEmail.toLowerCase().includes(search)
                );
              }).length} results
            </p>
          )}
        </div>

        {/* Export Calendar Button - Only show in day view */}
        {currentView === 'timeGridDay' && (
          <button
            onClick={handleExportCalendar}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors whitespace-nowrap"
          >
            <FiDownload className="h-4 w-4" />
            <span className="text-sm font-medium">Export Day to CSV</span>
          </button>
        )}
      </div>

      {/* Calendar */}
      <div className="mobile-card overflow-x-auto">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          initialDate={new Date()}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: window.innerWidth < 640 ? '' : 'dayGridMonth,timeGridWeek,timeGridDay'
          }}
          buttonText={{
            today: window.innerWidth < 640 ? 'Today' : 'Today',
            month: window.innerWidth < 640 ? 'M' : 'Month',
            week: window.innerWidth < 640 ? 'W' : 'Week',
            day: window.innerWidth < 640 ? 'D' : 'Day'
          }}
          weekends={true}
          firstDay={1}
          events={events.filter(event => {
            if (!searchTerm) return true;
            const search = searchTerm.toLowerCase();
            const leadName = event.extendedProps?.lead?.name || event.title || '';
            const leadPhone = event.extendedProps?.phone || '';
            const leadEmail = event.extendedProps?.lead?.email || '';
            return (
              leadName.toLowerCase().includes(search) ||
              leadPhone.includes(search) ||
              leadEmail.toLowerCase().includes(search)
            );
          })}
          dateClick={handleDateTimeClick}
          eventClick={handleEventClick}
          height="auto"
          eventDisplay="block"
          datesSet={(dateInfo) => {
            // PERFORMANCE: Skip this - let initial fetch handle it
            // This was causing duplicate fetches
            console.log('📅 View initialized:', dateInfo.view.type, dateInfo.startStr, 'to', dateInfo.endStr);

            // Track current view and date for export functionality
            setCurrentView(dateInfo.view.type);
            setCurrentDate(dateInfo.start);
          }}
          eventTimeFormat={{
            hour: 'numeric',
            minute: '2-digit',
            meridiem: 'short'
          }}
          slotMinTime="10:00:00"
          slotMaxTime="18:15:00"
          slotDuration="00:30:00"
          slotLabelInterval="00:30:00"
          slotLabelFormat={{
            hour: 'numeric',
            minute: '2-digit',
            meridiem: 'short'
          }}
          allDaySlot={false}
          snapDuration="00:30:00"
          selectConstraint={{
            start: '10:00',
            end: '18:15'
          }}
          timeZone='local'
          eventMaxStack={5}
          moreLinkClick="popover"
          dayMaxEventRows={false}
          forceEventDuration={true}
          defaultTimedEventDuration='00:30:00'
          progressiveEventRendering={true}
          lazyFetching={false}
          slotEventOverlap={false}
          eventOverlap={false}
          displayEventTime={true}
          displayEventEnd={true}
          views={{
            dayGridMonth: {
              dayMaxEventRows: false,
              moreLinkClick: 'popover',
              showNonCurrentDates: true,
              weekNumbers: false,
              fixedWeekCount: false,
              height: 'auto'
            },
            timeGridWeek: {
              allDaySlot: false,
              slotMinTime: '10:00:00',
              slotMaxTime: '18:00:00',
              height: 'auto'
            },
            timeGridDay: {
              allDaySlot: false,
              slotMinTime: '10:00:00',
              slotMaxTime: '18:00:00',
              height: 'auto'
            }
          }}
          eventContent={(arg) => {
            // PERFORMANCE: Skip SMS message processing entirely - too slow
            // This was causing 23+ function calls on every render

            // Only show "A" tag for bookings made BEFORE Friday October 17, 2025
            // Strict rule: No A tags for bookings from Oct 17, 2025 onwards
            const cutoffDate = new Date('2025-10-17T00:00:00');
            cutoffDate.setHours(0, 0, 0, 0);

            // Check when the booking was MADE (booked_at), not the appointment date
            const bookedAtDate = arg.event.extendedProps?.booked_at
              ? new Date(arg.event.extendedProps.booked_at)
              : null;

            // Show A tag ONLY if booking was made before October 17, 2025
            const showATag = bookedAtDate && bookedAtDate < cutoffDate;

            return (
              <div className="fc-event-main p-2 flex items-center justify-between h-full">
                <div className="fc-event-title-container flex-1 overflow-hidden">
                  <div className="fc-event-title text-sm font-semibold">
                    {arg.timeText && <span className="font-bold mr-1">{arg.timeText} </span>}
                    <span className="inline-flex items-center gap-1">
                      {showATag && (
                        <span className="bg-gray-500 text-white px-2 py-1 rounded text-xs font-semibold">A</span>
                      )}
                      {arg.event.title}
                    </span>
                  </div>
                </div>
              </div>
            );
          }}
        />
      </div>



      {/* Lead Form Modal */}
      {showLeadFormModal && selectedDate && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 h-full w-full z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="relative mx-auto p-6 border w-full max-w-5xl shadow-lg rounded-lg bg-white calendar-modal-scroll max-h-[95vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900">
                  {leadForm._id ? (leadForm.isReschedule ? 'Reschedule Appointment' : 'Book Existing Lead') : 'Create New Booking'}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {leadForm._id ? (leadForm.isReschedule ? 'Choose a new date and time for the appointment' : 'Schedule appointment for existing lead') : 'Fill in the lead information for the booking'}
                </p>
              </div>
              <button
                onClick={() => setShowLeadFormModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <FiX className="h-6 w-6" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Lead Form */}
              <div className="space-y-6">
                <h4 className="text-md font-medium text-gray-900 border-b pb-2">Lead Information</h4>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <FiUser className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        name="name"
                        value={leadForm.name}
                        onChange={handleFormChange}
                        className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter full name"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <FiPhone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <input
                        type="tel"
                        name="phone"
                        value={leadForm.phone}
                        onChange={handleFormChange}
                        className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter phone number"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <div className="relative">
                      <FiMail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <input
                        type="email"
                        name="email"
                        value={leadForm.email}
                        onChange={handleFormChange}
                        className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter email address"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Postcode</label>
                    <div className="relative">
                      <FiMapPin className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        name="postcode"
                        value={leadForm.postcode}
                        onChange={handleFormChange}
                        className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter postcode"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select
                      name="status"
                      value={leadForm.status}
                      onChange={handleFormChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="New">New</option>
                      <option value="Contacted">Contacted</option>
                      <option value="Booked">Booked</option>
                      <option value="Attended">Attended</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <div className="relative">
                      <FiFileText className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <textarea
                        name="notes"
                        value={leadForm.notes}
                        onChange={handleFormChange}
                        rows="3"
                        className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Additional notes..."
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Booking Preview */}
              <div className="space-y-6">
                <h4 className="text-md font-medium text-gray-900 border-b pb-2">Booking Preview</h4>
                
                {/* Send options */}
                <div className="bg-white border rounded-lg p-4">
                  <p className="text-sm font-medium text-gray-900 mb-2">Send booking confirmation via</p>
                  <div className="flex items-center space-x-6">
                    <label className="inline-flex items-center space-x-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                        checked={sendEmail}
                        onChange={(e) => setSendEmail(e.target.checked)}
                      />
                      <span className="text-sm text-gray-700">Email</span>
                    </label>
                    <label className="inline-flex items-center space-x-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                        checked={sendSms}
                        onChange={(e) => setSendSms(e.target.checked)}
                      />
                      <span className="text-sm text-gray-700">Text (SMS)</span>
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Both are checked by default. Uncheck to prevent sending.</p>

                  {/* Template Selector */}
                  {(sendEmail || sendSms) && (
                    <div className="mt-3">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Select Template
                      </label>
                      {bookingTemplates.length > 0 ? (
                        <>
                          <select
                            value={selectedTemplateId || ''}
                            onChange={(e) => setSelectedTemplateId(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {bookingTemplates.map((template) => (
                              <option key={template._id} value={template._id}>
                                {template.name} {(template.email_account || template.emailAccount) === 'secondary' ? '(Camry)' : '(Avensis)'}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-500 mt-1">
                            Template determines which email account to use
                          </p>
                        </>
                      ) : (
                        <div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-3">
                          ⚠️ No active booking confirmation templates found. Please create one in the Templates page.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-gray-50 rounded-lg p-4 space-y-4">
                  {/* Simple Date & Time Picker */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">New Date</label>
                      <input
                        type="date"
                        value={selectedDate ? selectedDate.dateStr.slice(0, 10) : ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            const newDate = new Date(e.target.value + 'T12:00:00');
                            setSelectedDate({ 
                              dateStr: newDate.toISOString(), 
                              date: newDate 
                            });
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">New Time</label>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={selectedDate ? selectedDate.date.getHours() : 9}
                          onChange={(e) => {
                            if (selectedDate) {
                              const newDate = new Date(selectedDate.date);
                              newDate.setHours(parseInt(e.target.value), newDate.getMinutes());
                              setSelectedDate({ 
                                dateStr: newDate.toISOString(), 
                                date: newDate 
                              });
                            }
                          }}
                          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {Array.from({length: 24}, (_, i) => (
                            <option key={i} value={i}>
                              {i === 0 ? '12 AM' : i === 12 ? '12 PM' : i > 12 ? `${i-12} PM` : `${i} AM`}
                            </option>
                          ))}
                        </select>
                        
                        <select
                          value={selectedDate ? selectedDate.date.getMinutes() : 0}
                          onChange={(e) => {
                            if (selectedDate) {
                              const newDate = new Date(selectedDate.date);
                              newDate.setMinutes(parseInt(e.target.value));
                              setSelectedDate({ 
                                dateStr: newDate.toISOString(), 
                                date: newDate 
                              });
                            }
                          }}
                          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {Array.from({length: 60}, (_, i) => (
                            <option key={i} value={i}>
                              {i.toString().padStart(2, '0')}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <FiCalendar className="h-5 w-5 text-blue-500" />
                    <div>
                      <p className="font-medium text-gray-900">Date & Time</p>
                      <p className="text-sm text-gray-600">{getBookingPreview()?.date}</p>
                      <p className="text-sm text-gray-600">{getBookingPreview()?.time}</p>
                    </div>
                  </div>

                  {leadForm.name && (
                    <div className="flex items-center space-x-3">
                      <FiUser className="h-5 w-5 text-green-500" />
                      <div>
                        <p className="font-medium text-gray-900">Client</p>
                        <p className="text-sm text-gray-600">{leadForm.name}</p>
                      </div>
                    </div>
                  )}

                  {leadForm.phone && (
                    <div className="flex items-center space-x-3">
                      <FiPhone className="h-5 w-5 text-purple-500" />
                      <div>
                        <p className="font-medium text-gray-900">Phone</p>
                        <p className="text-sm text-gray-600">{leadForm.phone}</p>
                      </div>
                    </div>
                  )}

                  {leadForm.email && (
                    <div className="flex items-center space-x-3">
                      <FiMail className="h-5 w-5 text-orange-500" />
                      <div>
                        <p className="font-medium text-gray-900">Email</p>
                        <p className="text-sm text-gray-600">{leadForm.email}</p>
                      </div>
                    </div>
                  )}

                  {leadForm.postcode && (
                    <div className="flex items-center space-x-3">
                      <FiMapPin className="h-5 w-5 text-red-500" />
                      <div>
                        <p className="font-medium text-gray-900">Postcode</p>
                        <p className="text-sm text-gray-600">{leadForm.postcode}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center space-x-3">
                    <div className={`w-5 h-5 rounded ${getEventColor(leadForm.status, leadForm.hasSale)}`} style={{backgroundColor: getEventColor(leadForm.status, leadForm.hasSale)}}></div>
                    <div>
                      <p className="font-medium text-gray-900">Status</p>
                      <span className={getStatusBadgeClass(leadForm.status)}>
                        {leadForm.status}
                      </span>
                    </div>
                  </div>

                  {leadForm.notes && (
                    <div className="pt-2 border-t border-gray-200">
                      <p className="font-medium text-gray-900 mb-1">Notes</p>
                      <p className="text-sm text-gray-600">{leadForm.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-8 flex justify-end space-x-3 pt-6 border-t">
              <button
                onClick={() => setShowLeadFormModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBooking}
                className="btn-primary"
              >
                {leadForm._id ? 'Book Appointment' : 'Save Booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Detail Modal - Wide Layout with Full Details */}
      {showEventModal && selectedEvent && selectedEvent.start && (() => {
        // Debug logging for image URL
        console.log('🖼️ Modal opened - Full selectedEvent:', {
          id: selectedEvent.id,
          title: selectedEvent.title,
          hasExtendedProps: !!selectedEvent.extendedProps,
          hasLead: !!selectedEvent.extendedProps?.lead,
          leadKeys: selectedEvent.extendedProps?.lead ? Object.keys(selectedEvent.extendedProps.lead) : [],
          image_url: selectedEvent.extendedProps?.lead?.image_url,
          image_url_type: typeof selectedEvent.extendedProps?.lead?.image_url,
          image_url_length: selectedEvent.extendedProps?.lead?.image_url?.length
        });
        return true;
      })() && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="relative w-full max-w-5xl bg-white rounded-lg shadow-2xl max-h-[95vh] overflow-y-auto calendar-modal-scroll flex flex-col">
            {/* Header: Photo and Main Details Top Right */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-3 sm:p-4">
              {/* Main Details */}
              <div className="flex-1 mb-2 sm:mb-0 mt-10 sm:mt-0">
                <h3 className="text-lg sm:text-xl font-bold text-white mb-1">
                  {selectedEvent.extendedProps?.lead?.name || selectedEvent.title}
                  {selectedEvent.extendedProps?.lead?.age && (
                    <span className="text-white/90 font-normal ml-2">({selectedEvent.extendedProps.lead.age})</span>
                  )}
                </h3>
                <div className="flex items-center space-x-3">
                  <span className={`${getStatusBadgeClass(selectedEvent.extendedProps?.status)} px-3 py-1 rounded-lg text-sm font-medium`}>
                    {selectedEvent.extendedProps?.status || 'Scheduled'}
                  </span>
                  {selectedEvent.extendedProps?.isConfirmed && (
                    <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium bg-white/20 text-white">
                      <FiCheck className="h-4 w-4 mr-2" />
                      Confirmed
                    </span>
                  )}
                </div>
              </div>
              {/* Photo Top Right */}
              <div className="relative ml-0 sm:ml-4 absolute top-3 right-3 sm:static">
                <div
                  className="cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => {
                    if (selectedEvent.extendedProps?.lead?.image_url) {
                      console.log('🖼️ Opening image:', selectedEvent.extendedProps.lead.image_url);
                      setLightboxImage(selectedEvent.extendedProps.lead.image_url);
                    }
                  }}
                >
                  <LazyImage
                    key={`${selectedEvent.id}-${selectedEvent.extendedProps?.lead?.image_url || 'no-image'}`}
                    src={getOptimizedImageUrl(selectedEvent.extendedProps?.lead?.image_url, 'optimized')}
                    alt={selectedEvent.extendedProps?.lead?.name || selectedEvent.title}
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl border-2 border-white shadow-lg object-cover"
                    fallbackClassName="w-16 h-16 sm:w-20 sm:h-20 rounded-xl border-2 border-white shadow-lg bg-white flex items-center justify-center"
                    lazy={false}
                    preload={true}
                    onError={() => {
                      console.error('❌ Image failed to load:', selectedEvent.extendedProps?.lead?.image_url);
                    }}
                    onLoad={() => {
                      console.log('✅ Image loaded successfully:', selectedEvent.extendedProps?.lead?.image_url);
                    }}
                  />
                </div>
                {/* Status indicator */}
                <div className={`absolute -bottom-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 border-white shadow-lg ${
                  selectedEvent.extendedProps?.status === 'Attended' ? 'bg-green-500' :
                  selectedEvent.extendedProps?.status === 'Booked' ? 'bg-blue-500' :
                  selectedEvent.extendedProps?.status === 'Cancelled' ? 'bg-red-500' :
                  'bg-gray-400'
                }`}></div>
              </div>

              {/* Navigation arrows with close button centered at top */}
              {(() => {
                const navState = getNavigationState();
                return (
                  <div className="absolute top-3 left-1/2 transform -translate-x-1/2 flex space-x-1 sm:space-x-2 z-10">
                    <button
                      onClick={navigateToPreviousBooking}
                      disabled={!navState.canGoPrevious}
                      className={`p-1.5 sm:p-2 rounded-full bg-white/20 backdrop-blur-sm transition-all duration-200 ${
                        navState.canGoPrevious
                          ? 'text-white hover:text-gray-900 hover:bg-white/40 shadow-lg'
                          : 'text-white/30 cursor-not-allowed bg-white/10'
                      }`}
                      title="Previous booking"
                    >
                      <FiChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                    <button
                      onClick={() => setShowEventModal(false)}
                      className="p-1.5 sm:p-2 rounded-full bg-white/20 backdrop-blur-sm text-white hover:text-gray-900 hover:bg-white/40 transition-all duration-200 shadow-lg"
                      title="Close"
                    >
                      <FiX className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                    <button
                      onClick={navigateToNextBooking}
                      disabled={!navState.canGoNext}
                      className={`p-1.5 sm:p-2 rounded-full bg-white/20 backdrop-blur-sm transition-all duration-200 ${
                        navState.canGoNext
                          ? 'text-white hover:text-gray-900 hover:bg-white/40 shadow-lg'
                          : 'text-white/30 cursor-not-allowed bg-white/10'
                      }`}
                      title="Next booking"
                    >
                      <FiChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                  </div>
                );
              })()}
            </div>
            {/* Main Info Center */}
            <div className="p-4 flex-1">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left Column - Contact Information */}
                <div>
                  <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center">
                    <FiUser className="h-4 w-4 mr-2 text-indigo-600" />
                    Contact Information
                  </h4>
                  <div className="space-y-3">
                    {/* Date and Time */}
                    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg p-3">
                      <div className="flex items-start space-x-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center flex-shrink-0">
                          <FiCalendar className="h-4 w-4 text-white" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-medium text-indigo-600 uppercase tracking-wide">Appointment Date & Time</p>
                          <p className="text-sm font-bold text-gray-900">
                            {selectedEvent.start ? new Date(selectedEvent.start).toLocaleDateString('en-US', {
                              weekday: 'long',
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            }) : 'Date not available'}
                          </p>
                          <p className="text-xs text-gray-600 flex items-center">
                            <FiClock className="h-3 w-3 mr-1" />
                            {selectedEvent.start ? formatEventTime(selectedEvent) : 'Time not available'}
                          </p>
                        </div>
                      </div>
                    </div>
                    {/* Phone */}
                    {selectedEvent.extendedProps?.phone && (
                      <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-3">
                        <div className="flex items-start space-x-3">
                          <div className="w-8 h-8 rounded-lg bg-purple-500 flex items-center justify-center flex-shrink-0">
                            <FiPhone className="h-4 w-4 text-white" />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-medium text-purple-600 uppercase tracking-wide">Phone Number</p>
                            <p className="text-sm font-bold text-gray-900">{selectedEvent.extendedProps.phone}</p>
                            <a href={`tel:${selectedEvent.extendedProps.phone}`} className="text-xs text-purple-600 hover:text-purple-800 transition-colors">
                              Click to call →
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Email */}
                    {selectedEvent.extendedProps?.lead?.email && (
                      <div className="bg-gradient-to-r from-pink-50 to-rose-50 rounded-lg p-3">
                        <div className="flex items-start space-x-3">
                          <div className="w-8 h-8 rounded-lg bg-pink-500 flex items-center justify-center flex-shrink-0">
                            <FiMail className="h-4 w-4 text-white" />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-medium text-pink-600 uppercase tracking-wide">Email Address</p>
                            <p className="text-sm font-bold text-gray-900 break-all">{selectedEvent.extendedProps.lead.email}</p>
                            <a href={`mailto:${selectedEvent.extendedProps.lead.email}`} className="text-xs text-pink-600 hover:text-pink-800 transition-colors">
                              Send email →
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Postcode */}
                    {selectedEvent.extendedProps?.lead?.postcode && (
                      <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-lg p-3">
                        <div className="flex items-start space-x-3">
                          <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center flex-shrink-0">
                            <FiMapPin className="h-4 w-4 text-white" />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-medium text-orange-600 uppercase tracking-wide">Postcode</p>
                            <p className="text-sm font-bold text-gray-900">{selectedEvent.extendedProps.lead.postcode}</p>
                            <a href={`https://maps.google.com/maps?q=${selectedEvent.extendedProps.lead.postcode}`} target="_blank" rel="noopener noreferrer" className="text-xs text-orange-600 hover:text-orange-800 transition-colors">
                              View on map →
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* Right Column - Details & Actions */}
                <div>
                  <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center">
                    <FiSettings className="h-4 w-4 mr-2 text-indigo-600" />
                    Details & Actions
                  </h4>
                  <div className="space-y-3">
                    {/* Send options (applies to next booking/reschedule) */}
                    <div className="bg-white border border-gray-100 rounded-lg p-3">
                      <h5 className="text-sm font-bold text-gray-900 mb-2">Booking confirmation channels</h5>
                      <div className="flex items-center space-x-6">
                        <label className="inline-flex items-center space-x-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                            checked={sendEmail}
                            onChange={(e) => setSendEmail(e.target.checked)}
                          />
                          <span className="text-sm text-gray-700">Email</span>
                        </label>
                        <label className="inline-flex items-center space-x-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                            checked={sendSms}
                            onChange={(e) => setSendSms(e.target.checked)}
                          />
                          <span className="text-sm text-gray-700">Text (SMS)</span>
                        </label>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">These settings apply when you reschedule from this modal.</p>

                      {/* Template Selector for Reschedule */}
                      {(sendEmail || sendSms) && (
                        <div className="mt-3">
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Select Template
                          </label>
                          {bookingTemplates.length > 0 ? (
                            <>
                              <select
                                value={selectedTemplateId || ''}
                                onChange={(e) => setSelectedTemplateId(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                              >
                                {bookingTemplates.map((template) => (
                                  <option key={template._id} value={template._id}>
                                    {template.name} {(template.email_account || template.emailAccount) === 'secondary' ? '(Camry)' : '(Avensis)'}
                                  </option>
                                ))}
                              </select>
                              <p className="text-xs text-gray-500 mt-1">
                                Template determines which email account to use
                              </p>
                            </>
                          ) : (
                            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
                              ⚠️ No active booking templates found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Assigned User */}
                    {selectedEvent.extendedProps?.booker && (
                      <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-3">
                        <div className="flex items-start space-x-3">
                          <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0">
                            <FiUser className="h-4 w-4 text-white" />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-medium text-green-600 uppercase tracking-wide">Assigned To</p>
                            <p className="text-sm font-bold text-gray-900">{selectedEvent.extendedProps.booker}</p>
                            <p className="text-xs text-green-600">Account Manager</p>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Quick Status Actions */}
                    <div className="bg-white border border-gray-100 rounded-lg p-3">
                      <h5 className="text-sm font-bold text-gray-900 mb-2 flex items-center">
                        <FiActivity className="h-4 w-4 mr-2 text-indigo-600" />
                        Quick Status Update
                      </h5>
                      {(() => {
                        const isBooked = selectedEvent.extendedProps?.status === 'Booked';
                        const isConfirmed = !!selectedEvent.extendedProps?.isConfirmed;
                        
                        // Determine current status with better fallback logic
                        let currentDisplayStatus = selectedEvent.extendedProps?.displayStatus || selectedEvent.extendedProps?.bookingStatus;
                        
                        // If no displayStatus/bookingStatus, determine from other props
                        if (!currentDisplayStatus) {
                          if (isBooked && isConfirmed) {
                            currentDisplayStatus = 'Confirmed';
                          } else if (isBooked && isConfirmed === false) {
                            currentDisplayStatus = 'Unconfirmed';
                          } else if (isBooked) {
                            currentDisplayStatus = 'Booked';
                          } else {
                            currentDisplayStatus = selectedEvent.extendedProps?.status || 'Unknown';
                          }
                        }
                        
                        const isCurrentlyConfirmed = currentDisplayStatus === 'Confirmed';
                        const isCurrentlyUnconfirmed = currentDisplayStatus === 'Unconfirmed';
                        const isCurrentlyArrived = currentDisplayStatus === 'Arrived';
                        const isCurrentlyLeft = currentDisplayStatus === 'Left';
                        const isCurrentlyNoSale = currentDisplayStatus === 'No Sale';
                        const isCurrentlyNoShow = currentDisplayStatus === 'No Show';
                        const isCurrentlyCancelled = currentDisplayStatus === 'Cancelled';
                        
                        // Debug log to help identify the issue
                        console.log('Calendar Status Debug:', {
                          status: selectedEvent.extendedProps?.status,
                          isConfirmed: selectedEvent.extendedProps?.isConfirmed,
                          displayStatus: selectedEvent.extendedProps?.displayStatus,
                          bookingStatus: selectedEvent.extendedProps?.bookingStatus,
                          currentDisplayStatus,
                          isCurrentlyConfirmed,
                          isCurrentlyUnconfirmed,
                          isCurrentlyArrived
                        });
                        
                        // Check permissions for button visibility
                        // const canChangeStatus = user?.role === 'admin' || user?.role === 'viewer' || user?.role === 'booker';
                        const isAssignedLead = selectedEvent.extendedProps?.lead?.booker === user?.id;
                        const canChangeConfirmation = user?.role === 'admin' || user?.role === 'viewer' || user?.role === 'booker';
                        const canChangeOtherStatuses = user?.role === 'admin' || user?.role === 'viewer';
                        const canCancelBooking = user?.role === 'admin' || user?.role === 'viewer' || user?.role === 'booker';
                        
                        return (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            {/* Confirm/Unconfirm buttons - visible to all authorized users */}
                            {canChangeConfirmation && (
                              <>
                                <button
                                  onClick={() => handleEventStatusChange('Confirmed')}
                                  disabled={isCurrentlyConfirmed}
                                  className={`relative overflow-hidden group flex items-center justify-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                    isCurrentlyConfirmed
                                      ? 'bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg transform scale-105'
                                      : 'bg-gradient-to-r from-emerald-400 to-green-500 text-white hover:from-green-500 hover:to-emerald-600 hover:shadow-lg hover:scale-105'
                                  }`}
                                >
                                  <FiCalendar className="h-4 w-4" />
                                  <span>{isCurrentlyConfirmed ? '✓ Confirmed' : 'Confirm'}</span>
                                </button>
                                <button
                                  onClick={() => handleEventStatusChange('Unconfirmed')}
                                  disabled={isCurrentlyUnconfirmed}
                                  className={`relative overflow-hidden group flex items-center justify-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                    isCurrentlyUnconfirmed
                                      ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg transform scale-105'
                                      : 'bg-gradient-to-r from-orange-400 to-amber-400 text-white hover:from-orange-500 hover:to-amber-500 hover:shadow-lg hover:scale-105'
                                  }`}
                                >
                                  <FiClock className="h-4 w-4" />
                                  <span>{isCurrentlyUnconfirmed ? '✓ Unconfirmed' : 'Unconfirm'}</span>
                                </button>
                              </>
                            )}
                            
                            {/* Cancel button - visible to bookers, admins, and viewers */}
                            {canCancelBooking && (
                              <button
                                onClick={() => handleEventStatusChange('Cancelled')}
                                disabled={isCurrentlyCancelled}
                                className={`relative overflow-hidden group flex items-center justify-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 col-span-2 ${
                                  isCurrentlyCancelled
                                    ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-lg transform scale-105'
                                    : 'bg-gradient-to-r from-rose-400 to-rose-500 text-white hover:from-rose-500 hover:to-pink-500 hover:shadow-lg hover:scale-105'
                                }`}
                              >
                                <FiX className="h-4 w-4" />
                                <span>{isCurrentlyCancelled ? '✓ Cancelled' : 'Cancel'}</span>
                              </button>
                            )}
                            
                            {/* Other status buttons - only visible to users with appropriate permissions */}
                            {canChangeOtherStatuses && (
                              <>
                                <button
                                  onClick={() => handleEventStatusChange('Arrived')}
                                  disabled={isCurrentlyArrived}
                                  className={`flex items-center justify-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium text-white transition-all duration-300 ${
                                    isCurrentlyArrived ? 'shadow-lg transform scale-105' : 'hover:shadow-lg hover:scale-105'
                                  }`}
                                  style={{ backgroundColor: '#e06666' }}
                                >
                                  <FiCheck className="h-4 w-4" />
                                  <span>{isCurrentlyArrived ? '✓ Arrived' : 'Arrived'}</span>
                                </button>
                                <button
                                  onClick={() => handleEventStatusChange('Left')}
                                  disabled={isCurrentlyLeft}
                                  className={`flex items-center justify-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium text-white transition-all duration-300 ${
                                    isCurrentlyLeft ? 'shadow-lg transform scale-105' : 'hover:shadow-lg hover:scale-105'
                                  }`}
                                  style={{ backgroundColor: '#000000' }}
                                >
                                  <FiExternalLink className="h-4 w-4" />
                                  <span>{isCurrentlyLeft ? '✓ Left' : 'Left'}</span>
                                </button>
                              </>
                            )}
                          </div>
                          {/* Expandable more statuses */}
                          {canChangeOtherStatuses && (
                            <div className="mt-2 flex justify-end">
                              <button
                                onClick={() => setShowMoreStatuses(!showMoreStatuses)}
                                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                              >
                                {showMoreStatuses ? 'Hide' : 'More'}
                              </button>
                            </div>
                          )}
                          {showMoreStatuses && canChangeOtherStatuses && (
                            <div className="grid grid-cols-2 gap-2 mt-2">
                              <button
                                onClick={() => handleEventStatusChange('No Sale')}
                                disabled={isCurrentlyNoSale}
                                className={`relative overflow-hidden group flex items-center justify-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium text-white transition-all duration-300 ${
                                  isCurrentlyNoSale 
                                    ? 'bg-gradient-to-r from-red-700 to-rose-700 shadow-lg transform scale-105' 
                                    : 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 hover:shadow-lg hover:scale-105'
                                }`}
                              >
                                <FiX className="h-4 w-4" />
                                <span>{isCurrentlyNoSale ? '✓ No Sale' : 'No Sale'}</span>
                              </button>
                              <button
                                onClick={() => handleEventStatusChange('No Show')}
                                disabled={isCurrentlyNoShow}
                                className={`relative overflow-hidden group flex items-center justify-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                  isCurrentlyNoShow
                                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg transform scale-105'
                                    : 'bg-gradient-to-r from-amber-400 to-amber-500 text-white hover:from-amber-500 hover:to-orange-500 hover:shadow-lg hover:scale-105'
                                }`}
                              >
                                <FiX className="h-4 w-4" />
                                <span>{isCurrentlyNoShow ? '✓ No Show' : 'No Show'}</span>
                              </button>
                              {/* Complete Sale button - Only for admin and viewer */}
                              <button
                                onClick={() => {
                                  if (user?.role === 'viewer' || user?.role === 'admin') {
                                    setShowSaleModal(true);
                                  }
                                }}
                                disabled={selectedEvent.extendedProps?.status === 'Attended' || !(user?.role === 'admin' || user?.role === 'viewer')}
                                className={`relative overflow-hidden group flex items-center justify-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                  selectedEvent.extendedProps?.status === 'Attended'
                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg transform scale-105'
                                    : 'bg-gradient-to-r from-emerald-400 to-emerald-500 text-white hover:from-emerald-500 hover:to-teal-500 hover:shadow-lg hover:scale-105'
                                } ${!(user?.role === 'admin' || user?.role === 'viewer') ? 'hidden' : ''}`}
                              >
                                <FiCheckCircle className="h-4 w-4" />
                                <span>{selectedEvent.extendedProps?.status === 'Attended' ? '✓ Complete' : (selectedSale ? 'Edit Sale' : 'Complete')}</span>
                              </button>
                              
                              {/* Reject Lead button - Only for booker and admin */}
                              <button
                                onClick={() => handleRejectLead()}
                                disabled={!(user?.role === 'admin' || user?.role === 'booker')}
                                className={`relative overflow-hidden group flex items-center justify-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                  'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 hover:shadow-lg hover:scale-105 text-white'
                                } ${!(user?.role === 'admin' || user?.role === 'booker') ? 'hidden' : ''}`}
                              >
                                <FiX className="h-4 w-4" />
                                <span>Reject Lead</span>
                              </button>
                            </div>
                          )}
                        </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
              {/* History/Notes at the bottom */}
              <div className="mt-4 pt-3 border-t border-gray-200">
                <div className="flex flex-col space-y-3">
                  {/* SMS Conversation History */}
                  {(() => {
                    const rawHistory = selectedEvent.extendedProps?.lead?.bookingHistory ??
                                       selectedEvent.extendedProps?.lead?.booking_history ?? [];
                    let history = [];
                    try {
                      if (Array.isArray(rawHistory)) {
                        history = rawHistory;
                      } else if (typeof rawHistory === 'string') {
                        history = rawHistory.trim() ? JSON.parse(rawHistory) : [];
                      } else if (rawHistory && typeof rawHistory === 'object') {
                        history = Array.isArray(rawHistory) ? rawHistory : [];
                      }
                    } catch (e) {
                      history = [];
                    }
                    const messages = Array.isArray(history) ? history.filter(h => ['SMS_SENT', 'SMS_RECEIVED', 'SMS_FAILED'].includes(h.action)) : [];
                    const receivedMessages = messages.filter(m => m.action === 'SMS_RECEIVED')
                                                     .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
                    const lastReceived = receivedMessages[0];
                    
                    if (messages.length === 0) return null;
                    
                    return (
                      <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-3">
                        <div className="flex items-start space-x-3">
                          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
                            <FiMessageSquare className="h-4 w-4 text-white" />
                          </div>
                          <div className="flex-1">
                            {/* Collapsible Messages Section */}
                            <>
                                <div 
                                  className="flex items-center space-x-2 mb-2 cursor-pointer hover:bg-blue-200/50 -mx-2 px-2 py-1 rounded transition-colors"
                                  onClick={() => setShowAllMessages(!showAllMessages)}
                                >
                                  <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Messages</p>
                                  <span className="text-xs text-gray-500">({messages.length})</span>
                                  {showAllMessages ? (
                                    <FiChevronUp className="h-4 w-4 text-gray-600" />
                                  ) : (
                                    <FiChevronDown className="h-4 w-4 text-gray-600" />
                                  )}
                                </div>
                            
                            {showAllMessages && (
                              <div 
                                className="max-h-64 overflow-y-auto space-y-2" 
                                id="calendar-messages-container"
                                ref={(el) => {
                                  if (el && messages.length > 0) {
                                    setTimeout(() => {
                                      el.scrollTop = el.scrollHeight;
                                    }, 50);
                                  }
                                }}
                              >
                                {messages
                                  .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
                                  .slice(-8)
                                  .map((message, idx) => (
                                  <div 
                                    key={idx} 
                                    className={`flex ${message.action === 'SMS_SENT' ? 'justify-end' : 'justify-start'}`}
                                  >
                                    <div className={`max-w-xs px-3 py-2 rounded-lg ${
                                      message.action === 'SMS_SENT' 
                                        ? 'bg-blue-500 text-white' 
                                        : message.action === 'SMS_FAILED'
                                          ? 'bg-red-50 border border-red-300 text-red-800'
                                          : 'bg-gray-200 text-gray-800'
                                    }`}>
                                      <p className="text-sm whitespace-pre-wrap">
                                        {message.details?.body || message.details?.message || 'No content'}
                                      </p>
                                      <div className="flex items-center justify-between mt-1">
                                        <p className={`text-xs ${
                                          message.action === 'SMS_SENT' ? 'text-blue-100' : (message.action === 'SMS_FAILED' ? 'text-red-700' : 'text-gray-600')
                                        }`}>
                                        {(() => {
                                          try {
                                            if (!message.timestamp) return 'Unknown time';
                                            
                                            let date;
                                            if (typeof message.timestamp === 'string') {
                                              date = new Date(message.timestamp);
                                            } else if (typeof message.timestamp === 'number') {
                                              date = new Date(message.timestamp > 1000000000000 ? message.timestamp : message.timestamp * 1000);
                                            } else {
                                              date = new Date(message.timestamp);
                                            }
                                            
                                            if (isNaN(date.getTime())) {
                                              return 'Invalid date';
                                            }
                                            
                                            const now = new Date();
                                            const diffMs = now - date;
                                            const diffHours = diffMs / (1000 * 60 * 60);
                                            
                                            if (diffHours < 1) {
                                              const minutes = Math.floor(diffMs / (1000 * 60));
                                              return minutes <= 0 ? 'Just now' : `${minutes} min ago`;
                                            } else if (diffHours < 24) {
                                              return date.toLocaleTimeString([], { 
                                                hour: '2-digit', 
                                                minute: '2-digit', 
                                                hour12: true 
                                              });
                                            } else {
                                              return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { 
                                                hour: '2-digit', 
                                                minute: '2-digit', 
                                                hour12: true 
                                              });
                                            }
                                          } catch (error) {
                                            console.error('Error formatting timestamp:', error, 'Timestamp:', message.timestamp);
                                            return 'Unknown time';
                                          }
                                        })()}
                                        {message.action === 'SMS_SENT' && (
                                          <span className="ml-1">
                                            {message.details?.status === 'sending' ? (
                                              <>
                                                <span className="inline-block w-2 h-2 bg-orange-400 rounded-full animate-pulse mr-1"></span>
                                                Sending...
                                              </>
                                            ) : (
                                              '• Sent'
                                            )}
                                          </span>
                                        )}
                                        </p>
                                        {/* Delivery ticks mirroring MessageModal */}
                                        {message.action === 'SMS_SENT' && message.details?.status !== 'sending' && (
                                          <div className="flex items-center space-x-1">
                                            <svg viewBox="0 0 24 24" className="h-3 w-3 text-blue-100 fill-current"><path d="M20.285 6.708a1 1 0 010 1.414l-9.193 9.193a1 1 0 01-1.414 0l-5.657-5.657a1 1 0 111.414-1.414l4.95 4.95 8.486-8.486a1 1 0 011.414 0z"/></svg>
                                            <svg viewBox="0 0 24 24" className="h-3 w-3 text-blue-100 fill-current"><path d="M20.285 6.708a1 1 0 010 1.414l-9.193 9.193a1 1 0 01-1.414 0l-5.657-5.657a1 1 0 111.414-1.414l4.95 4.95 8.486-8.486a1 1 0 011.414 0z"/></svg>
                                          </div>
                                        )}
                                        {message.action === 'SMS_RECEIVED' && (
                                          <div className="flex items-center"><svg viewBox="0 0 24 24" className="h-3 w-3 text-gray-500 fill-current"><path d="M20.285 6.708a1 1 0 010 1.414l-9.193 9.193a1 1 0 01-1.414 0l-5.657-5.657a1 1 0 111.414-1.414l4.95 4.95 8.486-8.486a1 1 0 011.414 0z"/></svg></div>
                                        )}
                                        {message.action === 'SMS_FAILED' && (
                                          <div className="flex items-center text-red-600" title={message.details?.error_message || 'SMS send failed'}>
                                            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 5v6h-2V7h2zm0 8v2h-2v-2h2z"/></svg>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            
                            {/* Quick Reply Section */}
                            {user?.role !== 'viewer' && selectedEvent.extendedProps?.lead?.phone && showAllMessages && (
                              <div className="mt-3 p-3 bg-white rounded-lg border border-blue-200">
                                <div className="flex space-x-2">
                                  <input
                                    type="text"
                                    placeholder="Type a quick reply..."
                                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    onKeyPress={async (e) => {
                                      if (e.key === 'Enter' && e.target.value.trim()) {
                                        const message = e.target.value.trim();
                                        const leadId = selectedEvent.extendedProps.lead.id;
                                        
                                        // Clear input immediately for better UX
                                        e.target.value = '';
                                        
                                        // Optimistically add the message to local state
                                        const optimisticMessage = {
                                          action: 'SMS_SENT',
                                          timestamp: new Date().toISOString(),
                                          performed_by: user.id,
                                          performed_by_name: user.name,
                                          details: {
                                            message: message,
                                            type: 'custom',
                                            phone: selectedEvent.extendedProps.lead.phone,
                                            status: 'sending'
                                          }
                                        };
                                        
                                        // Update the event's booking history immediately
                                        const currentHistory = selectedEvent.extendedProps.lead.bookingHistory || [];
                                        
                                        // Mark all received messages as read when user replies
                                        const updatedHistoryWithReadStatus = currentHistory.map(entry => {
                                          if (entry.action === 'SMS_RECEIVED' && !entry.details?.read) {
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
                                        
                                        const updatedHistory = [...updatedHistoryWithReadStatus, optimisticMessage];
                                        selectedEvent.extendedProps.lead.bookingHistory = updatedHistory;
                                        
                                        // Force re-render to update notification icon
                                        setEvents(prevEvents => [...prevEvents]);
                                        
                                        try {
                                          const response = await fetch(`/api/leads/${leadId}/send-sms`, {
                                            method: 'POST',
                                            headers: {
                                              'Content-Type': 'application/json',
                                              'Authorization': `Bearer ${localStorage.getItem('token')}`
                                            },
                                            body: JSON.stringify({ message, type: 'custom' })
                                          });
                                          
                                          if (response.ok) {
                                            // Update status to sent
                                            optimisticMessage.details.status = 'sent';
                                            setEvents(prevEvents => [...prevEvents]);
                                            
                                            // Refresh events from server to ensure read status is synced
                                            setTimeout(() => {
                                              debouncedFetchEvents();
                                            }, 1000);
                                          } else {
                                            // Remove the optimistic message on failure
                                            selectedEvent.extendedProps.lead.bookingHistory = currentHistory;
                                            setEvents(prevEvents => [...prevEvents]);
                                            alert('Failed to send SMS');
                                          }
                                        } catch (error) {
                                          // Remove the optimistic message on error
                                          selectedEvent.extendedProps.lead.bookingHistory = currentHistory;
                                          setEvents(prevEvents => [...prevEvents]);
                                          console.error('Error sending SMS:', error);
                                          alert('Error sending SMS');
                                        }
                                      }
                                    }}
                                  />
                                  <button
                                    onClick={async (e) => {
                                      const input = e.target.parentElement.querySelector('input');
                                      const message = input.value.trim();
                                      if (message) {
                                        const leadId = selectedEvent.extendedProps.lead.id;
                                        
                                        // Clear input immediately for better UX
                                        input.value = '';
                                        
                                        // Optimistically add the message to local state
                                        const optimisticMessage = {
                                          action: 'SMS_SENT',
                                          timestamp: new Date().toISOString(),
                                          performed_by: user.id,
                                          performed_by_name: user.name,
                                          details: {
                                            message: message,
                                            type: 'custom',
                                            phone: selectedEvent.extendedProps.lead.phone,
                                            status: 'sending'
                                          }
                                        };
                                        
                                        // Update the event's booking history immediately
                                        const currentHistory = selectedEvent.extendedProps.lead.bookingHistory || [];
                                        
                                        // Mark all received messages as read when user replies
                                        const updatedHistoryWithReadStatus = currentHistory.map(entry => {
                                          if (entry.action === 'SMS_RECEIVED' && !entry.details?.read) {
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
                                        
                                        const updatedHistory = [...updatedHistoryWithReadStatus, optimisticMessage];
                                        selectedEvent.extendedProps.lead.bookingHistory = updatedHistory;
                                        
                                        // Force re-render to update notification icon
                                        setEvents(prevEvents => [...prevEvents]);
                                        
                                        try {
                                          const response = await fetch(`/api/leads/${leadId}/send-sms`, {
                                            method: 'POST',
                                            headers: {
                                              'Content-Type': 'application/json',
                                              'Authorization': `Bearer ${localStorage.getItem('token')}`
                                            },
                                            body: JSON.stringify({ message, type: 'custom' })
                                          });
                                          
                                          if (response.ok) {
                                            // Update status to sent
                                            optimisticMessage.details.status = 'sent';
                                            setEvents(prevEvents => [...prevEvents]);
                                            
                                            // Refresh events from server to ensure read status is synced
                                            setTimeout(() => {
                                              debouncedFetchEvents();
                                            }, 1000);
                                          } else {
                                            // Remove the optimistic message on failure
                                            selectedEvent.extendedProps.lead.bookingHistory = currentHistory;
                                            setEvents(prevEvents => [...prevEvents]);
                                            alert('Failed to send SMS');
                                          }
                                        } catch (error) {
                                          // Remove the optimistic message on error
                                          selectedEvent.extendedProps.lead.bookingHistory = currentHistory;
                                          setEvents(prevEvents => [...prevEvents]);
                                          console.error('Error sending SMS:', error);
                                          alert('Error sending SMS');
                                        }
                                      }
                                    }}
                                    className="px-4 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors"
                                  >
                                    Send
                                  </button>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  Press Enter or click Send to reply to {selectedEvent.extendedProps?.lead?.name}
                                </div>
                              </div>
                            )}
                            </>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  
                  {/* Notes */}
                  <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-lg p-3">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-gray-500 flex items-center justify-center flex-shrink-0">
                        <FiFileText className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Notes</p>
                          {!editingNotes && (
                            <button
                              onClick={handleEditNotes}
                              className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center space-x-1 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                            >
                              <FiEdit className="h-3 w-3" />
                              <span>Edit Notes</span>
                            </button>
                          )}
                        </div>
                        
                        {editingNotes ? (
                          <div className="space-y-3">
                            <div className="relative">
                              <textarea
                                value={notesText}
                                onChange={(e) => setNotesText(e.target.value)}
                                rows="6"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                placeholder="Add detailed notes about this lead..."
                                autoFocus
                              />
                              <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                                {notesText.length} characters
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-gray-500">
                                All users can edit notes • Changes appear in booking history
                              </div>
                              <div className="flex space-x-2">
                                <button
                                  onClick={handleSaveNotes}
                                  disabled={updatingNotes}
                                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center space-x-1"
                                >
                                  {updatingNotes ? (
                                    <>
                                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                                      <span>Saving...</span>
                                    </>
                                  ) : (
                                    <>
                                      <FiCheck className="h-3 w-3" />
                                      <span>Save Notes</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  onClick={handleCancelNotes}
                                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 text-sm font-medium"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div>
                            {selectedEvent.extendedProps?.lead?.notes ? (
                              <div>
                                <p className="text-base text-gray-900 leading-relaxed whitespace-pre-wrap">
                                  {selectedEvent.extendedProps.lead.notes}
                                </p>
                                <div className="mt-2 text-xs text-gray-500">
                                  Click "Edit Notes" to modify
                                </div>
                              </div>
                            ) : (
                              <div className="text-center py-4">
                                <p className="text-base text-gray-500 italic">No notes available</p>
                                <p className="text-xs text-gray-400 mt-1">Click "Edit Notes" to add notes</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Sale Details if exists */}
                  {selectedSale && (
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <h4 className="font-bold text-blue-700 mb-2">Sale Details</h4>
                      <div className="text-sm text-blue-900">
                        <div><b>Amount:</b> £{selectedSale.saleAmount}</div>
                        <div><b>Payment Method:</b> {selectedSale.paymentMethod}</div>
                        <div><b>Notes:</b> {selectedSale.notes || 'None'}</div>
                        <div><b>Recorded By:</b> {selectedSale.user?.name}</div>
                        <div><b>Date:</b> {new Date(selectedSale.bookingDate).toLocaleDateString()}</div>
                      </div>
                    </div>
                  )}
                  {/* Booking History */}
                  {selectedEvent.extendedProps?.lead?.bookingHistory && Array.isArray(selectedEvent.extendedProps.lead.bookingHistory) && (
                    <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-xl p-4 mt-4 max-h-48 overflow-y-auto">
                      <h4 className="text-base font-bold text-green-700 mb-2">📋 Recent Activity</h4>
                      {selectedEvent.extendedProps.lead.bookingHistory
                        .filter(h => ['NOTES_UPDATED', 'INITIAL_BOOKING', 'RESCHEDULE', 'STATUS_CHANGE'].includes(h.action))
                        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                        .slice(0, 5)
                        .map((history, idx) => (
                          <div key={idx} className="flex items-start space-x-2 mb-2 last:mb-0">
                            <div className="mt-1">
                              {history.action === 'NOTES_UPDATED' && <FiFileText className="h-4 w-4 text-blue-500" />}
                              {history.action === 'INITIAL_BOOKING' && <FiCalendar className="h-4 w-4 text-green-500" />}
                              {history.action === 'RESCHEDULE' && <FiClock className="h-4 w-4 text-orange-500" />}
                              {history.action === 'STATUS_CHANGE' && <FiActivity className="h-4 w-4 text-purple-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-gray-700 font-semibold">
                                {history.action === 'NOTES_UPDATED' && 'Notes Updated'}
                                {history.action === 'INITIAL_BOOKING' && 'Appointment Booked'}
                                {history.action === 'RESCHEDULE' && 'Appointment Rescheduled'}
                                {history.action === 'STATUS_CHANGE' && 'Status Changed'}
                                <span className="ml-2 text-gray-400 font-normal">by {history.performedByName}</span>
                                <span className="ml-2 text-gray-400 font-normal">{new Date(history.timestamp).toLocaleString()}</span>
                              </div>
                              
                              {history.action === 'NOTES_UPDATED' && history.details && (
                                <div className="text-xs text-gray-600 mt-1">
                                  <div className="bg-blue-50 p-2 rounded">
                                    <div className="font-medium text-blue-800">
                                      {history.details.changeType === 'added' ? 'Notes Added' : 'Notes Modified'}
                                    </div>
                                    {history.details.oldNotes && (
                                      <div className="text-gray-600 mt-1">
                                        <span className="font-medium">Previous:</span> {history.details.oldNotes.slice(0, 60)}{history.details.oldNotes.length > 60 ? '...' : ''}
                                      </div>
                                    )}
                                    <div className="text-gray-800 mt-1">
                                      <span className="font-medium">New:</span> {history.details.newNotes.slice(0, 60)}{history.details.newNotes.length > 60 ? '...' : ''}
                                    </div>
                                  </div>
                                </div>
                              )}
                              
                              {history.action === 'RESCHEDULE' && history.details && (
                                <div className="text-xs text-gray-600 mt-1">
                                  <div className="bg-orange-50 p-2 rounded">
                                    <div><span className="font-medium">From:</span> {new Date(history.details.oldDate).toLocaleString()}</div>
                                    <div><span className="font-medium">To:</span> {new Date(history.details.newDate).toLocaleString()}</div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      {(!selectedEvent.extendedProps.lead.bookingHistory || !Array.isArray(selectedEvent.extendedProps.lead.bookingHistory) || selectedEvent.extendedProps.lead.bookingHistory.filter(h => ['NOTES_UPDATED', 'INITIAL_BOOKING', 'RESCHEDULE', 'STATUS_CHANGE'].includes(h.action)).length === 0) && (
                        <div className="text-xs text-gray-400 italic">No recent activity</div>
                      )}
                    </div>
                  )}

                  {/* Message History */}
                  {selectedEvent.extendedProps?.lead?.bookingHistory && Array.isArray(selectedEvent.extendedProps.lead.bookingHistory) && (
                    <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-4 mt-4 max-h-48 overflow-y-auto">
                      <h4 className="text-base font-bold text-blue-700 mb-2">Message History</h4>
                      {selectedEvent.extendedProps.lead.bookingHistory
                        .filter(h => ['EMAIL_SENT','EMAIL_RECEIVED','SMS_SENT','SMS_RECEIVED'].includes(h.action))
                        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                        .map((history, idx) => (
                          <div key={idx} className="flex items-start space-x-2 mb-2 last:mb-0">
                            <div className="mt-1">
                              {['EMAIL_SENT','EMAIL_RECEIVED'].includes(history.action) && <FiMail className={`h-4 w-4 ${history.action==='EMAIL_SENT'?'text-blue-500':'text-green-600'}`} />}
                              {['SMS_SENT','SMS_RECEIVED'].includes(history.action) && <FiMessageSquare className={`h-4 w-4 ${history.action==='SMS_SENT'?'text-blue-400':'text-green-400'}`} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-gray-700 font-semibold">
                                {history.action==='EMAIL_SENT' && 'Email Sent'}
                                {history.action==='EMAIL_RECEIVED' && 'Email Received'}
                                {history.action==='SMS_SENT' && 'Text Sent'}
                                {history.action==='SMS_RECEIVED' && 'Text Received'}
                                <span className="ml-2 text-gray-400 font-normal">{new Date(history.timestamp).toLocaleString()}</span>
                              </div>
                              {history.details?.subject && (
                                <div className="text-xs text-gray-500 truncate"><b>Subject:</b> {history.details.subject}</div>
                              )}
                              <div className="text-xs text-gray-600 truncate"><b>Message:</b> {history.details?.body?.slice(0, 80)}{history.details?.body?.length > 80 ? '...' : ''}</div>
                              <div className="text-[10px] text-gray-400">{history.details?.direction==='sent'?'To':'From'}: {history.performedByName}</div>
                            </div>
                          </div>
                        ))}
                      {(!selectedEvent.extendedProps.lead.bookingHistory || !Array.isArray(selectedEvent.extendedProps.lead.bookingHistory) || selectedEvent.extendedProps.lead.bookingHistory.filter(h => ['EMAIL_SENT','EMAIL_RECEIVED','SMS_SENT','SMS_RECEIVED'].includes(h.action)).length === 0) && (
                        <div className="text-xs text-gray-400 italic">No messages yet</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {/* Bottom Action Buttons */}
              <div className="mt-3 pt-3 border-t border-gray-200">
                <div className="flex space-x-2">
                  {/* Reschedule Button - Available for all roles */}
                  {selectedEvent.extendedProps?.status !== 'Cancelled' && (
                    <button
                      onClick={() => handleRescheduleAppointment()}
                      className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-gradient-to-r from-orange-400 to-amber-400 text-white rounded-lg hover:from-orange-500 hover:to-amber-500 transition-all duration-300 shadow text-xs font-medium"
                    >
                      <FiClock className="h-4 w-4" />
                      <span>Reschedule</span>
                    </button>
                  )}
                  
                  {/* View Lead Details Button - Hidden for viewers */}
                  {user?.role !== 'viewer' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/leads/${selectedEvent.id}`);
                      }}
                      className="flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-lg hover:from-indigo-600 hover:to-purple-600 transition-all duration-300 shadow text-xs font-medium"
                    >
                      <FiExternalLink className="h-4 w-4" />
                      <span>View Lead Details</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sale Modal */}
      {showSaleModal && selectedEvent && selectedEvent.extendedProps?.lead && (
        <SaleModal
          isOpen={showSaleModal}
          onClose={() => setShowSaleModal(false)}
          lead={selectedEvent.extendedProps.lead}
          existingSale={selectedSale}
          onSaveSuccess={() => {
            setShowSaleModal(false);
            setShowEventModal(false);
            alert(selectedSale ? 'Sale updated successfully!' : 'Sale recorded successfully!');
            handleEventStatusChange('Attended');
            debouncedFetchEvents(); // Use debounced fetch to prevent race conditions
          }}
        />
      )}

      {/* Reject Lead Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-96">
            <h2 className="text-lg font-bold mb-4">Reject Lead</h2>
            <label className="block mb-2 font-medium">Reason:</label>
            <select
              className="w-full border rounded px-3 py-2 mb-4"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            >
              <option value="Duplicate">Duplicate</option>
              <option value="Already Booked">Already Booked</option>
              <option value="Far South">Far South</option>
              <option value="Photo">Photo</option>
              <option value="Not Interested">Not Interested</option>
              <option value="Wrong Number">Wrong Number</option>
              <option value="Other">Other</option>
            </select>
            <div className="flex justify-end space-x-2">
              <button
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
                onClick={() => setShowRejectModal(false)}
                disabled={rejecting}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                disabled={rejecting}
                onClick={handleConfirmReject}
              >
                {rejecting ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage}
          alt={selectedEvent?.extendedProps?.lead?.name || 'Lead Photo'}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
};

export default Calendar; 