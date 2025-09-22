import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { FiDownload, FiCalendar, FiUser, FiTrendingUp, FiDollarSign, FiBarChart2 } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import axios from 'axios';

const Reports = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [reportData, setReportData] = useState({
    leadsAssigned: 0,
    booked: 0,
    attended: 0,
    cancelled: 0,
    conversionRate: 0,
    conversionData: [],
    totalSales: 0,
    totalSalesAmount: 0,
    salesByUser: {},
    salesByPaymentMethod: {},
    new: 0,
    sales: 0,
    dailyBreakdown: [],
    weeklyData: null
  });
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    userId: user?.role === 'admin' ? 'all' : user?.id || ''
  });
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('bookings');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [dailyBookings, setDailyBookings] = useState([]);
  const [loadingDaily, setLoadingDaily] = useState(false);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchUsers();
    }
    fetchReportData();
  }, [user]);

  // Fetch daily bookings when selected date changes
  useEffect(() => {
    if (user?.role === 'booker' && selectedDate) {
      fetchDailyBookings(selectedDate);
    }
  }, [selectedDate, user]);

  // Real-time updates
  useEffect(() => {
    if (socket) {
      const handleRealTimeUpdate = (data) => {
        console.log('📊 Reports: Real-time update received', data);
        // Refresh report data when any lead/sale changes occur
        fetchReportData();
        setLastUpdate(new Date());
      };

      // Subscribe to real-time updates
      socket.on('lead_created', handleRealTimeUpdate);
      socket.on('lead_updated', handleRealTimeUpdate);
      socket.on('lead_deleted', handleRealTimeUpdate);
      socket.on('sale_created', handleRealTimeUpdate);
      socket.on('sale_updated', handleRealTimeUpdate);
      socket.on('stats_update_needed', handleRealTimeUpdate);

      return () => {
        socket.off('lead_created', handleRealTimeUpdate);
        socket.off('lead_updated', handleRealTimeUpdate);
        socket.off('lead_deleted', handleRealTimeUpdate);
        socket.off('sale_created', handleRealTimeUpdate);
        socket.off('sale_updated', handleRealTimeUpdate);
        socket.off('stats_update_needed', handleRealTimeUpdate);
      };
    }
  }, [socket]);

  const fetchUsers = async () => {
    try {
      const response = await axios.get('/api/users');
      setUsers([
        { id: 'all', name: 'All Users' },
        ...response.data
      ]);
    } catch (error) {
      console.error('Error fetching users:', error);
      setUsers([
        { id: 'all', name: 'All Users' }
      ]);
    }
  };

  const fetchDailyBookings = async (date) => {
    setLoadingDaily(true);
    try {
      // For bookers, get bookings they created on this specific date
      const response = await axios.get('/api/leads', {
        params: { 
          limit: 100,
          created_date: date,
          created_by: user.id
        }
      });

      // Get leads created by this booker on the selected date
      const bookings = response.data?.leads || [];

      setDailyBookings(bookings.map(booking => ({
        name: booking.name,
        phone: booking.phone,
        email: booking.email,
        date_booked: booking.date_booked, // This is when the appointment is scheduled
        status: booking.status,
        id: booking.id
      })));

    } catch (error) {
      console.error('Error fetching daily bookings:', error);
      setDailyBookings([]);
    }
    setLoadingDaily(false);
  };

  const fetchReportData = async () => {
    setLoading(true);
    try {
      // Build query parameters
      const params = {};
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.userId && filters.userId !== 'all') params.userId = filters.userId;

      // Fetch data from multiple endpoints
      const requests = [
        axios.get('/api/stats/leads', { params })
      ];

      // Only fetch sales data for non-bookers
      if (user?.role !== 'booker') {
        requests.push(
          axios.get('/api/sales/summary', { params }),
          axios.get('/api/sales/stats', { params })
        );
      }

      const responses = await Promise.all(requests);
      const leadsStatsResponse = responses[0];
      const salesSummaryResponse = responses[1];
      const salesStatsResponse = responses[2];

      const leadsStats = leadsStatsResponse.data;
      const salesSummary = salesSummaryResponse?.data || {};
      const salesStats = salesStatsResponse?.data || {};

      // Calculate metrics
      const totalLeads = leadsStats.total || 0;
      const newLeads = leadsStats.new || 0;
      const bookedLeads = leadsStats.booked || 0;
      const attendedLeads = leadsStats.attended || 0;
      const cancelledLeads = leadsStats.cancelled || 0;
      const salesLeads = leadsStats.sales || 0;

      // Calculate conversion rate (booked / total assigned)
      const conversionRate = totalLeads > 0 ? Math.round((bookedLeads / totalLeads) * 100) : 0;

      // Create conversion data for charts
      const conversionData = [
        { name: 'New', value: newLeads, color: '#3B82F6' },
        { name: 'Booked', value: bookedLeads, color: '#10B981' },
        { name: 'Attended', value: attendedLeads, color: '#8B5CF6' },
        { name: 'Cancelled', value: cancelledLeads, color: '#EF4444' },
        { name: 'Sales', value: salesLeads, color: '#F59E0B' }
      ];

      let reportDataUpdate = {
        leadsAssigned: totalLeads,
        new: newLeads,
        booked: bookedLeads,
        attended: attendedLeads,
        cancelled: cancelledLeads,
        sales: salesLeads,
        conversionRate,
        conversionData,
        totalSales: salesStats.totalSales || 0,
        totalSalesAmount: salesStats.totalRevenue || 0,
        salesByUser: salesSummary.byUser || {},
        salesByPaymentMethod: salesSummary.byPaymentMethod || {},
        averageSaleValue: salesStats.averageSaleValue || 0,
        financeAgreements: salesStats.financeAgreements || 0,
        dailyBreakdown: []
      };

      // Fetch daily breakdown for bookers
      if (user?.role === 'booker') {
        reportDataUpdate.dailyBreakdown = await fetchDailyBreakdown();
        reportDataUpdate.weeklyData = await fetchWeeklyPerformance();
      }

      setReportData(reportDataUpdate);

      console.log('📊 Reports data updated:', {
        totalLeads,
        newLeads,
        bookedLeads,
        attendedLeads,
        cancelledLeads,
        salesLeads,
        conversionRate,
        totalSales: salesStats.totalSales,
        totalRevenue: salesStats.totalRevenue
      });

    } catch (error) {
      console.error('Error fetching report data:', error);
      // Keep existing data on error, don't reset to dummy data
    }
    setLoading(false);
  };

  const fetchDailyBreakdown = async () => {
    try {
      // For performance, we'll simplify this function
      // Instead of making 30+ API calls, return a simplified dataset
      // In production, you'd want a dedicated endpoint that returns aggregated data

      const today = new Date();
      const dailyData = [];

      // Create a simple 7-day breakdown instead of 30 days
      for (let i = 6; i >= 0; i--) {
        const currentDate = new Date(today);
        currentDate.setDate(today.getDate() - i);
        const dateStr = currentDate.toISOString().split('T')[0];

        dailyData.push({
          date: dateStr,
          day: currentDate.toLocaleDateString('en-US', { weekday: 'short' }),
          dayNumber: currentDate.getDate(),
          month: currentDate.toLocaleDateString('en-US', { month: 'short' }),
          assigned: Math.floor(Math.random() * 10) + 5, // Placeholder data
          converted: Math.floor(Math.random() * 5) + 1, // Placeholder data
          conversionRate: Math.floor(Math.random() * 50) + 20 // Placeholder data
        });
      }

      return dailyData;
    } catch (error) {
      console.error('Error fetching daily breakdown:', error);
      return [];
    }
  };

  const fetchWeeklyPerformance = async () => {
    try {
      // Get current week (Monday to Sunday)
      const today = new Date();
      const currentDay = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - (currentDay === 0 ? 6 : currentDay - 1));

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      // Initialize week data
      const weekDetails = [];
      const dailyChart = [];
      let weeklyBookings = 0;
      let totalAssigned = 0;
      let totalConverted = 0;
      let bestDay = '';
      let bestDayBookings = 0;
      let bookingsList = [];

      // Create array of dates for the week
      const weekDates = [];
      for (let i = 0; i < 7; i++) {
        const currentDate = new Date(monday);
        currentDate.setDate(monday.getDate() + i);
        weekDates.push({
          date: currentDate.toISOString().split('T')[0],
          dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long' }),
          shortDay: currentDate.toLocaleDateString('en-US', { weekday: 'short' })
        });
      }

      // Make all API calls in parallel instead of sequentially
      const dailyPromises = weekDates.map(({ date }) =>
        axios.get('/api/stats/daily-analytics', {
          params: { date }
        }).catch(error => {
          console.warn(`Failed to fetch daily analytics for ${date}:`, error);
          return { data: { metrics: { bookingsMade: 0, leadsAssigned: 0, conversionRate: 0 }, upcomingBookings: [] } };
        })
      );

      const dailyResponses = await Promise.all(dailyPromises);

      // Process the results
      weekDates.forEach((dayInfo, index) => {
        const response = dailyResponses[index];
        const dayBookings = response.data.metrics?.bookingsMade || 0;
        const dayAssigned = response.data.metrics?.leadsAssigned || 0;
        const dayConversionRate = response.data.metrics?.conversionRate || 0;
        const upcomingBookings = response.data.upcomingBookings || [];

        weeklyBookings += dayBookings;
        totalAssigned += dayAssigned;
        totalConverted += dayBookings;

        if (dayBookings > bestDayBookings) {
          bestDayBookings = dayBookings;
          bestDay = dayInfo.dayName;
        }

        weekDetails.push({
          date: dayInfo.date,
          dayName: dayInfo.dayName,
          bookings: dayBookings,
          assigned: dayAssigned,
          conversionRate: dayConversionRate,
          bookingsList: upcomingBookings.map(booking => ({
            name: booking.name,
            phone: booking.phone,
            dateBooked: booking.date_booked,
            status: booking.status
          }))
        });

        dailyChart.push({
          day: dayInfo.shortDay,
          actual: dayBookings
        });
      });

      // Get weekly trend (last 4 weeks) - simplified to avoid too many API calls
      const weeklyTrend = [];

      // Use the current week's data we already have
      weeklyTrend.push({
        week: 'Current Week',
        bookings: weeklyBookings
      });

      // For performance, we'll show a simplified trend
      // In a production environment, you'd want to create a dedicated endpoint
      // that returns weekly aggregated data instead of making 28+ API calls
      for (let i = 1; i <= 3; i++) {
        weeklyTrend.unshift({
          week: `Week ${4 - i}`,
          bookings: Math.max(0, weeklyBookings - (i * 2)) // Placeholder data
        });
      }

      // Calculate weekly average (last 4 weeks excluding current)
      const lastThreeWeeks = weeklyTrend.slice(0, 3);
      const weeklyAverage = lastThreeWeeks.length > 0
        ? Math.round(lastThreeWeeks.reduce((sum, week) => sum + week.bookings, 0) / lastThreeWeeks.length)
        : 0;

      // Today's bookings
      const todayStr = today.toISOString().split('T')[0];
      let todayBookings = 0;
      try {
        const todayResponse = await axios.get('/api/stats/daily-analytics', {
          params: { date: todayStr }
        });
        todayBookings = todayResponse.data.metrics?.bookingsMade || 0;
      } catch (error) {
        console.warn('Failed to fetch today\'s analytics:', error);
      }

      return {
        todayBookings,
        weeklyBookings,
        weeklyAverage,
        conversionRate: totalAssigned > 0 ? Math.round((totalConverted / totalAssigned) * 100) : 0,
        bestDay,
        bestDayBookings,
        weekDetails,
        dailyChart,
        weeklyTrend
      };

    } catch (error) {
      console.error('Error fetching weekly performance:', error);
      return {
        todayBookings: 0,
        weeklyBookings: 0,
        weeklyAverage: 0,
        conversionRate: 0,
        bestDay: 'N/A',
        bestDayBookings: 0,
        weekDetails: [],
        dailyChart: [],
        weeklyTrend: []
      };
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const generateReport = () => {
    fetchReportData();
  };

  const exportReport = () => {
    const reportContent = `
CRM Report
Generated: ${new Date().toLocaleDateString()}
Period: ${filters.startDate || 'All time'} - ${filters.endDate || 'Now'}
User: ${filters.userId === 'all' ? 'All Users' : users.find(u => u.id === filters.userId)?.name || 'Unknown'}

Lead Metrics:
- Total Leads: ${reportData.leadsAssigned}
- New Leads: ${reportData.new}
- Booked: ${reportData.booked}
- Attended: ${reportData.attended}
- Cancelled: ${reportData.cancelled}
- Sales: ${reportData.sales}
- Conversion Rate: ${reportData.conversionRate}%

Sales Metrics:
- Total Sales: ${reportData.totalSales}
- Total Revenue: £${reportData.totalSalesAmount.toFixed(2)}
- Average Sale Value: £${reportData.averageSaleValue.toFixed(2)}
- Finance Agreements: ${reportData.financeAgreements}

Last Updated: ${lastUpdate ? lastUpdate.toLocaleString() : 'Never'}
    `;
    
    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-report-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chartData = [
    { name: 'New', value: reportData.new, color: '#3B82F6' },
    { name: 'Booked', value: reportData.booked, color: '#10B981' },
    { name: 'Attended', value: reportData.attended, color: '#8B5CF6' },
    { name: 'Cancelled', value: reportData.cancelled, color: '#EF4444' },
    { name: 'Sales', value: reportData.sales, color: '#F59E0B' }
  ];

  // Show all users in dropdown for comprehensive reporting
  const getFilteredUsers = () => {
    return users; // Show all users regardless of active tab
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-1">
            Analyze performance and generate insights
            {lastUpdate && (
              <span className="ml-2 text-green-600">
                • Updated {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={exportReport}
          className="btn-primary flex items-center space-x-2"
        >
          <FiDownload className="h-4 w-4" />
          <span>Export Report</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 mb-4">
        {user?.role === 'booker' ? (
          <>
            <button
              className={`px-4 py-2 rounded-t-lg font-semibold flex items-center space-x-2 ${activeTab === 'bookings' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              onClick={() => setActiveTab('bookings')}
            >
              <FiBarChart2 /> <span>My Performance</span>
            </button>
            <button
              className={`px-4 py-2 rounded-t-lg font-semibold flex items-center space-x-2 ${activeTab === 'daily' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              onClick={() => setActiveTab('daily')}
            >
              <FiCalendar /> <span>Daily Breakdown</span>
            </button>
          </>
        ) : (
          <>
            <button
              className={`px-4 py-2 rounded-t-lg font-semibold flex items-center space-x-2 ${activeTab === 'bookings' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              onClick={() => setActiveTab('bookings')}
            >
              <FiCalendar /> <span>Bookings</span>
            </button>
            <button
              className={`px-4 py-2 rounded-t-lg font-semibold flex items-center space-x-2 ${activeTab === 'sales' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              onClick={() => setActiveTab('sales')}
            >
              <FiDollarSign /> <span>Sales</span>
            </button>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="card">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Report Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <FiCalendar className="inline h-4 w-4 mr-1" />
              Start Date
            </label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <FiCalendar className="inline h-4 w-4 mr-1" />
              End Date
            </label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
            />
          </div>
          {user?.role === 'admin' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <FiUser className="inline h-4 w-4 mr-1" />
                User
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={filters.userId}
                onChange={(e) => handleFilterChange('userId', e.target.value)}
              >
                {getFilteredUsers().map(user => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-end">
            <button
              onClick={generateReport}
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center space-x-2"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <>
                  <FiTrendingUp className="h-4 w-4" />
                  <span>Generate Report</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bookings Tab */}
      {activeTab === 'bookings' && (
        <>
          {/* Metrics Cards */}
          {user?.role === 'booker' ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="card text-center">
                <div className="text-2xl font-semibold text-blue-600">{reportData.leadsAssigned}</div>
                <div className="text-sm text-gray-500 mt-1">Leads Assigned</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-semibold text-green-600">{reportData.booked}</div>
                <div className="text-sm text-gray-500 mt-1">Leads Converted</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-semibold text-purple-600">{reportData.attended}</div>
                <div className="text-sm text-gray-500 mt-1">Attended</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-semibold text-indigo-600">{reportData.conversionRate}%</div>
                <div className="text-sm text-gray-500 mt-1">Conversion Rate</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
              <div className="card text-center">
                <div className="text-2xl font-semibold text-gray-600">{reportData.leadsAssigned}</div>
                <div className="text-sm text-gray-500 mt-1">Total Leads</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-semibold text-blue-600">{reportData.new}</div>
                <div className="text-sm text-gray-500 mt-1">New</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-semibold text-green-600">{reportData.booked}</div>
                <div className="text-sm text-gray-500 mt-1">Booked</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-semibold text-purple-600">{reportData.attended}</div>
                <div className="text-sm text-gray-500 mt-1">Attended</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-semibold text-red-600">{reportData.cancelled}</div>
                <div className="text-sm text-gray-500 mt-1">Cancelled</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-semibold text-indigo-600">{reportData.conversionRate}%</div>
                <div className="text-sm text-gray-500 mt-1">Conversion Rate</div>
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Bar Chart */}
            <div className="card">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Lead Status Overview</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pie Chart */}
            <div className="card">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Status Distribution</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={chartData.filter(item => item.value > 0)}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Summary */}
          <div className="card mt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Bookings Summary</h3>
            <div className="prose max-w-none">
              <p className="text-gray-600">
                This report shows booking metrics for{' '}
                {filters.userId === 'all' ? 'all users' : users.find(u => u.id === filters.userId)?.name}
                {filters.startDate && ` from ${filters.startDate}`}
                {filters.endDate && ` to ${filters.endDate}`}
                .
              </p>
              <div className="mt-4 space-y-2">
                <p className="text-sm text-gray-600">
                  • Total leads: <strong>{reportData.leadsAssigned}</strong>
                </p>
                <p className="text-sm text-gray-600">
                  • New leads: <strong>{reportData.new}</strong> ({reportData.leadsAssigned > 0 ? Math.round((reportData.new / reportData.leadsAssigned) * 100) : 0}%)
                </p>
                <p className="text-sm text-gray-600">
                  • Successfully booked: <strong>{reportData.booked}</strong> ({reportData.leadsAssigned > 0 ? Math.round((reportData.booked / reportData.leadsAssigned) * 100) : 0}%)
                </p>
                <p className="text-sm text-gray-600">
                  • Attended sessions: <strong>{reportData.attended}</strong> ({reportData.leadsAssigned > 0 ? Math.round((reportData.attended / reportData.leadsAssigned) * 100) : 0}%)
                </p>
                <p className="text-sm text-gray-600">
                  • Cancelled bookings: <strong>{reportData.cancelled}</strong> ({reportData.leadsAssigned > 0 ? Math.round((reportData.cancelled / reportData.leadsAssigned) * 100) : 0}%)
                </p>
                <p className="text-sm text-gray-600">
                  • Leads with sales: <strong>{reportData.sales}</strong> ({reportData.leadsAssigned > 0 ? Math.round((reportData.sales / reportData.leadsAssigned) * 100) : 0}%)
                </p>
                <p className="text-sm text-gray-600">
                  • Overall conversion rate: <strong>{reportData.conversionRate}%</strong>
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Sales Tab */}
      {activeTab === 'sales' && (
        <>
          {/* Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="card text-center">
              <div className="text-2xl font-semibold text-yellow-600">{reportData.totalSales}</div>
              <div className="text-sm text-gray-500 mt-1">Total Sales</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-semibold text-emerald-600">£{reportData.totalSalesAmount.toFixed(2)}</div>
              <div className="text-sm text-gray-500 mt-1">Sales Revenue</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-semibold text-indigo-600">£{reportData.averageSaleValue.toFixed(2)}</div>
              <div className="text-sm text-gray-500 mt-1">Avg Sale Value</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-semibold text-purple-600">{reportData.financeAgreements}</div>
              <div className="text-sm text-gray-500 mt-1">Finance Agreements</div>
            </div>
          </div>

          {/* Sales Charts - Only show for admins */}
          {user?.role === 'admin' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              {/* Sales by User */}
              <div className="card">
                <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                  <FiDollarSign className="h-5 w-5 mr-2 text-green-600" />
                  Sales by User
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={Object.entries(reportData.salesByUser || {}).map(([user, data]) => ({
                    name: user,
                    sales: data.count,
                    amount: data.amount
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value, name) => [name === 'amount' ? `£${value.toFixed(2)}` : value, name === 'amount' ? 'Revenue' : 'Sales Count']} />
                    <Bar dataKey="sales" fill="#10B981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Sales by Payment Method */}
              <div className="card">
                <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                  <FiDollarSign className="h-5 w-5 mr-2 text-blue-600" />
                  Sales by Payment Method
                </h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={Object.entries(reportData.salesByPaymentMethod || {}).map(([method, data]) => ({
                        name: method,
                        value: data.count,
                        amount: data.amount
                      }))}
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {Object.entries(reportData.salesByPaymentMethod || {}).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(${index * 60}, 70%, 50%)`} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name) => [value, 'Sales Count']} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Sales Summary */}
          <div className="card mt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Sales Summary</h3>
            <div className="prose max-w-none">
              <p className="text-gray-600">
                This report shows sales metrics for{' '}
                {filters.userId === 'all' ? 'all users' : users.find(u => u.id === filters.userId)?.name}
                {filters.startDate && ` from ${filters.startDate}`}
                {filters.endDate && ` to ${filters.endDate}`}
                .
              </p>
              <div className="mt-4 space-y-2">
                <p className="text-sm text-gray-600">
                  • Total sales: <strong>{reportData.totalSales}</strong>
                </p>
                <p className="text-sm text-gray-600">
                  • Total revenue: <strong>£{reportData.totalSalesAmount.toFixed(2)}</strong>
                </p>
                <p className="text-sm text-gray-600">
                  • Average sale value: <strong>£{reportData.averageSaleValue.toFixed(2)}</strong>
                </p>
                <p className="text-sm text-gray-600">
                  • Finance agreements: <strong>{reportData.financeAgreements}</strong>
                </p>
                <p className="text-sm text-gray-600">
                  • Sales conversion rate: <strong>{reportData.leadsAssigned > 0 ? Math.round((reportData.totalSales / reportData.leadsAssigned) * 100) : 0}%</strong>
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Bookings Tab */}
      {activeTab === 'bookings' && (
        <>
          {/* Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
            <div className="card text-center">
              <div className="text-2xl font-semibold text-gray-600">{reportData.leadsAssigned}</div>
              <div className="text-sm text-gray-500 mt-1">Total Leads</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-semibold text-blue-600">{reportData.new}</div>
              <div className="text-sm text-gray-500 mt-1">New</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-semibold text-green-600">{reportData.booked}</div>
              <div className="text-sm text-gray-500 mt-1">Booked</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-semibold text-purple-600">{reportData.attended}</div>
              <div className="text-sm text-gray-500 mt-1">Attended</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-semibold text-red-600">{reportData.cancelled}</div>
              <div className="text-sm text-gray-500 mt-1">Cancelled</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-semibold text-indigo-600">{reportData.conversionRate}%</div>
              <div className="text-sm text-gray-500 mt-1">Conversion Rate</div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            {/* Bar Chart */}
            <div className="card">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Lead Status Overview</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pie Chart */}
            <div className="card">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Status Distribution</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={chartData.filter(item => item.value > 0)}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Summary */}
          <div className="card mt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Bookings Summary</h3>
            <div className="prose max-w-none">
              <p className="text-gray-600">
                This report shows booking metrics for{' '}
                {filters.userId === 'all' ? 'all users' : users.find(u => u.id === filters.userId)?.name}
                {filters.startDate && ` from ${filters.startDate}`}
                {filters.endDate && ` to ${filters.endDate}`}
                .
              </p>
              <div className="mt-4 space-y-2">
                <p className="text-sm text-gray-600">
                  • Total leads: <strong>{reportData.leadsAssigned}</strong>
                </p>
                <p className="text-sm text-gray-600">
                  • New leads: <strong>{reportData.new}</strong> ({reportData.leadsAssigned > 0 ? Math.round((reportData.new / reportData.leadsAssigned) * 100) : 0}%)
                </p>
                <p className="text-sm text-gray-600">
                  • Successfully booked: <strong>{reportData.booked}</strong> ({reportData.leadsAssigned > 0 ? Math.round((reportData.booked / reportData.leadsAssigned) * 100) : 0}%)
                </p>
                <p className="text-sm text-gray-600">
                  • Attended sessions: <strong>{reportData.attended}</strong> ({reportData.leadsAssigned > 0 ? Math.round((reportData.attended / reportData.leadsAssigned) * 100) : 0}%)
                </p>
                <p className="text-sm text-gray-600">
                  • Cancelled bookings: <strong>{reportData.cancelled}</strong> ({reportData.leadsAssigned > 0 ? Math.round((reportData.cancelled / reportData.leadsAssigned) * 100) : 0}%)
                </p>
                <p className="text-sm text-gray-600">
                  • Overall conversion rate: <strong>{reportData.conversionRate}%</strong>
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Daily Breakdown Tab (Bookers Only) - Simple Option A */}
      {activeTab === 'daily' && user?.role === 'booker' && (
        <div className="space-y-6">
          {/* Simple Daily Booking Count + List */}
          <div className="card">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold text-gray-900">📅 Today's Bookings Made</h3>
              <div className="flex items-center space-x-2">
                <FiCalendar className="h-4 w-4 text-gray-500" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-3 py-1 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            {/* Daily Count Summary */}
            <div className="mb-6 p-4 bg-blue-50 rounded-lg border-l-4 border-blue-500">
              <h4 className="text-lg font-semibold text-blue-900 mb-2">
                📊 Total Bookings Made Today: {dailyBookings.length}
              </h4>
              <p className="text-sm text-blue-700">Bookings you created on {new Date(selectedDate).toLocaleDateString('en-GB')}</p>
            </div>

            {/* Simple Booking List */}
            {loadingDaily ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading bookings...</p>
              </div>
            ) : (
              <div className="space-y-3">
                {dailyBookings.length > 0 ? (
                  <>
                    <h4 className="font-medium text-gray-900 mb-3">📝 Bookings Created:</h4>
                    {dailyBookings.map((booking, index) => (
                      <div key={booking.id || index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-l-4 border-blue-500">
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
                          <p className="text-xs text-gray-500">Created on {new Date(selectedDate).toLocaleDateString('en-GB')}</p>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <FiCalendar className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>No bookings made on {new Date(selectedDate).toLocaleDateString('en-GB')}</p>
                    <p className="text-sm mt-2">Start creating bookings to see them here!</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports; 