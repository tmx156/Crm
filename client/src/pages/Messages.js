import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import MessageModal from '../components/MessageModal';
import {
  FiMessageSquare,
  FiMail,
  FiPhone,
  FiUser,
  FiClock,
  FiFilter,
  FiSearch,
  FiEye,
  FiArrowUpRight,
  FiRefreshCw,
  FiInbox,
  FiSend,
  FiCheck,
  FiX
} from 'react-icons/fi';
import axios from 'axios';

const Messages = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const [messages, setMessages] = useState([]);
  const [filteredMessages, setFilteredMessages] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('sms');
  const [selectedDirection, setSelectedDirection] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [selectedMessageModal, setSelectedMessageModal] = useState(null);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [readMessageIds, setReadMessageIds] = useState(new Set());
  const [localStorageLoaded, setLocalStorageLoaded] = useState(false);

  // Load read message IDs from localStorage on mount
  useEffect(() => {
    console.log('🔄 Messages: Loading read message IDs from localStorage...');
    try {
      const stored = localStorage.getItem('readMessageIds');
      if (stored) {
        const parsedIds = JSON.parse(stored);
        if (Array.isArray(parsedIds) && parsedIds.length > 0) {
          setReadMessageIds(new Set(parsedIds));
          console.log('✅ Loaded read message IDs from localStorage:', parsedIds.length, 'messages');
          console.log('📋 Read message IDs:', parsedIds.slice(0, 5), parsedIds.length > 5 ? `...and ${parsedIds.length - 5} more` : '');
        } else {
          console.log('ℹ️ No read message IDs found in localStorage or empty array');
        }
      } else {
        console.log('ℹ️ No readMessageIds key found in localStorage');
      }
    } catch (error) {
      console.warn('❌ Error loading read message IDs from localStorage:', error);
    } finally {
      setLocalStorageLoaded(true);
      console.log('🚀 Messages: localStorage loading completed');
    }
  }, []);

  // Save read message IDs to localStorage when they change
  useEffect(() => {
    if (!localStorageLoaded) return; // Don't save until we've loaded the initial data

    try {
      const idsArray = Array.from(readMessageIds);
      localStorage.setItem('readMessageIds', JSON.stringify(idsArray));
      console.log('💾 Saved read message IDs to localStorage:', idsArray.length);
    } catch (error) {
      console.warn('Error saving read message IDs to localStorage:', error);
    }
  }, [readMessageIds, localStorageLoaded]);

  // Calculate stats based on conversations
  const calculateConversationStats = (conversations, allMessages) => {
    const totalConversations = conversations.filter(c => c.isConversation).length;
    const totalIndividualMessages = allMessages.length;

    // Count conversations by type (conversations can have both SMS and email)
    const smsConversations = conversations.filter(c => c.isConversation && c.hasSMS).length;
    const emailConversations = conversations.filter(c => c.isConversation && c.hasEmail).length;
    const mixedConversations = conversations.filter(c => c.isConversation && c.hasSMS && c.hasEmail).length;

    // Count unread conversations (conversations with unread messages)
    const unreadConversations = conversations.filter(c => c.isConversation && c.unreadCount > 0).length;

    // Calculate total messages across all conversations
    const totalMessagesInConversations = conversations
      .filter(c => c.isConversation)
      .reduce((total, conv) => total + conv.messageCount, 0);

    return {
      totalMessages: totalConversations, // Show conversations count
      smsCount: smsConversations,
      emailCount: emailConversations,
      mixedCount: mixedConversations,
      unreadCount: unreadConversations,
      totalIndividualMessages, // Keep track of actual message count
      totalMessagesInConversations
    };
  };

  // Group messages into conversation threads by lead (not by lead+type)
  const groupMessagesIntoConversations = (messages) => {
    const conversations = new Map();
    const orphanedMessages = [];

    messages.forEach(message => {
      // Only group SMS and email messages that have a leadId
      if ((message.type === 'sms' || message.type === 'email') && message.leadId) {
        const conversationKey = message.leadId; // Group by lead only

        if (!conversations.has(conversationKey)) {
          // Create new conversation with the most recent message
          conversations.set(conversationKey, {
            id: `conv_${message.leadId}`,
            leadId: message.leadId,
            leadName: message.leadName,
            leadEmail: message.leadEmail,
            leadPhone: message.leadPhone,
            leadStatus: message.leadStatus,
            assignedTo: message.assignedTo,
            lastMessage: message,
            messageCount: 1,
            unreadCount: message.isRead === false ? 1 : 0,
            hasSMS: message.type === 'sms',
            hasEmail: message.type === 'email',
            messages: [message],
            timestamp: new Date(message.timestamp || message.created_at),
            isConversation: true,
            // Track delivery status for conversations
            hasFailedDeliveries: message.delivery_status === 'failed' || message.email_status === 'failed',
            hasPendingDeliveries: message.delivery_status === 'pending' || message.delivery_status === 'sending'
          });
        } else {
          const conversation = conversations.get(conversationKey);

          // Add message to conversation
          conversation.messages.push(message);
          conversation.messageCount++;

          // Update unread count
          if (message.isRead === false) {
            conversation.unreadCount++;
          }

          // Update message type flags
          if (message.type === 'sms') conversation.hasSMS = true;
          if (message.type === 'email') conversation.hasEmail = true;

          // Update delivery status flags
          if (message.delivery_status === 'failed' || message.email_status === 'failed') {
            conversation.hasFailedDeliveries = true;
          }
          if (message.delivery_status === 'pending' || message.delivery_status === 'sending') {
            conversation.hasPendingDeliveries = true;
          }

          // Update last message if this is newer
          const messageTime = new Date(message.timestamp || message.created_at);
          if (messageTime > conversation.timestamp) {
            conversation.lastMessage = message;
            conversation.timestamp = messageTime;
          }
        }
      } else {
        // Messages without leadId or other types stay as individual items
        orphanedMessages.push(message);
      }
    });

    // Convert conversations to array and sort by most recent
    const conversationArray = Array.from(conversations.values())
      .sort((a, b) => b.timestamp - a.timestamp);

    // Combine conversations and orphaned messages
    return [...conversationArray, ...orphanedMessages];
  };

  // Fetch messages
  const fetchMessages = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/messages-list');

      let fetchedMessages = response.data.messages || [];

      // Preserve read status - once a message is marked as read, it stays read permanently
      // Also check localStorage directly as a fallback
      const fallbackReadIds = new Set();
      try {
        const stored = localStorage.getItem('readMessageIds');
        if (stored) {
          const parsedIds = JSON.parse(stored);
          if (Array.isArray(parsedIds)) {
            parsedIds.forEach(id => fallbackReadIds.add(id));
          }
        }
      } catch (error) {
        console.warn('Error reading fallback read IDs from localStorage:', error);
      }

      fetchedMessages = fetchedMessages.map(message => {
        const isMarkedAsRead = readMessageIds.has(message.id) ||
                              fallbackReadIds.has(message.id) ||
                              message.read_status === true ||
                              message.isRead === true;

        if (isMarkedAsRead) {
          console.log(`📖 Message ${message.id} marked as read from ${readMessageIds.has(message.id) ? 'state' : fallbackReadIds.has(message.id) ? 'localStorage' : 'backend'}`);
        }

        return {
          ...message,
          isRead: isMarkedAsRead
        };
      });

      // TEMPORARILY DISABLE conversation grouping to test if messages appear
      // const groupedMessages = groupMessagesIntoConversations(fetchedMessages);
      const groupedMessages = fetchedMessages; // Use raw messages for now

      // TEMPORARILY USE SIMPLE STATS
      const conversationStats = {
        totalMessages: groupedMessages.length,
        smsCount: groupedMessages.filter(m => m.type === 'sms').length,
        emailCount: groupedMessages.filter(m => m.type === 'email').length,
        unreadCount: groupedMessages.filter(m => !m.isRead).length
      };

      setMessages(groupedMessages);
      setFilteredMessages(groupedMessages);
      setStats(conversationStats);
    } catch (error) {
      console.error('Error fetching messages:', error);
      // Set empty state on error
      setMessages([]);
      setFilteredMessages([]);
      setStats({});
    } finally {
      setLoading(false);
    }
  };

  // Initial load - wait for localStorage to be loaded
  useEffect(() => {
    if (!localStorageLoaded) return;

    console.log('🚀 Messages: localStorage loaded, fetching initial messages...');
    fetchMessages();
  }, [localStorageLoaded]);

  // Re-fetch messages when readMessageIds changes (after localStorage is loaded)
  // This ensures the UI reflects the latest read status
  useEffect(() => {
    if (!localStorageLoaded || readMessageIds.size === 0) return;

    console.log('🔄 Messages: Read status changed, updating message display...');
    // Re-apply read status to current messages without fetching new data
    setMessages(prevMessages =>
      prevMessages.map(message => {
        const isMarkedAsRead = readMessageIds.has(message.id) ||
                              message.read_status === true ||
                              message.isRead === true;

        return {
          ...message,
          isRead: isMarkedAsRead
        };
      })
    );

    setFilteredMessages(prevMessages =>
      prevMessages.map(message => {
        const isMarkedAsRead = readMessageIds.has(message.id) ||
                              message.read_status === true ||
                              message.isRead === true;

        return {
          ...message,
          isRead: isMarkedAsRead
        };
      })
    );
  }, [readMessageIds, localStorageLoaded]);

  // Polling effect - only start after localStorage is loaded
  useEffect(() => {
    if (!localStorageLoaded) return;

    // Less frequent polling to prevent flashing - poll every 60 seconds
    const pollingInterval = setInterval(() => {
      console.log('📱 Messages: Polling for new messages...');
      fetchMessages();
    }, 60000); // Poll every 60 seconds to reduce flashing

    return () => {
      clearInterval(pollingInterval);
      console.log('✅ Messages: Cleaned up polling');
    };
  }, [localStorageLoaded]);

  // Sync selectedFilter with ?type=sms|email in URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const type = params.get('type');
    if (type === 'sms' || type === 'email') {
      setSelectedFilter(type);
    }
  }, [location.search]);

  // When user changes filter, update URL query
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('type') !== selectedFilter) {
      params.set('type', selectedFilter);
      navigate({ pathname: '/messages', search: params.toString() }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilter]);

  // Listen for real-time message updates and read status changes
  useEffect(() => {
    if (socket) {
      const handleLeadUpdate = (update) => {
        if (update.type === 'LEAD_UPDATED' && update.data.lead) {
          const lead = update.data.lead;
          
          // Check if this update contains a new SMS or EMAIL
          if (lead.booking_history) {
            const history = typeof lead.booking_history === 'string' 
              ? JSON.parse(lead.booking_history) 
              : lead.booking_history;
            
            // Find the most recent inbound SMS entry
            const recentSms = history.find(entry => 
              entry.action === 'SMS_RECEIVED' && 
              new Date(entry.timestamp) > new Date(Date.now() - 30000) // Within last 30 seconds
            );
            
            // Find the most recent inbound EMAIL entry
            const recentEmail = history.find(entry => 
              entry.action === 'EMAIL_RECEIVED' && 
              new Date(entry.timestamp) > new Date(Date.now() - 30000) // Within last 30 seconds
            );
            
            if (recentSms) {
              // Add the new SMS message optimistically (client-side dedup window)
              const newMessage = {
                id: `${lead.id}_${recentSms.timestamp}`,
                leadId: lead.id,
                leadName: lead.name,
                leadPhone: lead.phone,
                content: recentSms.details?.body || recentSms.details?.message || 'No content',
                type: 'sms',
                direction: recentSms.action === 'SMS_SENT' ? 'sent' : 'received',
                action: recentSms.action,
                timestamp: recentSms.timestamp,
                performedBy: recentSms.performed_by,
                performedByName: recentSms.performed_by_name,
                isRead: recentSms.action === 'SMS_SENT' ? true : false,  // New received messages are unread
                details: recentSms.details
              };

              // Check if message already exists to avoid duplicates
              setMessages(prev => {
                const within2min = (a, b) => {
                  try { return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 120000; } catch { return false; }
                };
                const normalizedNew = (newMessage.content || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0,160);
                const exists = prev.some(msg => 
                  msg.leadId === newMessage.leadId &&
                  msg.type === 'sms' &&
                  msg.direction === 'received' &&
                  ((msg.id === newMessage.id) ||
                   (within2min(msg.timestamp, newMessage.timestamp) &&
                    (String(msg.content || '').replace(/\s+/g,' ').trim().toLowerCase().slice(0,160) === normalizedNew)))
                );
                if (exists) return prev;
                return [newMessage, ...prev];
              });
              
              // Also update filtered messages
               setFilteredMessages(prev => {
                 const within2min = (a, b) => {
                   try { return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 120000; } catch { return false; }
                 };
                 const normalizedNew = (newMessage.content || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0,160);
                 const exists = prev.some(msg => 
                   msg.leadId === newMessage.leadId &&
                   msg.type === 'sms' &&
                   msg.direction === 'received' &&
                   ((msg.id === newMessage.id) ||
                    (within2min(msg.timestamp, newMessage.timestamp) &&
                     (String(msg.content || '').replace(/\s+/g,' ').trim().toLowerCase().slice(0,160) === normalizedNew)))
                 );
                 if (exists) return prev;
                 return [newMessage, ...prev];
               });
              
              // Update stats
              setStats(prev => ({
                ...prev,
                totalMessages: prev.totalMessages + 1,
                smsCount: prev.smsCount + 1,
                sentCount: recentSms.action === 'SMS_SENT' ? prev.sentCount + 1 : prev.sentCount,
                receivedCount: recentSms.action === 'SMS_RECEIVED' ? prev.receivedCount + 1 : prev.receivedCount
              }));
            }
            
            // Handle new EMAIL messages
            if (recentEmail) {
              const newEmailMessage = {
                id: `${lead.id}_${recentEmail.timestamp}`,
                leadId: lead.id,
                leadName: lead.name,
                leadPhone: lead.phone,
                leadEmail: lead.email,
                content: recentEmail.details?.body || recentEmail.details?.subject || 'No content',
                type: 'email',
                direction: 'received',
                action: 'EMAIL_RECEIVED',
                timestamp: recentEmail.timestamp,
                performedBy: recentEmail.performed_by,
                performedByName: recentEmail.performed_by_name,
                isRead: recentEmail.details?.read || false,
                details: recentEmail.details
              };

              // Add email to messages state
              setMessages(prev => {
                const within2min = (a, b) => {
                  try { return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 120000; } catch { return false; }
                };
                const normalizedNew = (newEmailMessage.content || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0,160);
                const exists = prev.some(msg => 
                  msg.leadId === newEmailMessage.leadId &&
                  msg.type === 'email' &&
                  msg.direction === 'received' &&
                  ((msg.id === newEmailMessage.id) ||
                   (within2min(msg.timestamp, newEmailMessage.timestamp) &&
                    (String(msg.content || '').replace(/\s+/g,' ').trim().toLowerCase().slice(0,160) === normalizedNew)))
                );
                if (exists) return prev;
                return [newEmailMessage, ...prev];
              });
              
              // Update filtered messages
              setFilteredMessages(prev => {
                const within2min = (a, b) => {
                  try { return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 120000; } catch { return false; }
                };
                const normalizedNew = (newEmailMessage.content || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0,160);
                const exists = prev.some(msg => 
                  msg.leadId === newEmailMessage.leadId &&
                  msg.type === 'email' &&
                  msg.direction === 'received' &&
                  ((msg.id === newEmailMessage.id) ||
                   (within2min(msg.timestamp, newEmailMessage.timestamp) &&
                    (String(msg.content || '').replace(/\s+/g,' ').trim().toLowerCase().slice(0,160) === normalizedNew)))
                );
                if (exists) return prev;
                return [newEmailMessage, ...prev];
              });
              
              // Update stats for email
              setStats(prev => ({
                ...prev,
                totalMessages: prev.totalMessages + 1,
                emailCount: prev.emailCount + 1,
                receivedCount: prev.receivedCount + 1
              }));
            }
          }
        }
      };

      // Handle incoming message events from SMS webhook - listen for both events
      const handleMessageReceived = (data) => {
        console.log('📱 Messages: Received message_received event:', data);
        
        // Create new message object immediately
        if (data && (data.leadId || data.phone)) {
          const newMessage = {
            id: `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            leadId: data.leadId || data.phone,
            leadName: data.leadName || data.name || 'Unknown',
            leadPhone: data.phone || data.leadPhone || '',
            content: data.content || data.message || data.body || 'No content',
            type: 'sms',
            direction: 'received',
            action: 'SMS_RECEIVED',
            timestamp: data.timestamp || new Date().toISOString(),
            isRead: false,
            details: data.details || {}
          };
          
          // Add to messages immediately for instant visibility
          setMessages(prev => {
            // Simple duplicate check
            const exists = prev.some(msg => 
              msg.content === newMessage.content && 
              msg.leadPhone === newMessage.leadPhone &&
              Math.abs(new Date(msg.timestamp) - new Date(newMessage.timestamp)) < 10000
            );
            if (!exists) {
              console.log('✅ Adding new SMS to messages:', newMessage);
              return [newMessage, ...prev];
            }
            return prev;
          });
          
          // Update stats immediately
          setStats(prev => ({
            ...prev,
            totalMessages: (prev.totalMessages || 0) + 1,
            smsCount: (prev.smsCount || 0) + 1,
            receivedCount: (prev.receivedCount || 0) + 1,
            unreadCount: (prev.unreadCount || 0) + 1
          }));
        }
        
        // Refresh messages from server after a longer delay to prevent flashing
        // Only refresh if this is a new message not already in our list
        const existingMessage = messages.find(msg => msg.id === data.messageId);
        if (!existingMessage) {
          setTimeout(() => fetchMessages(), 10000); // 10 seconds delay
        }
        
        // Show a brief notification
        console.log(`📱 New SMS received from ${data.phone}: ${data.content}`);
      };

      // Handle incoming SMS events (alternative event name)
      const handleSmsReceived = (data) => {
        console.log('📱 Messages: Received sms_received event:', data);
        // Process the same way as message_received
        handleMessageReceived(data);
      };

      // Handle incoming EMAIL events
      const handleEmailReceived = (data) => {
        console.log('📧 Messages: Received email_received event:', data);
        
        // Create new email message object immediately
        if (data && (data.leadId || data.email)) {
          const newEmailMessage = {
            id: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            leadId: data.leadId || data.email,
            leadName: data.leadName || data.name || 'Unknown',
            leadPhone: data.phone || data.leadPhone || '',
            leadEmail: data.email || data.leadEmail || '',
            content: data.content || data.subject || data.body || 'No content',
            type: 'email',
            direction: 'received',
            action: 'EMAIL_RECEIVED',
            timestamp: data.timestamp || new Date().toISOString(),
            isRead: false,
            details: data.details || {}
          };
          
          // Add to messages immediately for instant visibility
          setMessages(prev => {
            // Simple duplicate check
            const exists = prev.some(msg => 
              msg.content === newEmailMessage.content && 
              msg.leadEmail === newEmailMessage.leadEmail &&
              Math.abs(new Date(msg.timestamp) - new Date(newEmailMessage.timestamp)) < 10000
            );
            if (!exists) {
              console.log('✅ Adding new email to messages:', newEmailMessage);
              return [newEmailMessage, ...prev];
            }
            return prev;
          });
          
          // Update stats immediately
          setStats(prev => ({
            ...prev,
            totalMessages: (prev.totalMessages || 0) + 1,
            emailCount: (prev.emailCount || 0) + 1,
            receivedCount: (prev.receivedCount || 0) + 1,
            unreadCount: (prev.unreadCount || 0) + 1
          }));
        }
        
        // Refresh messages from server after a longer delay to prevent flashing
        // Only refresh if this is a new message not already in our list
        const existingMessage = messages.find(msg => msg.id === data.messageId);
        if (!existingMessage) {
          setTimeout(() => fetchMessages(), 10000); // 10 seconds delay
        }
        
        // Show a brief notification
        console.log(`📧 New email received from ${data.leadId}: ${data.content}`);
      };

      // Handle messages synced event
      const handleMessagesSynced = (data) => {
        console.log('🔄 Messages: Received messages_synced event:', data);
        setSyncStatus(`Synced ${data.totalSynced} messages, skipped ${data.totalSkipped} duplicates`);

        // Only refresh if there were actually new messages synced
        if (data.totalSynced > 0) {
          setTimeout(() => fetchMessages(), 5000); // 5 second delay to prevent flashing
        }
        
        // Clear status after 5 seconds
        setTimeout(() => setSyncStatus(null), 5000);
      };

      const handleMessagesDeleted = (payload) => {
        try {
          const ids = payload?.messageIds || [];
          if (ids.length === 0) return;
          setMessages(prev => prev.filter(m => !ids.includes(m.id)));
          setFilteredMessages(prev => prev.filter(m => !ids.includes(m.id)));
          setSelectedIds(prev => prev.filter(id => !ids.includes(id)));
        } catch (e) {
          console.warn('Messages deleted event handling error:', e);
        }
      };

      // Handle message read events from other clients/components
      const handleMessageRead = (data) => {
        console.log('📡 Messages: Received message_read event:', data);
        console.log('📡 Messages: Current messages count:', messages.length);
        
        // Update both messages and filteredMessages state
        setMessages(prev => {
          const updated = prev.map(msg => {
            if (msg.id === data.messageId) {
              console.log('✅ Messages: Found and updating message:', msg.id);
              return { ...msg, isRead: true };
            }
            return msg;
          });
          console.log('📡 Messages: Updated messages state');
          return updated;
        });
        
        setFilteredMessages(prev => {
          const updated = prev.map(msg => {
            if (msg.id === data.messageId) {
              console.log('✅ Messages: Found and updating filtered message:', msg.id);
              return { ...msg, isRead: true };
            }
            return msg;
          });
          console.log('📡 Messages: Updated filteredMessages state');
          return updated;
        });
      };

      // Listen for all relevant events
      socket.on('lead_updated', handleLeadUpdate);
      socket.on('message_received', handleMessageReceived);
      socket.on('sms_received', handleSmsReceived); // Add this event listener
      socket.on('email_received', handleEmailReceived);
      socket.on('messages_synced', handleMessagesSynced);
      socket.on('message_read', handleMessageRead);
      socket.on('messages_deleted', handleMessagesDeleted);
      socket.on('message_read_direct', handleMessageRead); // Backup listener
      
      return () => {
        socket.off('lead_updated', handleLeadUpdate);
        socket.off('message_received', handleMessageReceived);
        socket.off('sms_received', handleSmsReceived); // Clean up this listener too
        socket.off('email_received', handleEmailReceived);
        socket.off('messages_synced', handleMessagesSynced);
        socket.off('message_read', handleMessageRead);
        socket.off('message_read_direct', handleMessageRead);
        socket.off('messages_deleted', handleMessagesDeleted);
      };
    }
  }, [socket]);

  // Filter messages based on search and filters
  useEffect(() => {
    let filtered = messages;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(msg => 
        msg.leadName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        msg.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        msg.leadPhone?.includes(searchTerm) ||
        msg.leadEmail?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Type filter (sms or email)
    filtered = filtered.filter(msg => msg.type === selectedFilter);

    // Direction filter
    if (selectedDirection !== 'all') {
      filtered = filtered.filter(msg => msg.direction === selectedDirection);
    }

    setFilteredMessages(filtered);
  }, [messages, searchTerm, selectedFilter, selectedDirection]);

  // Keep selection in sync with current filtered view
  useEffect(() => {
    if (selectAll) {
      setSelectedIds(filteredMessages.map(m => m.id));
    } else {
      setSelectedIds(prev => prev.filter(id => filteredMessages.some(m => m.id === id)));
    }
  }, [filteredMessages, selectAll]);

  const toggleSelectAll = () => {
    const next = !selectAll;
    setSelectAll(next);
    setSelectedIds(next ? filteredMessages.map(m => m.id) : []);
  };

  const toggleSelectOne = (e, id) => {
    e.stopPropagation();
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/messages-list/bulk-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ messageIds: selectedIds })
      });
      const data = await res.json();
      if (data.success) {
        const removed = new Set((data.results || []).filter(r => r.success).map(r => r.messageId));
        setMessages(prev => prev.filter(m => !removed.has(m.id)));
        setFilteredMessages(prev => prev.filter(m => !removed.has(m.id)));
        setSelectedIds([]);
        setSelectAll(false);
      } else {
        alert(data.message || 'Delete failed');
      }
    } catch (err) {
      console.error('Bulk delete error:', err);
      alert('Delete failed');
    }
  };

  // Debug function to clear all read statuses (for testing)
  const clearAllReadStatuses = () => {
    console.log('🧹 Clearing all read statuses...');
    setReadMessageIds(new Set());
    localStorage.removeItem('readMessageIds');
    // Refetch messages to reset all to unread
    fetchMessages();
  };

  // Mark message as read with proper race condition handling
  const markAsRead = async (message) => {
    const messageId = message.id;

    // Prevent duplicate requests if already processing
    if (readMessageIds.has(messageId) || message.processing) {
      console.log('ℹ️ Messages: Message already read or being processed:', messageId);
      return;
    }

    try {
      console.log('📱 Messages: Marking message as read:', messageId);

      // Mark as processing to prevent race conditions
      const updateProcessingState = (processing) => {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === messageId ? { ...msg, processing } : msg
          )
        );
        setFilteredMessages(prev =>
          prev.map(msg =>
            msg.id === messageId ? { ...msg, processing } : msg
          )
        );
      };

      updateProcessingState(true);

      // Optimistic UI update - mark as read immediately for better UX
      setMessages(prev =>
        prev.map(msg =>
          msg.id === messageId ? { ...msg, isRead: true } : msg
        )
      );
      setFilteredMessages(prev =>
        prev.map(msg =>
          msg.id === messageId ? { ...msg, isRead: true } : msg
        )
      );

      // Use messageId directly (now that we're using UUIDs consistently)
      const response = await axios.put(`/api/messages-list/${messageId}/read`);

      if (response.data.success) {
        console.log('✅ Messages: Message marked as read successfully:', messageId);
        console.log('📋 Messages: Update method used:', response.data.method || 'direct');

        // Add to permanent read set - once read, stays read forever
        setReadMessageIds(prev => new Set([...prev, messageId]));

        updateProcessingState(false);
      } else {
        throw new Error(response.data.message || 'Failed to mark as read');
      }
    } catch (error) {
      console.error('❌ Messages: Error marking message as read:', error);

      // Remove processing state
      const updateProcessingState = (processing) => {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === messageId ? { ...msg, processing } : msg
          )
        );
        setFilteredMessages(prev =>
          prev.map(msg =>
            msg.id === messageId ? { ...msg, processing } : msg
          )
        );
      };

      updateProcessingState(false);

      // Handle 404 - message doesn't exist, remove from UI
      if (error.response?.status === 404) {
        console.log('🗑️ Messages: Message not found (404), removing from UI:', messageId);

        // Remove the non-existent message from the UI
        setMessages(prev => prev.filter(msg => msg.id !== messageId));
        setFilteredMessages(prev => prev.filter(msg => msg.id !== messageId));
      } else {
        // Revert optimistic UI update on other errors
        console.log('🔄 Messages: Reverting optimistic update due to error');
        setMessages(prev =>
          prev.map(msg =>
            msg.id === messageId ? { ...msg, isRead: false } : msg
          )
        );
        setFilteredMessages(prev =>
          prev.map(msg =>
            msg.id === messageId ? { ...msg, isRead: false } : msg
          )
        );
      }
    }
  };

  // Open message modal instead of navigating directly
  const handleMessageClick = (message) => {
    markAsRead(message);
    
    // Convert message format to notification format for the modal
    const notificationFormat = {
      id: message.id,
      leadId: message.leadId,
      leadName: message.leadName,
      leadPhone: message.leadPhone,
      leadEmail: message.leadEmail,
      content: message.content,  // Changed from 'message' to 'content'
      timestamp: message.timestamp,
      read: true,
      type: message.type,
      direction: message.direction,
      subject: message.subject || message.content,  // Add subject for emails
      isGrouped: message.isGrouped,
      conversationCount: message.conversationCount
    };
    
    setSelectedMessageModal(notificationFormat);
    setMessageModalOpen(true);
  };

  // Handle modal close
  const handleMessageModalClose = () => {
    setMessageModalOpen(false);
    setSelectedMessageModal(null);
  };

  // Handle reply sent - add optimistically then refresh
  const handleReplySent = (sentMessage) => {
    // Do not inject sent messages into the inbox; refresh to keep only received
    setTimeout(() => {
      fetchMessages();
    }, 800);
  };

  // Sync historical messages from provider
  const handleSyncMessages = async () => {
    if (syncing) return;
    
    setSyncing(true);
    setSyncStatus('Starting sync...');
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/sms/sync?purge=true', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSyncStatus(`✅ ${data.message}`);
        console.log('📱 SMS sync completed:', data);
        
        // Refresh messages to show newly synced ones
        fetchMessages();
      } else {
        setSyncStatus(`❌ Sync failed: ${data.error || data.message}`);
        console.error('SMS sync failed:', data);
      }
    } catch (error) {
      setSyncStatus(`❌ Sync error: ${error.message}`);
      console.error('Error syncing messages:', error);
    } finally {
      setSyncing(false);
      
      // Clear status after 5 seconds
      setTimeout(() => setSyncStatus(null), 5000);
    }
  };

  // Format timestamp
  const formatTime = (timestamp) => {
    if (!timestamp) return 'Just now';
    
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return 'Just now';
      }
      
      const now = new Date();
      const diff = now - date;
      const hours = diff / (1000 * 60 * 60);
      
      if (hours < 24) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (hours < 48) {
        return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch (error) {
      console.warn('Invalid timestamp:', timestamp);
      return 'Just now';
    }
  };

  // Get message icon
  const getMessageIcon = (type, direction) => {
    if (type === 'sms') {
      return direction === 'sent' ? 
        <FiMessageSquare className="h-5 w-5 text-blue-500" /> :
        <FiMessageSquare className="h-5 w-5 text-green-500" />;
    } else {
      return direction === 'sent' ? 
        <FiMail className="h-5 w-5 text-blue-500" /> :
        <FiMail className="h-5 w-5 text-green-500" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
            <FiMessageSquare className="h-6 w-6" />
            <span>Messages</span>
          </h1>
          <p className="text-gray-600 mt-1">
            {user.role === 'admin' ? 'All communications' : 'Your allocated leads communications'}
          </p>
        </div>
        
        {/* Action Buttons */}
        <div className="mt-4 md:mt-0 flex items-center space-x-3">
          {/* Refresh Button */}
          <button
            onClick={() => {
              console.log('🔄 Manual refresh triggered - clearing cache and reloading');
              // Clear local read status cache on manual refresh
              setReadMessageIds(new Set());
              localStorage.removeItem('readMessageIds');
              // Force reload from server
              fetchMessages();
            }}
            disabled={loading}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            <FiRefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          {/* Clear Read Status Button - Debug */}
          {user.role === 'admin' && (
            <button
              onClick={clearAllReadStatuses}
              className="inline-flex items-center px-3 py-2 border border-red-300 shadow-sm text-sm leading-4 font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              <FiEye className="h-4 w-4 mr-2" />
              Clear Read Status
            </button>
          )}

          {/* Sync Status - Admin Only */}
          {user.role === 'admin' && syncStatus && (
            <div className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
              {syncStatus}
            </div>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiInbox className="h-5 w-5 text-gray-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Total Messages</p>
              <p className="text-lg font-semibold text-gray-900">{stats.totalMessages || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiMessageSquare className="h-5 w-5 text-blue-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">SMS Messages</p>
              <p className="text-lg font-semibold text-gray-900">{stats.smsCount || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <FiMail className="h-5 w-5 text-green-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Email Messages</p>
              <p className="text-lg font-semibold text-gray-900">{stats.emailCount || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 relative">
              <FiEye className="h-5 w-5 text-orange-400" />
              {(stats.unreadCount || 0) > 0 && (
                <span className="absolute -top-1 -right-1 h-2 w-2 bg-red-500 rounded-full animate-pulse"></span>
              )}
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500">Unread</p>
              <div className="flex items-center space-x-2">
                <p className="text-lg font-semibold text-gray-900">{stats.unreadCount || 0}</p>
                {(stats.unreadCount || 0) > 0 && (
                  <span className="text-xs text-orange-600 font-medium">New messages!</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0 md:space-x-4">
          {/* Search */}
          <div className="flex-1 md:max-w-xl">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <FiSearch className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Search messages, leads, phone numbers..."
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Type Filter */}
          <div className="flex items-center space-x-2">
            <FiFilter className="h-4 w-4 text-gray-400" />
            <select
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          </div>

          {/* Direction Filter */}
          <div>
            <select
              value={selectedDirection}
              onChange={(e) => setSelectedDirection(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Messages</option>
              <option value="received">Received Only</option>
              <option value="sent">Sent Only</option>
            </select>
          </div>

          {/* Selection controls - Admin only */}
          {user.role === 'admin' && (
            <div className="flex items-center space-x-3">
              <label className="inline-flex items-center space-x-2 text-sm text-gray-700">
                <input type="checkbox" checked={selectAll} onChange={toggleSelectAll} />
                <span>Select all in view</span>
              </label>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.length === 0}
                className={`px-3 py-2 text-sm font-medium rounded-md border ${selectedIds.length === 0 ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-red-600 text-white border-red-700 hover:bg-red-700'}`}
              >
                Delete Selected
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Messages List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {filteredMessages.length === 0 ? (
          <div className="text-center py-12">
            <FiMessageSquare className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No messages found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchTerm || selectedFilter !== 'all' || selectedDirection !== 'all' 
                ? 'Try adjusting your filters or search terms.'
                : 'No communication history available yet.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {filteredMessages.map((message) => (
              <li
                key={message.id}
                className={`hover:bg-gray-50 cursor-pointer transition-colors relative ${
                  !message.isRead ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                }`}
                onClick={() => handleMessageClick(message)}
              >
                <div className="px-4 py-4 flex items-center justify-between">
                  <div className="flex items-center space-x-4 flex-1">
                    {user.role === 'admin' && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(message.id)}
                        onChange={(e) => toggleSelectOne(e, message.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4"
                      />
                    )}
                    {/* Message Icon */}
                    <div className="flex-shrink-0">
                      {getMessageIcon(message.type, message.direction)}
                    </div>

                    {/* Message Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <p className={`text-sm font-medium ${!message.isRead ? 'text-gray-900' : 'text-gray-600'}`}>
                            {message.leadName}
                          </p>
                          <span className="text-xs text-gray-500">
                            {message.leadPhone}
                          </span>
                          {message.direction === 'received' && !message.isRead && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500 text-white animate-pulse">
                              NEW
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            message.direction === 'sent'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {message.direction === 'sent' ? (
                              <>
                                <FiSend className="h-3 w-3 mr-1" />
                                Sent
                              </>
                            ) : (
                              <>
                                <FiInbox className="h-3 w-3 mr-1" />
                                Received
                              </>
                            )}
                          </span>
                          {/* Delivery Status for Sent Messages */}
                          {message.direction === 'sent' && message.delivery_status && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ml-2 ${
                              message.delivery_status === 'delivered'
                                ? 'bg-green-100 text-green-800'
                                : message.delivery_status === 'failed'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {message.delivery_status === 'delivered' && (
                                <>
                                  <FiCheck className="h-3 w-3 mr-1" />
                                  Delivered
                                </>
                              )}
                              {message.delivery_status === 'failed' && (
                                <>
                                  <FiX className="h-3 w-3 mr-1" />
                                  Failed
                                </>
                              )}
                              {message.delivery_status === 'sending' && (
                                <>
                                  <FiRefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                  Sending
                                </>
                              )}
                              {message.delivery_status === 'pending' && (
                                <>
                                  <FiClock className="h-3 w-3 mr-1" />
                                  Pending
                                </>
                              )}
                            </span>
                          )}
                          <FiArrowUpRight className="h-4 w-4 text-gray-400" />
                        </div>
                      </div>
                      <p className="text-sm text-gray-500 truncate mt-1">
                        {message.content}
                      </p>
                      {/* Error message for failed deliveries */}
                      {message.direction === 'sent' && message.delivery_status === 'failed' && message.error_message && (
                        <div className="mt-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-red-50 text-red-700 border border-red-200">
                            <FiX className="h-3 w-3 mr-1" />
                            Error: {message.error_message.length > 50
                              ? `${message.error_message.substring(0, 50)}...`
                              : message.error_message}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center mt-2 text-xs text-gray-500">
                        <FiClock className="h-3 w-3 mr-1" />
                        {formatTime(message.timestamp)}
                        {message.performedByName && message.direction === 'sent' && (
                          <>
                            <span className="mx-2">•</span>
                            <FiUser className="h-3 w-3 mr-1" />
                            {message.performedByName}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
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

export default Messages;