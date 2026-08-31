import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import axios from 'axios';

// Optimized Calendar with pagination and incremental loading
const OptimizedCalendar = ({
  onEventClick,
  onDateSelect,
  onViewChange,
  initialView = 'dayGridMonth',
  pageSize = 200
}) => {
  const [events, setEvents] = useState([]);
  const [loadedRanges, setLoadedRanges] = useState(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [totalEvents, setTotalEvents] = useState(0);

  const calendarRef = useRef(null);
  const lastFetchRef = useRef(0);
  const abortControllerRef = useRef(null);

  // Debounced fetch function to prevent excessive API calls
  const debouncedFetch = useCallback(async (start, end, force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 1000) {
      return; // Debounce to max 1 call per second
    }

    // Cancel previous request if still running
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      setIsLoading(true);
      setError(null);
      lastFetchRef.current = now;

      const startStr = start.toISOString();
      const endStr = end.toISOString();
      const rangeKey = `${startStr}-${endStr}`;

      // Check if we already have this range loaded
      if (loadedRanges.has(rangeKey) && !force) {
        setIsLoading(false);
        return;
      }

      console.log(`📅 Fetching events for range: ${start.toDateString()} - ${end.toDateString()}`);

      const response = await axios.get('/api/leads/calendar', {
        params: {
          start: startStr,
          end: endStr,
          limit: pageSize,
          page: 1
        },
        signal
      });

      if (response.data && response.data.leads) {
        const newEvents = response.data.leads.map(lead => ({
          id: lead.id || `lead-${lead._id}`,
          title: lead.name || 'Unnamed Lead',
          start: lead.date_booked,
          extendedProps: {
            lead: lead,
            status: lead.status,
            phone: lead.phone,
            email: lead.email,
            notes: lead.notes,
            hasUnreadMessages: lead.booking_history &&
              JSON.parse(lead.booking_history || '[]').some(h =>
                h.action === 'SMS_RECEIVED' && !h.details?.read
              )
          },
          backgroundColor: getEventColor(lead.status, lead.has_sale),
          borderColor: getEventColor(lead.status, lead.has_sale),
          textColor: '#ffffff'
        }));

        // Store the loaded range
        setLoadedRanges(prev => new Map(prev).set(rangeKey, true));

        // Merge new events with existing ones (avoid duplicates)
        setEvents(prev => {
          const existingIds = new Set(prev.map(e => e.id));
          const uniqueNewEvents = newEvents.filter(e => !existingIds.has(e.id));
          return [...prev, ...uniqueNewEvents];
        });

        setTotalEvents(response.data.total || response.data.leads.length);
        console.log(`📅 Loaded ${newEvents.length} events (Total: ${response.data.total || response.data.leads.length})`);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error fetching calendar events:', err);
        setError('Failed to load calendar events');
      }
    } finally {
      setIsLoading(false);
    }
  }, [pageSize]);

  // Event color function (extracted from original Calendar.js)
  const getEventColor = useCallback((status, hasSale = false) => {
    if (hasSale) return '#2563eb'; // blue for leads with a sale

    switch (status?.toLowerCase()) {
      case 'new':
      case 'unconfirmed':
        return '#ea580c'; // orange
      case 'confirmed':
      case 'attended':
      case 'complete':
      case 'interested':
        return '#059669'; // green
      case 'booked':
        return '#1e40af'; // blue
      case 'arrived':
      case 'assigned':
      case 'callback':
        return '#7c3aed'; // purple
      case 'on show':
      case 'rescheduled':
      case 'reschedule':
        return '#d97706'; // amber
      case 'no sale':
      case 'cancelled':
      case 'not interested':
        return '#dc2626'; // red
      case 'no show':
        return '#92400e'; // brown
      case 'contacted':
        return '#0891b2'; // cyan
      case 'unassigned':
        return '#6b7280'; // gray
      default:
        return '#6b7280'; // gray
    }
  }, []);

  // Handle date range changes (when user navigates calendar)
  const handleDatesSet = useCallback((dateInfo) => {
    const { start, end } = dateInfo;
    debouncedFetch(start, end);

    if (onViewChange) {
      onViewChange(dateInfo);
    }
  }, [debouncedFetch, onViewChange]);

  // Clear cache when needed
  const clearCache = useCallback(() => {
    setLoadedRanges(new Map());
    setEvents([]);
  }, []);

  // Refresh current view
  const refresh = useCallback((force = false) => {
    const calendarApi = calendarRef.current?.getApi();
    if (calendarApi) {
      const { start, end } = calendarApi.view;
      if (force) {
        clearCache();
      }
      debouncedFetch(start, end, force);
    }
  }, [debouncedFetch, clearCache]);

  // Memoize calendar options for performance
  const calendarOptions = useMemo(() => ({
    plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin],
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
    },
    initialView,
    height: 'auto',
    events,
    eventClick: (info) => {
      if (onEventClick) {
        onEventClick(info);
      }
    },
    select: (info) => {
      if (onDateSelect) {
        onDateSelect(info);
      }
    },
    datesSet: handleDatesSet,
    selectable: true,
    selectMirror: true,
    dayMaxEvents: 3,
    eventMaxStack: 5,
    progressiveEventRendering: true,
    lazyFetching: false,
    eventDisplay: 'block',
    displayEventTime: true,
    eventTimeFormat: {
      hour: 'numeric',
      minute: '2-digit',
      meridiem: 'short'
    },
    // Performance optimizations
    aspectRatio: window.innerWidth < 768 ? 1.0 : 1.35,
    handleWindowResize: true,
    stickyHeaderDates: true,
    // List view optimizations
    views: {
      listWeek: {
        listDayFormat: { weekday: 'long' }
      }
    }
  }), [events, handleDatesSet, onEventClick, onDateSelect, initialView]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="optimized-calendar">
      {isLoading && (
        <div className="calendar-loading">
          <div className="flex items-center justify-center p-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="ml-2 text-sm text-gray-600">Loading events...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="calendar-error bg-red-50 border border-red-200 p-3 rounded-lg mb-4">
          <div className="flex items-center">
            <span className="text-red-600 text-sm">{error}</span>
            <button
              onClick={() => refresh(true)}
              className="ml-2 text-xs bg-red-600 text-white px-2 py-1 rounded"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="calendar-stats text-xs text-gray-500 mb-2">
        {totalEvents > 0 && (
          <span>Showing {events.length} of {totalEvents} total events</span>
        )}
        {loadedRanges.size > 0 && (
          <span className="ml-4">{loadedRanges.size} date ranges cached</span>
        )}
      </div>

      <FullCalendar
        ref={calendarRef}
        {...calendarOptions}
      />
    </div>
  );
};

export default React.memo(OptimizedCalendar);