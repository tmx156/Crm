import React, { useState, useEffect, useCallback } from 'react';
import { FiWifi, FiActivity, FiClock, FiUsers, FiCalendar, FiDollarSign, FiZap, FiTarget, FiAlertCircle, FiMessageSquare, FiMail, FiSend, FiX, FiEye, FiArrowLeft, FiArrowRight } from 'react-icons/fi';
import axios from 'axios';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { toZonedTime, format } from 'date-fns-tz';

const getTodayUK = () => {
  const ukTz = 'Europe/London';
  const now = new Date();
  const ukNow = toZonedTime(now, ukTz);
  return format(ukNow, 'yyyy-MM-dd', { timeZone: ukTz });
};

const Dashboard = () => {
  const { user } = useAuth();
  const { isConnected } = useSocket();

  // State management
  const [liveStats, setLiveStats] = useState({ todayBookings: 0, todaySales: 0, todayRevenue: 0, thisHourBookings: 0 });
  const [bookerActivity, setBookerActivity] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [nextBookingDay, setNextBookingDay] = useState(null);
  const [calendarStats, setCalendarStats] = useState({ total: 0, confirmed: 0, unconfirmed: 0, cancelled: 0 });
  const [weekOverview, setWeekOverview] = useState({ total: 0, confirmed: 0, unconfirmed: 0, rate: 0 });
  const [recentActivity, setRecentActivity] = useState([]);
  const [unreadMessages, setUnreadMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [replyMode, setReplyMode] = useState('sms');
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [selectedBooker, setSelectedBooker] = useState(null);
  const [isBookerModalOpen, setIsBookerModalOpen] = useState(false);
  const [selectedActivityDate, setSelectedActivityDate] = useState(new Date().toISOString().split('T')[0]);

  // Fetch all dashboard data
  const fetchStats = useCallback(async () => {
    try {
      // Only fetch sales data for admin/viewer - bookings count comes from fetchBookerActivity
      if (user?.role === 'admin' || user?.role === 'viewer') {
        try {
          const salesRes = await axios.get('/api/sales/stats', {
            params: { dateRange: 'today' }
          });
          setLiveStats(prev => ({
            ...prev,
            todaySales: salesRes.data.totalSales || 0,
            todayRevenue: salesRes.data.totalRevenue || 0
          }));
        } catch (e) {
          console.error('Error fetching sales:', e);
        }
      }

      setLoading(false);
    } catch (e) {
      console.error('Error fetching stats:', e);
      setLoading(false);
    }
  }, [user]);

  // Fetch booker activity
  const fetchBookerActivity = useCallback(async () => {
    try {
      // Use selectedActivityDate instead of today
      const ukTz = 'Europe/London';
      const todayUK = selectedActivityDate;

      // Create start and end of day in UK local time (not UTC)
      // Then let the timezone library convert to UTC properly
      const startOfDayUK = new Date(todayUK + 'T00:00:00');
      const endOfDayUK = new Date(todayUK + 'T23:59:59.999');

      // Get timezone offset for UK (handles BST/GMT automatically)
      const offsetMinutes = -startOfDayUK.getTimezoneOffset();

      // Adjust to UTC by subtracting the offset
      const startUTC = new Date(startOfDayUK.getTime() + (offsetMinutes * 60000)).toISOString();
      const endUTC = new Date(endOfDayUK.getTime() + (offsetMinutes * 60000)).toISOString();

      console.log('📅 Dashboard querying bookings for UK date:', todayUK);
      console.log('📅 UTC range:', startUTC, 'to', endUTC);

      // Get all users
      const usersRes = await axios.get('/api/users');
      const users = usersRes.data || [];

      // ✅ DAILY ACTIVITY FIX: Get today's leads - filter by booked_at to show leads BOOKED today (UK TIME)
      const leadsRes = await axios.get('/api/leads/public', {
        params: {
          booked_at_start: startUTC,
          booked_at_end: endUTC
        }
      });
      const leads = leadsRes.data?.leads || [];
      console.log(`📊 Dashboard: Found ${leads.length} leads booked today using booked_at filter`);

      // Fetch sales data for admin/viewer - only sales made on selectedActivityDate
      let salesData = [];
      if (user?.role === 'admin' || user?.role === 'viewer') {
        try {
          const salesRes = await axios.get('/api/sales', {
            params: {
              dateRange: 'today' // This will be ignored, we filter client-side
            }
          });
          // Filter sales client-side to only include those created on selectedActivityDate in UK time
          salesData = (salesRes.data || []).filter(sale => {
            if (!sale.created_at) return false;
            const ukTz = 'Europe/London';
            const saleDateUK = format(toZonedTime(new Date(sale.created_at), ukTz), 'yyyy-MM-dd', { timeZone: ukTz });
            return saleDateUK === todayUK;
          });
        } catch (err) {
          console.error('Error fetching sales:', err);
        }
      }

      // Group by booker with sales
      const bookerStats = {};

      // Process bookings - show ONLY "Booked" status bookings created today
      leads.forEach(lead => {
        const bookerId = lead.booker_id;
        const status = (lead.status || '').toLowerCase();

        if (bookerId && status === 'booked') {
          if (!bookerStats[bookerId]) {
            const user = users.find(u => u.id === bookerId);
            bookerStats[bookerId] = {
              id: bookerId,
              name: user?.name || 'Unknown',
              bookings: 0,
              sales: 0,
              bookingDetails: [],
              salesDetails: [],
              lastActivity: new Date(lead.updated_at || lead.created_at)
            };
          }
          bookerStats[bookerId].bookings += 1;

          // Add booking details
          bookerStats[bookerId].bookingDetails.push({
            id: lead.id,
            name: lead.name,
            phone: lead.phone || lead.phone_number,
            time: lead.date_booked ? new Date(lead.date_booked).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '12:00',
            status: lead.status,
            dateBooked: lead.date_booked,
            bookedAt: lead.updated_at || lead.created_at,
            bookedAgo: timeAgo(new Date(lead.updated_at || lead.created_at))
          });

          const activityDate = new Date(lead.updated_at || lead.created_at);
          if (activityDate > bookerStats[bookerId].lastActivity) {
            bookerStats[bookerId].lastActivity = activityDate;
          }
        }
      });

      // Process sales
      salesData.forEach(sale => {
        const userId = sale.user_id;
        if (userId) {
          if (!bookerStats[userId]) {
            const user = users.find(u => u.id === userId);
            bookerStats[userId] = {
              id: userId,
              name: user?.name || 'Unknown',
              bookings: 0,
              sales: 0,
              bookingDetails: [],
              salesDetails: [],
              lastActivity: new Date(sale.created_at)
            };
          }
          bookerStats[userId].sales += 1;

          // Add sale details
          const saleUser = users.find(u => u.id === userId);
          bookerStats[userId].salesDetails.push({
            id: sale.id,
            leadName: sale.lead_name || 'Unknown',
            amount: sale.amount || sale.total_amount || 0,
            createdAt: sale.created_at,
            by: saleUser?.name || 'Unknown User',
            saleNumber: sale.booker_name || sale.id, // Show booker name instead of sale ID
            completedAgo: timeAgo(new Date(sale.created_at))
          });

          const saleDate = new Date(sale.created_at);
          if (saleDate > bookerStats[userId].lastActivity) {
            bookerStats[userId].lastActivity = saleDate;
          }
        }
      });

      // Convert to array and sort by total activity (bookings + sales)
      const activity = Object.values(bookerStats)
        .sort((a, b) => (b.bookings + b.sales) - (a.bookings + a.sales))
        .map((item, idx) => ({ ...item, rank: idx + 1 }));

      // Calculate total bookings and sales from bookerStats
      const totalBookingsToday = activity.reduce((sum, user) => sum + (user.bookings || 0), 0);
      const totalSalesToday = activity.reduce((sum, user) => sum + (user.sales || 0), 0);

      setBookerActivity(activity);

      // Update live stats with correct counts
      setLiveStats(prev => ({
        ...prev,
        todayBookings: totalBookingsToday,
        todaySales: totalSalesToday
      }));
    } catch (e) {
      console.error('Error fetching booker activity:', e);
    }
  }, [user, selectedActivityDate]);

  // Fetch calendar events
  const fetchCalendarEvents = useCallback(async () => {
    try {
      const calRes = await axios.get('/api/leads/calendar-public', {
        params: { limit: 500 }
      });

      const rawEvents = calRes.data?.events || [];

      // Flatten the nested structure from the leads API
      const events = rawEvents.map(event => {
        const date = new Date(event.start);
        return {
          id: event.extendedProps.id,
          name: event.extendedProps.name,
          phone: event.extendedProps.phone,
          email: event.extendedProps.email,
          lead_status: event.extendedProps.status,
          status: event.extendedProps.status,
          booking_date: event.extendedProps.date_booked,
          booking_time: event.extendedProps.time,
          booker_id: event.extendedProps.booker_id,
          is_confirmed: event.extendedProps.is_confirmed
        };
      });

      if (events.length > 0) {
        // Find next day with bookings (tomorrow onwards, not today)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const futureEvents = events.filter(e => {
          if (!e.booking_date) return false;
          const eventDate = new Date(e.booking_date);
          eventDate.setHours(0, 0, 0, 0);
          return eventDate >= tomorrow;
        });

        if (futureEvents.length > 0) {
          // Group by date
          const dateGroups = {};
          futureEvents.forEach(event => {
            const date = new Date(event.booking_date).toISOString().split('T')[0];
            if (!dateGroups[date]) {
              dateGroups[date] = [];
            }
            dateGroups[date].push(event);
          });

          // Get the first date
          const firstDate = Object.keys(dateGroups).sort()[0];
          setNextBookingDay(firstDate);

          // Calculate stats for that day
          const dayEvents = dateGroups[firstDate];
          const total = dayEvents.length;
          const confirmed = dayEvents.filter(e => e.is_confirmed === true).length;
          const cancelled = dayEvents.filter(e => (e.lead_status || '').toLowerCase() === 'cancelled').length;
          const unconfirmed = total - confirmed - cancelled;

          setCalendarStats({ total, confirmed, unconfirmed, cancelled });
          setCalendarEvents(dayEvents); // Show all events for the day

          // Calculate week overview (next 7 days)
          const weekEnd = new Date(today);
          weekEnd.setDate(weekEnd.getDate() + 7);

          const weekEvents = events.filter(e => {
            if (!e.booking_date) return false;
            const eventDate = new Date(e.booking_date);
            return eventDate >= today && eventDate <= weekEnd;
          });

          const weekTotal = weekEvents.length;
          const weekConfirmed = weekEvents.filter(e => e.is_confirmed === true).length;
          const weekUnconfirmed = weekTotal - weekConfirmed;
          const weekRate = weekTotal > 0 ? Math.round((weekConfirmed / weekTotal) * 100) : 0;

          setWeekOverview({
            total: weekTotal,
            confirmed: weekConfirmed,
            unconfirmed: weekUnconfirmed,
            rate: weekRate
          });
        } else {
          // No future events found
          setNextBookingDay(null);
          setCalendarStats({ total: 0, confirmed: 0, unconfirmed: 0, cancelled: 0 });
          setCalendarEvents([]);
        }
      } else {
        // No events at all
        setNextBookingDay(null);
        setCalendarStats({ total: 0, confirmed: 0, unconfirmed: 0, cancelled: 0 });
        setCalendarEvents([]);
      }
    } catch (e) {
      console.error('Error fetching calendar:', e);
      setNextBookingDay(null);
      setCalendarStats({ total: 0, confirmed: 0, unconfirmed: 0, cancelled: 0 });
      setCalendarEvents([]);
    }
  }, []);

  // Fetch recent activity
  const fetchRecentActivity = useCallback(async () => {
    try {
      // Use UK timezone for "today"
      const ukTz = 'Europe/London';
      const now = new Date();
      const ukNow = toZonedTime(now, ukTz);
      const todayUK = format(ukNow, 'yyyy-MM-dd', { timeZone: ukTz });

      // Create UK time range and convert to UTC
      const startOfDayUK = new Date(todayUK + 'T00:00:00');
      const endOfDayUK = new Date(todayUK + 'T23:59:59.999');
      const offsetMinutes = -startOfDayUK.getTimezoneOffset();
      const startUTC = new Date(startOfDayUK.getTime() + (offsetMinutes * 60000)).toISOString();
      const endUTC = new Date(endOfDayUK.getTime() + (offsetMinutes * 60000)).toISOString();

      const leadsRes = await axios.get('/api/leads/public', {
        params: {
          updated_at_start: startUTC,
          updated_at_end: endUTC
        }
      });
      const leads = leadsRes.data?.leads || [];

      // Get sales data for today
      let salesData = [];
      if (user?.role === 'admin' || user?.role === 'viewer') {
        try {
          const salesRes = await axios.get('/api/sales', {
            params: { dateRange: 'today' }
          });
          const todayUK = getTodayUK();
          salesData = (salesRes.data || []).filter(sale => {
            if (!sale.created_at) return false;
            const ukTz = 'Europe/London';
            const saleDateUK = format(toZonedTime(new Date(sale.created_at), ukTz), 'yyyy-MM-dd', { timeZone: ukTz });
            return saleDateUK === todayUK;
          });
        } catch (err) {
          console.error('Error fetching sales for activity:', err);
        }
      }

      // Create activity items from bookings - show ONLY "Booked" status
      const bookingActivities = leads
        .filter(lead => lead.booker_id && lead.status?.toLowerCase() === 'booked')
        .map(lead => ({
          id: lead.id,
          type: 'booking',
          message: `${lead.name} booked for ${lead.date_booked ? new Date(lead.date_booked).toLocaleDateString() : 'appointment'}`,
          timestamp: new Date(lead.updated_at || lead.created_at),
          icon: 'calendar'
        }));

      // Create activity items from sales
      const saleActivities = salesData.map(sale => ({
        id: sale.id,
        type: 'sale',
        message: `Sale completed for £${sale.amount?.toFixed(2) || '0.00'}`,
        timestamp: new Date(sale.created_at),
        icon: 'dollar'
      }));

      // Combine and sort all activities by timestamp
      const allActivities = [...bookingActivities, ...saleActivities]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5); // Show only last 5 activities

      setRecentActivity(allActivities);
    } catch (e) {
      console.error('Error fetching recent activity:', e);
    }
  }, [user]);

  // Fetch unread messages
  const fetchUnreadMessages = useCallback(async () => {
    try {
      const messagesRes = await axios.get('/api/messages-list', {
        params: { unread: true, limit: 10 }
      });
      let messages = messagesRes.data?.messages || messagesRes.data || [];
      console.log(`📨 Fetched unread messages:`, messagesRes.data);

      // Ensure messages is always an array
      if (!Array.isArray(messages)) {
        console.warn('📨 Messages response is not an array:', messages);
        messages = [];
      }

      console.log(`📨 Fetched ${messages.length} unread messages`);
      if (messages.length > 0) {
        console.log('📧 Sample message:', {
          leadName: messages[0].leadName,
          type: messages[0].type,
          content: messages[0].content,
          timestamp: messages[0].timestamp
        });
      }
      setUnreadMessages(messages.slice(0, 10));
    } catch (e) {
      console.error('Error fetching unread messages:', e);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStats();
    fetchBookerActivity();
    fetchCalendarEvents();
    fetchRecentActivity();
    fetchUnreadMessages();

    // Update clock every second
    const clockTimer = setInterval(() => setCurrentTime(new Date()), 1000);

    // Auto-refresh every 30 seconds
    const refreshTimer = setInterval(() => {
      fetchStats();
      fetchBookerActivity();
      fetchCalendarEvents();
      fetchRecentActivity();
      fetchUnreadMessages();
      setLastUpdated(new Date());
    }, 30000);

    return () => {
      clearInterval(clockTimer);
      clearInterval(refreshTimer);
    };
  }, [fetchStats, fetchBookerActivity, fetchCalendarEvents, fetchRecentActivity, fetchUnreadMessages]);

  // Confirm booking
  const handleConfirmBooking = async (eventId) => {
    try {
      await axios.put(`/api/leads/${eventId}`, { is_confirmed: true });
      fetchCalendarEvents();
    } catch (e) {
      console.error('Error confirming booking:', e);
    }
  };

  // Open message modal
  const handleMessageClick = (message) => {
    setSelectedMessage(message);
    setReplyMode(message.type === 'email' ? 'email' : 'sms');
    setReplyText('');
  };

  // Send reply
  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedMessage) return;

    setSendingReply(true);
    try {
      await axios.post('/api/messages-list/reply', {
        messageId: selectedMessage.id,
        type: replyMode,
        content: replyText,
        to: selectedMessage.from
      });

      // Mark as read
      await axios.put(`/api/messages-list/${selectedMessage.id}/read`);

      // Close modal and refresh
      setSelectedMessage(null);
      setReplyText('');
      fetchUnreadMessages();
    } catch (e) {
      console.error('Error sending reply:', e);
      alert('Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  // Format time ago
  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Navigate activity date (previous/next day)
  const navigateActivityDate = (direction) => {
    const current = new Date(selectedActivityDate);
    current.setDate(current.getDate() + direction);
    setSelectedActivityDate(current.toISOString().split('T')[0]);
  };

  // Check if selected date is today
  const isActivityToday = selectedActivityDate === new Date().toISOString().split('T')[0];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-3 sm:py-4 lg:py-6">

        {/* SECTION 1: Header */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-3 sm:p-4 lg:p-6 mb-4 sm:mb-6 lg:mb-8 border-l-4 border-red-500">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 sm:h-3 sm:w-3 bg-red-500 rounded-full animate-pulse"></div>
              <h1 className="text-base sm:text-xl lg:text-2xl font-bold text-gray-900">LIVE OPERATIONS</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 lg:gap-6 text-xs sm:text-sm w-full sm:w-auto">
              <div className="flex items-center space-x-2">
                <FiClock className="h-4 w-4 text-gray-500" />
                <span className="font-mono text-gray-700">{currentTime.toLocaleTimeString()}</span>
              </div>
              <div className="flex items-center space-x-2">
                <FiWifi className={`h-4 w-4 ${isConnected ? 'text-green-500' : 'text-red-500'}`} />
                <span className={`font-medium ${isConnected ? 'text-green-700' : 'text-red-700'}`}>
                  {isConnected ? 'LIVE' : 'OFFLINE'}
                </span>
              </div>
              <div className="text-gray-500">Updated {lastUpdated.toLocaleTimeString()}</div>
            </div>
          </div>
        </div>

        {/* SECTION 2: Today's Live Progress */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-3 sm:p-4 lg:p-6 mb-4 sm:mb-6 lg:mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-2">
            <div className="flex items-center space-x-2 sm:space-x-3">
              <FiActivity className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-red-500" />
              <h2 className="text-sm sm:text-base lg:text-xl font-bold text-gray-900">TODAY'S PROGRESS</h2>
              <div className="flex items-center space-x-1 sm:space-x-2">
                <div className={`h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                <span className={`text-xs font-medium ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
                  {isConnected ? 'LIVE' : 'OFFLINE'}
                </span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
            {/* Total Bookings Today */}
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg sm:rounded-xl p-3 sm:p-4 lg:p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-xs sm:text-sm font-medium">Bookings</p>
                  <p className="text-xl sm:text-2xl lg:text-3xl font-bold">{liveStats.todayBookings}</p>
                  <p className="text-blue-100 text-xs mt-0.5 sm:mt-1">Today</p>
                </div>
                <FiCalendar className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-blue-200" />
              </div>
            </div>

            {/* This Hour */}
            <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-lg sm:rounded-xl p-3 sm:p-4 lg:p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-xs sm:text-sm font-medium">This Hour</p>
                  <p className="text-xl sm:text-2xl lg:text-3xl font-bold">{liveStats.thisHourBookings}</p>
                  <p className="text-green-100 text-xs mt-0.5 sm:mt-1">Bookings</p>
                </div>
                <FiZap className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-green-200" />
              </div>
            </div>

            {/* Active Users */}
            <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg sm:rounded-xl p-3 sm:p-4 lg:p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-100 text-xs sm:text-sm font-medium">Active</p>
                  <p className="text-xl sm:text-2xl lg:text-3xl font-bold">1</p>
                  <p className="text-purple-100 text-xs mt-0.5 sm:mt-1">Users</p>
                </div>
                <FiUsers className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-purple-200" />
              </div>
            </div>

            {/* Sales Today (admin/viewer only) */}
            {(user?.role === 'admin' || user?.role === 'viewer') && (
              <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-lg sm:rounded-xl p-3 sm:p-4 lg:p-6 text-white col-span-2 lg:col-span-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-emerald-100 text-xs sm:text-sm font-medium">Sales Today</p>
                    <p className="text-xl sm:text-2xl lg:text-3xl font-bold">£{liveStats.todayRevenue.toFixed(0)}</p>
                    <p className="text-emerald-100 text-xs mt-0.5 sm:mt-1">{liveStats.todaySales} sales</p>
                  </div>
                  <FiDollarSign className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-emerald-200" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* SECTIONS 3 & 4: Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 mb-4 sm:mb-6 lg:mb-8">

          {/* SECTION 3: Daily Admin Activity Dashboard */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-3 sm:p-4 lg:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 sm:mb-4 lg:mb-6 gap-2">
              <div className="flex items-center space-x-2 sm:space-x-3">
                <FiTarget className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-blue-500" />
                <h2 className="text-sm sm:text-base lg:text-xl font-bold text-gray-900">DAILY ACTIVITY</h2>
              </div>
              <div className="text-xs sm:text-sm text-gray-500">
                {bookerActivity.reduce((sum, user) => sum + (user.bookings || 0), 0)} bookings • {bookerActivity.reduce((sum, user) => sum + (user.sales || 0), 0)} sales
              </div>
            </div>

            {/* Date Navigation */}
            <div className="flex items-center justify-between mb-3 sm:mb-4 bg-gray-50 rounded-lg p-3">
              <button
                onClick={() => navigateActivityDate(-1)}
                className="flex items-center space-x-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                title="Previous Day"
              >
                <FiArrowLeft className="h-4 w-4" />
                <span className="text-sm font-medium">Previous</span>
              </button>

              <div className="flex flex-col items-center">
                <input
                  type="date"
                  value={selectedActivityDate}
                  onChange={(e) => setSelectedActivityDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {!isActivityToday && (
                  <button
                    onClick={() => setSelectedActivityDate(new Date().toISOString().split('T')[0])}
                    className="text-xs text-blue-600 hover:text-blue-700 mt-1"
                  >
                    Back to Today
                  </button>
                )}
              </div>

              <button
                onClick={() => navigateActivityDate(1)}
                disabled={isActivityToday}
                className="flex items-center space-x-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next Day"
              >
                <span className="text-sm font-medium">Next</span>
                <FiArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-gray-500 font-medium mb-3 sm:mb-4">
              {isActivityToday ? 'Viewing Today - Resets at midnight' : `Viewing ${new Date(selectedActivityDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
            </div>
            <div className="space-y-3">
              {bookerActivity.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FiActivity className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>No booking activity today</p>
                </div>
              ) : (
                bookerActivity.map((booker) => (
                  <div key={booker.id} className="mb-6">
                    {/* Booker Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-4">
                        <div className="flex-shrink-0 w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-lg">
                          {booker.rank}
                        </div>
                        <div>
                          <p className="text-lg font-bold text-gray-900">{booker.name}</p>
                          <p className="text-xs text-gray-500">Last: {timeAgo(booker.lastActivity)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-blue-600">{(booker.bookings || 0) + (booker.sales || 0)}</p>
                        <p className="text-sm text-gray-500">total activity today</p>
                      </div>
                    </div>

                    {/* Booking Details - Show only first 2 */}
                    {booker.bookingDetails && booker.bookingDetails.length > 0 && (
                      <div className="space-y-3 mb-3">
                        {booker.bookingDetails.slice(0, 2).map((booking) => (
                          <div key={booking.id} className="bg-white border border-gray-200 rounded-lg p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start space-x-3">
                                <div className="flex-shrink-0">
                                  <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                                </div>
                                <div className="flex-1">
                                  <p className="font-semibold text-gray-900">{booking.name}</p>
                                  <div className="flex items-center space-x-4 mt-1 text-sm text-gray-600">
                                    <span className="flex items-center">
                                      <FiClock className="mr-1" /> {booking.time}
                                    </span>
                                    <span>{booking.phone}</span>
                                  </div>
                                  <p className="text-sm text-teal-600 mt-2 flex items-center">
                                    <FiCalendar className="mr-1" /> Booked {booking.bookedAgo}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="inline-block px-3 py-1 text-sm font-semibold text-blue-700 bg-blue-100 rounded-full">
                                  {booking.status}
                                </span>
                                <p className="text-xs text-gray-500 mt-1">
                                  {new Date(booking.dateBooked).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Sales Details - Show only first 2 */}
                    {booker.salesDetails && booker.salesDetails.length > 0 && (
                      <div className="space-y-3 mb-3">
                        {booker.salesDetails.slice(0, 2).map((sale) => (
                          <div key={sale.id} className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start space-x-3">
                                <div className="flex-shrink-0">
                                  <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                                </div>
                                <div className="flex-1">
                                  <p className="font-semibold text-gray-900">{sale.leadName}</p>
                                  <p className="text-lg font-bold text-green-700 mt-1">£{typeof sale.amount === 'number' ? sale.amount.toFixed(2) : sale.amount}</p>
                                  <p className="text-sm text-gray-600 mt-1">by {sale.by}</p>
                                  <p className="text-sm text-teal-600 mt-2 flex items-center">
                                    <FiDollarSign className="mr-1" /> Sale completed {sale.completedAgo}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="inline-block px-3 py-1 text-sm font-semibold text-green-700 bg-green-100 rounded-full">
                                  Completed
                                </span>
                                <p className="text-xs text-gray-500 mt-1">
                                  Booker: {sale.saleNumber}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* View More Button */}
                    {((booker.bookingDetails?.length || 0) + (booker.salesDetails?.length || 0)) > 2 && (
                      <div className="text-center pt-2">
                        <button
                          onClick={() => {
                            setSelectedBooker(booker);
                            setIsBookerModalOpen(true);
                          }}
                          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          <FiEye className="mr-2" />
                          View More ({(booker.bookingDetails?.length || 0) + (booker.salesDetails?.length || 0)} total events)
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* SECTION 4: Calendar Status */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-3 sm:p-4 lg:p-6">
            <div className="flex items-center space-x-2 sm:space-x-3 mb-3 sm:mb-4 lg:mb-6">
              <FiCalendar className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-green-500" />
              <h2 className="text-sm sm:text-base lg:text-xl font-bold text-gray-900">CALENDAR</h2>
            </div>

            {nextBookingDay ? (
              <>
                <div className="mb-4 flex items-center space-x-2">
                  <FiCalendar className="text-blue-600" />
                  <div>
                    <p className="text-sm text-gray-600">Next Day with Bookings: <span className="font-bold text-gray-900">{new Date(nextBookingDay).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></p>
                  </div>
                </div>

                {/* Stats boxes */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-4xl font-bold text-blue-600 mb-1">{calendarStats.total}</div>
                    <div className="flex items-center text-sm text-blue-600">
                      <FiCalendar className="mr-1" />
                      <span className="font-medium">Total</span>
                    </div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="text-4xl font-bold text-green-600 mb-1">{calendarStats.confirmed}</div>
                    <div className="flex items-center text-sm text-green-600">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="font-medium">Confirmed</span>
                    </div>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-4">
                    <div className="text-4xl font-bold text-orange-600 mb-1">{calendarStats.unconfirmed}</div>
                    <div className="flex items-center text-sm text-orange-600">
                      <FiAlertCircle className="mr-1" />
                      <span className="font-medium">Unconfirmed</span>
                    </div>
                  </div>
                </div>

                {/* Warning if unconfirmed */}
                {calendarStats.unconfirmed > 0 && (
                  <div className="bg-orange-50 border-l-4 border-orange-500 p-3 mb-4">
                    <div className="flex items-center">
                      <FiAlertCircle className="h-5 w-5 text-orange-500 mr-2" />
                      <p className="text-sm text-orange-700">
                        {calendarStats.unconfirmed} booking{calendarStats.unconfirmed > 1 ? 's' : ''} need confirmation
                      </p>
                    </div>
                  </div>
                )}

                {/* Live Events */}
                <div className="mb-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <FiCalendar className="text-gray-600" />
                    <p className="text-sm font-semibold text-gray-700">Live Events</p>
                  </div>
                  <div className="max-h-80 overflow-y-auto space-y-2 pr-2">
                    {calendarEvents.map((event) => {
                      const leadStatus = (event.lead_status || '').toLowerCase();
                      const isConfirmed = event.is_confirmed === true;
                      const isCancelled = leadStatus === 'cancelled';

                      return (
                        <div key={event.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center space-x-3 flex-1">
                            <span className="text-sm font-semibold text-gray-900 min-w-[60px]">
                              {event.booking_time || '09:00'}
                            </span>
                            <span className="text-sm font-medium text-gray-900">{event.name || 'Unknown'}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            {isCancelled ? (
                              <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-semibold bg-red-100 text-red-700">
                                Cancelled
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-semibold bg-orange-100 text-orange-700">
                                Booked
                              </span>
                            )}
                            {isConfirmed && !isCancelled && (
                              <div className="w-8 h-8 flex items-center justify-center bg-green-500 text-white rounded-full flex-shrink-0">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Week Overview */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm font-semibold text-gray-700 mb-3">Week Overview:</p>
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <p className="text-lg font-bold text-gray-900">{weekOverview.total}</p>
                      <p className="text-xs text-gray-600">Total</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-green-600">{weekOverview.confirmed}</p>
                      <p className="text-xs text-gray-600">Confirmed</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-orange-600">{weekOverview.unconfirmed}</p>
                      <p className="text-xs text-gray-600">Unconfirmed</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-blue-600">{weekOverview.rate}%</p>
                      <p className="text-xs text-gray-600">Rate</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FiCalendar className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No upcoming bookings</p>
              </div>
            )}
          </div>
        </div>

        {/* SECTIONS 5 & 6: Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">

          {/* SECTION 5: Live Activity Feed */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-3 sm:p-4 lg:p-6">
            <div className="flex items-center space-x-2 sm:space-x-3 mb-3 sm:mb-4 lg:mb-6">
              <FiActivity className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-purple-500" />
              <h2 className="text-sm sm:text-base lg:text-xl font-bold text-gray-900">ACTIVITY</h2>
            </div>
            <div className="space-y-3">
              {recentActivity.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FiActivity className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>No recent activity</p>
                </div>
              ) : (
                recentActivity.map((activity) => (
                  <div key={activity.id} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center">
                      {activity.icon === 'calendar' && <FiCalendar className="h-5 w-5" />}
                      {activity.icon === 'dollar' && <FiDollarSign className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">{activity.message}</p>
                      <p className="text-xs text-gray-500 mt-1">{timeAgo(activity.timestamp)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* SECTION 6: Live Messages */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-3 sm:p-4 lg:p-6">
            <div className="flex items-center justify-between mb-3 sm:mb-4 lg:mb-6">
              <div className="flex items-center space-x-2 sm:space-x-3">
                <FiMessageSquare className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-indigo-500" />
                <h2 className="text-sm sm:text-base lg:text-xl font-bold text-gray-900">MESSAGES</h2>
              </div>
              {(unreadMessages || []).length > 0 && (
                <div className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                  {(unreadMessages || []).length}
                </div>
              )}
            </div>
            <div className="space-y-3">
              {(unreadMessages || []).length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FiMessageSquare className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>No unread messages</p>
                </div>
              ) : (
                (unreadMessages || []).map((message) => (
                  <div key={message.id} className="bg-white border-l-4 border-orange-400 rounded-lg p-5 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <div className="bg-green-100 rounded-full p-2">
                          {message.type === 'email' ? (
                            <FiMail className="h-5 w-5 text-green-600" />
                          ) : (
                            <FiMessageSquare className="h-5 w-5 text-green-600" />
                          )}
                        </div>
                        <div>
                          <p className="font-bold text-gray-900">
                            {message.leadName || message.from || message.sender_name || 'Unknown'}
                          </p>
                          <span className="inline-block px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded">
                            {message.type === 'email' ? 'EMAIL' : 'SMS'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {message.subject && (
                      <p className="font-semibold text-gray-900 mb-2">{message.subject}</p>
                    )}

                    <p className="text-gray-700 text-sm mb-3 line-clamp-2">
                      {message.content || message.details?.body || message.body || message.preview || 'No content'}
                    </p>

                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">
                        {(message.timestamp || message.created_at) ? new Date(message.timestamp || message.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </p>
                      <button
                        onClick={() => handleMessageClick(message)}
                        className="text-blue-600 hover:text-blue-700 font-medium text-sm flex items-center space-x-1"
                      >
                        <span>Click to reply</span>
                        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Message Reply Modal */}
      {selectedMessage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">Reply to Message</h3>
                <button
                  onClick={() => setSelectedMessage(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <FiX className="h-6 w-6" />
                </button>
              </div>

              <div className="mb-6">
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <p className="text-sm font-semibold text-gray-900 mb-1">From: {selectedMessage.from}</p>
                  {selectedMessage.subject && (
                    <p className="text-sm text-gray-700 mb-2">Subject: {selectedMessage.subject}</p>
                  )}
                  <p className="text-sm text-gray-600">{selectedMessage.content || selectedMessage.preview}</p>
                </div>

                <div className="flex items-center space-x-4 mb-4">
                  <button
                    onClick={() => setReplyMode('sms')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      replyMode === 'sms'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    SMS
                  </button>
                  <button
                    onClick={() => setReplyMode('email')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      replyMode === 'email'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    Email
                  </button>
                </div>

                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Type your ${replyMode} message here...`}
                  className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows="6"
                />
              </div>

              <div className="flex items-center justify-end space-x-3">
                <button
                  onClick={() => setSelectedMessage(null)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || sendingReply}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FiSend className="h-4 w-4" />
                  <span>{sendingReply ? 'Sending...' : 'Send'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Booker Activity Modal - Full Details */}
      {isBookerModalOpen && selectedBooker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">{selectedBooker.name}</h3>
                <p className="text-sm text-gray-600">Full Activity Details</p>
              </div>
              <button
                onClick={() => setIsBookerModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <FiX className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6">
              {/* Stats Summary */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-sm text-blue-600 font-semibold">Total Bookings</p>
                  <p className="text-3xl font-bold text-blue-700">{selectedBooker.bookings || 0}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <p className="text-sm text-green-600 font-semibold">Total Sales</p>
                  <p className="text-3xl font-bold text-green-700">{selectedBooker.sales || 0}</p>
                </div>
              </div>

              {/* All Bookings */}
              {selectedBooker.bookingDetails && selectedBooker.bookingDetails.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-lg font-bold text-gray-900 mb-3 flex items-center">
                    <FiCalendar className="mr-2" />
                    All Bookings ({selectedBooker.bookingDetails.length})
                  </h4>
                  <div className="space-y-3">
                    {selectedBooker.bookingDetails.map((booking) => (
                      <div key={booking.id} className="bg-white border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3">
                            <div className="flex-shrink-0">
                              <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                            </div>
                            <div className="flex-1">
                              <p className="font-semibold text-gray-900">{booking.name}</p>
                              <div className="flex items-center space-x-4 mt-1 text-sm text-gray-600">
                                <span className="flex items-center">
                                  <FiClock className="mr-1" /> {booking.time}
                                </span>
                                <span>{booking.phone}</span>
                              </div>
                              <p className="text-sm text-teal-600 mt-2 flex items-center">
                                <FiCalendar className="mr-1" /> Booked {booking.bookedAgo}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="inline-block px-3 py-1 text-sm font-semibold text-blue-700 bg-blue-100 rounded-full">
                              {booking.status}
                            </span>
                            <p className="text-xs text-gray-500 mt-1">
                              {new Date(booking.dateBooked).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All Sales */}
              {selectedBooker.salesDetails && selectedBooker.salesDetails.length > 0 && (
                <div>
                  <h4 className="text-lg font-bold text-gray-900 mb-3 flex items-center">
                    <FiDollarSign className="mr-2" />
                    All Sales ({selectedBooker.salesDetails.length})
                  </h4>
                  <div className="space-y-3">
                    {selectedBooker.salesDetails.map((sale) => (
                      <div key={sale.id} className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3">
                            <div className="flex-shrink-0">
                              <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                            </div>
                            <div className="flex-1">
                              <p className="font-semibold text-gray-900">{sale.leadName}</p>
                              <p className="text-lg font-bold text-green-700 mt-1">£{typeof sale.amount === 'number' ? sale.amount.toFixed(2) : sale.amount}</p>
                              <p className="text-sm text-gray-600 mt-1">by {sale.by}</p>
                              <p className="text-sm text-teal-600 mt-2 flex items-center">
                                <FiDollarSign className="mr-1" /> Sale completed {sale.completedAgo}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="inline-block px-3 py-1 text-sm font-semibold text-green-700 bg-green-100 rounded-full">
                              Completed
                            </span>
                            <p className="text-xs text-gray-500 mt-1">
                              Sale #{sale.saleNumber.substring(0, 20)}...
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No Activity */}
              {(!selectedBooker.bookingDetails || selectedBooker.bookingDetails.length === 0) &&
               (!selectedBooker.salesDetails || selectedBooker.salesDetails.length === 0) && (
                <div className="text-center py-8">
                  <FiActivity className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600">No activity found for today</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
