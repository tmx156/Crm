// Calendar WebWorker for Heavy Processing
// Offloads intensive calculations from main thread

self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'PROCESS_EVENTS':
      processEvents(data);
      break;
    case 'CALCULATE_STATISTICS':
      calculateStatistics(data);
      break;
    case 'FILTER_EVENTS':
      filterEvents(data);
      break;
    case 'CLUSTER_EVENTS':
      clusterEvents(data);
      break;
    default:
      console.warn('Unknown worker task:', type);
  }
};

// Process raw lead data into calendar events
function processEvents({ leads, colorMapping = {} }) {
  const startTime = performance.now();

  try {
    const processedEvents = leads.map(lead => {
      // Parse booking history
      let bookingHistory = [];
      let hasUnreadMessages = false;

      try {
        if (lead.booking_history) {
          bookingHistory = JSON.parse(lead.booking_history);
          hasUnreadMessages = bookingHistory.some(h =>
            h.action === 'SMS_RECEIVED' && !h.details?.read
          );
        }
      } catch (err) {
        console.warn('Failed to parse booking history for lead:', lead.id);
      }

      // Determine event color
      const eventColor = getEventColor(lead.status, lead.has_sale, colorMapping);

      return {
        id: lead.id || `lead-${lead._id}`,
        title: lead.name || 'Unnamed Lead',
        start: lead.date_booked,
        backgroundColor: eventColor,
        borderColor: eventColor,
        textColor: '#ffffff',
        extendedProps: {
          lead: lead,
          status: lead.status,
          phone: lead.phone,
          email: lead.email,
          notes: lead.notes,
          bookingHistory,
          hasUnreadMessages,
          hasUnreadCount: bookingHistory.filter(h =>
            h.action === 'SMS_RECEIVED' && !h.details?.read
          ).length
        }
      };
    });

    const duration = performance.now() - startTime;

    self.postMessage({
      type: 'EVENTS_PROCESSED',
      data: processedEvents,
      meta: {
        duration: Math.round(duration),
        count: processedEvents.length
      }
    });

  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      error: error.message
    });
  }
}

// Calculate calendar statistics
function calculateStatistics({ events }) {
  const startTime = performance.now();

  const stats = {
    total: events.length,
    byStatus: {},
    byDate: {},
    byBooker: {},
    unreadMessages: 0,
    conversionRate: 0
  };

  let completedCount = 0;
  let bookedCount = 0;

  events.forEach(event => {
    const lead = event.extendedProps?.lead;
    if (!lead) return;

    // Status distribution
    const status = lead.status || 'Unknown';
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

    // Date distribution
    if (event.start) {
      const date = event.start.split('T')[0]; // YYYY-MM-DD
      stats.byDate[date] = (stats.byDate[date] || 0) + 1;
    }

    // Booker distribution
    if (lead.booker_id) {
      stats.byBooker[lead.booker_id] = (stats.byBooker[lead.booker_id] || 0) + 1;
    }

    // Unread messages
    if (event.extendedProps.hasUnreadMessages) {
      stats.unreadMessages += event.extendedProps.hasUnreadCount || 1;
    }

    // Conversion tracking
    if (lead.status === 'Attended' || lead.status === 'Complete') {
      completedCount++;
    }
    if (lead.status === 'Booked') {
      bookedCount++;
    }
  });

  // Calculate conversion rate
  if (bookedCount > 0) {
    stats.conversionRate = Math.round((completedCount / bookedCount) * 100);
  }

  const duration = performance.now() - startTime;

  self.postMessage({
    type: 'STATISTICS_CALCULATED',
    data: stats,
    meta: {
      duration: Math.round(duration)
    }
  });
}

// Advanced event filtering
function filterEvents({ events, filters }) {
  const startTime = performance.now();

  const filtered = events.filter(event => {
    const lead = event.extendedProps?.lead;
    if (!lead) return false;

    // Status filter
    if (filters.status && filters.status.length > 0) {
      if (!filters.status.includes(lead.status)) return false;
    }

    // Date range filter
    if (filters.dateRange) {
      const eventDate = new Date(event.start);
      const startDate = new Date(filters.dateRange.start);
      const endDate = new Date(filters.dateRange.end);

      if (eventDate < startDate || eventDate > endDate) return false;
    }

    // Booker filter
    if (filters.bookerId && lead.booker_id !== filters.bookerId) {
      return false;
    }

    // Text search
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      const searchableText = [
        lead.name,
        lead.phone,
        lead.email,
        lead.notes
      ].filter(Boolean).join(' ').toLowerCase();

      if (!searchableText.includes(searchLower)) return false;
    }

    // Has unread messages filter
    if (filters.hasUnreadMessages === true) {
      if (!event.extendedProps.hasUnreadMessages) return false;
    }

    return true;
  });

  const duration = performance.now() - startTime;

  self.postMessage({
    type: 'EVENTS_FILTERED',
    data: filtered,
    meta: {
      duration: Math.round(duration),
      originalCount: events.length,
      filteredCount: filtered.length
    }
  });
}

// Event clustering for performance
function clusterEvents({ events, clusterDistance = 50 }) {
  const startTime = performance.now();

  // Group events by date first
  const eventsByDate = {};
  events.forEach(event => {
    const date = event.start?.split('T')[0];
    if (date) {
      if (!eventsByDate[date]) eventsByDate[date] = [];
      eventsByDate[date].push(event);
    }
  });

  const clustered = [];

  Object.entries(eventsByDate).forEach(([date, dayEvents]) => {
    if (dayEvents.length <= clusterDistance) {
      // Don't cluster if under threshold
      clustered.push(...dayEvents);
    } else {
      // Create cluster event
      const clusterEvent = {
        id: `cluster-${date}`,
        title: `${dayEvents.length} events`,
        start: `${date}T09:00:00`,
        backgroundColor: '#6b7280',
        borderColor: '#6b7280',
        textColor: '#ffffff',
        extendedProps: {
          isCluster: true,
          eventCount: dayEvents.length,
          events: dayEvents,
          lead: {
            name: `${dayEvents.length} events on ${date}`
          }
        }
      };
      clustered.push(clusterEvent);
    }
  });

  const duration = performance.now() - startTime;

  self.postMessage({
    type: 'EVENTS_CLUSTERED',
    data: clustered,
    meta: {
      duration: Math.round(duration),
      originalCount: events.length,
      clusteredCount: clustered.length,
      compressionRatio: Math.round((1 - clustered.length / events.length) * 100)
    }
  });
}

// Event color logic (same as main thread)
function getEventColor(status, hasSale = false, colorMapping = {}) {
  if (colorMapping[status]) return colorMapping[status];
  if (hasSale) return '#2563eb';

  switch (status?.toLowerCase()) {
    case 'new':
    case 'unconfirmed':
      return '#ea580c';
    case 'confirmed':
    case 'attended':
    case 'complete':
    case 'interested':
      return '#059669';
    case 'booked':
      return '#1e40af';
    case 'arrived':
    case 'assigned':
    case 'callback':
      return '#7c3aed';
    case 'on show':
    case 'rescheduled':
    case 'reschedule':
      return '#d97706';
    case 'no sale':
    case 'cancelled':
    case 'not interested':
      return '#dc2626';
    case 'no show':
      return '#92400e';
    case 'contacted':
      return '#0891b2';
    case 'unassigned':
    default:
      return '#6b7280';
  }
}