import React, { useState, useEffect } from 'react';
import { FiWifi, FiWifiOff, FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { useSocket } from '../context/SocketContext';
import { checkApiHealth } from '../utils/apiRetry';

const ConnectionStatus = ({ className = "" }) => {
  const { isConnected, connectionAttempts, lastConnectionError } = useSocket();
  const [apiHealth, setApiHealth] = useState({ healthy: true, checking: false });
  const [showDetails, setShowDetails] = useState(false);

  // Check API health periodically
  useEffect(() => {
    const checkHealth = async () => {
      setApiHealth(prev => ({ ...prev, checking: true }));
      try {
        const health = await checkApiHealth();
        setApiHealth({ ...health, checking: false });
      } catch (error) {
        setApiHealth({ healthy: false, error: error.message, checking: false });
      }
    };

    // Initial check
    checkHealth();

    // Check every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // Determine overall connection status
  const getConnectionStatus = () => {
    if (!isConnected && !apiHealth.healthy) {
      return { 
        status: 'offline', 
        message: 'Disconnected', 
        icon: FiWifiOff,
        color: 'text-red-500 bg-red-100 border-red-200'
      };
    }
    
    if (!isConnected || !apiHealth.healthy) {
      return { 
        status: 'degraded', 
        message: 'Partial Connection', 
        icon: FiAlertTriangle,
        color: 'text-yellow-600 bg-yellow-100 border-yellow-200'
      };
    }
    
    if (connectionAttempts > 0) {
      return { 
        status: 'reconnecting', 
        message: 'Reconnecting...', 
        icon: FiRefreshCw,
        color: 'text-blue-500 bg-blue-100 border-blue-200'
      };
    }
    
    return { 
      status: 'connected', 
      message: 'Connected', 
      icon: FiWifi,
      color: 'text-green-600 bg-green-100 border-green-200'
    };
  };

  const connectionInfo = getConnectionStatus();
  const IconComponent = connectionInfo.icon;

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${connectionInfo.color} hover:opacity-80`}
        title="Click for connection details"
      >
        <IconComponent 
          className={`h-4 w-4 ${connectionInfo.status === 'reconnecting' ? 'animate-spin' : ''}`}
        />
        <span>{connectionInfo.message}</span>
      </button>

      {showDetails && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Connection Status</h3>
            
            {/* WebSocket Status */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">Real-time Sync</span>
                <div className={`flex items-center space-x-1 ${isConnected ? 'text-green-600' : 'text-red-500'}`}>
                  {isConnected ? <FiWifi className="h-3 w-3" /> : <FiWifiOff className="h-3 w-3" />}
                  <span className="text-xs">{isConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
              </div>
              {connectionAttempts > 0 && (
                <p className="text-xs text-blue-600">Reconnecting... (attempt {connectionAttempts})</p>
              )}
              {lastConnectionError && (
                <p className="text-xs text-red-500">Error: {lastConnectionError}</p>
              )}
            </div>

            {/* API Status */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">Database API</span>
                <div className={`flex items-center space-x-1 ${apiHealth.healthy ? 'text-green-600' : 'text-red-500'}`}>
                  {apiHealth.checking ? (
                    <FiRefreshCw className="h-3 w-3 animate-spin" />
                  ) : apiHealth.healthy ? (
                    <FiWifi className="h-3 w-3" />
                  ) : (
                    <FiWifiOff className="h-3 w-3" />
                  )}
                  <span className="text-xs">
                    {apiHealth.checking ? 'Checking...' : apiHealth.healthy ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              </div>
              {apiHealth.error && (
                <p className="text-xs text-red-500">Error: {apiHealth.error}</p>
              )}
              {apiHealth.latency && (
                <p className="text-xs text-gray-500">Latency: {apiHealth.latency}ms</p>
              )}
              {apiHealth.databaseStatus && (
                <p className="text-xs text-gray-500">Database: {apiHealth.databaseStatus}</p>
              )}
              {apiHealth.serverStatus && (
                <p className="text-xs text-gray-500">Server: {apiHealth.serverStatus}</p>
              )}
            </div>

            {/* Connection Tips */}
            {(!isConnected || !apiHealth.healthy) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
                <p className="text-xs text-yellow-800 font-medium mb-1">Connection Issues?</p>
                <ul className="text-xs text-yellow-700 space-y-1">
                  <li>• Check your internet connection</li>
                  <li>• Refresh the page if problems persist</li>
                  <li>• Data will sync when connection is restored</li>
                </ul>
              </div>
            )}

            {/* Manual Refresh Button */}
            <button
              onClick={() => {
                setApiHealth(prev => ({ ...prev, checking: true }));
                window.location.reload();
              }}
              className="w-full mt-3 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded text-sm font-medium hover:bg-blue-100 transition-colors"
            >
              <FiRefreshCw className="h-3 w-3 inline mr-1" />
              Refresh Page
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectionStatus; 