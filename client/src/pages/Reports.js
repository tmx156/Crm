import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Cell } from 'recharts';
import { FiDownload, FiCalendar, FiUser, FiTrendingUp, FiDollarSign, FiBarChart2, FiRefreshCw, FiTarget, FiAward, FiCheck } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import axios from 'axios';

const Reports = () => {
  const { user } = useAuth();
  const { socket } = useSocket();

  // State
  const [kpis, setKpis] = useState({
    leadsAssigned: 0,
    totalBooked: 0,
    attended: 0,
    salesMade: 0,
    totalRevenue: 0,
    averageSale: 0,
    bookingRate: 0,
    showUpRate: 0,
    salesConversionRate: 0
  });

  const [dailyBreakdown, setDailyBreakdown] = useState([]);
  const [monthlyBreakdown, setMonthlyBreakdown] = useState([]);
  const [salesDetails, setSalesDetails] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Calculate this week Monday-Sunday (UK week logic)
  const getThisWeekDates = () => {
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysToMonday = currentDay === 0 ? 6 : currentDay - 1;
    
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysToMonday);
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    return {
      startDate: monday.toISOString().split('T')[0],
      endDate: sunday.toISOString().split('T')[0]
    };
  };
  
  // Get today's date for default filter
  const getTodayDate = () => {
    const today = new Date();
    return {
      startDate: today.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0]
    };
  };

  const [filters, setFilters] = useState(() => {
    const today = getTodayDate();
    return {
      startDate: today.startDate, // Today
      endDate: today.endDate,     // Today
      userId: user?.role === 'admin' ? 'all' : user?.id || ''
    };
  });
  const [users, setUsers] = useState([]);
  const [viewMode, setViewMode] = useState('daily'); // daily or monthly
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchUsers();
    }
    fetchReportData();
  }, [user]);

  // Real-time updates
  useEffect(() => {
    if (socket) {
      const handleRealTimeUpdate = (data) => {
        console.log('📊 Reports: Real-time update received', data);
        fetchReportData();
        setLastUpdate(new Date());
      };

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
      setUsers([{ id: 'all', name: 'All Users' }]);
    }
  };

  const fetchReportData = async () => {
    setLoading(true);
    try {
      // Convert date range to UTC timestamps for proper filtering
      const startDate = new Date(filters.startDate);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);

      const startUTC = startDate.toISOString();
      const endUTC = endDate.toISOString();

      console.log('📊 Reports fetching data with date range:', {
        startDate: filters.startDate,
        endDate: filters.endDate,
        startUTC,
        endUTC
      });

      // Fetch leads in TWO ways to ensure we get complete data:
      // 1. Leads CREATED in date range (for "assigned" metric)
      // 2. Leads BOOKED in date range (for "booked" metric)
      const [usersRes, createdLeadsRes, bookedLeadsRes, allSalesRes] = await Promise.all([
        axios.get('/api/users'),
        // Get ALL leads created in this date range
        axios.get('/api/leads/public', {
          params: {
            created_at_start: startUTC,
            created_at_end: endUTC,
            limit: 10000
          }
        }),
        // Get ALL leads booked in this date range
        axios.get('/api/leads/public', {
          params: {
            booked_at_start: startUTC,
            booked_at_end: endUTC,
            limit: 10000
          }
        }),
        // Get sales using DAILY ACTIVITY LOGIC - filter by creation date in the selected period
        // This ensures we count sales ENTERED during the period, like the Dashboard does
        axios.get('/api/sales', {
          params: {
            startDate: startUTC,
            endDate: endUTC
          }
        }).catch(err => {
          console.warn('Failed to fetch sales, using empty array:', err);
          return { data: [] };
        })
      ]);

      const users = usersRes.data || [];
      const createdLeads = createdLeadsRes.data?.leads || [];
      const bookedLeads = bookedLeadsRes.data?.leads || [];
      const allSales = Array.isArray(allSalesRes.data) ? allSalesRes.data : [];
      
      // Merge both sets of leads, removing duplicates by ID
      const leadMap = new Map();
      
      // Add all created leads
      createdLeads.forEach(lead => {
        leadMap.set(lead.id, lead);
      });
      
      // Add all booked leads (may overlap with created leads)
      bookedLeads.forEach(lead => {
        if (!leadMap.has(lead.id)) {
          leadMap.set(lead.id, lead);
        }
      });
      
      const leads = Array.from(leadMap.values());

      // Filter leads by user if specified - for user-specific reports, show leads assigned to that user
      // This is different from bookings (booker_id) - assigned means leads given to that user to work on
      const filteredLeads = filters.userId === 'all'
        ? leads
        : leads.filter(lead => lead.created_by_user_id === filters.userId);
      
      // DAILY ACTIVITY LOGIC: Filter sales by user if specified
      // This matches the Dashboard - sales are attributed to who ENTERED them, not who booked the lead
      const filteredSales = filters.userId === 'all'
        ? allSales
        : allSales.filter(sale => sale.user_id === filters.userId);

      console.log('📊 Reports raw data:', {
        users: users.length,
        createdLeads: createdLeads.length,
        bookedLeads: bookedLeads.length,
        mergedLeads: leads.length,
        filteredLeads: filteredLeads.length,
        allSales: allSales.length,
        filteredSales: filteredSales.length,
        userFilter: filters.userId,
        dateRange: { start: filters.startDate, end: filters.endDate },
        utcRange: { start: startUTC, end: endUTC }
      });

      // Debug: Show sample data and filtering info
      if (filters.userId !== 'all') {
        console.log(`🔍 User filter active: ${filters.userId}`);
        console.log(`   Filtered leads: ${filteredLeads.length} (from ${leads.length} total)`);
        console.log(`   Filtered sales: ${filteredSales.length} (from ${allSales.length} total)`);
      }

      if (createdLeads.length > 0) {
        console.log('📊 Sample created lead:', {
          id: createdLeads[0].id,
          created_by_user_id: createdLeads[0].created_by_user_id,
          booker_id: createdLeads[0].booker_id,
          status: createdLeads[0].status
        });
      }
      if (bookedLeads.length > 0) {
        console.log('📊 Sample booked lead:', {
          id: bookedLeads[0].id,
          created_by_user_id: bookedLeads[0].created_by_user_id,
          booker_id: bookedLeads[0].booker_id,
          status: bookedLeads[0].status
        });
      }
      if (allSales.length > 0) {
        console.log('📊 Sample sale:', {
          id: allSales[0].id,
          user_id: allSales[0].user_id,
          lead_id: allSales[0].lead_id
        });
      }

      // Calculate KPIs using the same logic as Daily Activity
      const kpis = calculateKPIs(filteredLeads, filteredSales, users);
      
      // Calculate daily breakdown
      const dailyBreakdown = calculateDailyBreakdown(filteredLeads, filteredSales);
      
      // Calculate monthly breakdown
      const monthlyBreakdown = calculateMonthlyBreakdown(filteredLeads, filteredSales);
      
      // Process sales details
      const salesDetails = processSalesDetails(filteredSales, leads, users);

      setKpis(kpis);
      setDailyBreakdown(dailyBreakdown);
      setMonthlyBreakdown(monthlyBreakdown);
      setSalesDetails(salesDetails);
      setLastUpdate(new Date());

      console.log('📊 Reports processed data:', {
        kpis,
        dailyDays: dailyBreakdown.length,
        monthlyWeeks: monthlyBreakdown.length,
        sales: salesDetails.length
      });

      // Debug: Show daily breakdown summary
      if (dailyBreakdown.length > 0) {
        console.log('📊 Daily breakdown summary:');
        dailyBreakdown.slice(0, 3).forEach(day => {
          console.log(`   ${day.date}: Assigned=${day.assigned}, Booked=${day.booked}, Sales=${day.sales}`);
        });
        if (dailyBreakdown.length > 3) {
          console.log(`   ... and ${dailyBreakdown.length - 3} more days`);
        }
      }

    } catch (error) {
      console.error('Error fetching report data:', error);
    }
    setLoading(false);
  };

  // Calculate KPIs using EXACT DAILY ACTIVITY LOGIC from Dashboard
  const calculateKPIs = (leads, sales, users) => {
    // Count leads CREATED (assigned) in date range for "leadsAssigned"
    const createdLeads = leads.filter(lead => lead.created_at);

    // ✅ EVER_BOOKED FIX: Count ALL leads ever booked (including cancelled)
    // This matches the Dashboard daily activity logic using ever_booked
    const bookedLeads = leads.filter(lead => lead.ever_booked);

    // Count attended (current status is Attended/Complete)
    const attendedLeads = leads.filter(lead =>
      ['attended', 'complete'].includes(lead.status?.toLowerCase())
    );

    // DASHBOARD LOGIC: Count ALL sales entered during the period
    const salesMade = sales.length;
    const totalRevenue = sales.reduce((sum, sale) => sum + (sale.amount || sale.total_amount || 0), 0);
    const averageSale = salesMade > 0 ? totalRevenue / salesMade : 0;

    // Calculate rates using DAILY ACTIVITIES logic
    const bookingRate = createdLeads.length > 0 ? Math.round((bookedLeads.length / createdLeads.length) * 100) : 0;
    const showUpRate = bookedLeads.length > 0 ? Math.round((attendedLeads.length / bookedLeads.length) * 100) : 0;
    const salesConversionRate = attendedLeads.length > 0 ? Math.round((salesMade / attendedLeads.length) * 100) : 0;

    return {
      leadsAssigned: createdLeads.length,
      totalBooked: bookedLeads.length,
      attended: attendedLeads.length,
      salesMade,
      totalRevenue,
      averageSale,
      bookingRate,
      showUpRate,
      salesConversionRate
    };
  };

  // Calculate daily breakdown - using DAILY ACTIVITIES LOGIC
  const calculateDailyBreakdown = (leads, sales) => {
    const breakdown = {};

    console.log('📊 Calculating daily breakdown:');
    console.log('   Leads:', leads.length);
    console.log('   Sales:', sales.length);
    
    // Process ALL leads to count assigned and booked correctly
    leads.forEach(lead => {
      // Count as "assigned" on the day the lead was created
      if (lead.created_at) {
        const createdDate = new Date(lead.created_at).toISOString().split('T')[0];
        
        if (!breakdown[createdDate]) {
          breakdown[createdDate] = {
            date: createdDate,
            dayName: new Date(createdDate).toLocaleDateString('en-US', { weekday: 'long' }),
            assigned: 0,
            booked: 0,
            sales: 0,
            revenue: 0
          };
        }
        
        breakdown[createdDate].assigned += 1;
      }
      
      // ✅ EVER_BOOKED FIX: Count as "booked" if ever_booked is true (includes cancelled)
      // This matches the Dashboard logic using ever_booked
      if (lead.ever_booked) {
        // Use booked_at if available, otherwise fall back to created_at
        const bookedDate = lead.booked_at ?
          new Date(lead.booked_at).toISOString().split('T')[0] :
          new Date(lead.created_at).toISOString().split('T')[0];

        if (!breakdown[bookedDate]) {
          breakdown[bookedDate] = {
            date: bookedDate,
            dayName: new Date(bookedDate).toLocaleDateString('en-US', { weekday: 'long' }),
            assigned: 0,
            booked: 0,
            sales: 0,
            revenue: 0
          };
        }

        breakdown[bookedDate].booked += 1;
      }
    });

    // Process sales using DAILY ACTIVITY LOGIC - count sales by when they were ENTERED
    let salesProcessed = 0;
    sales.forEach(sale => {
      if (sale.created_at) {
        // Count sale on the day it was ENTERED (like Dashboard daily activity)
        const saleDate = new Date(sale.created_at).toISOString().split('T')[0];
        if (!breakdown[saleDate]) {
          breakdown[saleDate] = {
            date: saleDate,
            dayName: new Date(saleDate).toLocaleDateString('en-US', { weekday: 'long' }),
            assigned: 0,
            booked: 0,
            sales: 0,
            revenue: 0
          };
        }
        breakdown[saleDate].sales += 1;
        breakdown[saleDate].revenue += (sale.amount || sale.total_amount || 0);
        salesProcessed += 1;
      }
    });

    console.log('   Sales processed for daily breakdown:', salesProcessed);

    const result = Object.values(breakdown).sort((a, b) => new Date(a.date) - new Date(b.date));
    console.log('📊 Daily breakdown result:', result.length, 'days with data');
    
    return result;
  };

  // Calculate monthly/weekly breakdown - using DAILY ACTIVITIES LOGIC
  const calculateMonthlyBreakdown = (leads, sales) => {
    const breakdown = {};
    
    leads.forEach(lead => {
      // Count as "assigned" based on created_at (when lead was created/assigned)
      if (lead.created_at) {
        const createdDate = new Date(lead.created_at);
        const createdWeekStart = new Date(createdDate);
        const createdDayOfWeek = createdDate.getDay();
        const createdDiffToMonday = createdDayOfWeek === 0 ? -6 : 1 - createdDayOfWeek;
        createdWeekStart.setDate(createdDate.getDate() + createdDiffToMonday);
        createdWeekStart.setHours(0, 0, 0, 0);
        
        const createdWeekEnd = new Date(createdWeekStart);
        createdWeekEnd.setDate(createdWeekStart.getDate() + 6);
        createdWeekEnd.setHours(23, 59, 59, 999);
        
        const createdWeekKey = createdWeekStart.toISOString().split('T')[0];
        const createdWeekLabel = `Week ${Math.ceil(createdWeekStart.getDate() / 7)}`;
        
        if (!breakdown[createdWeekKey]) {
          breakdown[createdWeekKey] = {
            weekNumber: createdWeekKey,
            weekLabel: createdWeekLabel,
            weekStart: createdWeekStart.toISOString().split('T')[0],
            weekEnd: createdWeekEnd.toISOString().split('T')[0],
            assigned: 0,
            booked: 0,
            attended: 0,
            sales: 0,
            revenue: 0
          };
        }
        
        breakdown[createdWeekKey].assigned += 1;
        
        // Count attended for leads created this week
        if (['attended', 'complete'].includes(lead.status?.toLowerCase()) && lead.booked_at) {
          breakdown[createdWeekKey].attended += 1;
        }
      }
      
      // ✅ EVER_BOOKED FIX: Count as "booked" if ever_booked is true (includes cancelled)
      if (lead.ever_booked) {
        // Use booked_at if available, otherwise fall back to created_at
        const bookedDate = lead.booked_at ? new Date(lead.booked_at) : new Date(lead.created_at);
        const bookedWeekStart = new Date(bookedDate);
        const bookedDayOfWeek = bookedDate.getDay();
        const bookedDiffToMonday = bookedDayOfWeek === 0 ? -6 : 1 - bookedDayOfWeek;
        bookedWeekStart.setDate(bookedDate.getDate() + bookedDiffToMonday);
        bookedWeekStart.setHours(0, 0, 0, 0);

        const bookedWeekEnd = new Date(bookedWeekStart);
        bookedWeekEnd.setDate(bookedWeekStart.getDate() + 6);
        bookedWeekEnd.setHours(23, 59, 59, 999);

        const bookedWeekKey = bookedWeekStart.toISOString().split('T')[0];
        const bookedWeekLabel = `Week ${Math.ceil(bookedWeekStart.getDate() / 7)}`;

        if (!breakdown[bookedWeekKey]) {
          breakdown[bookedWeekKey] = {
            weekNumber: bookedWeekKey,
            weekLabel: bookedWeekLabel,
            weekStart: bookedWeekStart.toISOString().split('T')[0],
            weekEnd: bookedWeekEnd.toISOString().split('T')[0],
            assigned: 0,
            booked: 0,
            attended: 0,
            sales: 0,
            revenue: 0
          };
        }

        breakdown[bookedWeekKey].booked += 1;
      }
    });

    // Process sales using DAILY ACTIVITY LOGIC - track by when the SALE was ENTERED
    sales.forEach(sale => {
      if (sale.created_at) {
        const saleDate = new Date(sale.created_at);
        const weekStart = new Date(saleDate);
        const dayOfWeek = saleDate.getDay();
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        weekStart.setDate(saleDate.getDate() + diffToMonday);
        weekStart.setHours(0, 0, 0, 0);

        const weekKey = weekStart.toISOString().split('T')[0];

        if (breakdown[weekKey]) {
          breakdown[weekKey].sales += 1;
          breakdown[weekKey].revenue += (sale.amount || sale.total_amount || 0);
        }
      }
    });

    return Object.values(breakdown).sort((a, b) => new Date(a.weekStart) - new Date(b.weekStart));
  };

  // Process sales details - DAILY ACTIVITY LOGIC
  const processSalesDetails = (sales, leads, users) => {
    const userMap = users.reduce((acc, user) => {
      acc[user.id] = user;
      return acc;
    }, {});

    const leadMap = leads.reduce((acc, lead) => {
      acc[lead.id] = lead;
      return acc;
    }, {});

    return sales.map(sale => {
      const lead = leadMap[sale.lead_id];
      const user = userMap[sale.user_id];

      return {
        saleId: sale.id,
        clientName: lead?.name || sale.lead_name || 'Unknown',
        phone: lead?.phone || sale.lead_phone || 'N/A',
        bookedDate: lead?.booked_at || lead?.date_booked || lead?.created_at,
        saleDate: sale.created_at,
        saleAmount: sale.amount || sale.total_amount || 0,
        paymentMethod: sale.payment_method || 'N/A',
        user: user?.name || 'Unknown'
      };
    });
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
CRM KPI Report
Generated: ${new Date().toLocaleDateString()}
Period: ${filters.startDate} - ${filters.endDate}
User: ${filters.userId === 'all' ? 'All Users' : users.find(u => u.id === filters.userId)?.name || 'Unknown'}

KEY PERFORMANCE INDICATORS:
- Leads Assigned: ${kpis.leadsAssigned}
- Total Bookings Made: ${kpis.totalBooked}
- Attended: ${kpis.attended}
- Sales Made: ${kpis.salesMade}
- Total Revenue: £${kpis.totalRevenue.toFixed(2)}
- Average Sale: £${kpis.averageSale.toFixed(2)}
- Booking Rate: ${kpis.bookingRate}%
- Show Up Rate: ${kpis.showUpRate}%
- Sales Conversion: ${kpis.salesConversionRate}%

DAILY BREAKDOWN:
${dailyBreakdown.map(day => `${day.date} (${day.dayName}): Assigned: ${day.assigned}, Booked: ${day.booked}, Sales: ${day.sales}, Revenue: £${day.revenue.toFixed(2)}`).join('\n')}

SALES DETAILS:
${salesDetails.map(sale => `${sale.clientName} - £${sale.saleAmount.toFixed(2)} - ${new Date(sale.saleDate).toLocaleDateString()}`).join('\n')}

Last Updated: ${lastUpdate ? lastUpdate.toLocaleString() : 'Never'}
    `;

    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kpi-report-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📊 KPI Reports & Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Comprehensive booking, performance, and sales tracking
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
                {users.map(user => (
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
                  <FiRefreshCw className="h-4 w-4" />
                  <span>Generate Report</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card text-center bg-gradient-to-br from-blue-50 to-blue-100">
          <div className="flex items-center justify-center mb-2">
            <FiUser className="h-8 w-8 text-blue-600" />
          </div>
          <div className="text-3xl font-bold text-blue-900">{kpis.leadsAssigned}</div>
          <div className="text-sm text-blue-700 font-medium mt-1">Leads Assigned</div>
        </div>

        <div className="card text-center bg-gradient-to-br from-green-50 to-green-100">
          <div className="flex items-center justify-center mb-2">
            <FiCalendar className="h-8 w-8 text-green-600" />
          </div>
          <div className="text-3xl font-bold text-green-900">{kpis.totalBooked}</div>
          <div className="text-sm text-green-700 font-medium mt-1">Total Bookings Made</div>
        </div>

        <div className="card text-center bg-gradient-to-br from-purple-50 to-purple-100">
          <div className="flex items-center justify-center mb-2">
            <FiCheck className="h-8 w-8 text-purple-600" />
          </div>
          <div className="text-3xl font-bold text-purple-900">{kpis.attended}</div>
          <div className="text-sm text-purple-700 font-medium mt-1">Attended</div>
        </div>

        <div className="card text-center bg-gradient-to-br from-yellow-50 to-yellow-100">
          <div className="flex items-center justify-center mb-2">
            <FiDollarSign className="h-8 w-8 text-yellow-600" />
          </div>
          <div className="text-3xl font-bold text-yellow-900">{kpis.salesMade}</div>
          <div className="text-sm text-yellow-700 font-medium mt-1">Sales Made</div>
        </div>

        <div className="card text-center bg-gradient-to-br from-red-50 to-red-100">
          <div className="flex items-center justify-center mb-2">
            <FiDollarSign className="h-8 w-8 text-red-600" />
          </div>
          <div className="text-3xl font-bold text-red-900">{formatCurrency(kpis.totalRevenue)}</div>
          <div className="text-sm text-red-700 font-medium mt-1">Total Revenue</div>
        </div>

        <div className="card text-center bg-gradient-to-br from-indigo-50 to-indigo-100">
          <div className="flex items-center justify-center mb-2">
            <FiTarget className="h-8 w-8 text-indigo-600" />
          </div>
          <div className="text-3xl font-bold text-indigo-900">{kpis.bookingRate}%</div>
          <div className="text-sm text-indigo-700 font-medium mt-1">Booking Rate</div>
        </div>

        <div className="card text-center bg-gradient-to-br from-pink-50 to-pink-100">
          <div className="flex items-center justify-center mb-2">
            <FiCheck className="h-8 w-8 text-pink-600" />
          </div>
          <div className="text-3xl font-bold text-pink-900">{kpis.showUpRate}%</div>
          <div className="text-sm text-pink-700 font-medium mt-1">Show Up Rate</div>
        </div>

        <div className="card text-center bg-gradient-to-br from-teal-50 to-teal-100">
          <div className="flex items-center justify-center mb-2">
            <FiAward className="h-8 w-8 text-teal-600" />
          </div>
          <div className="text-3xl font-bold text-teal-900">{kpis.salesConversionRate}%</div>
          <div className="text-sm text-teal-700 font-medium mt-1">Sales Conversion</div>
        </div>
      </div>

      {/* Conversion Funnel */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center">
          <FiTrendingUp className="h-5 w-5 mr-2 text-blue-600" />
          Conversion Funnel
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[
            { label: 'Leads', value: kpis.leadsAssigned, color: 'bg-blue-500', percentage: 100 },
            { label: 'Booked', value: kpis.totalBooked, color: 'bg-green-500', percentage: kpis.bookingRate },
            { label: 'Attended', value: kpis.attended, color: 'bg-purple-500', percentage: kpis.showUpRate },
            { label: 'Sales', value: kpis.salesMade, color: 'bg-yellow-500', percentage: kpis.salesConversionRate },
            { label: 'Revenue', value: formatCurrency(kpis.totalRevenue), color: 'bg-red-500', percentage: 100 }
          ].map((step, index) => (
            <div key={step.label} className="text-center">
              <div className={`${step.color} rounded-lg p-4 text-white mb-2`}>
                <div className="text-2xl font-bold">{step.value}</div>
                <div className="text-sm opacity-90">{step.label}</div>
              </div>
              {index < 4 && (
                <div className="text-sm font-medium text-gray-600">
                  {step.percentage}% →
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* View Mode Toggle */}
      <div className="flex space-x-2">
        <button
          className={`px-4 py-2 rounded-lg font-semibold ${viewMode === 'daily' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          onClick={() => setViewMode('daily')}
        >
          Daily Breakdown
        </button>
        <button
          className={`px-4 py-2 rounded-lg font-semibold ${viewMode === 'monthly' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          onClick={() => setViewMode('monthly')}
        >
          Monthly Breakdown
        </button>
      </div>

      {/* Daily Breakdown */}
      {viewMode === 'daily' && (
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Daily Breakdown</h3>
          <p className="text-sm text-gray-600 mb-4">
            📌 Assigned = Leads created/assigned | Booked = Bookings made | Sales/Revenue = Total conversions
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Day</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Booked</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sales</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {dailyBreakdown.map((day) => (
                  <tr key={day.date} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{day.date}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{day.dayName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 font-semibold">{day.assigned}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-semibold">{day.booked}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-yellow-600 font-semibold">{day.sales}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 font-semibold">{formatCurrency(day.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly Breakdown */}
      {viewMode === 'monthly' && (
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Monthly/Weekly Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Week</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Booked</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Attended</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sales</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {monthlyBreakdown.map((week) => (
                  <tr key={week.weekNumber} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{week.weekLabel}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{week.weekStart} to {week.weekEnd}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 font-semibold">{week.assigned}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-semibold">{week.booked}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-purple-600 font-semibold">{week.attended}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-yellow-600 font-semibold">{week.sales}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 font-semibold">{formatCurrency(week.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sales Details */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center">
          <FiDollarSign className="h-5 w-5 mr-2 text-green-600" />
          Sales from Bookings
        </h3>
        <div className="mb-4 p-4 bg-green-50 rounded-lg border border-green-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-green-700 font-medium">Total Sales</div>
              <div className="text-2xl font-bold text-green-900">{salesDetails.length}</div>
            </div>
            <div>
              <div className="text-sm text-green-700 font-medium">Total Revenue</div>
              <div className="text-2xl font-bold text-green-900">
                {formatCurrency(salesDetails.reduce((sum, s) => sum + s.saleAmount, 0))}
              </div>
            </div>
            <div>
              <div className="text-sm text-green-700 font-medium">Average Sale</div>
              <div className="text-2xl font-bold text-green-900">
                {formatCurrency(salesDetails.length > 0 ? salesDetails.reduce((sum, s) => sum + s.saleAmount, 0) / salesDetails.length : 0)}
              </div>
            </div>
          </div>
        </div>

        {salesDetails.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Booked Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sale Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {salesDetails.map((sale) => (
                  <tr key={sale.saleId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{sale.clientName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{sale.phone}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {sale.bookedDate ? new Date(sale.bookedDate).toLocaleDateString('en-GB') : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(sale.saleDate).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-bold">
                      {formatCurrency(sale.saleAmount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{sale.paymentMethod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <FiDollarSign className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No sales data available for this period</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Reports;
