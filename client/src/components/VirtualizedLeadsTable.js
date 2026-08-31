import React, { useState, useCallback, useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import LazyImage from './LazyImage';
import { getOptimizedImageUrl } from '../utils/imageUtils';

const VirtualizedLeadsTable = ({ 
  leads, 
  onLeadClick, 
  onSelectLead, 
  selectedLeads, 
  statusFilter,
  getStatusBadgeClass,
  formatDate 
}) => {
  const [hoveredIndex, setHoveredIndex] = useState(-1);

  // Memoize the row renderer for better performance
  const Row = useCallback(({ index, style }) => {
    const lead = leads[index];
    if (!lead) return null;

    const isSelected = selectedLeads.includes(lead.id);
    const isHovered = hoveredIndex === index;

    return (
      <div
        style={style}
        className={`flex items-center px-6 py-4 border-b border-gray-200 cursor-pointer transition-colors duration-200 ${
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
            className="w-10 h-10 rounded-full object-cover border-2 border-gray-200"
            fallbackClassName="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center border-2 border-gray-200"
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
  }, [leads, selectedLeads, statusFilter, onLeadClick, onSelectLead, getStatusBadgeClass, formatDate, hoveredIndex]);

  // Calculate item height based on status filter
  const itemHeight = statusFilter === 'Rejected' ? 60 : 56; // Slightly taller for rejected leads

  return (
    <div className="bg-white shadow overflow-hidden">
      {/* Table Header */}
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
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

      {/* Virtualized List */}
      <List
        height={600} // Fixed height for the virtualized container
        itemCount={leads.length}
        itemSize={itemHeight}
        itemData={leads}
      >
        {Row}
      </List>
    </div>
  );
};

export default VirtualizedLeadsTable;
