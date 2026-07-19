import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import {
  FiCalendar, FiUsers, FiDollarSign, FiCheckCircle, FiXCircle, FiClock, FiTarget,
  FiRefreshCw, FiAlertTriangle, FiBookOpen, FiChevronDown, FiArrowUp
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import axios from 'axios';

// Fixed categorical order (app-wide palette) for booker-identity charts
const BOOKER_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

// Semantic (status) colors for appointment outcomes
const OUTCOME_COLORS = {
  Showed: '#10B981',
  Cancelled: '#EF4444',
  'No Show': '#F59E0B',
  Pending: '#94A3B8'
};

const EMPTY_METRICS = {
  bookingsMade: 0, onCalendar: 0, cancelled: 0, showed: 0,
  noShow: 0, pending: 0, showRate: null, salesCount: 0, revenue: 0
};

function toISODate(d) {
  // Read local calendar fields directly — avoid toISOString(), which converts
  // to UTC first and shifts the date in any non-UTC timezone (e.g. BST).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMonday(d) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getThisWeekDates() {
  const monday = getMonday(new Date());
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { startDate: toISODate(monday), endDate: toISODate(sunday) };
}

function getLastWeekDates() {
  const thisMonday = getMonday(new Date());
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  return { startDate: toISODate(lastMonday), endDate: toISODate(lastSunday) };
}

function getThisMonthDates() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { startDate: toISODate(first), endDate: toISODate(now) };
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(amount || 0);
}

function formatPercent(v) {
  return v === null || v === undefined ? '-' : `${v}%`;
}

function shortDayLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

