import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FiRefreshCw, FiCalendar, FiAlertTriangle } from 'react-icons/fi';
import axios from 'axios';
import { useSocket } from '../context/SocketContext';

// Days run 8am to 8am UK time to match the ad account; the server owns that
// logic. Here a "day" is the calendar date its 8am window starts on.

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

function pct(n, of) {
  return of ? `${Math.round((n * 100) / of)}%` : '';
}

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Pick dates' }
];

function rangeDates(key, today, custom) {
  switch (key) {
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'last7': return { from: addDays(today, -7), to: addDays(today, -1) };
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today };
    case 'custom': return custom;
    default: return { from: today, to: today };
  }
}

function BarRow({ label, count, of, max, color = 'bg-blue-600', labelWidth = 'w-28' }) {
  const width = max ? Math.max(2, Math.round((count * 100) / max)) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`${labelWidth} shrink-0 truncate text-gray-700`} title={label}>{label}</span>
      <div className="flex-1 h-3.5 bg-gray-100 rounded-md overflow-hidden">
        <div className={`h-full rounded-md ${color}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right font-semibold text-gray-900">
        {count} <span className="font-normal text-gray-500">{of !== undefined ? pct(count, of) : ''}</span>
      </span>
    </div>
  );
}

function Card({ title, aside, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {aside && <span className="text-xs text-gray-500">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

const LeadReport = () => {
  const { socket } = useSocket();
  const [rangeKey, setRangeKey] = useState('today');
  const [today, setToday] = useState(null);
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Until the server has told us which 8am day "today" is, ask for its default.
  const { from, to } = today ? rangeDates(rangeKey, today, custom) : { from: '', to: '' };

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const response = await axios.get('/api/lead-report', { params });
      setData(response.data);
      if (!today) {
        setToday(response.data.range.today);
        setCustom({ from: response.data.range.today, to: response.data.range.today });
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [from, to, today]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // New webhook leads refresh the report live.
  useEffect(() => {
    if (!socket?.on) return undefined;
    const onLead = (payload) => {
      if (payload?.action === 'created') fetchReport();
    };
    socket.on('lead_updated', onLead);
    return () => socket.off && socket.off('lead_updated', onLead);
  }, [socket, fetchReport]);

  const s = data?.summary;
  const change = s && s.previousTotal ? Math.round(((s.total - s.previousTotal) * 100) / s.previousTotal) : null;
  const windowText = data
    ? (data.range.from === data.range.to
      ? `8am ${formatDay(data.range.from)} to 8am ${formatDay(addDays(data.range.to, 1))}`
      : `8am ${formatDay(data.range.from)} to 8am ${formatDay(addDays(data.range.to, 1))} (${data.range.days} days)`)
    : '';

  const kpis = s ? [
    {
      label: 'Leads',
      value: s.total,
      sub: change === null ? `${s.previousTotal} in the period before` : `${change >= 0 ? '+' : ''}${change}% vs the period before`,
      subClass: change === null ? 'text-gray-500' : change >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'
    },
    { label: 'Average miles away', value: s.avgMiles === null ? '–' : `${s.avgMiles} mi`, sub: s.medianMiles === null ? 'No postcodes found' : `Median ${s.medianMiles} mi`, subClass: 'text-gray-500' },
    { label: 'Within 50 miles', value: s.within50, sub: `${pct(s.within50, s.located)} of leads with a postcode`, subClass: 'text-gray-500' },
    { label: 'Over 150 miles', value: s.over150, sub: `${pct(s.over150, s.located)} probably too far to attend`, subClass: 'text-amber-700' },
    { label: 'Average age', value: s.avgAge === null ? '–' : s.avgAge, sub: 'Of leads who gave an age', subClass: 'text-gray-500' },
    { label: 'Booked so far', value: s.booked, sub: `${pct(s.booked, s.total)} of these leads`, subClass: 'text-gray-500' }
  ] : [];

  const maxOf = (list) => Math.max(0, ...(list || []).map((x) => x.count));
  const dailyMax = maxOf(data?.daily);
  const hourMax = maxOf(data?.hours);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lead Report</h1>
          <p className="text-sm text-gray-600 mt-1">
            Website leads from the webhook. Each day runs <strong className="text-gray-900">8am to 8am UK time</strong>, matching the ad account.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRangeKey(r.key)}
              className={`min-h-[44px] px-4 rounded-lg text-sm font-semibold border transition-colors ${
                rangeKey === r.key ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={fetchReport}
            aria-label="Refresh"
            className="min-h-[44px] px-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            <FiRefreshCw className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {rangeKey === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-xl p-4">
          <label className="flex flex-col text-sm text-gray-700 gap-1">
            First day
            <input type="date" value={custom.from} max={today || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2" />
          </label>
          <label className="flex flex-col text-sm text-gray-700 gap-1">
            Last day
            <input type="date" value={custom.to} max={today || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              className="border border-gray-300 rounded-lg px-3 py-2" />
          </label>
          <span className="text-xs text-gray-500 pb-2">Each day starts at 8am on the date picked.</span>
        </div>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
          <FiCalendar className="text-blue-700" aria-hidden="true" />
          <span>Showing <strong>{windowText}</strong>. Distances are measured from the studio, <strong>M12 6DA</strong>.</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <FiAlertTriangle aria-hidden="true" /> {error}
        </div>
      )}

      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {kpis.map((k) => (
              <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-1.5">
                <span className="text-sm font-medium text-gray-600">{k.label}</span>
                <span className="text-3xl font-bold text-gray-900 tracking-tight">{k.value}</span>
                <span className={`text-xs ${k.subClass}`}>{k.sub}</span>
              </div>
            ))}
          </div>

          <Card title={`Leads per day, last ${data.daily.length} days`} aside="Each bar is one 8am to 8am day. Dark bars are the selected days.">
            <div className="overflow-x-auto">
              <div className="flex items-end gap-2 h-56 min-w-[640px] pt-5">
                {data.daily.map((d) => (
                  <div key={d.day} className="flex-1 h-full flex flex-col items-center justify-end gap-1.5">
                    <span className="text-xs font-semibold text-gray-900">{d.count}</span>
                    <div
                      className={`w-full max-w-[44px] rounded-t-md ${d.selected ? 'bg-blue-900' : 'bg-blue-300'}`}
                      style={{ height: `${dailyMax ? Math.max(2, Math.round((d.count * 150) / dailyMax)) : 2}px` }}
                    />
                    <span className="text-[11px] text-gray-500 whitespace-nowrap">{formatDay(d.day)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Distance from M12 6DA">
              <div className="flex flex-wrap gap-5 text-sm text-gray-600">
                <span>Average <strong className="text-gray-900">{s.avgMiles ?? '–'} mi</strong></span>
                <span>Median <strong className="text-gray-900">{s.medianMiles ?? '–'} mi</strong></span>
                <span>Closest <strong className="text-gray-900">{s.minMiles ?? '–'} mi</strong></span>
                <span>Furthest <strong className="text-gray-900">{s.maxMiles ?? '–'} mi</strong></span>
                <span>Postcode found <strong className="text-gray-900">{s.located} of {s.total}</strong></span>
              </div>
              {data.distanceBands.map((b, i) => (
                <BarRow key={b.label} label={b.label} count={b.count} of={s.located} max={maxOf(data.distanceBands)}
                  color={i === data.distanceBands.length - 1 ? 'bg-amber-600' : 'bg-blue-600'} />
              ))}
            </Card>

            <Card title="Which ad they came from">
              {data.sources.length === 0 && <p className="text-sm text-gray-500">No leads in this period.</p>}
              {data.sources.map((b) => (
                <BarRow key={b.label} label={b.label} count={b.count} of={s.total} max={maxOf(data.sources)} />
              ))}
            </Card>

            <Card title="Age" aside={s.avgAge !== null ? `Average ${s.avgAge}` : undefined}>
              {data.ages.length === 0 && <p className="text-sm text-gray-500">No leads in this period.</p>}
              {data.ages.map((b) => (
                <BarRow key={b.label} label={b.label} count={b.count} of={s.total} max={maxOf(data.ages)} />
              ))}
            </Card>

            <Card title="Top areas">
              {data.areas.length === 0 && <p className="text-sm text-gray-500">No postcodes found in this period.</p>}
              {data.areas.map((b) => (
                <BarRow key={b.label} label={b.label} count={b.count} max={maxOf(data.areas)} labelWidth="w-44" />
              ))}
            </Card>
          </div>

          <Card title="What time leads come in" aside="UK time">
            <div className="overflow-x-auto">
              <div className="flex items-end gap-1 h-36 min-w-[640px]">
                {data.hours.map((h) => (
                  <div key={h.hour} className="flex-1 h-full flex flex-col items-center justify-end gap-1" title={`${h.count} leads`}>
                    <div
                      className="w-full rounded-t bg-blue-400"
                      style={{ height: `${hourMax ? Math.max(3, Math.round((h.count * 110) / hourMax)) : 3}px` }}
                    />
                    <span className="text-[10px] text-gray-500">{h.hour}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card title={`Leads in this period (${data.leads.length})`} aside="Over 150 miles is flagged, like the upload pop-up">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2.5 px-2 font-semibold">Time</th>
                    <th className="py-2.5 px-2 font-semibold">Name</th>
                    <th className="py-2.5 px-2 font-semibold">Age</th>
                    <th className="py-2.5 px-2 font-semibold">Postcode</th>
                    <th className="py-2.5 px-2 font-semibold">Miles</th>
                    <th className="py-2.5 px-2 font-semibold">Ad</th>
                    <th className="py-2.5 px-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leads.map((l) => (
                    <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 px-2 text-gray-600 whitespace-nowrap">{l.createdAt ? formatTime(l.createdAt) : '–'}</td>
                      <td className="py-2.5 px-2 font-medium">
                        <Link to={`/leads/${l.id}`} className="text-blue-700 hover:text-blue-900">{l.name}</Link>
                      </td>
                      <td className="py-2.5 px-2">{l.age ?? '–'}</td>
                      <td className="py-2.5 px-2">{l.postcode || '–'}</td>
                      <td className="py-2.5 px-2">
                        {l.miles === null ? '–' : l.miles > 150
                          ? <span className="bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded-full">{l.miles} mi</span>
                          : `${l.miles} mi`}
                      </td>
                      <td className="py-2.5 px-2">{l.source}</td>
                      <td className="py-2.5 px-2">{l.status}</td>
                    </tr>
                  ))}
                  {data.leads.length === 0 && (
                    <tr><td colSpan={7} className="py-6 text-center text-gray-500">No website leads in this period yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default LeadReport;
