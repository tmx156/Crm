import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { FiArrowLeft, FiEdit, FiSave, FiPhone, FiMail, FiMapPin, FiCalendar, FiMessageSquare, FiSend, FiChevronLeft, FiChevronRight, FiChevronUp, FiChevronDown, FiActivity, FiCheckCircle, FiX, FiRefreshCw, FiClock, FiUser, FiCheck, FiSettings } from 'react-icons/fi';
import axios from 'axios';
import TagSystem from '../components/TagSystem';
import PhotoModal from '../components/PhotoModal';
import LazyImage from '../components/LazyImage';
import { getOptimizedImageUrl, preloadImages } from '../utils/imageUtils';

const LeadDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({});

  // Navigation state
  const [allLeads, setAllLeads] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [navigationLoading, setNavigationLoading] = useState(false);
  
  // Filter context from navigation state
  const [filterContext, setFilterContext] = useState({
    statusFilter: 'all',
    searchTerm: '',
    filteredLeads: []
  });

  // SMS & Email templates state (for Messages section)
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedEmailTemplate, setSelectedEmailTemplate] = useState('');
  const [smsTemplates, setSmsTemplates] = useState([]);
  const [emailTemplates, setEmailTemplates] = useState([]);

  // Photo modal state
  const [photoModalOpen, setPhotoModalOpen] = useState(false);

  // Reschedule modal state
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);

  // Image preloading state
  const [preloadedImages, setPreloadedImages] = useState(new Set());
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState('');

  // Sale state
  const [sale, setSale] = useState(null);

  // Booking history state
  const [bookingHistory, setBookingHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Messages conversation state
  const [messagesExpanded, setMessagesExpanded] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [newReply, setNewReply] = useState('');
  const [replyMode, setReplyMode] = useState('sms'); // 'sms' or 'email'
  
  // Auto-resize textarea function
  const autoResizeTextarea = (textarea) => {
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 500) + 'px'; // Max height 500px
    }
  };

  // Add state for reject modal
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('Duplicate');
  const [rejecting, setRejecting] = useState(false);

  // Fallback templates for when API is unavailable
  const fallbackSmsTemplates = [
    { _id: 'welcome', name: 'Welcome Message', message: "Hi [NAME], thanks for your interest! We'll contact you shortly to confirm your photoshoot booking." },
    { _id: 'reminder', name: 'Reminder Message', message: "Hi [NAME], just a reminder about your modelling photoshoot on [DATE] at [TIME]." },
    { _id: 'followup', name: 'Follow-up Message', message: "Hi [NAME], we noticed you haven't confirmed your session. Let us know if you're still interested!" }
  ];

  const fallbackEmailTemplates = [
    { 
      _id: 'welcome', 
      name: 'Welcome Email',
      subject: "Welcome to our Modelling Studio - [NAME]",
      message: "Dear [NAME],\n\nThank you for your interest in our modelling services! We're excited to work with you.\n\nWe'll be in touch shortly to confirm your photoshoot booking and discuss the details.\n\nIf you have any questions in the meantime, please don't hesitate to reach out.\n\nBest regards,\nThe Studio Team"
    },
    { 
      _id: 'reminder', 
      name: 'Reminder Email',
      subject: "Reminder: Your Photoshoot on [DATE]",
      message: "Dear [NAME],\n\nThis is a friendly reminder about your upcoming modelling photoshoot scheduled for [DATE] at [TIME].\n\nPlease ensure you arrive 15 minutes early and bring any items we discussed.\n\nLooking forward to working with you!\n\nBest regards,\nThe Studio Team"
    },
    { 
      _id: 'followup', 
      name: 'Follow-up Email',
      subject: "Following up on your Modelling Session - [NAME]", 
      message: "Dear [NAME],\n\nWe noticed that you haven't confirmed your modelling session yet.\n\nWe're still very interested in working with you and would love to schedule your photoshoot.\n\nPlease let us know if you're still interested or if you have any questions.\n\nBest regards,\nThe Studio Team"
    },
    { 
      _id: 'booking_confirmation', 
      name: 'Booking Confirmation',
      subject: "Booking Confirmed - Your Photoshoot on [DATE]",
      message: "Dear [NAME],\n\nGreat news! Your photoshoot has been confirmed for [DATE] at [TIME].\n\nLocation: Our Studio\nDuration: Approximately 2 hours\n\nPlease bring:\n- A variety of outfits\n- Any specific props or accessories\n- A positive attitude!\n\nWe can't wait to work with you!\n\nBest regards,\nThe Studio Team"
    }
  ];

  // Utility to group templates by category (Bookers Templates)
  const categorizeTemplates = (templates) => {
    const categories = {
      'Booking & Reminders': ['booking_confirmation', 'appointment_reminder'],
      'Custom Templates': ['custom'],
    };
    const grouped = { 'Booking & Reminders': [], 'Custom Templates': [] };
    templates.forEach(t => {
      let found = false;
      for (const [cat, types] of Object.entries(categories)) {
        if (types.includes(t.type)) {
          grouped[cat].push(t);
          found = true;
          break;
        }
      }
      if (!found) grouped['Custom Templates'].push(t); // Default to Custom Templates if unknown
    });
    return grouped;
  };

  // Show only Bookers Templates (matching BookersTemplates page)
  const isLeadTemplate = (t) => [
    'booking_confirmation',
    'appointment_reminder',
    'custom'
  ].includes(t.type);

  // Preload adjacent lead images for smooth navigation
  const preloadAdjacentImages = async () => {
    if (allLeads.length <= 1) return;

    const currentLeadIndex = currentIndex;
    const adjacentLeads = [];
    
    // Get previous and next leads
    if (currentLeadIndex > 0) {
      adjacentLeads.push(allLeads[currentLeadIndex - 1]);
    }
    if (currentLeadIndex < allLeads.length - 1) {
      adjacentLeads.push(allLeads[currentLeadIndex + 1]);
    }

    // Get optimized image URLs for adjacent leads
    const imageUrls = adjacentLeads
      .map(lead => lead.image_url)
      .filter(url => url && url !== '')
      .map(url => getOptimizedImageUrl(url, 'optimized'));

    if (imageUrls.length === 0) return;

    try {
      console.log('🖼️ Preloading adjacent lead images:', imageUrls);
      await preloadImages(imageUrls);
      
      // Mark images as preloaded
      setPreloadedImages(prev => {
        const newSet = new Set(prev);
        imageUrls.forEach(url => newSet.add(url));
        return newSet;
      });
    } catch (error) {
      console.warn('⚠️ Failed to preload some images:', error);
    }
  };

  // Initialize component and handle navigation
  useEffect(() => {
    console.log('🔍 LeadDetail: Component initialized', { id, hasState: !!location.state });

    // Always try to set up navigation context
    if (location.state) {
      const { statusFilter, searchTerm, filteredLeads } = location.state;
      console.log('🔍 LeadDetail: Setting up navigation context');

      setFilterContext({
        statusFilter: statusFilter || 'all',
        searchTerm: searchTerm || '',
        filteredLeads: filteredLeads || []
      });

      if (filteredLeads && filteredLeads.length > 0) {
        setAllLeads(filteredLeads);
        const index = filteredLeads.findIndex(lead => lead.id === id);
        setCurrentIndex(index !== -1 ? index : 0);
        console.log('📍 LeadDetail: Navigation context ready, index:', index);
      }
    }

    // Fallback: if we don't have leads but have an ID, fetch all leads
    if (id && allLeads.length === 0 && !location.state?.filteredLeads) {
      console.log('⚠️ LeadDetail: No leads available, fetching all');
      fetchAllLeads();
    }
  }, [id, location.state]); // Add dependencies

  // Separate effect for initial data fetching
  useEffect(() => {
    if (id && !lead) {
      console.log('📥 LeadDetail: Fetching initial data for lead:', id);
      fetchLead();
      fetchTemplates();
      fetchSale();
      fetchBookingHistory();
    }
  }, [id]);

  // Handle lead ID changes (navigation within the app)
  useEffect(() => {
    if (id && allLeads.length > 0) {
      // Update current index if lead exists in our list
      const leadIndex = allLeads.findIndex(lead => lead.id === id);
      if (leadIndex !== -1) {
        setCurrentIndex(leadIndex);
        console.log('🔄 LeadDetail: Updated index for existing lead:', leadIndex);
      }

      // Fetch data for the new lead
      fetchLead();
      fetchTemplates();
      fetchSale();
      fetchBookingHistory();
    }
  }, [id, allLeads]);

  // Preload adjacent images when leads or current index changes
  useEffect(() => {
    if (allLeads.length > 0) {
      preloadAdjacentImages();
    }
  }, [allLeads, currentIndex]);

  // Fetch conversation history when messages section is expanded
  useEffect(() => {
    if (messagesExpanded && lead) {
      fetchConversationHistory();
    }
  }, [messagesExpanded, lead]);

  // Auto-resize textarea when reply changes or mode changes
  useEffect(() => {
    if (newReply && messagesExpanded) {
      setTimeout(() => {
        const textarea = document.querySelector('textarea[placeholder*="reply"]');
        autoResizeTextarea(textarea);
      }, 0);
    }
  }, [newReply, replyMode, messagesExpanded]);

  const fetchTemplates = async () => {
    try {
      // Fetch user-specific templates (bookersOnly=true means only their templates)
      const response = await axios.get('/api/templates?bookersOnly=true');
      const allTemplates = response.data.map(template => ({
        ...template,
        _id: template.id || template._id // Ensure _id field exists
      }));
      
      // Filter for Bookers Template types only
      const bookersTemplates = allTemplates.filter(isLeadTemplate);
      
      // Set both SMS and Email templates to the same filtered list
      // (templates can have both smsBody and emailBody)
      setSmsTemplates(bookersTemplates.filter(t => t.smsBody || t.sendSMS));
      setEmailTemplates(bookersTemplates.filter(t => t.emailBody || t.sendEmail));
    } catch (error) {
      console.error('Error fetching templates:', error);
      // Use fallback templates
      setSmsTemplates(fallbackSmsTemplates);
      setEmailTemplates(fallbackEmailTemplates);
    }
  };

  const fetchAllLeads = async () => {
    try {
      // Use filter context if available, otherwise fetch all leads
      const params = {};
      if (filterContext.statusFilter && filterContext.statusFilter !== 'all') {
        params.status = filterContext.statusFilter;
      }
      if (filterContext.searchTerm) {
        params.search = filterContext.searchTerm;
      }

      // Fetch all leads by setting a high limit (1000 should be sufficient for most use cases)
      // This ensures navigation works through all available leads, not just the first 50
      params.limit = 1000;
      params.page = 1;

      const response = await axios.get('/api/leads', { params });
      const leads = response.data.leads || response.data || [];

      // If we have filtered leads from navigation state, use those instead
      const leadsToUse = filterContext.filteredLeads.length > 0 ? filterContext.filteredLeads : leads;
      setAllLeads(leadsToUse);

      // Find current lead's position - handle both string and ObjectId formats
      const index = leadsToUse.findIndex(lead =>
        lead.id === id ||
        lead.id.toString() === id ||
        lead.id === id.toString()
      );
      setCurrentIndex(index !== -1 ? index : 0);
    } catch (error) {
      console.error('Error fetching all leads:', error);
      setError('Failed to fetch leads. Please try again.');
      setAllLeads([]);
      setCurrentIndex(0);
    }
  };

  const fetchLead = async () => {
    if (!id) {
      console.log('⚠️ No ID provided for fetchLead');
      return;
    }

    console.log('📥 Fetching lead data for ID:', id);
    setLoading(true); // Always set loading when fetching

    try {
      const response = await axios.get(`/api/leads/${id}`);
      console.log('✅ Lead data fetched:', response.data.name);

      setLead(response.data);
      setFormData(response.data);
      setError(''); // Clear any previous errors
    } catch (error) {
      console.error('❌ Error fetching lead:', error);
      setError('Failed to fetch lead details. Please try again.');
      setLead(null);
      setFormData({});
    } finally {
      setLoading(false);
      setNavigationLoading(false); // Reset navigation loading when done
    }
  };

  const fetchSale = async () => {
    try {
      const response = await axios.get(`/api/sales/by-lead/${id}`);
      setSale(response.data);
    } catch (error) {
      // Handle 404 gracefully - it's normal for leads without sales
      if (error.response?.status === 404 || error.response?.status === 200) {
        setSale(null); // No sale found
      } else {
        console.warn('⚠️ Error fetching sale:', error.message);
        setSale(null);
      }
    }
  };

  const fetchBookingHistory = async () => {
    try {
      setHistoryLoading(true);
      const response = await axios.get(`/api/leads/${id}/history`);
      setBookingHistory(response.data.bookingHistory || []);
    } catch (error) {
      console.error('Error fetching booking history:', error);
      setBookingHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const oldNotes = lead.notes || '';
      const newNotes = formData.notes || '';

      const response = await axios.put(`/api/leads/${id}`, formData);
      // Use the server response data instead of local formData to ensure accuracy
      const updatedLead = response.data.lead || response.data;
      setLead(updatedLead);
      setFormData(updatedLead); // Also update formData to match server state
      setEditing(false);

      // Add to booking history if notes changed
      if (oldNotes !== newNotes) {
        await addHistoryEntry('NOTES_UPDATED', {
          oldNotes: oldNotes,
          newNotes: newNotes
        });

        // Set refresh trigger for Calendar
        localStorage.setItem('calendarRefreshTrigger', 'true');
      }
    } catch (error) {
      console.error('Error updating lead:', error);
      // Don't update local state on error - keep original data
      alert('Failed to save changes. Please try again.');
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleBookAppointment = () => {
    // Store lead data in localStorage for the calendar to pick up
    localStorage.setItem('bookingLead', JSON.stringify({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      postcode: lead.postcode,
      notes: lead.notes,
      image_url: lead.image_url,
      currentStatus: lead.status // Include current status for context
    }));
    
    // Navigate to calendar
    navigate('/calendar');
  };

  const navigateToCalendar = (booking) => {
    // Store booking data for calendar highlighting
    localStorage.setItem('highlightBooking', JSON.stringify({
      leadId: lead.id,
      leadName: lead.name,
      date: booking.date,
      type: booking.type,
      status: booking.status
    }));
    
    // Navigate to calendar
    navigate('/calendar');
  };

  // Navigation Functions
  const handlePreviousLead = () => {
    if (currentIndex > 0 && allLeads.length > 0) {
      const previousLead = allLeads[currentIndex - 1];
      console.log('⬅️ Navigating to previous lead:', previousLead.name, 'ID:', previousLead.id);

      setNavigationLoading(true);
      setLead(null); // Clear current lead to trigger loading state

      navigate(`/leads/${previousLead.id}`, {
        replace: true,
        state: {
          statusFilter: filterContext.statusFilter,
          searchTerm: filterContext.searchTerm,
          filteredLeads: allLeads
        }
      });
    }
  };

  const handleNextLead = () => {
    if (currentIndex < allLeads.length - 1 && allLeads.length > 0) {
      const nextLead = allLeads[currentIndex + 1];
      console.log('➡️ Navigating to next lead:', nextLead.name, 'ID:', nextLead.id);

      setNavigationLoading(true);
      setLead(null); // Clear current lead to trigger loading state

      navigate(`/leads/${nextLead.id}`, {
        replace: true,
        state: {
          statusFilter: filterContext.statusFilter,
          searchTerm: filterContext.searchTerm,
          filteredLeads: allLeads
        }
      });
    }
  };

  const canNavigatePrevious = () => {
    return currentIndex > 0 && allLeads.length > 0;
  };

  const canNavigateNext = () => {
    return currentIndex < allLeads.length - 1 && allLeads.length > 0;
  };

  // Template placeholder replacement
  const replacePlaceholders = (message) => {
    const defaultDate = new Date(lead.dateBooked).toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric' 
    });
    const defaultTime = new Date(lead.dateBooked).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });

    return message
      .replace(/\[NAME\]/g, lead.name)
      .replace(/\[DATE\]/g, defaultDate)
      .replace(/\[TIME\]/g, defaultTime);
  };

  const addHistoryEntry = async (action, details) => {
    try {
      await axios.post(`/api/leads/${id}/history`, {
        action,
        details,
        timestamp: new Date().toISOString()
      });
      // Refresh booking history
      fetchBookingHistory();
    } catch (error) {
      console.error('Error adding history entry:', error);
    }
  };

  // Conversation Functions
  const fetchConversationHistory = async () => {
    if (!lead || !messagesExpanded) return;
    
    try {
      setConversationLoading(true);
      
      // Get conversation history from booking history
      if (lead.booking_history) {
        const history = typeof lead.booking_history === 'string' 
          ? JSON.parse(lead.booking_history) 
          : lead.booking_history;
        
        // Filter communication entries and sort by timestamp
        const communications = history
          .filter(entry => ['SMS_SENT', 'SMS_RECEIVED', 'EMAIL_SENT', 'EMAIL_RECEIVED'].includes(entry.action))
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        setConversationHistory(communications);
      } else {
        setConversationHistory([]);
      }
    } catch (error) {
      console.error('Error fetching conversation history:', error);
      setConversationHistory([]);
    } finally {
      setConversationLoading(false);
    }
  };

  const handleSendQuickReply = async () => {
    if (!newReply.trim()) {
      alert('Please enter a reply message.');
      return;
    }
    
    try {
      if (replyMode === 'sms') {
        if (!lead.phone) {
          alert('This lead does not have a phone number.');
          return;
        }
        
        const response = await axios.post(`/api/leads/${lead.id}/send-sms`, {
          message: newReply,
          type: 'custom'
        });
        
        if (response.data.success) {
          alert(`SMS sent successfully to ${lead.phone}!`);
          
          // Add to booking history
          await addHistoryEntry('SMS_SENT', {
            recipient: lead.phone,
            message: newReply,
            template: 'Quick reply'
          });
          
          setNewReply('');
          // Refresh conversation
          setTimeout(() => fetchConversationHistory(), 1000);
        } else {
          alert(`Failed to send SMS: ${response.data.message}`);
        }
      } else {
        // Email reply
        if (!lead.email) {
          alert('This lead does not have an email address.');
          return;
        }
        
        // Parse subject and body from newReply if email template was used
        let emailSubject = 'Reply';
        let emailBody = newReply;
        
        // If template contained subject (first line before double newline)
        if (newReply.includes('\n\n')) {
          const parts = newReply.split('\n\n');
          if (parts[0].length < 100) { // First part is likely subject if short
            emailSubject = parts[0];
            emailBody = parts.slice(1).join('\n\n');
          }
        }
        
        const response = await axios.post(`/api/leads/${lead.id}/send-email`, {
          subject: emailSubject,
          body: emailBody
        });
        
        if (response.data.success) {
          alert(`Email sent successfully to ${lead.email}!`);
          
          setNewReply('');
          // Refresh conversation
          setTimeout(() => fetchConversationHistory(), 1000);
        } else {
          alert(`Failed to send email: ${response.data.message}`);
        }
      }
    } catch (error) {
      console.error('Error sending reply:', error);
      alert(`Error sending reply: ${error.response?.data?.message || error.message}`);
    }
  };

  const handleQuickStatusChange = async (newStatus) => {
    if (!window.confirm(`Are you sure you want to change ${lead.name}'s status to "${newStatus}"?`)) {
      return;
    }

    const oldStatus = lead.status;

    try {
      const response = await axios.put(`/api/leads/${lead.id}`, {
        ...lead,
        status: newStatus,
        booking_status: null // Clear any previous booking status (like 'Arrived') when changing main status
      });

      if (response.data.success || response.data.lead) {
        const updatedLead = response.data.lead || response.data;
        setLead(updatedLead);
        setFormData(updatedLead);
        
        // Emit real-time update for diary synchronization
        try {
          // Update diary stats if this is a booking status change
          if (newStatus === 'Booked' || oldStatus === 'Booked' || 
              newStatus === 'Attended' || oldStatus === 'Attended' ||
              newStatus === 'Cancelled' || oldStatus === 'Cancelled') {
            
            // Emit diary update
            await axios.post('/api/stats/diary-update', {
              leadId: lead.id,
              leadName: lead.name,
              oldStatus: oldStatus,
              newStatus: newStatus,
              dateBooked: lead.dateBooked,
              timestamp: new Date().toISOString()
            });
          }
        } catch (diaryError) {
          console.warn('Diary update failed:', diaryError);
          // Don't block the main operation if diary update fails
        }
        
        // Add to booking history
        await addHistoryEntry('STATUS_CHANGED', {
          oldStatus: oldStatus,
          newStatus: newStatus,
          reason: 'Manual status update'
        });
        
        // Show success message with visual feedback
        const statusEmoji = {
          'Booked': '📅',
          'Attended': '✅', 
          'Cancelled': '❌',
          'New': '🆕'
        };
        
        alert(`${statusEmoji[newStatus] || '✅'} Successfully updated ${lead.name}'s status to "${newStatus}"`);
        
        // Refresh the lead data
        fetchLead();
      }
    } catch (error) {
      console.error('Error updating lead status:', error);
      alert('Failed to update status. Please try again.');
    }
  };

  const handleCancelAppointment = async () => {
    if (lead.status === 'Cancelled') {
      alert('This appointment is already cancelled.');
      return;
    }

    const confirmationMessage = `Are you sure you want to cancel ${lead.name}'s appointment?\n\n` +
      `This will:\n` +
      `• Change the status to "Cancelled"\n` +
      `• Remove the appointment from the calendar\n` +
      `• Update the booking history\n` +
      `• Update daily diary statistics\n\n` +
      `This action cannot be undone.`;

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    const oldStatus = lead.status;
    const originalDateBooked = lead.dateBooked;

    try {
      const response = await axios.put(`/api/leads/${lead.id}`, {
        ...lead,
        status: 'Cancelled',
        dateBooked: null // Remove the booking date
      });

      if (response.data.success || response.data.lead) {
        const updatedLead = response.data.lead || response.data;
        setLead(updatedLead);
        setFormData(updatedLead);
        
        // Emit diary update for cancellation
        try {
          await axios.post('/api/stats/diary-update', {
            leadId: lead.id,
            leadName: lead.name,
            oldStatus: oldStatus,
            newStatus: 'Cancelled',
            dateBooked: originalDateBooked,
            timestamp: new Date().toISOString()
          });
        } catch (diaryError) {
          console.warn('Diary update failed:', diaryError);
        }
        
        // Show success message with visual feedback
        alert(`❌ Successfully cancelled ${lead.name}'s appointment. Diary statistics have been updated.`);
        
        // Refresh the lead data
        fetchLead();
      }
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      alert('Failed to cancel appointment. Please try again.');
    }
  };

  const handleRescheduleAppointment = () => {
    if (lead.status === 'Cancelled') {
      alert('Cannot reschedule a cancelled appointment. Please change the status first.');
      return;
    }
    setNewDate(lead.dateBooked ? lead.dateBooked.split('T')[0] : '');
    setNewTime(lead.dateBooked ? new Date(lead.dateBooked).toISOString().substr(11, 5) : '');
    setRescheduleModalOpen(true);
  };

  const handleRescheduleSubmit = async () => {
    setRescheduleLoading(true);
    setRescheduleError('');
    try {
      const isoDateTime = newDate && newTime ? new Date(`${newDate}T${newTime}`).toISOString() : null;
      if (!isoDateTime) {
        setRescheduleError('Please select both date and time.');
        setRescheduleLoading(false);
        return;
      }
      const response = await axios.put(`/api/leads/${lead.id}`, {
        ...lead,
        dateBooked: isoDateTime,
        status: 'Booked',
        is_confirmed: 0, // Reset to unconfirmed when rescheduling
        booking_status: 'Reschedule', // Set to new Reschedule status to indicate rescheduling
        isReschedule: true,
        rescheduleReason: `Appointment rescheduled via lead detail to ${new Date(isoDateTime).toLocaleString()}`
      });
      setLead(response.data.lead || response.data);
      setFormData(response.data.lead || response.data);
      setRescheduleModalOpen(false);
    } catch (error) {
      setRescheduleError('Failed to reschedule. Please try again.');
    }
    setRescheduleLoading(false);
  };

  const getStatusBadgeClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'new':
        return 'status-badge status-new';
      case 'booked':
        return 'status-badge status-booked';
      case 'attended':
        return 'status-badge status-attended';
      case 'cancelled':
        return 'status-badge status-cancelled';
      case 'reschedule':
        return 'status-badge status-reschedule';
      default:
        return 'status-badge status-new';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  // No Answer Counter functionality
  const handleNoAnswerIncrement = async () => {
    try {
      const response = await axios.post(`/api/leads/${id}/no-answer`);
      setLead(response.data);
      setFormData(response.data);
    } catch (error) {
      console.error('Error updating no answer count:', error);
    }
  };

  if (loading || navigationLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">
            {navigationLoading ? 'Loading next lead...' : 'Loading lead details...'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={() => {
            setError('');
            fetchLead();
          }}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Lead not found</p>
        <button
          onClick={() => navigate('/leads', {
            state: { 
              statusFilter: filterContext.statusFilter,
              searchTerm: filterContext.searchTerm
            }
          })}
          className="mt-4 btn-primary"
        >
          Back to Leads
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="relative min-h-screen bg-gray-50">
        {/* NEW: Sale amount at the top */}
        {sale && sale.saleAmount !== undefined && (
          <div className="w-full flex justify-center items-center py-4">
            <div className="bg-green-100 border border-green-300 rounded-lg px-6 py-3 shadow text-2xl font-bold text-green-800">
              Amount Spent: £{Number(sale.saleAmount).toFixed(2)}
            </div>
          </div>
        )}
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/leads', {
                  state: { 
                    statusFilter: filterContext.statusFilter,
                    searchTerm: filterContext.searchTerm
                  }
                })}
                className="p-2 rounded-md text-gray-400 hover:text-gray-600"
              >
                <FiArrowLeft className="h-5 w-5" />
              </button>
              <h1 className="text-2xl font-semibold text-gray-900">Lead Details</h1>
              
              {/* Navigation Counter */}
              {allLeads.length > 0 && (
                <span className="text-sm text-gray-500">
                  {currentIndex + 1} of {allLeads.length}
                  {/* Debug info */}
                  <span className="ml-2 text-xs text-gray-400">
                    (filter: {filterContext.statusFilter}, search: "{filterContext.searchTerm}")
                  </span>
                </span>
              )}
            </div>
            
            {/* Navigation Arrows */}
            <div className="flex items-center space-x-2">
              <button
                onClick={handlePreviousLead}
                disabled={!canNavigatePrevious() || navigationLoading}
                className={`p-2 rounded-md transition-colors relative ${
                  canNavigatePrevious() && !navigationLoading
                    ? 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                    : 'text-gray-300 cursor-not-allowed'
                }`}
                title={`Previous Lead ${canNavigatePrevious() ? `(${allLeads[currentIndex - 1]?.name})` : '(none)'}`}
              >
                {navigationLoading && currentIndex > 0 ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-600"></div>
                ) : (
                  <FiChevronLeft className="h-5 w-5" />
                )}
              </button>

              <button
                onClick={handleNextLead}
                disabled={!canNavigateNext() || navigationLoading}
                className={`p-2 rounded-md transition-colors relative ${
                  canNavigateNext() && !navigationLoading
                    ? 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                    : 'text-gray-300 cursor-not-allowed'
                }`}
                title={`Next Lead ${canNavigateNext() ? `(${allLeads[currentIndex + 1]?.name})` : '(none)'}`}
              >
                {navigationLoading && currentIndex < allLeads.length - 1 ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-600"></div>
                ) : (
                  <FiChevronRight className="h-5 w-5" />
                )}
              </button>
            </div>

            <div className="flex items-center space-x-3">
              {!editing && (
                <button
                  onClick={() => handleBookAppointment()}
                  className="btn-secondary flex items-center space-x-2"
                >
                  <FiCalendar className="h-4 w-4" />
                  <span>
                    {lead.status?.toLowerCase() === 'booked' ? 'Reschedule' : 'Book Appointment'}
                  </span>
                </button>
              )}
              {editing ? (
                <>
                  <button
                    onClick={() => {
                      setEditing(false);
                      setFormData(lead);
                    }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button onClick={handleSave} className="btn-primary flex items-center space-x-2">
                    <FiSave className="h-4 w-4" />
                    <span>Save</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="btn-primary flex items-center space-x-2"
                >
                  <FiEdit className="h-4 w-4" />
                  <span>Edit</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Left Column - Lead Information */}
            <div className="lg:col-span-3 space-y-6">
              {/* Basic Information */}
              <div className="card">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Basic Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Name */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4">
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
                        <FiUser className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-blue-600 uppercase tracking-wide">Full Name</p>
                        {editing ? (
                          <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleInputChange}
                            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg font-bold text-gray-900"
                          />
                        ) : (
                          <p className="text-lg font-bold text-gray-900 mt-1">{lead.name}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Age */}
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4">
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 rounded-xl bg-green-500 flex items-center justify-center flex-shrink-0">
                        <FiUser className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-green-600 uppercase tracking-wide">Age</p>
                        {editing ? (
                          <input
                            type="number"
                            name="age"
                            value={formData.age || ''}
                            onChange={handleInputChange}
                            min="1"
                            max="120"
                            placeholder="Enter age"
                            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500 text-lg font-bold text-gray-900"
                          />
                        ) : (
                          <p className="text-lg font-bold text-gray-900 mt-1">{lead.age ? `${lead.age} years old` : 'N/A'}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div className="card">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Contact Information</h3>
                <div className="space-y-6">
                  {/* Phone */}
                  <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-4">
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 rounded-xl bg-purple-500 flex items-center justify-center flex-shrink-0">
                        <FiPhone className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-purple-600 uppercase tracking-wide">Phone Number</p>
                        {editing ? (
                          <input
                            type="tel"
                            name="phone"
                            value={formData.phone}
                            onChange={handleInputChange}
                            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-lg font-bold text-gray-900"
                          />
                        ) : (
                          <p className="text-lg font-bold text-gray-900 mt-1">{lead.phone}</p>
                        )}
                        {!editing && (
                          <a href={`tel:${lead.phone}`} className="text-sm text-purple-600 hover:text-purple-800 transition-colors">
                            Click to call →
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="bg-gradient-to-r from-pink-50 to-rose-50 rounded-xl p-4">
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 rounded-xl bg-pink-500 flex items-center justify-center flex-shrink-0">
                        <FiMail className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-pink-600 uppercase tracking-wide">Email Address</p>
                        {editing ? (
                          <input
                            type="email"
                            name="email"
                            value={formData.email || ''}
                            onChange={handleInputChange}
                            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-pink-500 focus:border-pink-500 text-lg font-bold text-gray-900"
                          />
                        ) : (
                          <p className="text-lg font-bold text-gray-900 mt-1 break-all">{lead.email || 'N/A'}</p>
                        )}
                        {!editing && lead.email && (
                          <a href={`mailto:${lead.email}`} className="text-sm text-pink-600 hover:text-pink-800 transition-colors">
                            Send email →
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Postcode */}
                  <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl p-4">
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center flex-shrink-0">
                        <FiMapPin className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-orange-600 uppercase tracking-wide">Postcode</p>
                        {editing ? (
                          <input
                            type="text"
                            name="postcode"
                            value={formData.postcode}
                            onChange={handleInputChange}
                            className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-lg font-bold text-gray-900"
                          />
                        ) : (
                          <p className="text-lg font-bold text-gray-900 mt-1">{lead.postcode}</p>
                        )}
                        {!editing && (
                          <a href={`https://maps.google.com/maps?q=${lead.postcode}`} target="_blank" rel="noopener noreferrer" className="text-sm text-orange-600 hover:text-orange-800 transition-colors">
                            View on map →
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>



              {/* Tag System */}
              {!editing && (
                <TagSystem 
                  leadId={lead.id} 
                  onTagsUpdate={(tags) => {
                    // Update the lead state with new tags
                    setLead({ ...lead, tags: tags });
                  }}
                />
              )}

              {/* Removed Image Upload section */}

              {/* Notes */}
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Notes</h3>
                  {!editing && (
                    <button
                      onClick={() => setEditing(true)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center space-x-1 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                    >
                      <FiEdit className="h-3 w-3" />
                      <span>Edit Notes</span>
                    </button>
                  )}
                </div>
                
                {editing ? (
                  <div className="space-y-3">
                    <div className="relative">
                      <textarea
                        name="notes"
                        rows="6"
                        value={formData.notes || ''}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                        placeholder="Add detailed notes about this lead..."
                        autoFocus
                      />
                      <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                        {(formData.notes || '').length} characters
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        All users can edit notes • Changes appear in booking history
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={handleSave}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium flex items-center space-x-1"
                        >
                          <FiCheck className="h-3 w-3" />
                          <span>Save Notes</span>
                        </button>
                        <button
                          onClick={() => setEditing(false)}
                          className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 text-sm font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    {lead.notes ? (
                      <div>
                        <p className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                          {lead.notes}
                        </p>
                        <div className="mt-2 text-xs text-gray-500">
                          Click "Edit Notes" to modify
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-gray-500 italic">No notes available</p>
                        <p className="text-xs text-gray-400 mt-1">Click "Edit Notes" to add notes</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 📨 Messages Conversation Section */}
              {!editing && (
                <div className="card">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setMessagesExpanded(!messagesExpanded)}
                      className="flex items-center space-x-2 flex-1 text-left hover:bg-gray-50 p-2 -m-2 rounded-md transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        <FiMessageSquare className="h-5 w-5 text-indigo-500" />
                        <h3 className="text-lg font-medium text-gray-900">📨 Messages</h3>
                        {conversationHistory.length > 0 && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                            {conversationHistory.length} messages
                          </span>
                        )}
                      </div>
                      {messagesExpanded ? (
                        <FiChevronUp className="h-5 w-5 text-gray-400" />
                      ) : (
                        <FiChevronDown className="h-5 w-5 text-gray-400" />
                      )}
                    </button>

                    {/* Templates Management Link */}
                    <button
                      onClick={() => navigate('/bookers-templates')}
                      className="ml-3 px-3 py-2 text-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-md flex items-center space-x-1 transition-colors border border-indigo-200"
                      title="Manage Bookers Templates - Create & edit templates for Lead Details"
                    >
                      <FiSettings className="h-4 w-4" />
                      <span>Manage Templates</span>
                    </button>
                  </div>
                  
                  {messagesExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      {/* Conversation History */}
                      <div className="max-h-80 overflow-y-auto bg-gray-50 rounded-lg p-4 mb-4">
                        {conversationLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                            <span className="ml-2 text-gray-500">Loading conversation...</span>
                          </div>
                        ) : conversationHistory.length === 0 ? (
                          <div className="text-center py-8 text-gray-500">
                            <FiMessageSquare className="mx-auto h-8 w-8 mb-2 text-gray-300" />
                            <p>No conversation history</p>
                            <p className="text-sm mt-1">Messages will appear here when sent or received</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {conversationHistory.map((message, index) => (
                              <div 
                                key={`${message.timestamp}-${index}`}
                                className={`flex ${(['SMS_SENT', 'EMAIL_SENT'].includes(message.action)) ? 'justify-end' : 'justify-start'}`}
                              >
                                <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg shadow-sm ${
                                  (['SMS_SENT', 'EMAIL_SENT'].includes(message.action))
                                    ? 'bg-blue-500 text-white' 
                                    : 'bg-white border text-gray-900'
                                }`}>
                                  {/* Message content */}
                                  {message.action.includes('EMAIL') && message.details?.subject && (
                                    <p className="text-sm font-semibold mb-1">
                                      {message.details.subject}
                                    </p>
                                  )}
                                  <p className="text-sm whitespace-pre-wrap break-words">
                                    {message.details?.body || message.details?.message || 'No content'}
                                  </p>
                                  
                                  {/* Message metadata */}
                                  <div className="flex items-center justify-between mt-1">
                                    <p className={`text-xs ${
                                      (['SMS_SENT', 'EMAIL_SENT'].includes(message.action)) ? 'text-blue-100' : 'text-gray-500'
                                    }`}>
                                      {(() => {
                                        try {
                                          const date = new Date(message.timestamp);
                                          if (isNaN(date.getTime())) return 'Unknown time';
                                          
                                          const now = new Date();
                                          const diffMs = now - date;
                                          const diffHours = diffMs / (1000 * 60 * 60);
                                          
                                          if (diffHours < 1) {
                                            const minutes = Math.floor(diffMs / (1000 * 60));
                                            return minutes <= 0 ? 'Just now' : `${minutes}m ago`;
                                          } else if (diffHours < 24) {
                                            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                                          } else {
                                            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                                          }
                                        } catch (error) {
                                          return 'Unknown time';
                                        }
                                      })()} • {message.action.includes('SMS') ? 'SMS' : 'Email'}
                                    </p>
                                    {(['SMS_SENT', 'EMAIL_SENT'].includes(message.action)) && (
                                      <FiCheck className="h-3 w-3 text-blue-100" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      {/* Quick Reply Section */}
                      <div className="space-y-3">
                        <div className="flex items-center space-x-3">
                          <label className="text-sm font-medium text-gray-700">Reply via:</label>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => setReplyMode('sms')}
                              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                                replyMode === 'sms' 
                                  ? 'bg-blue-500 text-white' 
                                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                              }`}
                            >
                              SMS
                            </button>
                            <button
                              onClick={() => setReplyMode('email')}
                              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                                replyMode === 'email' 
                                  ? 'bg-blue-500 text-white' 
                                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                              }`}
                              disabled={!lead.email}
                            >
                              Email
                            </button>
                          </div>
                        </div>

                        {/* Template Selection */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Choose Template (Optional)
                          </label>
                          <select
                            value={replyMode === 'sms' ? selectedTemplate : selectedEmailTemplate}
                            onChange={(e) => {
                              const templateId = e.target.value;
                              if (replyMode === 'sms') {
                                setSelectedTemplate(templateId);
                                if (templateId) {
                                  const template = smsTemplates.find(t => t._id === templateId);
                                  if (template) {
                                    const msg = template.smsBody || template.message || '';
                                    const processedMsg = replacePlaceholders(msg);
                                    setNewReply(processedMsg);
                                    // Auto-resize textarea after setting new content
                                    setTimeout(() => {
                                      const textarea = document.querySelector('textarea[placeholder*="reply"]');
                                      autoResizeTextarea(textarea);
                                    }, 0);
                                  }
                                }
                              } else {
                                setSelectedEmailTemplate(templateId);
                                if (templateId) {
                                  const template = emailTemplates.find(t => t._id === templateId);
                                  if (template) {
                                    const subj = template.subject || '';
                                    const msg = template.emailBody || template.message || '';
                                    const processedMsg = replacePlaceholders(subj) + '\n\n' + replacePlaceholders(msg);
                                    setNewReply(processedMsg);
                                    // Auto-resize textarea after setting new content
                                    setTimeout(() => {
                                      const textarea = document.querySelector('textarea[placeholder*="reply"]');
                                      autoResizeTextarea(textarea);
                                    }, 0);
                                  }
                                }
                              }
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="">Select a template...</option>
                            {replyMode === 'sms' ? (
                              Object.entries(categorizeTemplates(smsTemplates)).map(([cat, templates]) =>
                                templates.length > 0 && (
                                  <optgroup key={cat} label={cat}>
                                    {templates.map(template => (
                                      <option key={template._id} value={template._id}>
                                        {template.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )
                              )
                            ) : (
                              Object.entries(categorizeTemplates(emailTemplates)).map(([cat, templates]) =>
                                templates.length > 0 && (
                                  <optgroup key={cat} label={cat}>
                                    {templates.map(template => (
                                      <option key={template._id} value={template._id}>
                                        {template.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )
                              )
                            )}
                          </select>
                        </div>
                        
                        <div className="flex space-x-2">
                          <textarea
                            value={newReply}
                            onChange={(e) => {
                              setNewReply(e.target.value);
                              autoResizeTextarea(e.target);
                            }}
                            placeholder={`Type your ${replyMode === 'sms' ? 'SMS' : 'email'} reply...`}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none overflow-hidden"
                            style={{ minHeight: '60px' }}
                            maxLength={replyMode === 'sms' ? 160 : 5000}
                          />
                          <button
                            onClick={handleSendQuickReply}
                            disabled={!newReply.trim()}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                          >
                            <FiSend className="h-4 w-4" />
                            <span>Send</span>
                          </button>
                        </div>
                        
                        <p className="text-xs text-gray-500">
                          {replyMode === 'sms' 
                            ? `Send to: ${lead.phone} (${newReply.length}/160 characters)` 
                            : `Send to: ${lead.email || 'No email address'}`
                          }
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Booking History */}
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">📋 Booking History</h3>
                  {historyLoading && (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                  )}
                </div>

                {bookingHistory.length > 0 ? (
                  <div className="space-y-4">
                    {bookingHistory
                      // Filter out empty entries with no action, name, or timestamp
                      .filter(entry =>
                        entry.action &&
                        entry.action.trim() !== '' &&
                        (entry.performedByName || entry.timestamp)
                      )
                      .map((entry, index) => (
                      <div key={index} className="border-l-4 border-blue-500 pl-4 py-3 bg-gray-50 rounded-r-lg">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <span className="font-semibold text-gray-900">
                                {entry.action}
                              </span>
                              <span className="text-sm text-gray-500">
                                by {entry.performedByName}
                              </span>
                            </div>

                            {entry.details && Object.keys(entry.details).length > 0 && (
                              <div className="text-sm text-gray-600 mb-2">
                                {entry.action === 'NOTES_UPDATED' ? (
                                  <div className="space-y-2">
                                    <div className="bg-blue-50 p-3 rounded-lg">
                                      <div className="font-medium text-blue-800 mb-1">
                                        Notes {entry.details.changeType === 'added' ? 'Added' : 'Modified'}
                                      </div>
                                      {entry.details.oldNotes && (
                                        <div className="text-xs text-gray-600 mb-1">
                                          <span className="font-medium">Previous:</span> {entry.details.oldNotes}
                                        </div>
                                      )}
                                      <div className="text-sm text-gray-800">
                                        <span className="font-medium">New:</span> {entry.details.newNotes}
                                      </div>
                                      <div className="text-xs text-gray-500 mt-1">
                                        {entry.details.characterCount} characters
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  Object.entries(entry.details).map(([key, value]) => (
                                    <div key={key} className="mb-1">
                                      <span className="font-medium">{key}:</span> {value}
                                    </div>
                                  ))
                                )}
                              </div>
                            )}

                            {entry.leadSnapshot && Object.keys(entry.leadSnapshot).length > 0 && (
                              <div className="text-xs text-gray-500 bg-white p-2 rounded border">
                                <div className="font-medium mb-1">Lead State:</div>
                                {Object.entries(entry.leadSnapshot).map(([key, value]) => (
                                  <div key={key}>
                                    <span className="font-medium">{key}:</span> {value || 'N/A'}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="text-xs text-gray-400 ml-4">
                            {(() => {
                              try {
                                if (!entry.timestamp) return 'Unknown time';

                                let date;
                                if (typeof entry.timestamp === 'string') {
                                  date = new Date(entry.timestamp);
                                } else if (typeof entry.timestamp === 'number') {
                                  date = new Date(entry.timestamp > 1000000000000 ? entry.timestamp : entry.timestamp * 1000);
                                } else {
                                  date = new Date(entry.timestamp);
                                }

                                if (isNaN(date.getTime())) {
                                  return 'Invalid date';
                                }

                                const now = new Date();
                                const diffMs = now - date;
                                const diffHours = diffMs / (1000 * 60 * 60);
                                const diffDays = diffMs / (1000 * 60 * 60 * 24);

                                if (diffHours < 1) {
                                  const minutes = Math.floor(diffMs / (1000 * 60));
                                  return minutes <= 0 ? 'Just now' : `${minutes} min ago`;
                                } else if (diffHours < 24) {
                                  return date.toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: true
                                  });
                                } else if (diffDays < 7) {
                                  const days = Math.floor(diffDays);
                                  return `${days} day${days === 1 ? '' : 's'} ago`;
                                } else {
                                  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: true
                                  });
                                }
                              } catch (error) {
                                console.error('Error formatting timestamp:', error, 'Timestamp:', entry.timestamp);
                                return 'Unknown time';
                              }
                            })()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">📋</div>
                    <p>No booking history available</p>
                    <p className="text-sm">History will appear here when actions are taken on this lead</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Photo and Lead Details */}
            <div className="space-y-6">
              <div className="card">
                <div className="mb-4">
                  <div className="mx-auto w-full max-w-xs aspect-square bg-gray-300 flex items-center justify-center rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300">
                    {lead.image_url ? (
                      <LazyImage
                        src={getOptimizedImageUrl(lead.image_url, 'optimized')}
                        alt={lead.name}
                        className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform duration-300"
                        fallbackClassName="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-200 to-gray-300"
                        lazy={false} // Don't use lazy loading for main lead image
                        onClick={() => setPhotoModalOpen(true)}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-200 to-gray-300">
                        <span className="text-6xl font-medium text-gray-600">
                          {lead.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                  {lead.image_url && (
                    <p className="text-xs text-gray-500 mt-2">Click photo to view full screen</p>
                  )}
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">{lead.name}</h2>
                <div className="space-y-2 text-sm text-gray-600">
                  {lead.age && (
                    <div className="flex items-center justify-center space-x-2">
                      <FiUser className="h-4 w-4" />
                      <span>{lead.age} years old</span>
                    </div>
                  )}
                  <div className="flex items-center justify-center space-x-2">
                    <FiPhone className="h-4 w-4" />
                    <span>{lead.phone}</span>
                  </div>
                  {lead.email && (
                    <div className="flex items-center justify-center space-x-2">
                      <FiMail className="h-4 w-4" />
                      <span>{lead.email}</span>
                    </div>
                  )}
                </div>
                
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Lead Information</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Status:</span>
                      <span className={getStatusBadgeClass(lead.status)}>
                        {lead.status}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Assigned to:</span>
                      <span className="text-sm font-medium text-gray-900">
                        {lead.booker?.name || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Date Added:</span>
                      <span className="text-sm font-medium text-gray-900">
                        {formatDate(lead.dateBooked)}
                      </span>
                    </div>
                    

                  </div>
                </div>
              </div>
              {/* Add Reject button in the details card (after notes section) */}
              {!editing && lead.status !== 'Rejected' && (
                <button
                  className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                  onClick={() => setShowRejectModal(true)}
                >
                  Reject Lead
                </button>
              )}
              
              {/* Add Send Booking Confirmation button */}
              {!editing && lead.phone && lead.status === 'Booked' && (
                <button
                  className="mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                  onClick={async () => {
                    if (lead.dateBooked) {
                      try {
                        const response = await axios.post(`/api/leads/${lead.id}/send-booking-confirmation`, {
                          appointmentDate: lead.dateBooked
                        });
                        
                        if (response.data.success) {
                          alert(`Booking confirmation SMS sent successfully to ${lead.phone}!`);
                        } else {
                          alert(`Failed to send booking confirmation: ${response.data.message}`);
                        }
                      } catch (error) {
                        console.error('Booking confirmation error:', error);
                        alert(`Error sending booking confirmation: ${error.response?.data?.message || error.message}`);
                      }
                    } else {
                      alert('This lead does not have a booked date.');
                    }
                  }}
                >
                  Send Booking Confirmation SMS
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Photo Modal */}
      <PhotoModal
        isOpen={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        imageUrl={lead?.image_url ? getOptimizedImageUrl(lead.image_url, 'original') : null}
        leadName={lead?.name}
      />

      {/* Reject Modal */}
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
            </select>
            <div className="flex justify-end space-x-2">
              <button
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
                onClick={() => setShowRejectModal(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                disabled={rejecting}
                onClick={async () => {
                  setRejecting(true);
                  try {
                    await axios.patch(`/api/leads/${lead.id}/reject`, { reason: rejectReason });
                    setLead({ ...lead, status: 'Rejected', reject_reason: rejectReason });
                    setShowRejectModal(false);
                  } catch (err) {
                    alert('Failed to reject lead.');
                  }
                  setRejecting(false);
                }}
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LeadDetail; 