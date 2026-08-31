import React, { useState, useCallback, useRef, useEffect } from 'react';
import LazyImage from './LazyImage';
import { getOptimizedImageUrl } from '../utils/imageUtils';

const VirtualLeadsList = ({ 
  leads, 
  onLeadClick, 
  onSelectLead, 
  selectedLeads, 
  statusFilter,
  getStatusBadgeClass,
  formatDate,
  height = 600,
  itemHeight = 60
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(height);
  const containerRef = useRef(null);
  const [hoveredIndex, setHoveredIndex] = useState(-1);

  // Calculate visible range
  const visibleStart = Math.floor(scrollTop / itemHeight);
  const visibleEnd = Math.min(leads.length, visibleStart + Math.ceil(containerHeight / itemHeight) + 1);
  const visibleLeads = leads.slice(visibleStart, visibleEnd);

  // Calculate total height
  const totalHeight = leads.length * itemHeight;

  // Handle scroll
  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  // Memoize the row renderer for better performance
  const LeadRow = useCallback(({ lead, index, style }) => {
    const isSelected = selectedLeads.includes(lead.id);
    const isHovered = hoveredIndex === index;

    return (
      <div
        style={style}
        className={`flex items-center px-6 border-b border-gray-200 cursor-pointer transition-colors duration-150 ${
          isSelected ? 'bg-blue-50' : isHovered ? 'bg-gray-50' : 'bg-white'
        }`}
        onClick={(e) => {
          if (e.target.type !== 'checkbox') {
            onLeadClick(lead, e);
          }
        }}
        onMouseEnter={() => setHoveredIndex(index)}
        onMouseLeave={() => setHoveredIndex(-1)}
      >
        {/* Checkbox */}
        <div className="w-12 flex-shrink-0">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation();
              onSelectLead(lead.id, e.target.checked);
            }}
            className="cursor-pointer"
          />
        </div>

        {/* Photo */}
        <div className="w-16 flex-shrink-0">
        <LazyImage
          src={getOptimizedImageUrl(lead.image_url, 'thumbnail') || ''}
          alt={lead.name}
          className="w-6 h-6 rounded-full object-cover border border-gray-200" // Ultra-small for maximum speed
          fallbackClassName="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center border border-gray-200"
          lazy={true}
          preload={false}
        />
        </div>

        {/* Name */}
        <div className="w-48 flex-shrink-0">
          <div className="text-sm font-medium text-gray-900 truncate">
            {lead.name}
          </div>
        </div>

        {/* Phone */}
        <div className="w-32 flex-shrink-0">
          <div className="text-sm text-gray-900 truncate">
            {lead.phone}
          </div>
        </div>

        {/* Postcode */}
        <div className="w-24 flex-shrink-0">
          <div className="text-sm text-gray-900 truncate">
            {lead.postcode}
          </div>
        </div>

        {/* Status */}
        <div className="w-24 flex-shrink-0">
          <span className={getStatusBadgeClass(lead.status)}>
            {lead.status}
          </span>
        </div>

        {/* Reject Reason (only for Rejected status) */}
        {statusFilter === 'Rejected' && (
          <div className="w-48 flex-shrink-0">
            <div className="text-sm text-red-600 font-medium truncate">
              {lead.reject_reason || 'No reason specified'}
            </div>
          </div>
        )}

        {/* Booker */}
        <div className="w-32 flex-shrink-0">
          <div className="text-sm text-gray-900 truncate">
            {lead.booker?.name || 'N/A'}
          </div>
        </div>

        {/* Date Booked */}
        <div className="w-32 flex-shrink-0">
          <div className="text-sm text-gray-900 truncate">
            {lead.date_booked ? formatDate(lead.date_booked) : 'N/A'}
          </div>
        </div>

        {/* Actions */}
        <div className="w-32 flex-shrink-0">
          <div className="flex items-center justify-end space-x-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Handle book lead action
              }}
              className="text-green-600 hover:text-green-900 p-1 rounded hover:bg-green-50"
              title="Book Appointment"
            >
              📅
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Handle view details action
              }}
              className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
              title="View Details"
            >
              👁️
            </button>
          </div>
        </div>
      </div>
    );
  }, [selectedLeads, statusFilter, onLeadClick, onSelectLead, getStatusBadgeClass, formatDate, hoveredIndex]);

  // Update container height on resize
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight);
      }
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  return (
    <div className="bg-white shadow overflow-hidden">
      {/* Table Header */}
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center text-xs font-medium text-gray-500 uppercase tracking-wider">
          <div className="w-12 flex-shrink-0">
            <input
              type="checkbox"
              className="cursor-pointer"
              // Add select all functionality here
            />
          </div>
          <div className="w-16 flex-shrink-0">Photo</div>
          <div className="w-48 flex-shrink-0">Name</div>
          <div className="w-32 flex-shrink-0">Phone</div>
          <div className="w-24 flex-shrink-0">Postcode</div>
          <div className="w-24 flex-shrink-0">Status</div>
          {statusFilter === 'Rejected' && (
            <div className="w-48 flex-shrink-0">Reject Reason</div>
          )}
          <div className="w-32 flex-shrink-0">Booker</div>
          <div className="w-32 flex-shrink-0">Date Booked</div>
          <div className="w-32 flex-shrink-0">Actions</div>
        </div>
      </div>

      {/* Virtual Scrolling Container */}
      <div
        ref={containerRef}
        className="overflow-auto"
        style={{ height: `${height}px` }}
        onScroll={handleScroll}
      >
        <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
          {visibleLeads.map((lead, index) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              index={visibleStart + index}
              style={{
                position: 'absolute',
                top: `${(visibleStart + index) * itemHeight}px`,
                left: 0,
                right: 0,
                height: `${itemHeight}px`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default VirtualLeadsList;
