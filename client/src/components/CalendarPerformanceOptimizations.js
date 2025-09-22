import React, { useState, useCallback, useMemo } from 'react';
import OptimizedCalendar from './OptimizedCalendar';
import VirtualizedEventHistory from './VirtualizedEventHistory';

/**
 * Calendar Performance Optimization Integration
 *
 * This component demonstrates how to integrate the performance optimizations
 * into the existing Calendar.js component.
 */

const CalendarPerformanceOptimizations = ({
  user,
  onEventClick,
  onDateSelect,
  socket,
  ...props
}) => {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);

  // Handle event clicks with optimized modal
  const handleEventClick = useCallback((info) => {
    const { event } = info;
    const lead = event.extendedProps?.lead;

    if (lead) {
      setSelectedEvent({
        id: event.id,
        title: event.title,
        start: event.start,
        lead: lead,
        ...event.extendedProps
      });
      setShowEventModal(true);
    }

    if (onEventClick) {
      onEventClick(info);
    }
  }, [onEventClick]);

  // Parse booking history for virtualized display
  const bookingHistory = useMemo(() => {
    if (!selectedEvent?.lead?.booking_history) return [];

    try {
      return JSON.parse(selectedEvent.lead.booking_history);
    } catch (error) {
      console.error('Error parsing booking history:', error);
      return [];
    }
  }, [selectedEvent]);

  // Performance optimizations for SMS/Email sending
  const handleSendSMS = useCallback(async (leadId, message) => {
    // Implement optimistic update
    console.log('Sending SMS to lead:', leadId, message);
    // Add your SMS sending logic here
  }, []);

  const handleSendEmail = useCallback(async (leadId, subject, body) => {
    // Implement optimistic update
    console.log('Sending email to lead:', leadId, subject, body);
    // Add your email sending logic here
  }, []);

  return (
    <div className="calendar-performance-wrapper">
      {/* Optimized Calendar Component */}
      <OptimizedCalendar
        onEventClick={handleEventClick}
        onDateSelect={onDateSelect}
        pageSize={200} // Configurable page size
        initialView="dayGridMonth"
      />

      {/* Optimized Event Modal */}
      {showEventModal && selectedEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {selectedEvent.lead.name || 'Unnamed Lead'}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedEvent.lead.phone} • {selectedEvent.lead.email}
                  </p>
                </div>
                <button
                  onClick={() => setShowEventModal(false)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 200px)' }}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Lead Details */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Lead Details</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-gray-500">Status</label>
                      <p className="text-sm text-gray-900">{selectedEvent.lead.status}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-500">Booked Date</label>
                      <p className="text-sm text-gray-900">
                        {selectedEvent.lead.date_booked
                          ? new Date(selectedEvent.lead.date_booked).toLocaleString()
                          : 'Not scheduled'
                        }
                      </p>
                    </div>
                    {selectedEvent.lead.notes && (
                      <div>
                        <label className="text-sm font-medium text-gray-500">Notes</label>
                        <p className="text-sm text-gray-900">{selectedEvent.lead.notes}</p>
                      </div>
                    )}
                  </div>

                  {/* Quick Actions */}
                  <div className="mt-6 space-y-2">
                    <button
                      onClick={() => handleSendSMS(selectedEvent.lead.id, '')}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm"
                    >
                      Send SMS
                    </button>
                    <button
                      onClick={() => handleSendEmail(selectedEvent.lead.id, '', '')}
                      className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm"
                    >
                      Send Email
                    </button>
                  </div>
                </div>

                {/* Virtualized History */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Communication History ({bookingHistory.length} items)
                  </h3>
                  <VirtualizedEventHistory
                    history={bookingHistory}
                    height={400}
                    onSendSMS={handleSendSMS}
                    onSendEmail={handleSendEmail}
                    leadId={selectedEvent.lead.id}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarPerformanceOptimizations;