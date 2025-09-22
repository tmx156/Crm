import React, { useState, useEffect, useCallback } from 'react';

const VirtualizedTable = ({ 
  data, 
  columns, 
  rowHeight = 72, // Height of each row in pixels
  containerHeight = 600, // Height of the visible container
  overscan = 5, // Number of extra rows to render above/below visible area
  onRowClick,
  selectedRows = [],
  onRowSelect,
  onSelectAll,
  renderRow,
  ...props 
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [isSelectAllChecked, setIsSelectAllChecked] = useState(false);
  const [isSelectAllIndeterminate, setIsSelectAllIndeterminate] = useState(false);

  // Calculate visible range
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    data.length - 1,
    Math.floor((scrollTop + containerHeight) / rowHeight) + overscan
  );

  // Calculate visible rows
  const visibleRows = data.slice(startIndex, endIndex + 1);

  // Calculate total height for scrollbar
  const totalHeight = data.length * rowHeight;

  // Calculate offset for visible rows
  const offsetY = startIndex * rowHeight;

  // Handle scroll
  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  // Update select all state
  useEffect(() => {
    if (data.length === 0) {
      setIsSelectAllChecked(false);
      setIsSelectAllIndeterminate(false);
      return;
    }

    const selectedCount = selectedRows.length;
    const totalCount = data.length;

    if (selectedCount === 0) {
      setIsSelectAllChecked(false);
      setIsSelectAllIndeterminate(false);
    } else if (selectedCount === totalCount) {
      setIsSelectAllChecked(true);
      setIsSelectAllIndeterminate(false);
    } else {
      setIsSelectAllChecked(false);
      setIsSelectAllIndeterminate(true);
    }
  }, [selectedRows, data.length]);

  // Handle select all
  const handleSelectAll = useCallback((checked) => {
    if (checked) {
      onSelectAll?.(data.map(item => item.id));
    } else {
      onSelectAll?.([]);
    }
  }, [data, onSelectAll]);

  return (
    <div
      className="relative overflow-auto"
      style={{ height: containerHeight }}
      onScroll={handleScroll}
      {...props}
    >
      {/* Total height container for proper scrollbar */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* Visible rows container */}
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleRows.map((item, index) => {
            const actualIndex = startIndex + index;
            const isSelected = selectedRows.includes(item.id);
            
            return (
              <div
                key={item.id || actualIndex}
                style={{ height: rowHeight }}
                className="border-b border-gray-200 hover:bg-gray-50 transition-colors duration-150"
              >
                {renderRow?.(item, actualIndex, isSelected, onRowSelect, onRowClick) || (
                  <div className="flex items-center px-6 py-4">
                    {/* Default row rendering */}
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">
                        {item.name || `Row ${actualIndex + 1}`}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Select all checkbox (if provided) */}
      {onSelectAll && (
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-3 z-10">
          <input
            type="checkbox"
            checked={isSelectAllChecked}
            ref={(input) => {
              if (input) {
                input.indeterminate = isSelectAllIndeterminate;
              }
            }}
            onChange={(e) => handleSelectAll(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
};

export default VirtualizedTable;
