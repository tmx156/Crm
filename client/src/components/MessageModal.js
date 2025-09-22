import React, { useState, useEffect, useCallback } from 'react';
import { 
  FiX, 
  FiMessageSquare, 
  FiMail,
  FiSend, 
  FiUser, 
  FiPhone, 
  FiClock,
  FiArrowRight,
  FiCheck,
  FiAlertCircle
} from 'react-icons/fi';
import axios from 'axios';
import { useSocket } from '../context/SocketContext';

const MessageModal = ({ notification, isOpen, onClose, onReply }) => {
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [markingAsRead, setMarkingAsRead] = useState(false);
  const [readError, setReadError] = useState(null);
  const { socket } = useSocket();

  // Define fetchConversationHistory function first
  const fetchConversationHistory = useCallback(async () => {
    try {
      setLoadingHistory(true);
      const response = await axios.get(`/api/leads/${notification.leadId}`);
      const lead = response.data;
      
      if (lead.booking_history) {
        const history = typeof lead.booking_history === 'string' 
          ? JSON.parse(lead.booking_history) 
          : lead.booking_history;
        
        // Filter by channel depending on the message type opened
        const wantedActions = notification?.type === 'email'
          ? ['EMAIL_SENT', 'EMAIL_RECEIVED']
          : ['SMS_SENT', 'SMS_RECEIVED', 'SMS_FAILED'];

        const convo = history
          .filter(entry => wantedActions.includes(entry.action))
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        setConversationHistory(convo);
      }
    } catch (error) {
      console.error('Error fetching conversation history:', error);
      setConversationHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [notification?.leadId, notification?.type]);

  // Reset state when modal opens with a new notification
  useEffect(() => {
    if (isOpen && notification) {
      setMarkingAsRead(false);
      setReadError(null);
      fetchConversationHistory();
      
      // Mark the message as read when modal opens (only if not already read)
      const markMessageAsRead = async () => {
        // Skip if already marked as read
        if (notification.read) {
          console.log('📱 MessageModal: Message already read, skipping mark as read');
          return;
        }

        try {
          setMarkingAsRead(true);
          setReadError(null);
          console.log('📱 MessageModal: Attempting to mark message as read:', notification.id);
          console.log('📱 MessageModal: Notification object:', notification);
          
          // Use the stored messageId if available, otherwise construct leadId_timestamp
          let messageIdentifier = notification.id;
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

          // If we have a stored messageId (from real-time updates), use it directly
          if (notification.messageId) {
            messageIdentifier = notification.messageId;
            console.log('📱 MessageModal: Using stored messageId:', messageIdentifier);
          } else if (notification.leadId && uuidRegex.test(notification.leadId)) {
            // If leadId is a UUID, it might be the actual message ID
            messageIdentifier = notification.leadId;
            console.log('📱 MessageModal: Using leadId as direct message ID (UUID):', messageIdentifier);
          } else if (notification.leadId && notification.timestamp) {
            // Construct leadId_timestamp format for non-UUID leadIds
            messageIdentifier = `${notification.leadId}_${notification.timestamp}`;
            console.log('📱 MessageModal: Using leadId_timestamp format:', messageIdentifier);
          } else {
            console.log('📱 MessageModal: Using notification.id as fallback:', messageIdentifier);
          }

          console.log('📱 MessageModal: Final message identifier:', messageIdentifier);
          console.log('📱 MessageModal: Has leadId:', !!notification.leadId, 'Has timestamp:', !!notification.timestamp);

          const token = localStorage.getItem('token');
          const response = await axios.put(`/api/messages-list/${messageIdentifier}/read`, {}, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });
          
          console.log('📱 MessageModal: API response:', response.data);

          if (response.data.success) {
            console.log('✅ MessageModal: Message marked as read successfully:', notification.id);
            console.log('📋 MessageModal: Update method used:', response.data.method || 'booking_history');
            setMarkingAsRead(false);

            // Also emit a direct socket event as backup to ensure synchronization
            if (socket) {
              socket.emit('message_read_direct', {
                messageId: notification.id,
                leadId: notification.leadId,
                leadName: notification.leadName
              });
              console.log('📡 MessageModal: Emitted direct socket event as backup');
            }
          } else {
            console.error('❌ MessageModal: API response indicates failure:', response.data);
            setReadError('Failed to mark message as read');
            setMarkingAsRead(false);
          }
        } catch (error) {
          console.error('❌ MessageModal: Error marking message as read:', error);
          console.error('❌ MessageModal: Error details:', error.response?.data);

          // Handle 404 - message doesn't exist
          if (error.response?.status === 404) {
            console.log('🗑️ MessageModal: Message not found (404), but keeping modal open:', notification.id);
            setReadError('Message not found in database');
            setMarkingAsRead(false);
            // Don't close the modal - just log the error and continue showing the modal
            // The user can still see the conversation history even if read status fails
          } else {
            setReadError(error.response?.data?.message || 'Failed to mark message as read');
            setMarkingAsRead(false);
          }
        }
      };
      
      // Add a small delay to ensure modal is fully rendered
      const timeoutId = setTimeout(() => {
        markMessageAsRead();
      }, 100);

      return () => clearTimeout(timeoutId);
    } else if (!isOpen) {
      // Reset state when modal closes
      setMarkingAsRead(false);
      setReadError(null);
    }
  }, [isOpen, notification, fetchConversationHistory]);

  // Listen for real-time updates to refresh conversation fast
  useEffect(() => {
    if (socket && isOpen && notification) {
      const handleLeadUpdate = (update) => {
        if (update.type === 'LEAD_UPDATED' && update.data.lead && 
            update.data.lead.id === notification.leadId) {
          // Refresh conversation history when this lead is updated
          fetchConversationHistory();
        }
      };
      const handleSmsReceived = (data) => {
        if (data && data.leadId === notification.leadId) {
          fetchConversationHistory();
        }
      };
      
      const handleMessageReceived = (data) => {
        if (data && data.leadId === notification.leadId) {
          fetchConversationHistory();
        }
      };

      socket.on('lead_updated', handleLeadUpdate);
      socket.on('sms_received', handleSmsReceived);
      socket.on('message_received', handleMessageReceived);
      
      return () => {
        socket.off('lead_updated', handleLeadUpdate);
        socket.off('sms_received', handleSmsReceived);
        socket.off('message_received', handleMessageReceived);
      };
    }
  }, [socket, isOpen, notification, fetchConversationHistory]);

  // Auto-scroll to bottom when conversation loads
  useEffect(() => {
    if (conversationHistory.length > 0) {
      const conversationDiv = document.querySelector('.conversation-scroll');
      if (conversationDiv) {
        conversationDiv.scrollTop = conversationDiv.scrollHeight;
      }
    }
  }, [conversationHistory]);

  if (!isOpen || !notification) return null;

  const handleSendReply = async () => {
    if (!replyText.trim()) {
      alert('Please enter a reply message');
      return;
    }

    try {
      setSending(true);
      if (notification?.type === 'email') {
        // Send Email reply
        const subjectBase = notification?.subject || notification?.content || '';
        const subject = subjectBase && !/^re\s*:/i.test(subjectBase) ? `Re: ${subjectBase}` : (subjectBase || 'Re:');
        const response = await axios.post(`/api/leads/${notification.leadId}/send-email`, {
          subject,
          body: replyText
        });
        if (response.data.success) {
          alert('Email sent successfully!');
          setReplyText('');
          try { await axios.put(`/api/messages-list/${notification.id}/read`); } catch {}
          await fetchConversationHistory();
          onReply && onReply({ leadId: notification.leadId, leadName: notification.leadName, content: replyText });
          if (socket) { socket.emit('message_read', { leadId: notification.leadId }); }
        } else {
          alert('Failed to send email: ' + (response.data.message || 'Unknown error'));
        }
      } else {
        // Send SMS reply (unchanged)
        const response = await axios.post(`/api/leads/${notification.leadId}/send-sms`, {
          message: replyText,
          type: 'custom'
        });
        if (response.data.success) {
          alert('SMS reply sent successfully!');
          const sentMessageText = replyText;
          setReplyText('');
          try { await axios.put(`/api/messages-list/${notification.id}/read`); } catch {}
          await fetchConversationHistory();
          onReply && onReply({
            leadId: notification.leadId,
            leadName: notification.leadName,
            leadPhone: notification.leadPhone,
            content: sentMessageText
          });
          if (socket) { socket.emit('message_read', { leadId: notification.leadId }); }
        } else {
          alert('Failed to send SMS: ' + (response.data.message || 'Unknown error'));
        }
      }
    } catch (error) {
      console.error('Error sending reply:', error);
      alert('Error sending message: ' + (error.response?.data?.message || error.message));
    } finally {
      setSending(false);
    }
  };

  // Improved timestamp formatting with error handling
  const formatTime = (timestamp) => {
    try {
      if (!timestamp) return 'Unknown time';
      
      // Handle different timestamp formats
      let date;
      if (typeof timestamp === 'string') {
        // Try parsing ISO string or other formats
        date = new Date(timestamp);
      } else if (typeof timestamp === 'number') {
        // Handle Unix timestamp (both seconds and milliseconds)
        date = new Date(timestamp > 1000000000000 ? timestamp : timestamp * 1000);
      } else {
        date = new Date(timestamp);
      }
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.warn('Invalid timestamp:', timestamp);
        return 'Invalid date';
      }
      
      const now = new Date();
      const diffMs = now - date;
      const diffHours = diffMs / (1000 * 60 * 60);
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      
      // Format based on how recent the message is
      if (diffHours < 1) {
        const minutes = Math.floor(diffMs / (1000 * 60));
        return minutes <= 0 ? 'Just now' : `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
      } else if (diffHours < 24) {
        return date.toLocaleTimeString([], { 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: true 
        });
      } else if (diffDays < 7) {
        const days = Math.floor(diffDays);
        return `${days} day${days === 1 ? '' : 's'} ago at ${date.toLocaleTimeString([], { 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: true 
        })}`;
      } else {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: true 
        });
      }
    } catch (error) {
      console.error('Error formatting timestamp:', error, 'Timestamp:', timestamp);
      return 'Unknown time';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            {notification?.type === 'email' 
              ? <FiMail className="h-5 w-5 text-green-600" /> 
              : <FiMessageSquare className="h-5 w-5 text-blue-600" />}
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {notification.isGrouped ? 'Conversation with' : 'Message from'} {notification.leadName || 'Unknown'}
                {notification.isGrouped && notification.conversationCount > 1 && (
                  <span className="ml-2 text-sm font-normal text-purple-600">
                    ({notification.conversationCount} messages)
                  </span>
                )}
              </h3>
              <div className="flex items-center space-x-2">
                <p className="text-sm text-gray-500">
                  <FiClock className="h-3 w-3 inline mr-1" />
                  {notification.isGrouped ? 'Latest message: ' : ''}
                  {formatTime(notification.timestamp)}
                </p>
                {markingAsRead && (
                  <span className="text-xs text-blue-600 flex items-center">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-1"></div>
                    Marking as read...
                  </span>
                )}
                {readError && (
                  <span className="text-xs text-red-600 flex items-center">
                    <FiAlertCircle className="h-3 w-3 mr-1" />
                    {readError}
                  </span>
                )}
                {!markingAsRead && !readError && notification.read && (
                  <span className="text-xs text-green-600 flex items-center">
                    <FiCheck className="h-3 w-3 mr-1" />
                    Read
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <FiX className="h-5 w-5" />
          </button>
        </div>

        {/* Conversation History */}
        <div className="p-4 max-h-80 overflow-y-auto conversation-scroll bg-gray-50">
          {/* Display the current message if available */}
          {notification?.content && (
            <div className="mb-4 p-3 bg-white border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500">
                  {notification.direction === 'received' ? 'Received Message' : 'Sent Message'}
                </span>
                <span className="text-xs text-gray-400">
                  {formatTime(notification.timestamp)}
                </span>
              </div>
              <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">
                {notification.content}
              </p>
            </div>
          )}
          
          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span className="ml-2 text-gray-500">Loading conversation...</span>
            </div>
          ) : conversationHistory.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <FiMessageSquare className="mx-auto h-8 w-8 mb-2" />
              <p>No previous conversation history</p>
              <p className="text-xs mt-1">This is the start of your conversation</p>
            </div>
          ) : (
            <div className="space-y-3">
              {conversationHistory.map((message, index) => (
                <div 
                  key={`${message.timestamp}-${index}`}
                  className={`flex ${(['SMS_SENT','EMAIL_SENT'].includes(message.action)) ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg shadow-sm ${
                    (message.action === 'SMS_SENT' || message.action === 'EMAIL_SENT')
                      ? 'bg-blue-500 text-white' 
                      : message.action === 'SMS_FAILED' 
                        ? 'bg-red-50 border border-red-300 text-red-800'
                        : 'bg-gray-100 border text-gray-900'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {message.details?.body || message.details?.message || message.details?.subject || 'No content'}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <p className={`text-xs ${
                        (message.action === 'SMS_SENT' || message.action === 'EMAIL_SENT') ? 'text-blue-100' : (message.action === 'SMS_FAILED' ? 'text-red-700' : 'text-gray-600')
                      }`}>
                        {formatTime(message.timestamp)}
                        {(message.action === 'SMS_SENT' || message.action === 'EMAIL_SENT') && (
                          <span className="ml-1">• Sent</span>
                        )}
                        {(message.action === 'SMS_RECEIVED' || message.action === 'EMAIL_RECEIVED') && (
                          <span className="ml-1">• Received</span>
                        )}
                        {message.action === 'SMS_FAILED' && (
                          <span className="ml-1">• Failed</span>
                        )}
                      </p>
                      {/* Delivery ticks */}
                      {(message.action === 'SMS_SENT' || message.action === 'EMAIL_SENT') && (
                        <div className="flex items-center space-x-1">
                          <FiCheck className="h-3 w-3 text-blue-100" />
                          <FiCheck className="h-3 w-3 text-blue-100" />
                        </div>
                      )}
                      {(message.action === 'SMS_RECEIVED' || message.action === 'EMAIL_RECEIVED') && (
                        <div className="flex items-center">
                          <FiCheck className="h-3 w-3 text-gray-500" />
                        </div>
                      )}
                      {message.action === 'SMS_FAILED' && (
                        <div className="flex items-center text-red-600" title={message.details?.error_message || 'SMS send failed'}>
                          <FiAlertCircle className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reply Section */}
        <div className="border-t border-gray-200 p-4 bg-white">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              {notification?.type === 'email' ? 'Reply via Email' : 'Reply via SMS'}
            </label>
            <div className="flex space-x-3">
              <div className="flex-1">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your reply message..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  rows="3"
                  maxLength={notification?.type === 'email' ? 5000 : 160}
                />
                <div className="flex justify-between items-center mt-1">
                  <p className="text-xs text-gray-500">
                    {replyText.length}/{notification?.type === 'email' ? 5000 : 160} characters
                  </p>
                  {replyText.length > 140 && (
                    <p className="text-xs text-orange-500">
                      May be sent as multiple messages
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="bg-gray-50 px-4 py-3 flex justify-between items-center">
          <button
            onClick={() => window.open(`/leads/${notification.leadId}`, '_blank')}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center space-x-1"
          >
            <FiUser className="h-4 w-4" />
            <span>View Lead Details</span>
            <FiArrowRight className="h-3 w-3" />
          </button>
          
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Close
            </button>
            <button
              onClick={handleSendReply}
              disabled={sending || !replyText.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {sending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <FiSend className="h-4 w-4" />
                  <span>{notification?.type === 'email' ? 'Send Email' : 'Send SMS'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageModal;