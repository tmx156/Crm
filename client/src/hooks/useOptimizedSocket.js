import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';
import { recordCustomMetric } from '../utils/PerformanceMonitor';

// Optimized Socket Hook for Calendar Updates
export const useOptimizedSocket = (calendarRef, setEvents) => {
  const { socket, isConnected } = useSocket();
  const updateQueueRef = useRef([]);
  const batchTimeoutRef = useRef(null);
  const lastUpdateRef = useRef(0);

  // Debounced batch update function
  const processBatchedUpdates = useCallback(() => {
    if (updateQueueRef.current.length === 0) return;

    const updates = [...updateQueueRef.current];
    updateQueueRef.current = [];

    const startTime = performance.now();

    // Group updates by type for efficient processing
    const groupedUpdates = updates.reduce((acc, update) => {
      if (!acc[update.type]) acc[update.type] = [];
      acc[update.type].push(update);
      return acc;
    }, {});

    console.log(`🔄 Processing ${updates.length} batched socket updates`);

    // Process each type of update
    Object.entries(groupedUpdates).forEach(([type, typeUpdates]) => {
      switch (type) {
        case 'LEAD_UPDATED':
          handleBatchedLeadUpdates(typeUpdates);
          break;
        case 'LEAD_CREATED':
          handleBatchedLeadCreates(typeUpdates);
          break;
        case 'LEAD_DELETED':
          handleBatchedLeadDeletes(typeUpdates);
          break;
        case 'STATUS_CHANGED':
          handleBatchedStatusChanges(typeUpdates);
          break;
        default:
          console.log(`Unknown update type: ${type}`);
      }
    });

    const duration = performance.now() - startTime;
    recordCustomMetric('socketBatchUpdate', {
      updateCount: updates.length,
      duration,
      types: Object.keys(groupedUpdates)
    });

    lastUpdateRef.current = Date.now();
  }, []);

  // Queue update for batching
  const queueUpdate = useCallback((update) => {
    updateQueueRef.current.push(update);

    // Clear existing timeout
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current);
    }

    // Batch updates over 100ms window
    batchTimeoutRef.current = setTimeout(processBatchedUpdates, 100);
  }, [processBatchedUpdates]);

  // Handle batched lead updates
  const handleBatchedLeadUpdates = useCallback((updates) => {
    const leadUpdates = new Map();

    // Merge multiple updates to same lead
    updates.forEach(({ data: lead }) => {
      if (lead && lead.id) {
        leadUpdates.set(lead.id, lead);
      }
    });

    if (leadUpdates.size === 0) return;

    setEvents(prevEvents => {
      const newEvents = [...prevEvents];
      let hasChanges = false;

      leadUpdates.forEach((lead, leadId) => {
        const eventIndex = newEvents.findIndex(e => e.id === leadId);

        if (eventIndex >= 0) {
          // Update existing event
          const oldEvent = newEvents[eventIndex];
          const updatedEvent = {
            ...oldEvent,
            title: lead.name || oldEvent.title,
            start: lead.date_booked || oldEvent.start,
            backgroundColor: getEventColor(lead.status, lead.has_sale),
            borderColor: getEventColor(lead.status, lead.has_sale),
            extendedProps: {
              ...oldEvent.extendedProps,
              lead: { ...oldEvent.extendedProps.lead, ...lead },
              status: lead.status || oldEvent.extendedProps.status
            }
          };

          newEvents[eventIndex] = updatedEvent;
          hasChanges = true;

          console.log(`📝 Updated event: ${lead.name} (${lead.status})`);
        }
      });

      return hasChanges ? newEvents : prevEvents;
    });
  }, [setEvents]);

  // Handle batched lead creates
  const handleBatchedLeadCreates = useCallback((updates) => {
    const newLeads = updates
      .map(({ data: lead }) => lead)
      .filter(lead => lead && lead.date_booked); // Only booked leads appear on calendar

    if (newLeads.length === 0) return;

    setEvents(prevEvents => {
      const existingIds = new Set(prevEvents.map(e => e.id));
      const newEvents = newLeads
        .filter(lead => !existingIds.has(lead.id))
        .map(lead => ({
          id: lead.id,
          title: lead.name || 'Unnamed Lead',
          start: lead.date_booked,
          backgroundColor: getEventColor(lead.status, lead.has_sale),
          borderColor: getEventColor(lead.status, lead.has_sale),
          textColor: '#ffffff',
          extendedProps: {
            lead,
            status: lead.status
          }
        }));

      if (newEvents.length > 0) {
        console.log(`➕ Added ${newEvents.length} new events`);
        return [...prevEvents, ...newEvents];
      }

      return prevEvents;
    });
  }, [setEvents]);

  // Handle batched lead deletes
  const handleBatchedLeadDeletes = useCallback((updates) => {
    const deletedIds = new Set(updates.map(({ data }) => data.leadId || data.id));

    if (deletedIds.size === 0) return;

    setEvents(prevEvents => {
      const filtered = prevEvents.filter(event => !deletedIds.has(event.id));

      if (filtered.length !== prevEvents.length) {
        console.log(`🗑️ Removed ${prevEvents.length - filtered.length} events`);
        return filtered;
      }

      return prevEvents;
    });
  }, [setEvents]);

  // Handle batched status changes
  const handleBatchedStatusChanges = useCallback((updates) => {
    const statusUpdates = new Map();

    updates.forEach(({ data }) => {
      if (data.leadId && data.newStatus) {
        statusUpdates.set(data.leadId, data.newStatus);
      }
    });

    if (statusUpdates.size === 0) return;

    setEvents(prevEvents => {
      const newEvents = [...prevEvents];
      let hasChanges = false;

      statusUpdates.forEach((newStatus, leadId) => {
        const eventIndex = newEvents.findIndex(e => e.id === leadId);

        if (eventIndex >= 0) {
          const oldEvent = newEvents[eventIndex];
          const lead = { ...oldEvent.extendedProps.lead, status: newStatus };

          newEvents[eventIndex] = {
            ...oldEvent,
            backgroundColor: getEventColor(newStatus, lead.has_sale),
            borderColor: getEventColor(newStatus, lead.has_sale),
            extendedProps: {
              ...oldEvent.extendedProps,
              lead,
              status: newStatus
            }
          };

          hasChanges = true;
          console.log(`🎯 Status updated: ${oldEvent.title} → ${newStatus}`);
        }
      });

      return hasChanges ? newEvents : prevEvents;
    });
  }, [setEvents]);

  // Event color function
  const getEventColor = useCallback((status, hasSale = false) => {
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
      default:
        return '#6b7280';
    }
  }, []);

  // Setup socket listeners with rate limiting
  useEffect(() => {
    if (!socket || !isConnected) return;

    console.log('🔌 Setting up optimized socket listeners');

    // Rate limiting - max 10 updates per second
    let updateCount = 0;
    const rateLimitWindow = setInterval(() => {
      updateCount = 0;
    }, 1000);

    const handleSocketUpdate = (type) => (data) => {
      updateCount++;

      if (updateCount > 10) {
        console.warn('⚠️ Socket update rate limit exceeded, dropping update');
        return;
      }

      queueUpdate({ type, data, timestamp: Date.now() });
    };

    // Subscribe to socket events
    socket.on('leadUpdated', handleSocketUpdate('LEAD_UPDATED'));
    socket.on('leadCreated', handleSocketUpdate('LEAD_CREATED'));
    socket.on('leadDeleted', handleSocketUpdate('LEAD_DELETED'));
    socket.on('statusChanged', handleSocketUpdate('STATUS_CHANGED'));

    // Connection health monitoring
    socket.on('connect', () => {
      console.log('🟢 Socket connected, calendar real-time enabled');
      recordCustomMetric('socketConnection', { status: 'connected' });
    });

    socket.on('disconnect', (reason) => {
      console.log('🔴 Socket disconnected:', reason);
      recordCustomMetric('socketConnection', { status: 'disconnected', reason });
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log('🔄 Socket reconnected after', attemptNumber, 'attempts');
      recordCustomMetric('socketConnection', { status: 'reconnected', attempts: attemptNumber });
    });

    // Cleanup
    return () => {
      clearInterval(rateLimitWindow);
      socket.off('leadUpdated');
      socket.off('leadCreated');
      socket.off('leadDeleted');
      socket.off('statusChanged');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('reconnect');

      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
        processBatchedUpdates(); // Process any pending updates
      }
    };
  }, [socket, isConnected, queueUpdate, processBatchedUpdates]);

  // Return useful methods and state
  return useMemo(() => ({
    isConnected,
    queuedUpdates: updateQueueRef.current.length,
    lastUpdate: lastUpdateRef.current,
    forceUpdate: processBatchedUpdates
  }), [isConnected, processBatchedUpdates]);
};