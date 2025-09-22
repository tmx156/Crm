import React, { useState, useEffect } from 'react';
import { 
  FiWifi, FiTrendingUp, FiMail, FiMessageSquare, FiTrash2, FiInbox,
  FiCalendar, FiDollarSign, FiUsers, FiChevronDown, FiChevronUp,
  FiClock, FiCheckCircle, FiXCircle, FiEye, FiSend, FiPhone
} from 'react-icons/fi';
import axios from 'axios';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalLeadsThisMonth: 0,
    bookedLeads: 0,
    showUpRate: 0,
    leadsOverTime: [],
    showUpVsCancellation: { showUps: 0, cancellations: 0 },
    leaderboard: []
  });

  const [dashboardData, setDashboardData] = useState({
    todayBookings: [],
    recentSales: [],
    recentMessages: [],
    bookingsByBooker: [],
    chartData: {
      bookingsOverTime: [],
      salesOverTime: [],
      bookerPerformance: [],
      statusDistribution: []
    },
    todayStats: {
      bookingsMade: 0,
      salesCompleted: 0,
      messagesSent: 0,
      leadsCreated: 0
    }
  });

  const [expandedSections, setExpandedSections] = useState({
    bookings: false,
    sales: false,
    messages: false,
    bookers: false,
    charts: false,
    stats: false
  });

  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const { subscribeToStatsUpdates, isConnected } = useSocket();

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToStatsUpdates((update) => {
      if (update.type === 'STATS_UPDATE_NEEDED') {
        console.log('📊 Dashboard: Refreshing stats due to real-time update');
        fetchDashboardStats();
        setLastUpdated(new Date());
      }
    });

    return unsubscribe;
  }, [subscribeToStatsUpdates]);

  const fetchDashboardStats = async () => {
    try {
      const promises = [
        fetchTodayBookings(),
        fetchRecentMessages(),
        fetchBookingsByBooker(),
        fetchChartData(),
        fetchTodayStats()
      ];
      
      // Only fetch sales data for admin and viewer roles
      if (user?.role === 'admin' || user?.role === 'viewer') {
        promises.push(fetchRecentSales());
      }
      
      await Promise.all(promises);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
    }
    setLoading(false);
  };

  const fetchTodayBookings = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // For bookers, only fetch bookings they created today
      if (user?.role === 'booker') {
        const response = await axios.get('/api/leads', {
          params: { 
            limit: 50,
            created_today: true,
            created_by: user.id
          }
        });
        
        const todayBookings = response.data?.leads || [];
        setDashboardData(prev => ({ ...prev, todayBookings }));
      } else {
        // For admin/viewer, fetch all today's calendar events
        const response = await axios.get('/api/leads/calendar', {
          params: { 
            start: today,
            end: today,
            limit: 10
          }
        });
        
        const todayBookings = response.data?.events?.filter(event => 
          event.extendedProps?.status === 'Booked' || 
          event.extendedProps?.status === 'Attended'
        ) || [];
        
        setDashboardData(prev => ({ ...prev, todayBookings }));
      }
    } catch (error) {
      console.error('Error fetching today bookings:', error);
    }
  };

  const fetchRecentSales = async () => {
    try {
      const response = await axios.get('/api/sales', {
        params: { limit: 5 }
      });
      
      const recentSales = response.data || [];
      setDashboardData(prev => ({ ...prev, recentSales }));
    } catch (error) {
      console.error('Error fetching recent sales:', error);
    }
  };

  const fetchRecentMessages = async () => {
    try {
      const response = await axios.get('/api/messages', {
        params: { limit: 5 }
      });
      
      const recentMessages = response.data || [];
      setDashboardData(prev => ({ ...prev, recentMessages }));
    } catch (error) {
      console.error('Error fetching recent messages:', error);
    }
  };

  const fetchBookingsByBooker = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get today's leads with booker information
      const response = await axios.get('/api/leads', {
        params: { 
          limit: 100,
          status: 'Booked'
        }
      });
      
      const todayLeads = (response.data?.leads || []).filter(lead => 
        lead.date_booked?.startsWith(today) || lead.created_at?.startsWith(today)
      );
      
      // Group bookings by booker
      const bookingsByBooker = {};
      todayLeads.forEach(lead => {
        const bookerName = lead.booker?.name || 'Unassigned';
        if (!bookingsByBooker[bookerName]) {
          bookingsByBooker[bookerName] = {
            name: bookerName,
            count: 0,
            bookings: []
          };
        }
        bookingsByBooker[bookerName].count++;
        bookingsByBooker[bookerName].bookings.push({
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          time: lead.date_booked ? formatTime(lead.date_booked) : 'TBD',
          status: lead.status
        });
      });
      
      // Convert to array and sort by count
      const bookerStats = Object.values(bookingsByBooker).sort((a, b) => b.count - a.count);
      
      setDashboardData(prev => ({ ...prev, bookingsByBooker: bookerStats }));
    } catch (error) {
      console.error('Error fetching bookings by booker:', error);
    }
  };

  const fetchChartData = async () => {
    try {
      // Get last 7 days of data for charts
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      // Fetch leads for the last 7 days
      const leadsResponse = await axios.get('/api/leads', {
        params: { limit: 200 }
      });

      const leads = leadsResponse.data?.leads || [];
      let sales = [];
      
      // Only fetch sales data for admin and viewer roles
      if (user?.role === 'admin' || user?.role === 'viewer') {
        const salesResponse = await axios.get('/api/sales');
        sales = salesResponse.data || [];
      }

      // Process bookings over time (last 7 days)
      const bookingsOverTime = [];
      const salesOverTime = [];
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        
        // Count bookings for this day
        const dayBookings = leads.filter(lead => 
          lead.date_booked?.startsWith(dateStr) || lead.created_at?.startsWith(dateStr)
        ).length;

        // Count sales for this day
        const daySales = sales.filter(sale => 
          sale.created_at?.startsWith(dateStr)
        ).length;

        bookingsOverTime.push({
          day: dayName,
          bookings: dayBookings,
          date: dateStr
        });

        salesOverTime.push({
          day: dayName,
          sales: daySales,
          revenue: sales.filter(sale => sale.created_at?.startsWith(dateStr))
            .reduce((sum, sale) => sum + (parseFloat(sale.amount) || 0), 0),
          date: dateStr
        });
      }

      // Process booker performance (last 7 days)
      const bookerPerformance = {};
      leads.forEach(lead => {
        const bookerName = lead.booker?.name || 'Unassigned';
        if (!bookerPerformance[bookerName]) {
          bookerPerformance[bookerName] = 0;
        }
        bookerPerformance[bookerName]++;
      });

      const bookerPerformanceData = Object.entries(bookerPerformance)
        .map(([name, count]) => ({ name, bookings: count }))
        .sort((a, b) => b.bookings - a.bookings)
        .slice(0, 5); // Top 5 bookers

      // Process status distribution
      const statusCounts = {};
      leads.forEach(lead => {
        const status = lead.status || 'Unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      const statusDistribution = Object.entries(statusCounts)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count);

      setDashboardData(prev => ({
        ...prev,
        chartData: {
          bookingsOverTime,
          salesOverTime,
          bookerPerformance: bookerPerformanceData,
          statusDistribution
        }
      }));
    } catch (error) {
      console.error('Error fetching chart data:', error);
    }
  };

  const fetchTodayStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get today's bookings count
      let bookingsMade = 0;
      if (user?.role === 'booker') {
        // For bookers, count bookings they created today
        const bookingsResponse = await axios.get('/api/leads', {
          params: { 
            limit: 100,
            created_today: true,
            created_by: user.id
          }
        });
        bookingsMade = bookingsResponse.data?.leads?.length || 0;
      } else {
        // For admin/viewer, count calendar events
        const bookingsResponse = await axios.get('/api/leads/calendar', {
          params: { start: today, end: today }
        });
        bookingsMade = bookingsResponse.data?.events?.length || 0;
      }

      // Get today's sales count (only for admin and viewer roles)
      let salesCompleted = 0;
      if (user?.role === 'admin' || user?.role === 'viewer') {
        const salesResponse = await axios.get('/api/sales');
        const todaySales = (salesResponse.data || []).filter(sale => 
          sale.created_at?.startsWith(today)
        );
        salesCompleted = todaySales.length;
      }

      // Get today's messages count
      const messagesResponse = await axios.get('/api/messages');
      const todayMessages = (messagesResponse.data || []).filter(message => 
        message.created_at?.startsWith(today)
      );
      const messagesSent = todayMessages.length;

      // Get today's leads count
      const leadsResponse = await axios.get('/api/leads');
      const todayLeads = (leadsResponse.data?.leads || []).filter(lead => 
        lead.created_at?.startsWith(today)
      );
      const leadsCreated = todayLeads.length;

      setDashboardData(prev => ({
        ...prev,
        todayStats: {
          bookingsMade,
          salesCompleted,
          messagesSent,
          leadsCreated
        }
      }));
    } catch (error) {
      console.error('Error fetching today stats:', error);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const formatTime = (dateString) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center space-x-4">
            <div className="bg-white rounded-2xl p-3 shadow-lg">
              <FiCalendar className="h-8 w-8 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-gray-600">Welcome back, {user?.name || 'User'}!</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 bg-white rounded-full px-4 py-2 shadow-lg">
              <FiWifi className={`h-4 w-4 ${isConnected ? 'text-green-500' : 'text-red-500'}`} />
              <span className={`text-sm font-medium ${isConnected ? 'text-green-700' : 'text-red-700'}`}>
                {isConnected ? 'Live' : 'Offline'}
              </span>
            </div>
            <div className="text-sm text-gray-500">
              Updated {lastUpdated.toLocaleTimeString()}
          </div>
          </div>
        </div>

        {/* Today's Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Today's Bookings</p>
                <p className="text-3xl font-bold text-blue-600">{dashboardData.todayStats.bookingsMade}</p>
              </div>
              <FiCalendar className="h-8 w-8 text-blue-500" />
            </div>
          </div>

          {/* Sales Completed Card - Only for admin and viewer */}
          {(user?.role === 'admin' || user?.role === 'viewer') && (
            <div className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Sales Completed</p>
                  <p className="text-3xl font-bold text-green-600">{dashboardData.todayStats.salesCompleted}</p>
                </div>
                <FiDollarSign className="h-8 w-8 text-green-500" />
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 border-l-4 border-purple-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Messages Sent</p>
                <p className="text-3xl font-bold text-purple-600">{dashboardData.todayStats.messagesSent}</p>
              </div>
              <FiSend className="h-8 w-8 text-purple-500" />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 border-l-4 border-orange-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">New Leads</p>
                <p className="text-3xl font-bold text-orange-600">{dashboardData.todayStats.leadsCreated}</p>
              </div>
              <FiUsers className="h-8 w-8 text-orange-500" />
            </div>
          </div>
        </div>

        {/* Expandable Sections */}
        <div className="space-y-6">
          {/* Today's Bookings Section */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <button
              onClick={() => toggleSection('bookings')}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors duration-200"
            >
              <div className="flex items-center space-x-3">
                <FiCalendar className="h-6 w-6 text-blue-600" />
                <h2 className="text-xl font-semibold text-gray-900">Today's Bookings</h2>
                <span className="bg-blue-100 text-blue-800 text-sm font-medium px-2 py-1 rounded-full">
                  {dashboardData.todayBookings.length}
                </span>
              </div>
              {expandedSections.bookings ? (
                <FiChevronUp className="h-5 w-5 text-gray-400" />
              ) : (
                <FiChevronDown className="h-5 w-5 text-gray-400" />
              )}
            </button>
            
            {expandedSections.bookings && (
              <div className="px-6 pb-6">
                {dashboardData.todayBookings.length > 0 ? (
                  <div className="space-y-3">
                    {dashboardData.todayBookings.slice(0, 5).map((booking, index) => (
                      <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className={`h-3 w-3 rounded-full ${
                            booking.extendedProps?.status === 'Attended' ? 'bg-green-500' : 'bg-blue-500'
                          }`} />
                          <div>
                            <p className="font-medium text-gray-900">{booking.title}</p>
                            <p className="text-sm text-gray-600">{booking.extendedProps?.phone}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-gray-900">{formatTime(booking.start)}</p>
                          <p className="text-sm text-gray-600">{booking.extendedProps?.status}</p>
                        </div>
                      </div>
                    ))}
                    {dashboardData.todayBookings.length > 5 && (
                      <p className="text-center text-gray-500 text-sm">
                        +{dashboardData.todayBookings.length - 5} more bookings
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <FiCalendar className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>No bookings scheduled for today</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recent Sales Section - Only for admin and viewer */}
          {(user?.role === 'admin' || user?.role === 'viewer') && (
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <button
                onClick={() => toggleSection('sales')}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors duration-200"
              >
                <div className="flex items-center space-x-3">
                  <FiDollarSign className="h-6 w-6 text-green-600" />
                  <h2 className="text-xl font-semibold text-gray-900">Recent Sales</h2>
                  <span className="bg-green-100 text-green-800 text-sm font-medium px-2 py-1 rounded-full">
                    {dashboardData.recentSales.length}
                    </span>
                  </div>
                {expandedSections.sales ? (
                  <FiChevronUp className="h-5 w-5 text-gray-400" />
                ) : (
                  <FiChevronDown className="h-5 w-5 text-gray-400" />
                )}
              </button>
              
              {expandedSections.sales && (
                <div className="px-6 pb-6">
                  {dashboardData.recentSales.length > 0 ? (
                    <div className="space-y-3">
                      {dashboardData.recentSales.slice(0, 5).map((sale, index) => (
                        <div key={sale.id || index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-center space-x-3">
                            <div className="h-10 w-10 bg-green-100 rounded-full flex items-center justify-center">
                              <FiDollarSign className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{sale.lead_name || 'Unknown Lead'}</p>
                              <p className="text-sm text-gray-600">{sale.user_name || 'System'}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-green-600">£{sale.amount}</p>
                            <p className="text-sm text-gray-600">{formatDate(sale.created_at)}</p>
                          </div>
                      </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <FiDollarSign className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                      <p>No recent sales</p>
                  </div>
                  )}
                </div>
              )}
              </div>
            )}

          {/* Recent Messages Section */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
                <button
              onClick={() => toggleSection('messages')}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors duration-200"
            >
              <div className="flex items-center space-x-3">
                <FiMessageSquare className="h-6 w-6 text-purple-600" />
                <h2 className="text-xl font-semibold text-gray-900">Recent Messages</h2>
                <span className="bg-purple-100 text-purple-800 text-sm font-medium px-2 py-1 rounded-full">
                  {dashboardData.recentMessages.length}
                </span>
              </div>
              {expandedSections.messages ? (
                <FiChevronUp className="h-5 w-5 text-gray-400" />
              ) : (
                <FiChevronDown className="h-5 w-5 text-gray-400" />
              )}
            </button>
            
            {expandedSections.messages && (
              <div className="px-6 pb-6">
                {dashboardData.recentMessages.length > 0 ? (
              <div className="space-y-3">
                    {dashboardData.recentMessages.slice(0, 5).map((message, index) => (
                      <div key={message.id || index} className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
                    <div className="flex-shrink-0">
                      {message.type === 'sms' ? (
                            <FiMessageSquare className="h-5 w-5 text-green-500" />
                      ) : (
                            <FiMail className="h-5 w-5 text-blue-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                        {message.subject || message.lead_name || 'Message'}
                      </p>
                          <p className="text-sm text-gray-600 truncate">
                            {message.content || message.message || message.body}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {formatDate(message.created_at)}
                      </p>
                    </div>
                        <div className="flex-shrink-0">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            message.status === 'sent' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {message.status || 'pending'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <FiMessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>No recent messages</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* My Daily Bookings Section - For bookers only */}
          {user?.role === 'booker' && (
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <button
                onClick={() => toggleSection('bookers')}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors duration-200"
              >
                <div className="flex items-center space-x-3">
                  <FiCalendar className="h-6 w-6 text-blue-600" />
                  <h2 className="text-xl font-semibold text-gray-900">My Daily Bookings</h2>
                  <span className="bg-blue-100 text-blue-800 text-sm font-medium px-2 py-1 rounded-full">
                    {dashboardData.todayStats.bookingsMade} booking{dashboardData.todayStats.bookingsMade !== 1 ? 's' : ''}
                  </span>
                </div>
                {expandedSections.bookers ? (
                  <FiChevronUp className="h-5 w-5 text-gray-400" />
                ) : (
                  <FiChevronDown className="h-5 w-5 text-gray-400" />
                )}
              </button>
              
              {expandedSections.bookers && (
                <div className="px-6 pb-6">
                  <div className="mb-4 p-4 bg-blue-50 rounded-lg">
                    <h3 className="text-lg font-semibold text-blue-900 mb-2">
                      📊 Total Bookings Made Today: {dashboardData.todayStats.bookingsMade}
                    </h3>
                    <p className="text-sm text-blue-700">Bookings you created today</p>
                  </div>
                  
                  {dashboardData.todayBookings.length > 0 ? (
                    <div className="space-y-3">
                      <h4 className="font-medium text-gray-900 mb-3">📝 Bookings Created:</h4>
                      {dashboardData.todayBookings.map((booking, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-l-4 border-blue-500">
                          <div className="flex items-center space-x-3">
                            <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-blue-600 font-bold text-sm">
                                {index + 1}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{booking.name}</p>
                              <p className="text-sm text-gray-600">{booking.phone}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-blue-600">
                              Booked for {booking.date_booked ? new Date(booking.date_booked).toLocaleDateString('en-GB') : 'TBD'}
                            </p>
                            <p className="text-xs text-gray-500">Created today</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <FiCalendar className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                      <p>No bookings made today</p>
                      <p className="text-sm mt-2">Start creating bookings to see them here!</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Bookings by Booker Section - For admin and viewer only */}
          {(user?.role === 'admin' || user?.role === 'viewer') && (
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <button
                onClick={() => toggleSection('bookers')}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors duration-200"
              >
                <div className="flex items-center space-x-3">
                  <FiUsers className="h-6 w-6 text-indigo-600" />
                  <h2 className="text-xl font-semibold text-gray-900">Today's Bookings by Booker</h2>
                  <span className="bg-indigo-100 text-indigo-800 text-sm font-medium px-2 py-1 rounded-full">
                    {dashboardData.bookingsByBooker.length} bookers
                  </span>
                </div>
                {expandedSections.bookers ? (
                  <FiChevronUp className="h-5 w-5 text-gray-400" />
                ) : (
                  <FiChevronDown className="h-5 w-5 text-gray-400" />
                )}
              </button>
              
              {expandedSections.bookers && (
                <div className="px-6 pb-6">
                  {dashboardData.bookingsByBooker.length > 0 ? (
                    <div className="space-y-4">
                      {dashboardData.bookingsByBooker.map((booker, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center space-x-3">
                              <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center">
                                <span className="text-indigo-600 font-bold text-lg">
                                  {booker.name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div>
                                <h3 className="font-semibold text-gray-900">{booker.name}</h3>
                                <p className="text-sm text-gray-600">{booker.count} booking{booker.count !== 1 ? 's' : ''}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="bg-indigo-100 text-indigo-800 text-sm font-medium px-3 py-1 rounded-full">
                                {booker.count}
                              </span>
                            </div>
                          </div>
                          
                          {booker.bookings.length > 0 && (
                            <div className="space-y-2">
                              {booker.bookings.slice(0, 3).map((booking, bookingIndex) => (
                                <div key={bookingIndex} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                  <div className="flex items-center space-x-3">
                                    <div className={`h-2 w-2 rounded-full ${
                                      booking.status === 'Attended' ? 'bg-green-500' : 
                                      booking.status === 'Booked' ? 'bg-blue-500' : 'bg-gray-400'
                                    }`} />
                                    <div>
                                      <p className="font-medium text-gray-900 text-sm">{booking.name}</p>
                                      <p className="text-xs text-gray-600">{booking.phone}</p>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-sm font-medium text-gray-900">{booking.time}</p>
                                    <p className="text-xs text-gray-600">{booking.status}</p>
                                  </div>
                                </div>
                              ))}
                              {booker.bookings.length > 3 && (
                                <p className="text-center text-gray-500 text-sm py-2">
                                  +{booker.bookings.length - 3} more booking{booker.bookings.length - 3 !== 1 ? 's' : ''}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <FiUsers className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                      <p>No bookings made today</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Charts Section */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <button
              onClick={() => toggleSection('charts')}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors duration-200"
            >
              <div className="flex items-center space-x-3">
                <FiTrendingUp className="h-6 w-6 text-emerald-600" />
                <h2 className="text-xl font-semibold text-gray-900">Analytics & Charts</h2>
                <span className="bg-emerald-100 text-emerald-800 text-sm font-medium px-2 py-1 rounded-full">
                  4 charts
                </span>
              </div>
              {expandedSections.charts ? (
                <FiChevronUp className="h-5 w-5 text-gray-400" />
              ) : (
                <FiChevronDown className="h-5 w-5 text-gray-400" />
              )}
            </button>
            
            {expandedSections.charts && (
              <div className="px-6 pb-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Bookings Over Time */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                      <FiCalendar className="h-5 w-5 text-blue-600 mr-2" />
                      Bookings Over Time (7 Days)
                    </h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={dashboardData.chartData.bookingsOverTime}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="day" stroke="#6b7280" />
                          <YAxis stroke="#6b7280" />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'white', 
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                            }} 
                          />
                          <Area 
                            type="monotone" 
                            dataKey="bookings" 
                            stroke="#3b82f6" 
                            fill="#3b82f6" 
                            fillOpacity={0.3}
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
        </div>
      </div>

                  {/* Sales Performance - Only for admin and viewer */}
                  {(user?.role === 'admin' || user?.role === 'viewer') && (
                    <div className="bg-gray-50 rounded-xl p-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                        <FiDollarSign className="h-5 w-5 text-green-600 mr-2" />
                        Sales & Revenue (7 Days)
                      </h3>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={dashboardData.chartData.salesOverTime}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="day" stroke="#6b7280" />
                            <YAxis yAxisId="left" stroke="#6b7280" />
                            <YAxis yAxisId="right" orientation="right" stroke="#6b7280" />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: 'white', 
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                              }} 
                            />
                            <Line 
                              yAxisId="left"
                              type="monotone" 
                              dataKey="sales" 
                              stroke="#10b981" 
                              strokeWidth={3}
                              dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
                            />
                            <Line 
                              yAxisId="right"
                              type="monotone" 
                              dataKey="revenue" 
                              stroke="#f59e0b" 
                              strokeWidth={3}
                              dot={{ fill: '#f59e0b', strokeWidth: 2, r: 4 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Booker Performance */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                      <FiUsers className="h-5 w-5 text-purple-600 mr-2" />
                      Top Bookers Performance
                    </h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dashboardData.chartData.bookerPerformance} layout="horizontal">
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis type="number" stroke="#6b7280" />
                          <YAxis dataKey="name" type="category" stroke="#6b7280" width={80} />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'white', 
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                            }} 
                          />
                          <Bar dataKey="bookings" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
        </div>

                  {/* Status Distribution */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                      <FiCheckCircle className="h-5 w-5 text-orange-600 mr-2" />
                      Lead Status Distribution
                    </h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={dashboardData.chartData.statusDistribution}
                            cx="50%"
                            cy="50%"
                            outerRadius={80}
                            dataKey="count"
                            label={({ status, count }) => `${status}: ${count}`}
                          >
                            {dashboardData.chartData.statusDistribution.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={[
                                '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'
                              ][index % 6]} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'white', 
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                            }} 
                          />
                        </PieChart>
                      </ResponsiveContainer>
                </div>
                  </div>
                </div>
              </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
};


export default Dashboard;
