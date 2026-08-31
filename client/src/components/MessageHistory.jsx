import React from 'react';
import { FiMail, FiMessageSquare } from 'react-icons/fi';

const MessageHistory = ({ bookingHistory, title = "Message History", maxHeight = "max-h-48" }) => {
  if (!bookingHistory || !Array.isArray(bookingHistory)) {
    return null;
  }

  const messageHistory = bookingHistory
    .filter(h => ['EMAIL_SENT','EMAIL_RECEIVED','SMS_SENT','SMS_RECEIVED'].includes(h.action))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (messageHistory.length === 0) {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-4 mt-4">
        <h4 className="text-base font-bold text-blue-700 mb-2">{title}</h4>
        <div className="text-xs text-gray-400 italic">No messages yet</div>
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-4 mt-4 ${maxHeight} overflow-y-auto`}>
      <h4 className="text-base font-bold text-blue-700 mb-2">{title}</h4>
      {messageHistory
        .slice(0, 10) // Show latest 10 messages
        .map((history, idx) => (
          <div key={idx} className="flex items-start space-x-2 mb-2 last:mb-0">
            <div className="mt-1">
              {['EMAIL_SENT','EMAIL_RECEIVED'].includes(history.action) && (
                <FiMail className={`h-4 w-4 ${history.action==='EMAIL_SENT'?'text-blue-500':'text-green-600'}`} />
              )}
              {['SMS_SENT','SMS_RECEIVED'].includes(history.action) && (
                <FiMessageSquare className={`h-4 w-4 ${history.action==='SMS_SENT'?'text-blue-400':'text-green-400'}`} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-700 font-semibold">
                {history.action==='EMAIL_SENT' && 'Email Sent'}
                {history.action==='EMAIL_RECEIVED' && 'Email Received'}
                {history.action==='SMS_SENT' && 'Text Sent'}
                {history.action==='SMS_RECEIVED' && 'Text Received'}
                <span className="ml-2 text-gray-400 font-normal">
                  {new Date(history.timestamp).toLocaleString()}
                </span>
              </div>
              {history.details?.subject && (
                <div className="text-xs text-gray-500 truncate">
                  <b>Subject:</b> {history.details.subject}
                </div>
              )}
              <div className="text-xs text-gray-600 truncate">
                <b>Message:</b> {history.details?.body?.slice(0, 80)}{history.details?.body?.length > 80 ? '...' : ''}
              </div>
              <div className="text-[10px] text-gray-400">
                {history.details?.direction==='sent'?'To':'From'}: {history.performedByName}
              </div>
            </div>
          </div>
        ))}
    </div>
  );
};

export default MessageHistory;
