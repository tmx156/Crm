import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useNavigate } from 'react-router-dom';
import GmailEmailRenderer from '../components/GmailEmailRenderer';
import axios from 'axios';
import {
  FiMail,
  FiSearch,
  FiInbox,
  FiSend,
  FiRefreshCw,
  FiX,
  FiChevronLeft,
  FiCornerUpLeft,
  FiTrash2,
  FiPaperclip,
  FiCalendar,
  FiXCircle,
  FiUser
} from 'react-icons/fi';

const BOOKED_STATUSES = ['Booked', 'Confirmed', 'Unconfirmed'];

const Messages = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const fetchMessages = useCallback(async () => {
    try {
      setLoading(true);
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const response = await axios.get('/api/messages-list', {
        params: { limit: 500, since, type: 'email' }
      });
      const fetched = (response.data.messages || []).filter(m => m.type === 'email');
      setMessages(fetched);
    } catch (error) {
      console.error('Error fetching messages:', error);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  useEffect(() => {
    const interval = setInterval(fetchMessages, 60000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    if (!socket) return;

    const handleNewEmail = (data) => {
      if (data) {
        const newMsg = {
          id: data.messageId || `email_${Date.now()}`,
          messageId: data.messageId,
          leadId: data.leadId,
          leadName: data.leadName || 'Unknown',
          leadEmail: data.leadEmail || '',
          content: data.content || data.body || '',
          subject: data.subject || '(No Subject)',
          email_body: data.email_body || null,
          embedded_images: data.embedded_images || [],
          type: 'email',
          direction: 'received',
          timestamp: data.timestamp || new Date().toISOString(),
          isRead: false,
          attachments: data.attachments || []
        };
        setMessages(prev => {
          const exists = prev.some(m => m.id === newMsg.id);
          return exists ? prev : [newMsg, ...prev];
        });
      }
    };

    const handleMessageRead = (data) => {
      setMessages(prev => prev.map(m =>
        m.id === data.messageId || m.messageId === data.messageId
          ? { ...m, isRead: true } : m
      ));
      if (selectedEmail && (selectedEmail.id === data.messageId || selectedEmail.messageId === data.messageId)) {
        setSelectedEmail(prev => prev ? { ...prev, isRead: true } : prev);
      }
    };

    const handleMessageReceived = (data) => {
      if (data?.channel === 'email' || data?.type === 'email') handleNewEmail(data);
    };

    socket.on('email_received', handleNewEmail);
    socket.on('message_received', handleMessageReceived);
    socket.on('message_read', handleMessageRead);
    socket.on('message_read_direct', handleMessageRead);

    return () => {
      socket.off('email_received', handleNewEmail);
      socket.off('message_received', handleMessageReceived);
      socket.off('message_read', handleMessageRead);
      socket.off('message_read_direct', handleMessageRead);
    };
  }, [socket, selectedEmail]);

  const markAsRead = async (message) => {
    if (message.isRead) return;
    try {
      await axios.put(`/api/messages-list/${message.messageId || message.id}/read`);
      setMessages(prev => prev.map(m => m.id === message.id ? { ...m, isRead: true } : m));
    } catch (e) {
      console.error('Error marking as read:', e);
    }
  };

  const handleEmailClick = (message) => {
    setSelectedEmail(message);
    setShowReplyBox(false);
    setReplyText('');
    setReplySubject(`Re: ${message.subject || message.details?.subject || ''}`);
    markAsRead(message);
  };

  const handleCloseEmail = () => {
    setSelectedEmail(null);
    setShowReplyBox(false);
    setReplyText('');
  };

  const isLeadBooked = (message) => {
    return message && BOOKED_STATUSES.includes(message.leadStatus);
  };

  const handleCancelBooking = async (message) => {
    if (!message?.leadId) return;
    if (!window.confirm(`Cancel booking for ${message.leadName}?`)) return;
    try {
      await axios.put(`/api/leads/${message.leadId}`, { status: 'Cancelled' });
      setSelectedEmail(prev => prev ? { ...prev, leadStatus: 'Cancelled' } : prev);
      setMessages(prev => prev.map(m => m.leadId === message.leadId ? { ...m, leadStatus: 'Cancelled' } : m));
      alert(`Booking cancelled for ${message.leadName}`);
    } catch (e) {
      console.error('Error cancelling:', e);
      alert('Failed to cancel booking');
    }
  };

  const handleReschedule = (message) => {
    if (!message?.leadId) return;
    localStorage.setItem('bookingLead', JSON.stringify({
      id: message.leadId,
      name: message.leadName,
      phone: message.leadPhone,
      email: message.leadEmail,
      isReschedule: true,
      currentStatus: message.leadStatus
    }));
    navigate('/calendar');
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedEmail) return;
    setSendingReply(true);
    try {
      await axios.post('/api/messages-list/reply', {
        messageId: selectedEmail.messageId || selectedEmail.id,
        reply: replyText,
        replyType: 'email'
      });
      setReplyText('');
      setShowReplyBox(false);
      setTimeout(fetchMessages, 1000);
    } catch (e) {
      console.error('Error sending reply:', e);
      alert('Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedIds.length} email(s)?`)) return;
    try {
      await axios.post('/api/messages-list/bulk-delete', { messageIds: selectedIds });
      setMessages(prev => prev.filter(m => !selectedIds.includes(m.id)));
      setSelectedIds([]);
    } catch (e) {
      console.error('Error deleting:', e);
    }
  };

  const toggleSelect = (e, id) => {
    e.stopPropagation();
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const filteredMessages = messages.filter(m => {
    const matchesFolder = activeFolder === 'inbox' ? m.direction === 'received' : m.direction === 'sent';
    if (!matchesFolder) return false;
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (m.leadName || '').toLowerCase().includes(term) ||
           (m.subject || '').toLowerCase().includes(term) ||
           (m.content || '').toLowerCase().includes(term) ||
           (m.leadEmail || '').toLowerCase().includes(term);
  });

  const inboxCount = messages.filter(m => m.direction === 'received').length;
  const sentCount = messages.filter(m => m.direction === 'sent').length;
  const unreadCount = messages.filter(m => m.direction === 'received' && !m.isRead).length;

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isYesterday) return 'Yesterday';
    if (now.getFullYear() === date.getFullYear()) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getAvatarColor = (name) => {
    const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500'];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const getPreview = (message) => {
    const content = message.content || '';
    const clean = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return clean.length > 80 ? clean.substring(0, 80) + '...' : clean;
  };

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-100 overflow-hidden">
      {/* Gmail Sidebar */}
      <div className="w-56 bg-white border-r border-gray-200 flex-shrink-0 hidden md:flex flex-col">
        <div className="p-4">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <FiMail className="text-red-500" /> Mail
          </h2>
        </div>
        <nav className="flex-1 px-2 space-y-1">
          <button
            onClick={() => { setActiveFolder('inbox'); setSelectedEmail(null); }}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-r-full transition-colors ${
              activeFolder === 'inbox'
                ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center gap-3">
              <FiInbox className="h-4 w-4" />
              <span>Inbox</span>
            </div>
            {unreadCount > 0 && (
              <span className="text-xs font-bold text-blue-700">{unreadCount}</span>
            )}
          </button>
          <button
            onClick={() => { setActiveFolder('sent'); setSelectedEmail(null); }}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-r-full transition-colors ${
              activeFolder === 'sent'
                ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center gap-3">
              <FiSend className="h-4 w-4" />
              <span>Sent</span>
            </div>
            <span className="text-xs text-gray-500">{sentCount}</span>
          </button>
        </nav>
        <div className="p-3 border-t border-gray-200 text-xs text-gray-500">
          {inboxCount} emails in inbox
        </div>
      </div>

      {/* Mobile folder tabs — hide when viewing an email */}
      {!selectedEmail && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 flex">
          <button
            onClick={() => { setActiveFolder('inbox'); setSelectedEmail(null); }}
            className={`flex-1 py-3 text-center text-sm font-medium ${activeFolder === 'inbox' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-500'}`}
          >
            <FiInbox className="h-5 w-5 mx-auto mb-1" />
            Inbox {unreadCount > 0 && `(${unreadCount})`}
          </button>
          <button
            onClick={() => { setActiveFolder('sent'); setSelectedEmail(null); }}
            className={`flex-1 py-3 text-center text-sm font-medium ${activeFolder === 'sent' ? 'text-blue-600 border-t-2 border-blue-600' : 'text-gray-500'}`}
          >
            <FiSend className="h-5 w-5 mx-auto mb-1" />
            Sent
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3">
          {selectedEmail && (
            <button onClick={handleCloseEmail} className="p-1 hover:bg-gray-100 rounded-full mr-1">
              <FiChevronLeft className="h-5 w-5 text-gray-600" />
            </button>
          )}
          <div className="flex-1 max-w-2xl">
            <div className="relative">
              <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search mail"
                className="w-full pl-10 pr-4 py-2 bg-gray-100 border-0 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <button
            onClick={fetchMessages}
            disabled={loading}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            title="Refresh"
          >
            <FiRefreshCw className={`h-4 w-4 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {selectedIds.length > 0 && user.role === 'admin' && (
            <button onClick={handleBulkDelete} className="p-2 hover:bg-gray-100 rounded-full text-red-500" title="Delete selected">
              <FiTrash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Email List or Email View */}
        {!selectedEmail ? (
          <div className="flex-1 overflow-y-auto bg-white">
            {filteredMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <FiMail className="h-16 w-16 mb-4" />
                <p className="text-lg font-medium text-gray-500">
                  {searchTerm ? 'No emails match your search' : activeFolder === 'inbox' ? 'Your inbox is empty' : 'No sent emails'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredMessages.map((message) => (
                  <div
                    key={message.id}
                    onClick={() => handleEmailClick(message)}
                    className={`flex items-center px-4 py-2 cursor-pointer transition-colors group ${
                      !message.isRead ? 'bg-white font-semibold' : 'bg-gray-50/30'
                    } hover:shadow-sm hover:bg-gray-50`}
                  >
                    {/* Checkbox */}
                    {user.role === 'admin' && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(message.id)}
                        onChange={(e) => toggleSelect(e, message.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 mr-3 flex-shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    )}

                    {/* Unread indicator */}
                    <div className="w-1 mr-3 flex-shrink-0">
                      {!message.isRead && <div className="w-2 h-2 bg-blue-600 rounded-full"></div>}
                    </div>

                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full ${getAvatarColor(message.leadName)} flex items-center justify-center text-white text-xs font-bold mr-3 flex-shrink-0`}>
                      {getInitials(message.leadName)}
                    </div>

                    {/* Sender */}
                    <div className={`w-24 sm:w-36 md:w-44 flex-shrink-0 truncate text-xs sm:text-sm ${!message.isRead ? 'text-gray-900 font-semibold' : 'text-gray-600'}`}>
                      {message.direction === 'sent' ? `To: ${message.leadName}` : message.leadName || 'Unknown'}
                    </div>

                    {/* Subject + Preview */}
                    <div className="flex-1 min-w-0 flex items-center">
                      <span className={`text-xs sm:text-sm truncate ${!message.isRead ? 'text-gray-900' : 'text-gray-700'}`}>
                        {message.subject || message.details?.subject || '(No Subject)'}
                      </span>
                      <span className="text-sm text-gray-400 truncate ml-1 hidden md:inline">
                        — {getPreview(message)}
                      </span>
                    </div>

                    {/* Attachment icon */}
                    {message.attachments && message.attachments.length > 0 && (
                      <FiPaperclip className="h-4 w-4 text-gray-400 mx-2 flex-shrink-0" />
                    )}

                    {/* Date */}
                    <div className={`ml-4 text-xs flex-shrink-0 ${!message.isRead ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}>
                      {formatDate(message.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Email Detail View */
          <div className="flex-1 overflow-y-auto bg-white pb-24">
            <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
              {/* Subject */}
              <h1 className="text-base sm:text-xl font-normal text-gray-900 mb-3 sm:mb-4">
                {selectedEmail.subject || selectedEmail.details?.subject || '(No Subject)'}
              </h1>

              {/* Tags row: Status + Assigned User */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {selectedEmail.leadStatus && (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    selectedEmail.leadStatus === 'Cancelled' ? 'bg-red-100 text-red-700' :
                    BOOKED_STATUSES.includes(selectedEmail.leadStatus) ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {selectedEmail.leadStatus}
                  </span>
                )}
                {selectedEmail.assignedToName && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                    <FiUser className="h-3 w-3" />
                    {selectedEmail.assignedToName}
                  </span>
                )}
              </div>

              {/* Email Header */}
              <div className="flex items-start mb-4 sm:mb-6">
                <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full ${getAvatarColor(selectedEmail.leadName)} flex items-center justify-center text-white text-xs sm:text-sm font-bold mr-3 sm:mr-4 flex-shrink-0`}>
                  {getInitials(selectedEmail.leadName)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <div className="truncate">
                      <span className="text-sm font-semibold text-gray-900">
                        {selectedEmail.direction === 'sent' ? `To: ${selectedEmail.leadName}` : selectedEmail.leadName}
                      </span>
                      <span className="text-xs sm:text-sm text-gray-500 ml-1 sm:ml-2">
                        &lt;{selectedEmail.leadEmail || 'unknown'}&gt;
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 flex-shrink-0">
                      {selectedEmail.timestamp ? new Date(selectedEmail.timestamp).toLocaleString() : ''}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {selectedEmail.direction === 'sent' ? 'Sent' : 'Received'}
                    {selectedEmail.performedByName && ` by ${selectedEmail.performedByName}`}
                  </p>
                </div>
              </div>

              {/* Email Body */}
              <div className="border-t border-gray-100 pt-4 mb-4 sm:mb-6">
                {selectedEmail.email_body ? (
                  <GmailEmailRenderer
                    htmlContent={selectedEmail.email_body}
                    textContent={selectedEmail.content}
                    attachments={selectedEmail.attachments || []}
                    embeddedImages={selectedEmail.embedded_images || []}
                  />
                ) : (
                  <div className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
                    {selectedEmail.content || 'No content'}
                  </div>
                )}
              </div>

              {/* Reply Box (inline, scrolls with content) */}
              {showReplyBox && (
                <div className="border border-gray-300 rounded-lg overflow-hidden mb-6">
                  <div className="bg-gray-50 px-3 sm:px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <FiCornerUpLeft className="h-4 w-4" />
                      <span className="truncate">Reply to {selectedEmail.leadName}</span>
                    </div>
                    <button onClick={() => setShowReplyBox(false)} className="p-1 hover:bg-gray-200 rounded flex-shrink-0">
                      <FiX className="h-4 w-4 text-gray-500" />
                    </button>
                  </div>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write your reply..."
                    className="w-full p-3 sm:p-4 border-0 focus:ring-0 focus:outline-none resize-none text-sm"
                    rows="4"
                    autoFocus
                  />
                  <div className="bg-gray-50 px-3 sm:px-4 py-3 flex items-center justify-between border-t border-gray-200">
                    <button
                      onClick={handleSendReply}
                      disabled={!replyText.trim() || sendingReply}
                      className="inline-flex items-center px-4 sm:px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {sendingReply ? 'Sending...' : 'Send'}
                    </button>
                    <button onClick={() => setShowReplyBox(false)} className="text-sm text-gray-500 hover:text-gray-700">
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Floating Action Bar — always visible when viewing email */}
            <div className="fixed bottom-0 left-0 md:left-56 right-0 bg-white border-t border-gray-200 px-3 sm:px-6 py-3 flex items-center gap-2 z-50 shadow-lg">
              {selectedEmail.direction === 'received' && !showReplyBox && (
                <button
                  onClick={() => setShowReplyBox(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-full text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  <FiCornerUpLeft className="h-4 w-4" />
                  Reply
                </button>
              )}

              {isLeadBooked(selectedEmail) && (
                <>
                  <button
                    onClick={() => handleReschedule(selectedEmail)}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-blue-300 bg-white rounded-full text-sm text-blue-700 hover:bg-blue-50 transition-colors"
                  >
                    <FiCalendar className="h-4 w-4" />
                    Reschedule
                  </button>
                  <button
                    onClick={() => handleCancelBooking(selectedEmail)}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-red-300 bg-white rounded-full text-sm text-red-700 hover:bg-red-50 transition-colors"
                  >
                    <FiXCircle className="h-4 w-4" />
                    Cancel
                  </button>
                </>
              )}

              {selectedEmail.assignedToName && (
                <span className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                  <FiUser className="h-3 w-3" />
                  {selectedEmail.assignedToName}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Messages;
