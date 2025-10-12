import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import axios from 'axios';
import ConnectionStatus from './ConnectionStatus';
import MessageModal from './MessageModal';
import { 
  FiHome, 
  FiUsers, 
  FiUser, 
  FiCalendar, 
  FiBarChart2, 
  FiLogOut,
  FiMenu,
  FiX,
  FiSearch,
  FiBell,
  FiChevronDown,
  FiChevronUp,
  FiMail,
  FiBookOpen,
  FiTarget,
  FiDollarSign,
  FiTrendingUp,
  FiMessageSquare,
  FiActivity,
  FiCpu
} from 'react-icons/fi';

const Layout = ({ children }) => {
  const notificationsEnabled = String(process.env.REACT_APP_NOTIFICATIONS_ENABLED || 'true').toLowerCase() !== 'false';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [leadsDropdownOpen, setLeadsDropdownOpen] = useState(false);
  const [templatesDropdownOpen, setTemplatesDropdownOpen] = useState(false);
  const [retargetingDropdownOpen, setRetargetingDropdownOpen] = useState(false);
  const [messagesDropdownOpen, setMessagesDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [smsNotifications, setSmsNotifications] = useState([]);
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      const raw = localStorage.getItem('readNotificationIds');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [selectedMessageModal, setSelectedMessageModal] = useState(null);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const { user, logout, isAuthenticated } = useAuth();
  const { socket, isConnected } = useSocket();
  const location = useLocation();
  const navigate = useNavigate();
  // Add unique refs for each dropdown
  const leadsDropdownRef = useRef(null);
  const templatesDropdownRef = useRef(null);
  const retargetingDropdownRef = useRef(null);
  const notificationsDropdownRef = useRef(null);
  const messagesDropdownRef = useRef(null);

  const templateCategories = [
    { name: 'Diary Templates', key: 'Diary Templates' },
    { name: 'Retargeting Templates', key: 'Retargeting Templates' },
    { name: 'Sale Templates', key: 'Sale Templates' },
    { name: 'Bookers Templates', key: 'Bookers Templates' },
  ];

  // Separate click outside handlers for each dropdown
  useEffect(() => {
    // Removed auto-close for Leads dropdown - it will stay open until user manually closes it
    const handleClickOutsideTemplates = (event) => {
      if (templatesDropdownRef.current && !templatesDropdownRef.current.contains(event.target)) {
        setTemplatesDropdownOpen(false);
      }
    };
    const handleClickOutsideRetargeting = (event) => {
      if (retargetingDropdownRef.current && !retargetingDropdownRef.current.contains(event.target)) {
        setRetargetingDropdownOpen(false);
      }
    };
    const handleClickOutsideNotifications = (event) => {
      if (notificationsDropdownRef.current && !notificationsDropdownRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    };
    const handleClickOutsideMessages = (event) => {
      if (messagesDropdownRef.current && !messagesDropdownRef.current.contains(event.target)) {
        setMessagesDropdownOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutsideTemplates);
    document.addEventListener('mousedown', handleClickOutsideRetargeting);
    document.addEventListener('mousedown', handleClickOutsideNotifications);
    document.addEventListener('mousedown', handleClickOutsideMessages);
    return () => {
      document.removeEventListener('mousedown', handleClickOutsideTemplates);
      document.removeEventListener('mousedown', handleClickOutsideRetargeting);
      document.removeEventListener('mousedown', handleClickOutsideNotifications);
      document.removeEventListener('mousedown', handleClickOutsideMessages);
    };
  }, []);

  // Persist helpers
  const persistReadIds = (ids) => {
    setReadNotificationIds(ids);
    try { localStorage.setItem('readNotificationIds', JSON.stringify(ids.slice(-500))); } catch {}
  };
  const persistLastSeen = (iso) => {
    try { localStorage.setItem('lastSeenNotificationsAt', iso); } catch {}
  };

  // Mark all visible notifications as read (UI + persistence)
  const markAllNotificationsRead = () => {
    setSmsNotifications(prev => prev.map(n => ({ ...n, read: true })));
    const ids = Array.from(new Set([...readNotificationIds, ...smsNotifications.map(n => n.id)]));
    persistReadIds(ids);
    persistLastSeen(new Date().toISOString());
  };


  // SMS notification and read status listeners
  useEffect(() => {
    if (!notificationsEnabled) {
      console.log('🔔 Notifications disabled');
      return;
    }

    if (!socket) {
      console.log('🔔 No socket connection for notifications');
      return;
    }

    console.log('🔔 Setting up notification listeners...');

    const handleLeadUpdate = (update) => {
      if (update.type === 'LEAD_UPDATED' && update.data.lead) {
        const lead = update.data.lead;

        // Check if this lead update contains a new SMS reply
        if (lead.booking_history) {
          const history = typeof lead.booking_history === 'string'
            ? JSON.parse(lead.booking_history)
            : lead.booking_history;

          // Find the most recent SMS_RECEIVED entry
          const recentSmsReply = history.find(entry =>
            entry.action === 'SMS_RECEIVED' &&
            new Date(entry.timestamp) > new Date(Date.now() - 30000) // Within last 30 seconds
          );

          if (recentSmsReply) {
            const notification = {
              id: `${lead.id}_${recentSmsReply.timestamp}`,
              leadId: lead.id,
              leadName: lead.name,
              leadPhone: lead.phone,
              message: recentSmsReply.details.body,
              timestamp: recentSmsReply.timestamp,
              read: false
            };

            setSmsNotifications(prev => [notification, ...prev.slice(0, 9)]); // Keep only 10 most recent
            console.log('📱 New SMS notification:', notification);
          }
        }
      }
    };

      // Handle incoming SMS via consolidated event (notifications only for received)
      const handleSmsReceived = (data) => {
        console.log('📱 Layout: Received message_received event:', data);
        if (!data?.leadId) {
          console.log('❌ Layout: No leadId in SMS event data');
          return;
        }

        // Create notification object matching the expected format
        const notification = {
          id: data.messageId || `${data.leadId}_${data.timestamp}_${Date.now()}`, // Use messageId if available
          leadId: data.leadId,
          leadName: data.leadName || 'SMS Reply',
          leadPhone: data.phone,
          message: data.content, // Use 'message' field for consistency with polling format
          content: data.content, // Keep both for compatibility
          timestamp: data.timestamp,
          type: 'sms',
          read: false, // New messages are always unread when they arrive
          formattedTime: 'Just now'
        };

        console.log('🔔 Layout: Adding NEW notification:', {
          id: notification.id,
          lead: notification.leadName,
          message: notification.message?.substring(0, 30) + '...'
        });

        // Add to notifications (avoid duplicates)
        setSmsNotifications(prev => {
          const exists = prev.some(n => n.id === notification.id);
          if (exists) {
            console.log('⚠️ Layout: Notification already exists, skipping duplicate');
            return prev;
          }

          // Add new notification to the beginning and keep only 10 most recent
          const updated = [notification, ...prev.slice(0, 9)];
          console.log('✅ Layout: Added notification, total unread:', updated.filter(n => !n.read).length);
          return updated;
        });
      };
    // Handle incoming messages via message_received event (both SMS and email)
    const handleMessageReceived = (data) => {
      console.log('🔔 Layout: Received message_received event:', data);

      // Handle both SMS and email messages
      if (!data?.leadId && !data?.phone) {
        console.log('❌ Layout: No leadId or phone in message event data');
        return;
      }

      // Use consistent messageId format
      const notificationId = data.messageId || `${data.leadId || data.phone}_${data.timestamp}_${Date.now()}`;

      const notification = {
        id: notificationId,
        messageId: data.messageId || notificationId, // Store the actual message ID
        leadId: data.leadId,
        leadName: data.leadName || (data.channel === 'email' ? 'Email Reply' : 'SMS Reply'),
        leadPhone: data.phone || data.leadPhone,
        leadEmail: data.email || data.leadEmail,
        message: data.content,
        content: data.content, // Include both for compatibility
        timestamp: data.timestamp,
        type: data.channel || data.type || 'sms',
        subject: data.subject,
        read: false,
        formattedTime: 'Just now'
      };

      console.log(`🔔 Layout: Adding ${notification.type} notification:`, {
        id: notification.id,
        lead: notification.leadName,
        content: notification.content?.substring(0, 30) + '...'
      });

      // Add to notifications (avoid duplicates)
      setSmsNotifications(prev => {
        const exists = prev.some(n => n.id === notification.id);
        if (exists) {
          console.log('⚠️ Layout: Notification already exists, skipping duplicate');
          return prev;
        }

        // Add new notification to the beginning and keep only 10 most recent
        const updated = [notification, ...prev.slice(0, 9)];
        console.log(`✅ Layout: Added ${notification.type} notification, total notifications:`, updated.length);
        return updated;
      });
    };

    // Handle message read events from other clients/components
    const handleMessageRead = (data) => {
      console.log('📡 Layout: Received message_read event:', data);

      const messageId = data.messageId;
      if (!messageId) {
        console.warn('⚠️ Layout: No messageId in message_read event');
        return;
      }

      // Update notifications state - match by both id and messageId for compatibility
      setSmsNotifications(prev =>
        prev.map(notif => {
          if (notif.id === messageId || notif.messageId === messageId) {
            console.log('✅ Layout: Marking notification as read:', notif.id);
            return { ...notif, read: true };
          }
          return notif;
        })
      );

      // Persist this specific notification id as read
      const ids = Array.from(new Set([...readNotificationIds, messageId]));
      persistReadIds(ids);
      console.log('💾 Layout: Persisted read status for:', messageId);
    };

    socket.on('lead_updated', handleLeadUpdate);
    // Listen to new event name only to avoid duplicate notifications
    socket.on('sms_received', handleSmsReceived);
    socket.on('message_received', handleMessageReceived);
    socket.on('message_read', handleMessageRead);

    return () => {
      socket.off('lead_updated', handleLeadUpdate);
      socket.off('sms_received', handleSmsReceived);
      socket.off('message_received', handleMessageReceived);
      socket.off('message_read', handleMessageRead);
    };
  }, [socket, notificationsEnabled]);

  // Ultra-fast polling for SMS notifications
  useEffect(() => {
    if (!notificationsEnabled) return;
    let lastSince = (() => { try { return localStorage.getItem('messagesSince') || ''; } catch { return ''; } })();
    const pollForNotifications = async () => {
      try {
        // Skip polling if notifications are disabled
        if (!notificationsEnabled) {
          console.log('🔔 Notifications disabled, skipping poll');
          return;
        }

        // Debounce polling to prevent excessive requests
        const now = Date.now();
        const timeSinceLastPoll = now - lastPollTime;
        if (timeSinceLastPoll < 10000) { // Minimum 10 seconds between polls
          console.log(`🔔 Skipping poll - too soon (${timeSinceLastPoll}ms since last poll)`);
          return;
        }
        setLastPollTime(now);

        const token = localStorage.getItem('token');
        const params = {};
        if (lastSince) params.since = lastSince;
        params.limit = 200;
        const response = await axios.get('/api/messages-list', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          timeout: 10000, // 10 second timeout to prevent hanging
          params
        });
        const messages = response.data.messages || [];
        console.log('🔔 Total messages fetched:', messages.length);
        // Update since cursor for next poll
        const newSince = response.data?.meta?.latestCreatedAt || response.data?.meta?.since;
        if (newSince) {
          lastSince = newSince;
          try { localStorage.setItem('messagesSince', newSince); } catch {}
        }
        
        // Scope to recent window to avoid historical backlog dominating
        const recentThresholdMs = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
        const recentMessages = messages.filter(msg => {
          const ts = (() => { try { return new Date(msg.timestamp).getTime(); } catch { return Date.now(); } })();
          if (ts < recentThresholdMs) return false;
          if (msg.direction !== 'received') return false;

          // Include both SMS and email messages in notifications
          if (msg.type !== 'sms' && msg.type !== 'SMS' && msg.type !== 'email') {
            // Only filter out unknown message types
            if (Math.random() < 0.1) { // Log only 10% of the time
              console.log('🔔 Filtering out unknown message type:', msg.id, msg.type);
            }
            return false;
          }

          return true; // Include all recent SMS and email messages
        });
        console.log('🔔 All recent messages:', recentMessages.length);

        // Convert to notifications format and update state
        const newNotifications = recentMessages.map(msg => {
          // Fix timestamp formatting with timezone correction
          let formattedTime = 'Just now';
          if (msg.timestamp) {
            try {
              // Handle timestamps without Z suffix by treating them as UTC
              let timestampToUse = msg.timestamp;
              if (typeof timestampToUse === 'string' &&
                  timestampToUse.includes('T') &&
                  !timestampToUse.endsWith('Z') &&
                  !timestampToUse.includes('+') &&
                  !timestampToUse.includes('-', 10)) { // Don't add Z if timezone offset already present
                timestampToUse = timestampToUse + 'Z';
              }

              const date = new Date(timestampToUse);
              if (!isNaN(date.getTime())) {
                const now = new Date();
                const diffMs = now - date;
                const diffMins = Math.floor(diffMs / (1000 * 60));
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                if (diffMins < 1) {
                  formattedTime = 'Just now';
                } else if (diffMins < 60) {
                  formattedTime = `${diffMins} min ago`;
                } else if (diffHours < 24) {
                  formattedTime = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                } else if (diffDays < 7) {
                  formattedTime = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
                } else {
                  formattedTime = date.toLocaleDateString();
                }
              }
            } catch (e) {
              console.warn('Invalid timestamp:', msg.timestamp);
            }
          }

          // Use consistent ID format - always use the message UUID
          const notificationId = msg.messageId || msg.id;

          // Check read status using the correct ID
          const locallyMarkedAsRead = readNotificationIds.includes(notificationId);
          const serverUnread = !msg.isRead; // Server's computed read status
          const isRead = !serverUnread || locallyMarkedAsRead;

          return {
            id: notificationId, // Use messageId as the primary ID for consistency
            messageId: msg.messageId || msg.id, // Include the actual message UUID
            leadId: msg.leadId,
            leadName: msg.leadName,
            leadPhone: msg.leadPhone,
            leadEmail: msg.leadEmail,
            message: msg.content,
            content: msg.content, // Include both for compatibility
            timestamp: msg.timestamp,
            formattedTime: formattedTime,
            type: msg.type, // Include message type (sms/email)
            subject: msg.details?.subject || msg.subject, // For email notifications
            read: isRead
          };
        });
        
        if (newNotifications.length > 0) {
          console.log('🔔 Found new notifications via polling:', newNotifications.length);

          // Preserve existing real-time notifications and merge with polled ones
          setSmsNotifications(prev => {
            // Keep existing notifications that aren't in the new polled list
            const existingRealtime = prev.filter(existing =>
              !newNotifications.some(newNotif => newNotif.id === existing.id)
            );

            // Merge new notifications with existing ones, preserving read status
            const mergedNotifications = newNotifications.map(newNotif => {
              const existing = prev.find(existing => existing.id === newNotif.id || existing.messageId === newNotif.id);
              const persistedRead = readNotificationIds.includes(newNotif.id);

              // Priority for read status: existing state > persisted state > server state
              let finalReadStatus = newNotif.read; // Start with server state
              if (persistedRead) finalReadStatus = true; // Override with persisted state
              if (existing && existing.read) finalReadStatus = true; // Override with existing state

              return {
                ...newNotif,
                read: finalReadStatus
              };
            });

            // Filter out notifications that are older than those we already have from real-time
            const filteredMerged = mergedNotifications.filter(merged => {
              const existingRealTimeItem = existingRealtime.find(rt => rt.id === merged.id);
              return !existingRealTimeItem; // Only include if not already present from real-time
            });

            // Combine real-time and polled notifications
            const combined = [...existingRealtime, ...filteredMerged];

            // Sort by timestamp (most recent first) and keep only 10 most recent
            combined.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            const final = combined.slice(0, 10);
            console.log('🔔 Final notifications:', final.length, 'unread:', final.filter(n => !n.read).length);
            return final;
          });
        } else {
          console.log('🔔 No new notifications found via polling');
        }
      } catch (error) {
        console.error('Error polling for notifications:', error);
      }
    };
    
    // Initial poll
    pollForNotifications();
    
    // Poll for notifications every 60 seconds (lighter)
    const pollingInterval = setInterval(() => {
      console.log('🔔 Layout: Polling for notifications...');
      pollForNotifications();
    }, 60000);
    
    return () => {
      clearInterval(pollingInterval);
      console.log('🔔 Layout: Cleaned up notification polling');
    };
  }, [notificationsEnabled, readNotificationIds]);

  // State to prevent multiple simultaneous requests
  const [processingNotifications, setProcessingNotifications] = useState(new Set());
  const [lastPollTime, setLastPollTime] = useState(0);

  // Mark notification as read when clicking on it
  const markNotificationAsRead = async (notification) => {
    const notificationId = notification.id;

    try {
      console.log('🔔 Marking notification as read:', notificationId);

      // Prevent duplicate requests - check if already being processed or marked as read
      if (readNotificationIds.includes(notificationId) || processingNotifications.has(notificationId)) {
        console.log('ℹ️ Message already marked as read or being processed, skipping');
        return;
      }

      // Add to processing set to prevent multiple clicks
      setProcessingNotifications(prev => new Set([...prev, notificationId]));

      // Add visual processing indicator
      setSmsNotifications(prev =>
        prev.map(notif => {
          if (notif.id === notificationId) {
            return { ...notif, processing: true };
          }
          return notif;
        })
      );

      // Update local state immediately for better UX (no flashing)
      setSmsNotifications(prev =>
        prev.map(notif => {
          if (notif.id === notificationId) {
            return { ...notif, read: true };
          }
          return notif;
        })
      );

      // Use the messageId (UUID) directly for marking as read - no need for complex formatting
      const messageIdentifier = notification.messageId || notificationId;

      const token = localStorage.getItem('token');
      const response = await axios.put(`/api/messages-list/${messageIdentifier}/read`, {}, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (response.data.success) {
        console.log('✅ Message marked as read on server');
        // Persist to localStorage - add to existing read IDs
        const ids = Array.from(new Set([...readNotificationIds, notificationId]));
        persistReadIds(ids);

        // Clear processing indicator and smooth transition - remove from notifications after a brief delay
        setSmsNotifications(prev =>
          prev.map(notif => {
            if (notif.id === notificationId) {
              return { ...notif, processing: false };
            }
            return notif;
          })
        );

        setTimeout(() => {
          setSmsNotifications(prev => prev.filter(notif => notif.id !== notificationId));
        }, 500);
      }
    } catch (error) {
      console.error('❌ Error marking notification as read:', error.response?.data || error.message);
      // Revert local state if API call failed
      setSmsNotifications(prev =>
        prev.map(notif => {
          if (notif.id === notificationId) {
            return { ...notif, read: false, processing: false };
          }
          return notif;
        })
      );
    } finally {
      // Always remove from processing set
      setProcessingNotifications(prev => {
        const newSet = new Set(prev);
        newSet.delete(notificationId);
        return newSet;
      });
    }
  };

  // Open message modal instead of navigating directly
  const handleNotificationClick = (notification) => {
    markNotificationAsRead(notification); // Pass the entire notification object
    setNotificationsOpen(false);
    setSelectedMessageModal(notification);
    setMessageModalOpen(true);
  };

  // When opening notifications, mark all as seen (but don't mark as read yet)
  useEffect(() => {
    if (notificationsOpen) {
      // Just update the last seen timestamp, don't mark as read
      persistLastSeen(new Date().toISOString());
    }
  }, [notificationsOpen]);

  // When navigating to Messages page, clear badge as user is viewing messages
  useEffect(() => {
    if (location.pathname === '/messages') {
      markAllNotificationsRead();
    }
  }, [location.pathname]);

  // Clean up old notifications periodically (keep only last 7 days)
  useEffect(() => {
    const cleanupOldNotifications = () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      setSmsNotifications(prev =>
        prev.filter(notification => {
          const notificationDate = new Date(notification.timestamp);
          return notificationDate > sevenDaysAgo;
        })
      );
    };

    // Clean up every hour
    const cleanupInterval = setInterval(cleanupOldNotifications, 60 * 60 * 1000);
    return () => clearInterval(cleanupInterval);
  }, []);

  // Handle modal close
  const handleMessageModalClose = () => {
    setMessageModalOpen(false);
    setSelectedMessageModal(null);
  };

  // Handle reply sent - refresh notifications or update
  const handleReplySent = () => {
    // Could refresh notifications here if needed
    console.log('SMS reply sent successfully');
  };

  // Count unread notifications
  const unreadCount = smsNotifications.filter(notif => !notif.read).length;

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: FiHome, viewerHidden: true },
    { 
      name: 'Leads', 
      href: '/leads', 
      icon: FiUsers,
      hasDropdown: true,
      viewerHidden: true,
      dropdownItems: [
        { name: 'All Leads', status: 'all', icon: '📋' },
        { name: 'New Leads', status: 'New', icon: '🆕' },
        { name: 'Booked', status: 'Booked', icon: '📅' },
        { name: 'Attended', status: 'Attended', icon: '✅' },
        { name: 'Cancelled', status: 'Cancelled', icon: '❌' }
      ]
    },
    { name: 'Calendar', href: '/calendar', icon: FiCalendar },
    { name: 'Messages', href: '/messages', icon: FiMessageSquare },
    { name: 'Daily Diary', href: '/daily-diary', icon: FiBookOpen, adminOnly: true },
    { name: 'Sales', href: '/sales', icon: FiTrendingUp, adminOnly: true },
    { name: 'Finance', href: '/finance', icon: FiDollarSign, adminOnly: true },
    { name: 'Reports', href: '/reports', icon: FiBarChart2 },
    { name: 'Booker Analytics', href: '/booker-analytics', icon: FiActivity, adminOnly: true },
    { name: 'AI Assistant', href: '/ai-assistant', icon: FiCpu, adminOnly: true },
    { name: 'Retargeting', href: '/retargeting', icon: FiTarget, adminOnly: true },
    { name: 'Templates', href: '/templates', icon: FiMail, adminOnly: true },
    { name: 'Legacy Data', href: '/legacy', icon: FiUsers, adminOnly: true },
    { name: 'Users', href: '/users', icon: FiUser, adminOnly: true },
  ];

  const leadsStatusOptions = [
    { name: 'All Leads', status: 'all', icon: '📊', color: 'text-gray-600' },
    { name: 'New Leads', status: 'New', icon: '🆕', color: 'text-orange-600' },
    { name: 'Booked', status: 'Booked', icon: '📅', color: 'text-blue-600' },
    { name: 'Attended', status: 'Attended', icon: '✅', color: 'text-green-600' },
    { name: 'Cancelled', status: 'Cancelled', icon: '❌', color: 'text-red-600' },
  ];

  const filteredNavigation = navigation.filter(item => {
    // Hide admin-only items for non-admins
    if (item.adminOnly && user?.role !== 'admin') return false;
    
    // Hide viewer-hidden items for viewers
    if (item.viewerHidden && user?.role === 'viewer') return false;
    
    return true;
  });

  const isCurrentPath = (path) => location.pathname === path;

  const handleLeadsNavigation = (status = 'all') => {
    // Keep dropdown open - only close sidebar on mobile
    setSidebarOpen(false);
    
    // Navigate to leads page with status filter
    navigate('/leads', { 
      state: { statusFilter: status },
      replace: false 
    });
  };

  const isLeadsPage = () => location.pathname === '/leads';

  const handleMessagesNavigation = (type = 'sms') => {
    setSidebarOpen(false);
    const target = (type === 'email') ? 'email' : 'sms';
    navigate(`/messages?type=${target}`);
  };

  const getActiveStatusClass = (status) => {
    // This is a basic implementation - in a real app you'd track the active filter state
    return isLeadsPage() && status === 'all' 
      ? 'bg-blue-50 text-blue-900'
      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar */}
      <div className={`fixed inset-0 flex z-40 md:hidden ${sidebarOpen ? '' : 'pointer-events-none'}`}>
        <div className={`fixed inset-0 bg-gray-600 bg-opacity-75 transition-opacity duration-300 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}
             onClick={() => setSidebarOpen(false)} />

        <div className={`relative flex-1 flex flex-col max-w-xs w-full bg-white transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="absolute top-0 right-0 -mr-12 pt-2">
            <button
              type="button"
              className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
              onClick={() => setSidebarOpen(false)}
            >
              <FiX className="h-6 w-6 text-white" />
            </button>
          </div>
          
          <div className="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
            <div className="flex-shrink-0 flex items-center px-4">
              <h1 className="text-xl font-bold text-gray-900">CRM Studio</h1>
            </div>
            <nav className="mt-5 px-2 space-y-1">
              {filteredNavigation.map((item) => (
                <div key={item.name}>
                  {item.name === 'Leads' ? (
                    // Leads with dropdown
                    <div className="relative" ref={leadsDropdownRef}>
                      <button
                        onClick={() => setLeadsDropdownOpen(!leadsDropdownOpen)}
                        className={`group flex items-center justify-between w-full px-2 py-2 text-base font-medium rounded-md ${
                          isCurrentPath(item.href)
                            ? 'bg-blue-100 text-blue-900'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <div className="flex items-center">
                          <item.icon className="mr-4 h-6 w-6" />
                          {item.name}
                        </div>
                        {leadsDropdownOpen ? (
                          <FiChevronUp className="h-4 w-4" />
                        ) : (
                          <FiChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      
                      {/* Dropdown Menu */}
                      {leadsDropdownOpen && (
                        <div className="mt-1 ml-6 space-y-1">
                          {leadsStatusOptions.map((option) => (
                            <button
                              key={option.status}
                              onClick={() => handleLeadsNavigation(option.status)}
                              className={`group flex items-center justify-between w-full px-2 py-2 text-sm rounded-md transition-colors ${getActiveStatusClass(option.status)}`}
                            >
                              <div className="flex items-center">
                                <span className="mr-2">{option.icon}</span>
                                <span className={option.color}>{option.name}</span>
                              </div>
                              {isLeadsPage() && option.status === 'all' && (
                                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : item.name === 'Messages' ? (
                    <div className="relative" ref={messagesDropdownRef}>
                      <button
                        onClick={() => setMessagesDropdownOpen(!messagesDropdownOpen)}
                        className={`group flex items-center justify-between w-full px-2 py-2 text-base font-medium rounded-md ${
                          isCurrentPath(item.href)
                            ? 'bg-blue-100 text-blue-900'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <div className="flex items-center">
                          <item.icon className="mr-4 h-6 w-6" />
                          {item.name}
                        </div>
                        {messagesDropdownOpen ? (
                          <FiChevronUp className="h-4 w-4" />
                        ) : (
                          <FiChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      {messagesDropdownOpen && (
                        <div className="mt-1 ml-6 space-y-1">
                          <button
                            onClick={() => handleMessagesNavigation('sms')}
                            className="group flex items-center justify-between w-full px-2 py-2 text-sm rounded-md text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          >
                            <span className="mr-2">📩</span>
                            <span>SMS</span>
                          </button>
                          <button
                            onClick={() => handleMessagesNavigation('email')}
                            className="group flex items-center justify-between w-full px-2 py-2 text-sm rounded-md text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          >
                            <span className="mr-2">✉️</span>
                            <span>Email</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : item.name === 'Templates' ? (
                    <div className="relative" ref={templatesDropdownRef}>
                      <button
                        onClick={() => setTemplatesDropdownOpen(!templatesDropdownOpen)}
                        className={`group flex items-center justify-between w-full px-2 py-2 text-base font-medium rounded-md ${
                          location.pathname.startsWith('/templates')
                            ? 'bg-blue-100 text-blue-900'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <div className="flex items-center">
                          <FiMail className="mr-4 h-6 w-6" />
                          {item.name}
                        </div>
                        {templatesDropdownOpen ? (
                          <FiChevronUp className="h-4 w-4" />
                        ) : (
                          <FiChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      {templatesDropdownOpen && (
                        <div className="mt-1 ml-6 space-y-1">
                          {templateCategories.map((cat) => (
                            <button
                              key={cat.key}
                              onClick={() => {
                                if (cat.key === 'Bookers Templates') {
                                  navigate('/bookers-templates');
                                } else {
                                  setSidebarOpen(false);
                                  navigate('/templates', { state: { category: cat.key, navKey: Date.now() + Math.random() } });
                                }
                              }}
                              className={`group flex items-center w-full px-2 py-2 text-sm rounded-md transition-colors ${
                                location.pathname.startsWith('/templates') && (location.state?.category === cat.key)
                                  ? 'bg-blue-50 text-blue-900 font-semibold'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                              }`}
                            >
                              <span className="mr-2">{cat.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : item.name === 'Retargeting' ? (
                    <div className="relative" ref={retargetingDropdownRef}>
                      <button
                        onClick={() => {
                          if (location.pathname !== '/retargeting') {
                            navigate('/retargeting');
                            setRetargetingDropdownOpen(true);
                          } else {
                            setRetargetingDropdownOpen(!retargetingDropdownOpen);
                          }
                        }}
                        className={`group flex items-center justify-between w-full px-2 py-2 text-sm font-medium rounded-md ${
                          isCurrentPath(item.href)
                            ? 'bg-blue-100 text-blue-900'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <div className="flex items-center">
                          <item.icon className="mr-3 h-5 w-5" />
                          {item.name}
                        </div>
                        {retargetingDropdownOpen ? (
                          <FiChevronUp className="h-4 w-4" />
                        ) : (
                          <FiChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      {retargetingDropdownOpen && (
                        <div className="mt-1 ml-6 space-y-1">
                          <button
                            onClick={() => {
                              navigate('/retargeting-leads');
                            }}
                            className="group flex items-center w-full px-2 py-2 text-sm rounded-md transition-colors text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          >
                            <span className="mr-2">👥</span>
                            Leads (Retargeted Signups)
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Regular navigation items
                    <Link
                      to={item.href}
                      className={`group flex items-center px-2 py-2 text-base font-medium rounded-md ${
                        isCurrentPath(item.href)
                          ? 'bg-blue-100 text-blue-900'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                      onClick={() => setSidebarOpen(false)}
                    >
                      <item.icon className="mr-4 h-6 w-6" />
                      {item.name}
                    </Link>
                  )}
                </div>
              ))}
            </nav>
          </div>
          
          <div className="flex-shrink-0 flex border-t border-gray-200 p-4">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center">
                  <span className="text-sm font-medium text-white">
                    {user?.name?.charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-700">{user?.name}</p>
                <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Static sidebar for desktop */}
      <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0">
        <div className="flex-1 flex flex-col min-h-0 border-r border-gray-200 bg-white">
          <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
            <div className="flex items-center flex-shrink-0 px-4">
              <h1 className="text-xl font-bold text-gray-900">CRM Studio</h1>
            </div>
            <nav className="mt-5 flex-1 px-2 bg-white space-y-1">
              {filteredNavigation.map((item) => (
                <div key={item.name}>
                  {item.name === 'Leads' ? (
                    // Leads with dropdown
                    <div className="relative" ref={leadsDropdownRef}>
                      <button
                        onClick={() => setLeadsDropdownOpen(!leadsDropdownOpen)}
                        className={`group flex items-center justify-between w-full px-2 py-2 text-sm font-medium rounded-md ${
                          isCurrentPath(item.href)
                            ? 'bg-blue-100 text-blue-900'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <div className="flex items-center">
                          <item.icon className="mr-3 h-5 w-5" />
                          {item.name}
                        </div>
                        {leadsDropdownOpen ? (
                          <FiChevronUp className="h-4 w-4" />
                        ) : (
                          <FiChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      
                      {/* Dropdown Menu */}
                      {leadsDropdownOpen && (
                        <div className="mt-1 ml-6 space-y-1">
                          {leadsStatusOptions.map((option) => (
                            <button
                              key={option.status}
                              onClick={() => handleLeadsNavigation(option.status)}
                              className={`group flex items-center justify-between w-full px-2 py-2 text-sm rounded-md transition-colors ${getActiveStatusClass(option.status)}`}
                            >
                              <div className="flex items-center">
                                <span className="mr-2">{option.icon}</span>
                                <span className={option.color}>{option.name}</span>
                              </div>
                              {isLeadsPage() && option.status === 'all' && (
                                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : item.name === 'Messages' ? (
                    <div className="relative" ref={messagesDropdownRef}>
                      <button
                        onClick={() => setMessagesDropdownOpen(!messagesDropdownOpen)}
                        className={`group flex items-center justify-between w-full px-2 py-2 text-sm font-medium rounded-md ${
                          isCurrentPath(item.href)
                            ? 'bg-blue-100 text-blue-900'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <div className="flex items-center">
                          <item.icon className="mr-3 h-5 w-5" />
                          {item.name}
                        </div>
                        {messagesDropdownOpen ? (
                          <FiChevronUp className="h-4 w-4" />
                        ) : (
                          <FiChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      {messagesDropdownOpen && (
                        <div className="mt-1 ml-6 space-y-1">
                          <button
                            onClick={() => handleMessagesNavigation('sms')}
                            className="group flex items-center justify-between w-full px-2 py-2 text-sm rounded-md text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          >
                            <span className="mr-2">📩</span>
                            <span>SMS</span>
                          </button>
                          <button
                            onClick={() => handleMessagesNavigation('email')}
                            className="group flex items-center justify-between w-full px-2 py-2 text-sm rounded-md text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          >
                            <span className="mr-2">✉️</span>
                            <span>Email</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : item.name === 'Templates' ? (
                    <div className="relative" ref={templatesDropdownRef}>
                      <button
                        onClick={() => setTemplatesDropdownOpen(!templatesDropdownOpen)}
                        className={`group flex items-center justify-between w-full px-2 py-2 text-sm font-medium rounded-md ${
                          location.pathname.startsWith('/templates')
                            ? 'bg-blue-100 text-blue-900'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <div className="flex items-center">
                          <FiMail className="mr-3 h-5 w-5" />
                          {item.name}
                        </div>
                        {templatesDropdownOpen ? (
                          <FiChevronUp className="h-4 w-4" />
                        ) : (
                          <FiChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      {templatesDropdownOpen && (
                        <div className="mt-1 ml-6 space-y-1">
                          {templateCategories.map((cat) => (
                            <button
                              key={cat.key}
                              onClick={() => {
                                if (cat.key === 'Bookers Templates') {
                                  navigate('/bookers-templates');
                                } else {
                                  setSidebarOpen(false);
                                  navigate('/templates', { state: { category: cat.key, navKey: Date.now() + Math.random() } });
                                }
                              }}
                              className={`group flex items-center w-full px-2 py-2 text-sm rounded-md transition-colors ${
                                location.pathname.startsWith('/templates') && (location.state?.category === cat.key)
                                  ? 'bg-blue-50 text-blue-900 font-semibold'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                              }`}
                            >
                              <span className="mr-2">{cat.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : item.name === 'Retargeting' ? (
                    <div className="relative" ref={retargetingDropdownRef}>
                      <button
                        onClick={() => {
                          if (location.pathname !== '/retargeting') {
                            navigate('/retargeting');
                            setRetargetingDropdownOpen(true);
                          } else {
                            setRetargetingDropdownOpen(!retargetingDropdownOpen);
                          }
                        }}
                        className={`group flex items-center justify-between w-full px-2 py-2 text-sm font-medium rounded-md ${
                          isCurrentPath(item.href)
                            ? 'bg-blue-100 text-blue-900'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <div className="flex items-center">
                          <item.icon className="mr-3 h-5 w-5" />
                          {item.name}
                        </div>
                        {retargetingDropdownOpen ? (
                          <FiChevronUp className="h-4 w-4" />
                        ) : (
                          <FiChevronDown className="h-4 w-4" />
                        )}
                      </button>
                      {retargetingDropdownOpen && (
                        <div className="mt-1 ml-6 space-y-1">
                          <button
                            onClick={() => {
                              navigate('/retargeting-leads');
                            }}
                            className="group flex items-center w-full px-2 py-2 text-sm rounded-md transition-colors text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          >
                            <span className="mr-2">👥</span>
                            Leads (Retargeted Signups)
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Regular navigation items
                    <Link
                      to={item.href}
                      className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md ${
                        isCurrentPath(item.href)
                          ? 'bg-blue-100 text-blue-900'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      <item.icon className="mr-3 h-5 w-5" />
                      {item.name}
                    </Link>
                  )}
                </div>
              ))}
            </nav>
          </div>
          
          <div className="flex-shrink-0 flex border-t border-gray-200 p-4">
            <div className="flex items-center w-full">
              <div className="flex-shrink-0">
                <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center">
                  <span className="text-sm font-medium text-white">
                    {user?.name?.charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="ml-3 flex-1">
                <p className="text-sm font-medium text-gray-700">{user?.name}</p>
                <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
              </div>
              <button
                onClick={logout}
                className="ml-2 p-1 rounded-md text-gray-400 hover:text-gray-500"
                title="Logout"
              >
                <FiLogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="md:pl-64 flex flex-col flex-1">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
          <div className="max-w-full mx-auto px-3 sm:px-4 lg:px-8">
            <div className="flex justify-between items-center h-14 sm:h-16">
              <div className="flex items-center">
                <div className="flex-shrink-0 md:hidden">
                  <button
                    type="button"
                    className="p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 touch-target"
                    onClick={() => setSidebarOpen(true)}
                  >
                    <FiMenu className="h-6 w-6" />
                  </button>
                </div>
                <h1 className="md:hidden ml-2 text-lg font-bold text-gray-900">CRM</h1>
              </div>

              <div className="flex items-center space-x-2 sm:space-x-4">
                <ConnectionStatus />


                <div className="relative" ref={notificationsDropdownRef}>
                  <button
                    onClick={() => setNotificationsOpen(!notificationsOpen)}
                    className="p-2 rounded-md text-gray-400 hover:text-gray-500 relative touch-target"
                  >
                    <FiBell className="h-5 w-5 sm:h-6 sm:w-6" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {/* Notifications Dropdown */}
                  {notificationsOpen && (
                    <div className="absolute right-0 mt-2 w-[90vw] sm:w-80 max-w-md bg-white rounded-lg shadow-lg ring-1 ring-black ring-opacity-5 z-50">
                      <div className="py-2">
                        <div className="px-4 py-2 border-b border-gray-200">
                          <h3 className="text-sm font-medium text-gray-900">Message Notifications</h3>
                        </div>
                        
                        {smsNotifications.length === 0 ? (
                          <div className="px-4 py-6 text-center text-gray-500">
                            <FiMessageSquare className="mx-auto h-6 w-6 mb-2" />
                            <p className="text-sm">No new messages</p>
                          </div>
                        ) : (
                          <div className="max-h-80 overflow-y-auto">
                            {smsNotifications.map(notification => (
                              <div
                                key={notification.id}
                                onClick={() => handleNotificationClick(notification)}
                                className={`px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 ${
                                  !notification.read ? 'bg-blue-50' : ''
                                }`}
                              >
                                <div className="flex items-start space-x-3">
                                  <div className="flex-shrink-0">
                                    {notification.type === 'email' ? (
                                      <FiMail className={`h-5 w-5 ${
                                        !notification.read ? 'text-blue-600' : 'text-gray-400'
                                      }`} />
                                    ) : (
                                      <FiMessageSquare className={`h-5 w-5 ${
                                        !notification.read ? 'text-blue-600' : 'text-gray-400'
                                      }`} />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <p className={`text-sm font-medium ${
                                        !notification.read ? 'text-gray-900' : 'text-gray-600'
                                      }`}>
                                        {notification.leadName}
                                        {notification.type === 'email' && notification.subject && (
                                          <span className="text-xs text-gray-500 block">
                                            Subject: {notification.subject}
                                          </span>
                                        )}
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        {notification.formattedTime || 'Just now'}
                                      </p>
                                    </div>
                                    <p className="text-sm text-gray-600 truncate">
                                      {notification.message}
                                    </p>
                                    {!notification.read && (
                                      <div className="w-2 h-2 bg-blue-600 rounded-full mt-1"></div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {smsNotifications.length > 0 && (
                          <div className="px-4 py-2 border-t border-gray-200">
                            <button
                              onClick={() => setSmsNotifications([])}
                              className="text-xs text-gray-500 hover:text-gray-700"
                            >
                              Clear all notifications
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="hidden sm:flex sm:items-center">
                  <span className="hidden lg:block text-sm text-gray-700 mr-2">Welcome, {user?.name}</span>
                  <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-sm font-medium text-white">
                      {user?.name?.charAt(0).toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1">
          <div className="py-3 sm:py-4 md:py-6">
            <div className="max-w-full mx-auto px-3 sm:px-4 lg:px-8">
              {children}
            </div>
          </div>
        </main>
      </div>

      {/* Message Modal */}
      <MessageModal
        notification={selectedMessageModal}
        isOpen={messageModalOpen}
        onClose={handleMessageModalClose}
        onReply={handleReplySent}
      />

    </div>
  );
};

export default Layout; 