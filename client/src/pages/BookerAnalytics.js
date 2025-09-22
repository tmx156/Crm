import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { FiUsers, FiTrendingUp, FiTarget, FiDollarSign, FiCalendar, FiActivity, FiEye, FiDownload, FiRefreshCw, FiFilter } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import axios from 'axios';

const BookerAnalytics = () => {
  const { user } = useAuth();
  const { socket } = useSocket();

  // State management
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedPeriod, setSelectedPeriod] = useState('daily');
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });

  // Analytics data
  const [overviewData, setOverviewData] = useState(null);
  const [dailyComparison, setDailyComparison] = useState(null);
  const [activityLog, setActivityLog] = useState([]);
  const [assignmentHistory, setAssignmentHistory] = useState([]);
  const [selectedBooker, setSelectedBooker] = useState('all');

  // UI state
  const [activeTab, setActiveTab] = useState('overview');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchOverviewData();
      fetchDailyComparison();
      fetchActivityLog();
      fetchAssignmentHistory();
    }
  }, [user]);

  // Separate effect for date range changes
  useEffect(() => {
    if (user?.role === 'admin') {
      fetchOverviewData();
      fetchActivityLog();
      fetchAssignmentHistory();
    }
  }, [selectedPeriod, dateRange]);

  // Separate effect for selected date changes
  useEffect(() => {
    if (user?.role === 'admin') {
      fetchDailyComparison();
    }
  }, [selectedDate]);

  // Real-time updates
  useEffect(() => {
    if (socket && user?.role === 'admin') {
      const handleRealTimeUpdate = (data) => {
        console.log('📊 Booker Analytics: Real-time update received', data);
        // Refresh data when changes occur
        fetchOverviewData();
        fetchDailyComparison();
      };

      socket.on('lead_updated', handleRealTimeUpdate);
      socket.on('lead_created', handleRealTimeUpdate);
      socket.on('booker_activity', handleRealTimeUpdate);

      return () => {
        socket.off('lead_updated', handleRealTimeUpdate);
        socket.off('lead_created', handleRealTimeUpdate);
        socket.off('booker_activity', handleRealTimeUpdate);
      };
    }
  }, [socket, user]);

  const fetchOverviewData = async () => {
    setLoading(true);
    try {
      console.log('📊 Fetching overview data with params:', {
        period: selectedPeriod,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });

      const response = await axios.get('/api/booker-analytics/overview', {
        params: {
          period: selectedPeriod,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate
        }
      });

      console.log('📊 Overview response:', response.data);
      setOverviewData(response.data);
    } catch (error) {
      console.error('❌ Error fetching overview data:', error);
      // Set fallback data for testing
      setOverviewData({
        period: selectedPeriod,
        bookerCount: 0,
        teamTotals: {
          totalLeadsAssigned: 0,
          totalLeadsBooked: 0,
          totalLeadsAttended: 0,
          totalSalesMade: 0,
          totalRevenue: 0
        },
        bookerPerformance: []
      });
    }
    setLoading(false);
  };

  const fetchDailyComparison = async () => {
    try {
      console.log('📅 Fetching daily comparison for date:', selectedDate);

      const response = await axios.get('/api/booker-analytics/daily-comparison', {
        params: { date: selectedDate }
      });

      console.log('📅 Daily comparison response:', response.data);
      setDailyComparison(response.data);
    } catch (error) {
      console.error('❌ Error fetching daily comparison:', error);
      // Set fallback data
      setDailyComparison({
        date: selectedDate,
        dailyComparison: [],
        summary: {
          totalBookers: 0,
          activeBookers: 0,
          totalLeadsBooked: 0,
          totalRevenue: 0
        }
      });
    }
  };

  const fetchActivityLog = async () => {
    try {
      const response = await axios.get('/api/booker-analytics/activity-log', {
        params: {
          userId: selectedBooker !== 'all' ? selectedBooker : undefined,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          limit: 20
        }
      });
      setActivityLog(response.data.activities || []);
    } catch (error) {
      console.error('❌ Error fetching activity log:', error);
      setActivityLog([]);
    }
  };

  const fetchAssignmentHistory = async () => {
    try {
      const response = await axios.get('/api/booker-analytics/assignment-history', {
        params: {
          userId: selectedBooker !== 'all' ? selectedBooker : undefined,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          limit: 20
        }
      });
      setAssignmentHistory(response.data.assignments || []);
    } catch (error) {
      console.error('❌ Error fetching assignment history:', error);
      setAssignmentHistory([]);
    }
  };

  const handleRefresh = () => {
    fetchOverviewData();
    fetchDailyComparison();
    fetchActivityLog();
    fetchAssignmentHistory();
  };

  const generateSampleData = async () => {
    try {
      setLoading(true);
      console.log('🔄 Generating sample booker data...');

      const response = await axios.post('/api/booker-analytics/update-performance', {
        date: selectedDate
      });

      if (response.data.success) {
        console.log('✅ Sample data generated successfully');
        // Refresh all data
        await fetchOverviewData();
        await fetchDailyComparison();
        await fetchActivityLog();
        await fetchAssignmentHistory();
      }
    } catch (error) {
      console.error('❌ Error generating sample data:', error);
    }
    setLoading(false);
  };

  const exportData = () => {
    // Implement CSV export functionality
    if (!overviewData) return;

    const csvData = overviewData.bookerPerformance.map(bp => ({
      Name: bp.booker.name,
      Email: bp.booker.email,
      'Leads Assigned': bp.metrics.totalLeadsAssigned,
      'Leads Booked': bp.metrics.totalLeadsBooked,
      'Leads Attended': bp.metrics.totalLeadsAttended,
      'Sales Made': bp.metrics.totalSalesMade,
      'Total Revenue': bp.metrics.totalSaleAmount,
      'Conversion Rate': bp.metrics.overallConversionRate + '%',
      'Show Up Rate': bp.metrics.overallShowUpRate + '%'
    }));

    const csvContent = [
      Object.keys(csvData[0]).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `booker-analytics-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // Colors for charts
  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

  if (user?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <FiUsers className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access Denied</h3>
          <p className="mt-1 text-sm text-gray-500">Only administrators can access booker analytics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Booker Analytics Dashboard</h1>
          <p className="text-sm text-gray-500">Comprehensive performance tracking and insights</p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <FiFilter className="h-4 w-4 mr-2" />
            Filters
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <FiRefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={generateSampleData}
            disabled={loading}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <FiActivity className="h-4 w-4 mr-2" />
            Generate Data
          </button>
          <button
            onClick={exportData}
            disabled={!overviewData || overviewData.bookerPerformance?.length === 0}
            className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            <FiDownload className="h-4 w-4 mr-2" />
            Export
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-white p-4 rounded-lg shadow border">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="daily">Daily</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Booker Filter</label>
              <select
                value={selectedBooker}
                onChange={(e) => setSelectedBooker(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="all">All Bookers</option>
                {overviewData?.bookerPerformance?.map(bp => (
                  <option key={bp.booker.id} value={bp.booker.id}>
                    {bp.booker.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', name: 'Overview', icon: FiTrendingUp },
            { id: 'daily', name: 'Daily Comparison', icon: FiCalendar },
            { id: 'activity', name: 'Activity Log', icon: FiActivity },
            { id: 'assignments', name: 'Assignments', icon: FiUsers }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group inline-flex items-center py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="mr-2 h-4 w-4" />
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <FiRefreshCw className="mx-auto h-8 w-8 text-blue-500 animate-spin" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">Loading Analytics...</h3>
            <p className="mt-1 text-sm text-gray-500">Fetching booker performance data</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && overviewData && overviewData.bookerCount === 0 && (
        <div className="text-center py-12">
          <FiUsers className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No Booker Data Found</h3>
          <p className="mt-1 text-sm text-gray-500">
            No bookers or performance data available for the selected period.
          </p>
          <div className="mt-6">
            <button
              onClick={generateSampleData}
              disabled={loading}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              <FiActivity className="mr-2 h-4 w-4" />
              Generate Sample Data
            </button>
          </div>
        </div>
      )}

      {/* Tab Content */}
      {!loading && activeTab === 'overview' && overviewData && overviewData.bookerCount > 0 && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FiUsers className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Active Bookers</dt>
                      <dd className="text-lg font-medium text-gray-900">{overviewData.bookerCount}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FiTarget className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Leads Assigned</dt>
                      <dd className="text-lg font-medium text-gray-900">{overviewData.teamTotals.totalLeadsAssigned}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FiTrendingUp className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Bookings</dt>
                      <dd className="text-lg font-medium text-gray-900">{overviewData.teamTotals.totalLeadsBooked}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FiDollarSign className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Revenue</dt>
                      <dd className="text-lg font-medium text-gray-900">£{overviewData.teamTotals.totalRevenue.toFixed(2)}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Booker Performance Chart */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Booker Performance Comparison</h3>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={overviewData.bookerPerformance.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="booker.name" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="metrics.totalLeadsBooked" fill="#3B82F6" name="Leads Booked" />
                <Bar dataKey="metrics.totalSalesMade" fill="#10B981" name="Sales Made" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top Performers Table */}
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Top Performers</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">Ranked by total revenue generated</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Booker</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Booked</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conversion</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {overviewData.bookerPerformance.slice(0, 10).map((bp, index) => (
                    <tr key={bp.booker.id} className={index < 3 ? 'bg-yellow-50' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {index + 1}
                        {index === 0 && <span className="ml-1 text-yellow-500">🏆</span>}
                        {index === 1 && <span className="ml-1 text-gray-400">🥈</span>}
                        {index === 2 && <span className="ml-1 text-yellow-600">🥉</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{bp.booker.name}</div>
                        <div className="text-sm text-gray-500">{bp.booker.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {bp.metrics.totalLeadsAssigned}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {bp.metrics.totalLeadsBooked}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {bp.metrics.overallConversionRate}%
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                        £{bp.metrics.totalSaleAmount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Daily Comparison Tab */}
      {!loading && activeTab === 'daily' && (
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Daily Performance - {selectedDate}</h3>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{dailyComparison.summary.activeBookers}</div>
                <div className="text-sm text-gray-600">Active Bookers</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{dailyComparison.summary.totalLeadsBooked}</div>
                <div className="text-sm text-gray-600">Total Bookings</div>
              </div>
              <div className="bg-yellow-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">£{dailyComparison.summary.totalRevenue.toFixed(2)}</div>
                <div className="text-sm text-gray-600">Total Revenue</div>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">{dailyComparison.summary.totalBookers}</div>
                <div className="text-sm text-gray-600">Total Bookers</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Booker</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Booked</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attended</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sales</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Activity</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dailyComparison.dailyComparison.map((comparison) => (
                    <tr key={comparison.booker.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{comparison.booker.name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          comparison.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {comparison.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {comparison.performance.leads_assigned}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {comparison.performance.leads_booked}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {comparison.performance.leads_attended}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {comparison.performance.sales_made}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                        £{parseFloat(comparison.performance.total_sale_amount || 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {comparison.activityCount} actions
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Activity Log Tab */}
      {activeTab === 'activity' && (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Recent Activity Log</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">All booker actions and system events</p>
          </div>
          <div className="divide-y divide-gray-200">
            {activityLog.map((activity) => (
              <div key={activity.id} className="px-4 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <FiActivity className="h-4 w-4 text-gray-400 mr-3" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {activity.users?.name || 'Unknown User'}
                      </p>
                      <p className="text-sm text-gray-500">
                        {activity.activity_type.replace('_', ' ').toUpperCase()}
                        {activity.leads?.name && ` on ${activity.leads.name}`}
                        {activity.old_value && activity.new_value &&
                          ` (${activity.old_value} → ${activity.new_value})`
                        }
                      </p>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {new Date(activity.performed_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assignment History Tab */}
      {activeTab === 'assignments' && (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Assignment History</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">Complete audit trail of lead assignments</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lead</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned To</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned By</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Previous</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {assignmentHistory.map((assignment) => (
                  <tr key={assignment.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {assignment.leads?.name || 'Unknown Lead'}
                      </div>
                      <div className="text-sm text-gray-500">
                        {assignment.leads?.phone}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {assignment.assigned_to_user?.name || 'Unassigned'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {assignment.assigned_by_user?.name || 'System'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {assignment.previous_assignee_user?.name || 'None'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(assignment.assigned_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        assignment.assignment_type === 'manual'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {assignment.assignment_type}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookerAnalytics;