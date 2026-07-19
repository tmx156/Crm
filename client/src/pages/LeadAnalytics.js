import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  FiUsers, FiDollarSign, FiTarget, FiTrendingUp,
  FiRefreshCw, FiAlertTriangle, FiBarChart
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

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

function getLastMonthDates() {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfLastMonth = new Date(firstOfThisMonth);
  lastOfLastMonth.setDate(0); // day 0 of this month = last day of prior month
  const firstOfLastMonth = new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), 1);
  return { startDate: toISODate(firstOfLastMonth), endDate: toISODate(lastOfLastMonth) };
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(amount || 0);
}

function formatPercent(v) {
  return v === null || v === undefined ? '-' : `${v}%`;
}

const LeadAnalytics = () => {
  const { user } = useAuth();

  const [dateRange, setDateRange] = useState(() => getLastMonthDates());
  const [datePreset, setDatePreset] = useState('lastMonth');
  const [customInputs, setCustomInputs] = useState(() => getLastMonthDates());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const isAdmin = user?.role === 'admin';

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get('/api/lead-analytics/summary', {
        params: { startDate: dateRange.startDate, endDate: dateRange.endDate }
      });
      setData(response.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching lead analytics:', err);
      setError(err.response?.data?.message || 'Failed to load lead analytics');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, dateRange]);

  const handlePreset = (preset) => {
    setDatePreset(preset);
    if (preset === 'thisWeek') setDateRange(getThisWeekDates());
    else if (preset === 'lastWeek') setDateRange(getLastWeekDates());
    else if (preset === 'thisMonth') setDateRange(getThisMonthDates());
    else if (preset === 'lastMonth') setDateRange(getLastMonthDates());
    else if (preset === 'custom') setCustomInputs(dateRange);
  };

  const applyCustomRange = () => {
    setDateRange(customInputs);
  };

  const colorClasses = {
    blue: 'from-blue-50 to-blue-100 text-blue-900 text-blue-700 text-blue-600',
    green: 'from-green-50 to-green-100 text-green-900 text-green-700 text-green-600',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900 text-emerald-700 text-emerald-600',
    pink: 'from-pink-50 to-pink-100 text-pink-900 text-pink-700 text-pink-600'
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <FiUsers className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access Denied</h3>
          <p className="mt-1 text-sm text-gray-500">Only administrators can access lead analytics.</p>
        </div>
      </div>
    );
  }

  const hasAnyActivity = data && (data.summary.totalLeads + data.summary.totalSales) > 0;

  const kpiCards = data ? [
    { label: 'Total Leads', value: data.summary.totalLeads, icon: FiUsers, color: 'blue' },
    { label: 'Total Sales', value: data.summary.totalSales, icon: FiDollarSign, color: 'green' },
    { label: 'Total Revenue', value: formatCurrency(data.summary.totalRevenue), icon: FiTrendingUp, color: 'emerald' },
    { label: 'Conversion Rate', value: formatPercent(data.summary.conversionRate), sublabel: `of ${data.summary.arrivedLeads} arrived`, icon: FiTarget, color: 'pink' }
  ] : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Lead Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Leads and sales by age bracket and postcode area
            {lastUpdated && (
              <span className="ml-2 text-green-600">• Updated {lastUpdated.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <FiRefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Date range presets */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: 'thisWeek', label: 'This Week' },
            { key: 'lastWeek', label: 'Last Week' },
            { key: 'thisMonth', label: 'This Month' },
            { key: 'lastMonth', label: 'Last Month' },
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
          <button onClick={fetchData} className="text-sm font-semibold text-red-700 hover:text-red-900">Retry</button>
        </div>
      )}

      {/* Loading (initial / date-range change) */}
      {loading && !data && (
        <div className="card text-center py-12">
          <FiRefreshCw className="mx-auto h-8 w-8 text-blue-500 animate-spin" />
          <p className="mt-2 text-sm text-gray-500">Loading lead analytics...</p>
        </div>
      )}

      {/* No data at all in range */}
      {data && !hasAnyActivity && (
        <div className="card text-center py-12">
          <FiUsers className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No Activity Found</h3>
          <p className="mt-1 text-sm text-gray-500">No leads or sales in this date range.</p>
        </div>
      )}

      {data && hasAnyActivity && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
                  {card.sublabel && <div className="text-xs text-gray-400 mt-0.5">{card.sublabel}</div>}
                </div>
              );
            })}
          </div>

          {/* Age bracket chart */}
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center">
              <FiBarChart className="h-5 w-5 mr-2 text-blue-600" />
              Leads &amp; Sales by Age Bracket
            </h3>
            <div className="overflow-x-auto">
              <div style={{ minWidth: data.byAge.length * 70 }}>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.byAge}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="bracket" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="leads" name="Leads" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="sales" name="Sales" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Age bracket table */}
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Age Bracket Breakdown</h3>

            {/* Mobile: stacked cards */}
            <div className="show-mobile space-y-3">
              {data.byAge.map(row => (
                <div key={row.bracket} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-gray-900">{row.bracket}</span>
                    <span className="text-sm font-bold text-emerald-600">{formatCurrency(row.revenue)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Leads</span>
                      <span className="font-semibold text-blue-600">{row.leads}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Sales</span>
                      <span className="font-semibold text-green-600">{row.sales}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Conversion</span>
                      <span className="font-semibold text-pink-600">{formatPercent(row.conversionRate)}</span>
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Age Bracket</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Leads</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sales</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Conversion Rate</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.byAge.map(row => (
                    <tr key={row.bracket} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">{row.bracket}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-600 font-semibold">{row.leads}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-green-600 font-semibold">{row.sales}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-emerald-600 font-semibold">{formatCurrency(row.revenue)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-pink-600 font-semibold">{formatPercent(row.conversionRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Postcode area chart */}
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center">
              <FiBarChart className="h-5 w-5 mr-2 text-blue-600" />
              Leads &amp; Sales by Postcode Area (Top 12)
            </h3>
            <div className="overflow-x-auto">
              <div style={{ minWidth: data.byArea.length * 70 }}>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.byArea}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="area" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="leads" name="Leads" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="sales" name="Sales" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Postcode area table */}
          <div className="card">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Postcode Area Breakdown</h3>

            {/* Mobile: stacked cards */}
            <div className="show-mobile space-y-3">
              {data.byArea.map(row => (
                <div key={row.area} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-gray-900">{row.area}</span>
                    <span className="text-sm font-bold text-emerald-600">{formatCurrency(row.revenue)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Leads</span>
                      <span className="font-semibold text-blue-600">{row.leads}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Sales</span>
                      <span className="font-semibold text-green-600">{row.sales}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Conversion</span>
                      <span className="font-semibold text-pink-600">{formatPercent(row.conversionRate)}</span>
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Area</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Leads</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sales</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Conversion Rate</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.byArea.map(row => (
                    <tr key={row.area} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">{row.area}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-600 font-semibold">{row.leads}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-green-600 font-semibold">{row.sales}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-emerald-600 font-semibold">{formatCurrency(row.revenue)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-pink-600 font-semibold">{formatPercent(row.conversionRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.otherAreasCount > 0 && (
              <p className="text-xs text-gray-400 mt-3">
                +{data.otherAreasCount} more areas ({data.otherAreasLeads} leads)
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default LeadAnalytics;
