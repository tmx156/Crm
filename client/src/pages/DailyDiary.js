import React, { useState, useEffect } from 'react';
import {
  FiCalendar, FiUsers, FiTrendingUp, FiClock, FiPhone, FiRefreshCw,
  FiWifi, FiTarget, FiCheck, FiExternalLink, FiX, FiMail, FiMessageSquare,
  FiDollarSign, FiActivity, FiAward, FiPieChart, FiArrowUp,
  FiArrowDown, FiArrowLeft, FiArrowRight, FiMinus, FiStar, FiEye, FiBarChart
} from 'react-icons/fi';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const DailyDiary = () => {
  const { user } = useAuth();
  const { subscribeToLeadUpdates, isConnected } = useSocket();
  const navigate = useNavigate();

  // State management
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [analytics, setAnalytics] = useState({
    metrics: {
      leadsAssigned: 0,
      bookingsMade: 0,
      bookingsAttended: 0,
      bookingsCancelled: 0,
      noShows: 0,
      salesMade: 0,
      totalRevenue: 0,
      averageSale: 0,
      conversionRate: 0,
      showUpRate: 0,
      salesConversionRate: 0
    },
    upcomingBookings: []
  });
  const [hourlyActivity, setHourlyActivity] = useState([]);
  const [teamPerformance, setTeamPerformance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState('overview'); // overview, hourly, team
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [apiError, setApiError] = useState(null);

  // Fetch all data
  const fetchDailyData = async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);

    try {
      const [analyticsRes, hourlyRes, teamRes] = await Promise.all([
        axios.get('/api/stats/daily-analytics', { params: { date: selectedDate } }),
        axios.get('/api/stats/hourly-activity', { params: { date: selectedDate } }),
        axios.get('/api/stats/team-performance', { params: { date: selectedDate } })
      ]);

      setAnalytics(analyticsRes.data);
      setHourlyActivity(hourlyRes.data.hourlyActivity);
      setTeamPerformance(teamRes.data.teamPerformance);
      setLastUpdated(new Date());
      setApiError(null); // Clear any previous errors
    } catch (error) {
      console.error('Failed to fetch daily data:', error);
      if (error.response?.status === 404) {
        console.warn('API endpoints not found - server may need restart to load new routes');
        setApiError('API endpoints not found. Please restart the server to load the new Daily Analytics endpoints.');
      } else {
        setApiError('Failed to fetch analytics data. Please check your connection.');
      }
    } finally {
      setLoading(false);
      if (showRefreshing) setRefreshing(false);
    }
  };

  // Initial load and date changes
  useEffect(() => {
    fetchDailyData();
  }, [selectedDate]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchDailyData();
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh, selectedDate]);

  // Real-time updates
  useEffect(() => {
    const unsubscribe = subscribeToLeadUpdates((update) => {
      if (update.type === 'LEAD_UPDATED' || update.type === 'BOOKING_CREATED') {
        console.log('📊 Daily Diary: Refreshing due to real-time update');
        fetchDailyData();
      }
    });

    return unsubscribe;
  }, [subscribeToLeadUpdates]);

  // Handle manual refresh
  const handleRefresh = () => {
    fetchDailyData(true);
  };

  // Date navigation
  const navigateDate = (direction) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + direction);
    setSelectedDate(current.toISOString().split('T')[0]);
  };

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(amount);
  };

  // Get status indicator
  const getStatusIndicator = (current, previous) => {
    if (current > previous) return { icon: FiArrowUp, color: 'text-green-500' };
    if (current < previous) return { icon: FiArrowDown, color: 'text-red-500' };
    return { icon: FiMinus, color: 'text-gray-500' };
  };

  // Chart colors
  const chartColors = {
    primary: '#3b82f6',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#06b6d4'
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <FiRefreshCw className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-gray-600">Loading daily analytics...</span>
        </div>
      </div>
    );
  }

  if (apiError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md mx-auto text-center">
          <div className="bg-white rounded-lg shadow-sm border p-8">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FiX className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">API Error</h3>
            <p className="text-gray-600 mb-6">{apiError}</p>
            <button
              onClick={() => {
                setApiError(null);
                fetchDailyData(true);
              }}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <FiRefreshCw className="w-4 h-4" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <FiBarChart className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Daily Analytics</h1>
                <p className="text-sm text-gray-500">Comprehensive day-to-day performance insights</p>
              </div>
            </div>

            {/* Connection Status */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-gray-600">
                  {isConnected ? 'Live' : 'Offline'}
                </span>
              </div>

              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-medium ${
                  autoRefresh
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                <FiRefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} />
                <span>Auto</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Date Controls */}
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigateDate(-1)}
                className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-600"
              >
                <FiArrowLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center space-x-3">
                <FiCalendar className="w-5 h-5 text-blue-600" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-lg font-semibold text-gray-900">
                  {new Date(selectedDate).toLocaleDateString('en-GB', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </span>
              </div>

              <button
                onClick={() => navigateDate(1)}
                className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-600"
              >
                <FiArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-sm text-gray-500">
                <FiClock className="w-4 h-4" />
                <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>
              </div>

              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FiRefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="bg-white rounded-lg shadow-sm border mb-8">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              {[
                { id: 'overview', label: 'Overview', icon: FiPieChart },
                { id: 'hourly', label: 'Hourly Activity', icon: FiClock },
                { id: 'team', label: 'Team Performance', icon: FiUsers }
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setViewMode(tab.id)}
                    className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm ${
                      viewMode === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Overview Tab */}
        {viewMode === 'overview' && (
          <div className="space-y-8">
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Leads Assigned */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Leads Assigned</p>
                    <p className="text-3xl font-bold text-gray-900">{analytics.metrics.leadsAssigned}</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <FiUsers className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <span className="text-gray-500">Starting point of conversion funnel</span>
                </div>
              </div>

              {/* Bookings Made */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Bookings Made</p>
                    <p className="text-3xl font-bold text-gray-900">{analytics.metrics.bookingsMade}</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <FiCalendar className="w-6 h-6 text-green-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <span className={`font-medium ${analytics.metrics.conversionRate >= 20 ? 'text-green-600' : 'text-orange-600'}`}>
                    {analytics.metrics.conversionRate}% conversion rate
                  </span>
                </div>
              </div>

              {/* Show Up Rate */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Show Up Rate</p>
                    <p className="text-3xl font-bold text-gray-900">{analytics.metrics.showUpRate}%</p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <FiCheck className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <span className="text-gray-500">
                    {analytics.metrics.bookingsAttended} attended / {analytics.metrics.bookingsMade} booked
                  </span>
                </div>
              </div>

              {/* Revenue */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Revenue</p>
                    <p className="text-3xl font-bold text-gray-900">{formatCurrency(analytics.metrics.totalRevenue)}</p>
                  </div>
                  <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <FiDollarSign className="w-6 h-6 text-yellow-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <span className="text-gray-500">
                    {analytics.metrics.salesMade} sales • Avg: {formatCurrency(analytics.metrics.averageSale)}
                  </span>
                </div>
              </div>
            </div>

            {/* Conversion Funnel */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-6">Conversion Funnel</h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {[
                  { label: 'Leads Assigned', value: analytics.metrics.leadsAssigned, color: 'bg-blue-500', percentage: 100 },
                  { label: 'Bookings Made', value: analytics.metrics.bookingsMade, color: 'bg-green-500', percentage: analytics.metrics.conversionRate },
                  { label: 'Attended', value: analytics.metrics.bookingsAttended, color: 'bg-purple-500', percentage: analytics.metrics.showUpRate },
                  { label: 'Sales Made', value: analytics.metrics.salesMade, color: 'bg-yellow-500', percentage: analytics.metrics.salesConversionRate },
                  { label: 'Revenue', value: formatCurrency(analytics.metrics.totalRevenue), color: 'bg-red-500', percentage: 100 }
                ].map((step, index) => (
                  <div key={step.label} className="text-center">
                    <div className={`${step.color} rounded-lg p-4 text-white mb-2`}>
                      <div className="text-2xl font-bold">{step.value}</div>
                      <div className="text-sm opacity-90">{step.label}</div>
                    </div>
                    {index < 4 && (
                      <div className="text-sm font-medium text-gray-600">
                        {index === 0 ? '→' : `${step.percentage}% →`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Upcoming Bookings */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900">Upcoming Bookings (Next 7 Days)</h3>
                <span className="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded">
                  {analytics.upcomingBookings.length} bookings
                </span>
              </div>

              {analytics.upcomingBookings.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {analytics.upcomingBookings.map((booking) => (
                        <tr key={booking.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="font-medium text-gray-900">{booking.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {new Date(booking.date_booked).toLocaleDateString('en-GB')} at{' '}
                            {new Date(booking.date_booked).toLocaleTimeString('en-GB', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {booking.phone}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                              {booking.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <button
                              onClick={() => navigate(`/leads/${booking.id}`)}
                              className="text-blue-600 hover:text-blue-900 flex items-center space-x-1"
                            >
                              <FiEye className="w-4 h-4" />
                              <span>View</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <FiCalendar className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No upcoming bookings in the next 7 days</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hourly Activity Tab */}
        {viewMode === 'hourly' && (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Hourly Activity Breakdown</h3>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourlyActivity}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" />
                  <YAxis />
                  <Tooltip />
                  <Area type="monotone" dataKey="bookings" stackId="1" stroke={chartColors.primary} fill={chartColors.primary} />
                  <Area type="monotone" dataKey="attended" stackId="2" stroke={chartColors.success} fill={chartColors.success} />
                  <Area type="monotone" dataKey="cancelled" stackId="3" stroke={chartColors.danger} fill={chartColors.danger} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Team Performance Tab */}
        {viewMode === 'team' && (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Team Performance</h3>

            {teamPerformance.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team Member</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Leads Assigned</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bookings</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attended</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sales</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conversion</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Show Up</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {teamPerformance.map((member, index) => (
                      <tr key={member.userId} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            {index === 0 && (
                              <FiStar className="w-4 h-4 text-yellow-400 mr-2" />
                            )}
                            <div>
                              <div className="font-medium text-gray-900">{member.name}</div>
                              <div className="text-sm text-gray-500">{member.role}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{member.leadsAssigned}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{member.bookingsMade}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{member.attended}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{member.salesMade}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatCurrency(member.revenue)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            member.conversionRate >= 25 ? 'bg-green-100 text-green-800' :
                            member.conversionRate >= 15 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {member.conversionRate}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            member.showUpRate >= 70 ? 'bg-green-100 text-green-800' :
                            member.showUpRate >= 50 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {member.showUpRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FiUsers className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>No team performance data available for this date</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DailyDiary;