const Reports = () => {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [dateRange, setDateRange] = useState(() => getLastWeekDates());
  const [datePreset, setDatePreset] = useState('lastWeek');
  const [customInputs, setCustomInputs] = useState(() => getLastWeekDates());
  const [data, setData] = useState(null);
  const [selectedBooker, setSelectedBooker] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Floating toolbar: appears once the main filter card scrolls out of view,
  // so date-range and booker can be changed without scrolling back to the top.
  const filtersAnchorRef = useRef(null);
  const [showFloatingBar, setShowFloatingBar] = useState(false);
  const [floatingBookerOpen, setFloatingBookerOpen] = useState(false);
  const [floatingCustomOpen, setFloatingCustomOpen] = useState(false);
  const floatingBookerRef = useRef(null);
  const floatingCustomRef = useRef(null);

  const isAdmin = user?.role === 'admin';

  const fetchReportData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get('/api/booker-performance/summary', {
        params: { startDate: dateRange.startDate, endDate: dateRange.endDate }
      });
      setData(response.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching booker performance report:', err);
      setError(err.response?.data?.message || 'Failed to load report data');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) fetchReportData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, dateRange]);

  useEffect(() => {
    if (!socket || !isAdmin) return undefined;
    const handleRealTimeUpdate = () => fetchReportData();

    socket.on('lead_created', handleRealTimeUpdate);
    socket.on('lead_updated', handleRealTimeUpdate);
    socket.on('lead_deleted', handleRealTimeUpdate);
    socket.on('sale_created', handleRealTimeUpdate);
    socket.on('sale_updated', handleRealTimeUpdate);

    return () => {
      socket.off('lead_created', handleRealTimeUpdate);
      socket.off('lead_updated', handleRealTimeUpdate);
      socket.off('lead_deleted', handleRealTimeUpdate);
      socket.off('sale_created', handleRealTimeUpdate);
      socket.off('sale_updated', handleRealTimeUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isAdmin]);

  // Show the floating toolbar once the real filter card scrolls past the
  // sticky app header (top-14/16 accounts for that header's own height).
  useEffect(() => {
    const el = filtersAnchorRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setShowFloatingBar(!entry.isIntersecting),
      { rootMargin: '-64px 0px 0px 0px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Close either floating popover on an outside click, and both on Escape.
  useEffect(() => {
    if (!floatingBookerOpen && !floatingCustomOpen) return undefined;
    const handlePointerDown = (e) => {
      if (floatingBookerOpen && floatingBookerRef.current && !floatingBookerRef.current.contains(e.target)) {
        setFloatingBookerOpen(false);
      }
      if (floatingCustomOpen && floatingCustomRef.current && !floatingCustomRef.current.contains(e.target)) {
        setFloatingCustomOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setFloatingBookerOpen(false);
        setFloatingCustomOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [floatingBookerOpen, floatingCustomOpen]);

  const sortedBookers = useMemo(() => {
    if (!data) return [];
    return [...data.bookers].sort((a, b) => {
      if (a.id === 'unknown') return 1;
      if (b.id === 'unknown') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [data]);

  const scope = useMemo(() => {
    if (!data) return EMPTY_METRICS;
    if (selectedBooker === 'all') return data.totals;
    return data.byBooker[selectedBooker] || EMPTY_METRICS;
  }, [data, selectedBooker]);

  const scopeName = selectedBooker === 'all'
    ? 'All Bookers'
    : (sortedBookers.find(b => b.id === selectedBooker)?.name || 'Unknown');

  const outcomePieData = useMemo(() => ([
    { name: 'Showed', value: scope.showed },
    { name: 'Cancelled', value: scope.cancelled },
    { name: 'No Show', value: scope.noShow },
    { name: 'Pending', value: scope.pending }
  ].filter(d => d.value > 0)), [scope]);

  const bookerShareData = useMemo(() => {
    if (!data || selectedBooker !== 'all') return [];
    return sortedBookers
      .map(b => ({ name: b.name, value: data.byBooker[b.id]?.bookingsMade || 0 }))
      .filter(d => d.value > 0);
  }, [data, sortedBookers, selectedBooker]);

  const dailyBarData = useMemo(() => {
    if (!data) return [];
    return data.daily.map(d => ({
      date: d.date,
      label: shortDayLabel(d.date),
      value: selectedBooker === 'all' ? d.bookingsMade.total : (d.bookingsMade.byBooker[selectedBooker] || 0)
    }));
  }, [data, selectedBooker]);

  const breakdownRows = useMemo(() => {
    if (!data) return [];
    if (selectedBooker === 'all') {
      const rows = sortedBookers.map(b => ({ id: b.id, name: b.name, ...data.byBooker[b.id] }));
      rows.push({ id: 'TOTAL', name: 'TOTAL', ...data.totals, isTotal: true });
      return rows;
    }
    return [{ id: selectedBooker, name: scopeName, ...scope }];
  }, [data, sortedBookers, selectedBooker, scope, scopeName]);

  const salesRows = useMemo(() => {
    if (!data) return [];
    if (selectedBooker === 'all') return data.salesDetail;
    return data.salesDetail.filter(s => s.bookerId === selectedBooker);
  }, [data, selectedBooker]);

  const handlePreset = (preset) => {
    setDatePreset(preset);
    if (preset === 'thisWeek') setDateRange(getThisWeekDates());
    else if (preset === 'lastWeek') setDateRange(getLastWeekDates());
    else if (preset === 'thisMonth') setDateRange(getThisMonthDates());
    else if (preset === 'custom') setCustomInputs(dateRange);
  };

  // Same as handlePreset, but for the floating toolbar: picking "Custom" opens
  // its own compact popover instead of relying on the (now scrolled-away) inline picker.
  const handleFloatingPreset = (preset) => {
    handlePreset(preset);
    setFloatingCustomOpen(preset === 'custom');
  };

  const applyCustomRange = () => {
    setDateRange(customInputs);
  };

  const applyFloatingCustomRange = () => {
    applyCustomRange();
    setFloatingCustomOpen(false);
  };

  const kpiCards = [
    { label: 'Bookings Made', value: scope.bookingsMade, icon: FiBookOpen, color: 'blue' },
    { label: 'On Calendar', value: scope.onCalendar, icon: FiCalendar, color: 'indigo' },
    { label: 'Cancelled', value: scope.cancelled, icon: FiXCircle, color: 'red' },
    { label: 'Showed', value: scope.showed, icon: FiCheckCircle, color: 'green' },
    { label: 'Show Rate', value: formatPercent(scope.showRate), icon: FiTarget, color: 'pink' },
    { label: 'No Show', value: scope.noShow, icon: FiAlertTriangle, color: 'orange' },
    { label: 'Pending', value: scope.pending, icon: FiClock, color: 'gray' },
    { label: 'Sales', value: scope.salesCount, icon: FiDollarSign, color: 'yellow' },
    { label: 'Revenue', value: formatCurrency(scope.revenue), icon: FiDollarSign, color: 'emerald' }
  ];

  const colorClasses = {
    blue: 'from-blue-50 to-blue-100 text-blue-900 text-blue-700 text-blue-600',
    indigo: 'from-indigo-50 to-indigo-100 text-indigo-900 text-indigo-700 text-indigo-600',
    red: 'from-red-50 to-red-100 text-red-900 text-red-700 text-red-600',
    green: 'from-green-50 to-green-100 text-green-900 text-green-700 text-green-600',
    pink: 'from-pink-50 to-pink-100 text-pink-900 text-pink-700 text-pink-600',
    orange: 'from-orange-50 to-orange-100 text-orange-900 text-orange-700 text-orange-600',
    gray: 'from-gray-50 to-gray-100 text-gray-900 text-gray-700 text-gray-600',
    yellow: 'from-yellow-50 to-yellow-100 text-yellow-900 text-yellow-700 text-yellow-600',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900 text-emerald-700 text-emerald-600'
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <FiUsers className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access Denied</h3>
          <p className="mt-1 text-sm text-gray-500">Only administrators can access booker performance reports.</p>
        </div>
      </div>
    );
  }

  const hasAnyActivity = data && (data.totals.bookingsMade + data.totals.onCalendar + data.totals.salesCount) > 0;

  return (
    <div className="space-y-6">
      {/* Floating toolbar - mirrors the date-range & booker filters below, but
          stays reachable once that card has scrolled out of view. */}
      <div
        aria-hidden={!showFloatingBar}
        className={`fixed top-14 sm:top-16 left-0 md:left-64 right-0 z-20 transition-all duration-300 ease-out ${
          showFloatingBar ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="bg-white/90 backdrop-blur-md shadow-lg border-b border-gray-200">
          <div className="max-w-full mx-auto px-3 sm:px-4 lg:px-8 py-2 sm:py-2.5">
            <div className="flex items-center gap-2 overflow-x-auto">
              {/* Compact date presets */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {[
                  { key: 'thisWeek', label: 'This Week' },
                  { key: 'lastWeek', label: 'Last Week' },
                  { key: 'thisMonth', label: 'This Month' },
                  { key: 'custom', label: 'Custom' }
                ].map(p => (
                  <button
                    key={p.key}
                    onClick={() => handleFloatingPreset(p.key)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      datePreset === p.key ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <span className="hidden sm:inline text-xs text-gray-400 flex-shrink-0 px-1">
                {dateRange.startDate} → {dateRange.endDate}
              </span>

              <div className="w-px h-5 bg-gray-200 flex-shrink-0" />

              {/* Booker dropdown */}
              <div className="relative flex-shrink-0" ref={floatingBookerRef}>
                <button
                  onClick={() => setFloatingBookerOpen(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  <FiUsers className="h-3.5 w-3.5" />
                  <span className="max-w-[110px] truncate">{scopeName}</span>
                  <FiChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${floatingBookerOpen ? 'rotate-180' : ''}`} />
                </button>
                {floatingBookerOpen && (
                  <div className="absolute right-0 sm:left-0 sm:right-auto mt-2 w-52 max-h-72 overflow-y-auto bg-white rounded-xl shadow-xl ring-1 ring-black/5 py-1.5 z-30">
                    <button
                      onClick={() => { setSelectedBooker('all'); setFloatingBookerOpen(false); }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        selectedBooker === 'all' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      All Bookers
                    </button>
                    {sortedBookers.map(b => (
                      <button
                        key={b.id}
                        onClick={() => { setSelectedBooker(b.id); setFloatingBookerOpen(false); }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          selectedBooker === b.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={fetchReportData}
                disabled={loading}
                className="flex-shrink-0 ml-auto p-1.5 rounded-full text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <FiRefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Custom range popover */}
            {floatingCustomOpen && (
              <div
                ref={floatingCustomRef}
                className="mt-2.5 flex flex-wrap items-end gap-2.5 bg-gray-50 border border-gray-200 rounded-xl p-3"
              >
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Start Date</label>
                  <input
                    type="date"
                    className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={customInputs.startDate}
                    onChange={(e) => setCustomInputs(prev => ({ ...prev, startDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">End Date</label>
                  <input
                    type="date"
                    className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={customInputs.endDate}
                    onChange={(e) => setCustomInputs(prev => ({ ...prev, endDate: e.target.value }))}
                  />
                </div>
                <button onClick={applyFloatingCustomRange} className="btn-primary text-sm px-4 py-1.5">Apply</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scroll-to-top companion FAB */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-hidden={!showFloatingBar}
        title="Back to top"
        className={`fixed bottom-5 right-5 z-20 h-11 w-11 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 flex items-center justify-center transition-all duration-300 ease-out hover:bg-blue-700 hover:scale-105 active:scale-95 ${
          showFloatingBar ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'
        }`}
      >
        <FiArrowUp className="h-5 w-5" />
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Booker Performance</h1>
          <p className="text-sm text-gray-500 mt-1">
            Bookings, cancellations, show-ups and sales by booker
            {lastUpdated && (
              <span className="ml-2 text-green-600">• Updated {lastUpdated.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <button
          onClick={fetchReportData}
          disabled={loading}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <FiRefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Date range presets */}
      <div className="card" ref={filtersAnchorRef}>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: 'thisWeek', label: 'This Week' },
            { key: 'lastWeek', label: 'Last Week' },
            { key: 'thisMonth', label: 'This Month' },
            { key: 'custom', label: 'Custom' }
          ].map(p => (
            <button
              key={p.key}
              onClick={() => handlePreset(p.key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${datePreset === p.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {p.label}
            </button>
          ))}
          <span className="text-sm text-gray-500 w-full sm:w-auto sm:ml-2 mt-1 sm:mt-0">
            {dateRange.startDate} to {dateRange.endDate}
          </span>
        </div>
        {datePreset === 'custom' && (
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 mt-4">
            <div className="w-full sm:w-auto">
              <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={customInputs.startDate}
                onChange={(e) => setCustomInputs(prev => ({ ...prev, startDate: e.target.value }))}
              />
            </div>
            <div className="w-full sm:w-auto">
              <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={customInputs.endDate}
                onChange={(e) => setCustomInputs(prev => ({ ...prev, endDate: e.target.value }))}
              />
            </div>
            <button onClick={applyCustomRange} className="btn-primary w-full sm:w-auto">Apply</button>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center text-red-700 text-sm">
            <FiAlertTriangle className="h-4 w-4 mr-2" />
            {error}
          </div>
          <button onClick={fetchReportData} className="text-sm font-semibold text-red-700 hover:text-red-900">Retry</button>
        </div>
      )}

      {/* Loading (initial / date-range change) */}
      {loading && !data && (
        <div className="card text-center py-12">
          <FiRefreshCw className="mx-auto h-8 w-8 text-blue-500 animate-spin" />
          <p className="mt-2 text-sm text-gray-500">Loading report data...</p>
        </div>
      )}

      {/* No data at all in range */}
      {data && !hasAnyActivity && (
        <div className="card text-center py-12">
          <FiUsers className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No Activity Found</h3>
          <p className="mt-1 text-sm text-gray-500">No bookings, appointments or sales in this date range.</p>
        </div>
      )}

      {data && hasAnyActivity && (
        <>
          {/* Booker selector */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
            <button
              onClick={() => setSelectedBooker('all')}
              className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold ${selectedBooker === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              All Bookers
            </button>
            {sortedBookers.map(b => (
              <button
                key={b.id}
                onClick={() => setSelectedBooker(b.id)}
                className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold ${selectedBooker === b.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {b.name}
              </button>
            ))}
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {kpiCards.map(card => {
              const Icon = card.icon;
              const cls = colorClasses[card.color].split(' ');
              return (
                <div key={card.label} className={`card text-center bg-gradient-to-br ${cls[0]} ${cls[1]}`}>
                  <div className="flex items-center justify-center mb-2">
                    <Icon className={`h-6 w-6 ${cls[4]}`} />
                  </div>
                  <div className={`text-2xl font-bold ${cls[2]}`}>{card.value}</div>
                  <div className={`text-xs font-medium mt-1 ${cls[3]}`}>{card.label}</div>
                </div>
              );
            })}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Appointment Outcomes — {scopeName}</h3>
              {outcomePieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={outcomePieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {outcomePieData.map((entry) => (
                        <Cell key={entry.name} fill={OUTCOME_COLORS[entry.name]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name) => [value, name]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-16 text-sm text-gray-400">No outcome data yet for this period</div>
              )}
            </div>

            <div className="card">
              {selectedBooker === 'all' ? (
                <>
                  <h3 className="text-base font-semibold text-gray-900 mb-4">Bookings Made by Booker</h3>
                  {bookerShareData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={bookerShareData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={2}
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          {bookerShareData.map((entry, i) => (
                            <Cell key={entry.name} fill={BOOKER_COLORS[i % BOOKER_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value, name) => [value, name]} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-16 text-sm text-gray-400">No bookings yet for this period</div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                  <FiUsers className="h-10 w-10 text-blue-400 mb-3" />
                  <h3 className="text-base font-semibold text-gray-900">Viewing: {scopeName}</h3>
                  <p className="text-sm text-gray-500 mt-1">{scope.salesCount} sales · {formatCurrency(scope.revenue)} revenue</p>
                  <button
                    onClick={() => setSelectedBooker('all')}
                    className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-800"
                  >
                    ← Back to All Bookers
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Daily bookings bar chart */}
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Daily Bookings Made — {scopeName}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailyBarData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" name="Bookings Made" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Per-booker breakdown */}
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Booker Breakdown</h3>

            {/* Mobile: stacked cards, one per booker */}
            <div className="show-mobile space-y-3">
              {breakdownRows.map(row => (
                <div
                  key={row.id}
                  className={`rounded-lg border p-4 ${row.isTotal ? 'bg-gray-50 border-gray-300' : 'border-gray-200'}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-gray-900">{row.name}</span>
                    <span className="text-sm font-bold text-emerald-600">{formatCurrency(row.revenue)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Bookings Made</span>
                      <span className="font-semibold text-blue-600">{row.bookingsMade}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">On Calendar</span>
                      <span className="font-semibold text-indigo-600">{row.onCalendar}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Cancelled</span>
                      <span className="font-semibold text-red-600">{row.cancelled}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Showed</span>
                      <span className="font-semibold text-green-600">{row.showed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Show Rate</span>
                      <span className="font-semibold text-pink-600">{formatPercent(row.showRate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">No Show</span>
                      <span className="font-semibold text-orange-600">{row.noShow}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Pending</span>
                      <span className="font-semibold text-gray-600">{row.pending}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Sales</span>
                      <span className="font-semibold text-yellow-600">{row.salesCount}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tablet/desktop: full table */}
            <div className="hide-mobile overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Booker</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bookings Made</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">On Calendar</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cancelled</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Showed</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Show Rate</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">No Show</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pending</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sales</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {breakdownRows.map(row => (
                    <tr key={row.id} className={row.isTotal ? 'bg-gray-50 font-bold' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">{row.name}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-600 font-semibold">{row.bookingsMade}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-indigo-600 font-semibold">{row.onCalendar}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-red-600 font-semibold">{row.cancelled}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-green-600 font-semibold">{row.showed}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-pink-600 font-semibold">{formatPercent(row.showRate)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-orange-600 font-semibold">{row.noShow}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 font-semibold">{row.pending}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-yellow-600 font-semibold">{row.salesCount}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-emerald-600 font-semibold">{formatCurrency(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sales detail */}
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-1 flex items-center">
              <FiDollarSign className="h-5 w-5 mr-2 text-green-600" />
              Sales — {scopeName}
            </h3>
            {salesRows.length > 0 && <p className="show-mobile text-xs text-gray-400 mb-3">Swipe to see more →</p>}
            {salesRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lead</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Booker</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {salesRows.map(sale => (
                      <tr key={sale.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">{sale.leadName}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-green-600 font-bold">{formatCurrency(sale.amount)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{sale.bookerName}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          {new Date(sale.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FiDollarSign className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No sales for this selection</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Reports;
