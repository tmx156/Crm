import React, { useState, useEffect, useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import { FiMessageSquare, FiPhone, FiMail, FiClock, FiUser, FiCheck } from 'react-icons/fi';

const VirtualizedEventHistory = ({
  history = [],
  height = 400,
  onSendSMS,
  onSendEmail,
  leadId
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  // Process and filter history items
  const processedHistory = useMemo(() => {
    if (!history || !Array.isArray(history)) return [];

    return history
      .filter(item => {
        // Filter by type
        if (filterType !== 'all') {
          const itemType = item.action?.toLowerCase() || '';
          if (filterType === 'sms' && !itemType.includes('sms')) return false;
          if (filterType === 'calls' && !itemType.includes('call')) return false;
          if (filterType === 'email' && !itemType.includes('email')) return false;
          if (filterType === 'status' && !itemType.includes('status')) return false;
        }

        // Filter by search term
        if (searchTerm) {
          const searchLower = searchTerm.toLowerCase();
          const searchableText = [
            item.action || '',
            item.details?.message || '',
            item.details?.notes || '',
            item.details?.from || '',
            item.details?.to || ''
          ].join(' ').toLowerCase();

          return searchableText.includes(searchLower);
        }

        return true;
      })
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [history, searchTerm, filterType]);

  // Get icon for history item type
  const getItemIcon = (action) => {
    const actionLower = action?.toLowerCase() || '';
    if (actionLower.includes('sms')) return <FiMessageSquare className="w-4 h-4" />;
    if (actionLower.includes('call')) return <FiPhone className="w-4 h-4" />;
    if (actionLower.includes('email')) return <FiMail className="w-4 h-4" />;
    if (actionLower.includes('status')) return <FiUser className="w-4 h-4" />;
    return <FiClock className="w-4 h-4" />;
  };

  // Get color for history item type
  const getItemColor = (action, details) => {
    const actionLower = action?.toLowerCase() || '';

    if (actionLower.includes('sms_received')) {
      return details?.read ? 'text-gray-600' : 'text-blue-600 font-semibold';
    }
    if (actionLower.includes('sms_sent')) return 'text-green-600';
    if (actionLower.includes('call')) return 'text-purple-600';
    if (actionLower.includes('email')) return 'text-indigo-600';
    if (actionLower.includes('status')) return 'text-orange-600';

    return 'text-gray-600';
  };

  // Format timestamp
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Render individual history item
  const HistoryItem = ({ index, style }) => {
    const item = processedHistory[index];
    if (!item) return null;

    const isUnreadSMS = item.action === 'SMS_RECEIVED' && !item.details?.read;

    return (
      <div style={style} className="px-4 py-2 border-b border-gray-100 hover:bg-gray-50">
        <div className="flex items-start space-x-3">
          {/* Icon */}
          <div className={`mt-1 ${getItemColor(item.action, item.details)}`}>
            {getItemIcon(item.action)}
            {isUnreadSMS && (
              <div className="w-2 h-2 bg-blue-500 rounded-full absolute -mt-1 -mr-1"></div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className={`text-sm ${getItemColor(item.action, item.details)}`}>
                {item.action.replace(/_/g, ' ')}
                {item.details?.status && ` (${item.details.status})`}
              </div>
              <div className="text-xs text-gray-400">
                {formatTimestamp(item.timestamp)}
              </div>
            </div>

            {/* Message content */}
            {item.details?.message && (
              <div className={`mt-1 text-sm ${isUnreadSMS ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                {item.details.message.length > 100
                  ? `${item.details.message.substring(0, 100)}...`
                  : item.details.message
                }
              </div>
            )}

            {/* Additional details */}
            {item.details?.from && (
              <div className="text-xs text-gray-500 mt-1">
                From: {item.details.from}
              </div>
            )}

            {item.details?.notes && (
              <div className="text-xs text-gray-500 mt-1">
                Notes: {item.details.notes}
              </div>
            )}

            {/* Quick actions for SMS items */}
            {item.action === 'SMS_RECEIVED' && onSendSMS && (
              <div className="mt-2 flex space-x-2">
                <button
                  onClick={() => onSendSMS(leadId, `Re: ${item.details?.message || ''}`)}
                  className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded"
                >
                  Reply
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="virtualized-history">
      {/* Search and Filter Controls */}
      <div className="mb-4 space-y-2">
        <input
          type="text"
          placeholder="Search history..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />

        <div className="flex space-x-2 text-sm">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded text-xs"
          >
            <option value="all">All Types</option>
            <option value="sms">SMS</option>
            <option value="calls">Calls</option>
            <option value="email">Email</option>
            <option value="status">Status Changes</option>
          </select>

          <div className="text-xs text-gray-500 flex items-center">
            {processedHistory.length} of {history.length} items
          </div>
        </div>
      </div>

      {/* Virtualized List */}
      {processedHistory.length > 0 ? (
        <List
          height={height}
          itemCount={processedHistory.length}
          itemSize={80} // Average item height
          className="border border-gray-200 rounded-lg"
        >
          {HistoryItem}
        </List>
      ) : (
        <div className="text-center py-8 text-gray-500">
          {history.length === 0
            ? 'No history available'
            : 'No items match your filter'
          }
        </div>
      )}

      {/* Summary Stats */}
      {processedHistory.length > 0 && (
        <div className="mt-4 grid grid-cols-4 gap-4 text-xs text-gray-500">
          <div>
            <strong>{processedHistory.filter(i => i.action.includes('SMS')).length}</strong>
            <div>SMS</div>
          </div>
          <div>
            <strong>{processedHistory.filter(i => i.action.includes('CALL')).length}</strong>
            <div>Calls</div>
          </div>
          <div>
            <strong>{processedHistory.filter(i => i.action.includes('EMAIL')).length}</strong>
            <div>Emails</div>
          </div>
          <div>
            <strong>{processedHistory.filter(i => i.action.includes('STATUS')).length}</strong>
            <div>Status Changes</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(VirtualizedEventHistory);