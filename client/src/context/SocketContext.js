import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [lastConnectionError, setLastConnectionError] = useState(null);
  const { user } = useAuth();
  const heartbeatRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const isConnectingRef = useRef(false);

  // Initialize socket connection with enhanced stability
  useEffect(() => {
    if (user && !isConnectingRef.current) {
      isConnectingRef.current = true;
      
      // Enhanced WebSocket connection configuration
      const serverUrl = process.env.NODE_ENV === 'production' 
        ? window.location.origin 
        : 'http://localhost:5000';
      console.log('🔌 Connecting to WebSocket server:', serverUrl);
      
      const newSocket = io(serverUrl, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
        timeout: 20000, // Reduced timeout for faster failure detection
        forceNew: true, // Force new connection to avoid conflicts
        reconnection: true,
        reconnectionDelay: 2000, // Increased initial delay
        reconnectionDelayMax: 15000, // Increased max delay
        reconnectionAttempts: 10, // Reduced attempts to prevent infinite loops
        autoConnect: true,
        upgrade: true,
        rememberUpgrade: false, // Don't remember upgrade to allow fallback
        
        // Simplified connection options
        rejectUnauthorized: false, // Only for development
        secure: false, // Force non-secure for localhost development
        
        // Add connection state tracking
        multiplex: false, // Disable multiplexing to avoid conflicts
      });

      // Enhanced connection event handlers
      newSocket.on('connect', () => {
        console.log('✅ Connected to WebSocket server');
        console.log('👤 User data:', { id: user.id, name: user.name, role: user.role });
        setIsConnected(true);
        setConnectionAttempts(0);
        setLastConnectionError(null);
        isConnectingRef.current = false;
        
        // Clear any existing reconnect timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        
        // Join user-specific room
        newSocket.emit('join', { id: user.id, name: user.name, role: user.role });
        
        // Start heartbeat to keep connection alive
        startHeartbeat(newSocket);
      });

      newSocket.on('disconnect', (reason) => {
        console.log(`❌ Disconnected from WebSocket server: ${reason}`);
        setIsConnected(false);
        isConnectingRef.current = false;
        
        // Clear heartbeat
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        
        if (reason === 'io server disconnect') {
          // Server initiated disconnect, reconnect manually after delay
          console.log('🔄 Server initiated disconnect, attempting to reconnect...');
          reconnectTimeoutRef.current = setTimeout(() => {
            if (newSocket && !newSocket.connected) {
              newSocket.connect();
            }
          }, 2000);
        }
      });

      newSocket.on('connect_error', (error) => {
        console.error('❌ Socket connection error:', error.message);
        setIsConnected(false);
        isConnectingRef.current = false;
        setConnectionAttempts(prev => prev + 1);
        setLastConnectionError(error.message);
        
        // Add exponential backoff for connection errors
        const delay = Math.min(1000 * Math.pow(2, connectionAttempts), 30000);
        console.log(`🔄 Will retry connection in ${delay}ms`);
      });

      newSocket.on('reconnect', (attemptNumber) => {
        console.log(`🔄 Reconnected after ${attemptNumber} attempts`);
        setIsConnected(true);
        isConnectingRef.current = false;
        setConnectionAttempts(0);
        setLastConnectionError(null);
        
        // Clear reconnect timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        
        // Rejoin user room after reconnection
        newSocket.emit('join', { id: user.id, name: user.name, role: user.role });
        
        // Restart heartbeat
        startHeartbeat(newSocket);
      });

      newSocket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`🔄 Reconnection attempt ${attemptNumber}`);
        setConnectionAttempts(attemptNumber);
      });

      newSocket.on('reconnect_error', (error) => {
        console.error('❌ Reconnection failed:', error.message);
        setLastConnectionError(error.message);
      });

      newSocket.on('reconnect_failed', () => {
        console.error('❌ All reconnection attempts failed');
        setIsConnected(false);
        isConnectingRef.current = false;
        setLastConnectionError('Max reconnection attempts reached');
      });

      // Handle ping/pong for connection health
      newSocket.on('ping', () => {
        newSocket.emit('pong');
      });

      setSocket(newSocket);

      return () => {
        console.log('🧹 Cleaning up socket connection...');
        
        // Clean up timeouts first
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        
        // Reset connection state
        isConnectingRef.current = false;
        
        // Only clean up if socket exists and is not already closed
        if (newSocket && !newSocket.disconnected) {
          // Remove all event listeners before closing
          newSocket.removeAllListeners();
          
          // Close connection gracefully with a small delay
          setTimeout(() => {
            if (newSocket && !newSocket.disconnected) {
              newSocket.disconnect();
            }
          }, 100);
        }
        
        console.log('✅ Socket connection cleaned up');
      };
    }
  }, [user]);

  // Heartbeat function to keep connection alive
  const startHeartbeat = (socket) => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
    }
    
    heartbeatRef.current = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat', { timestamp: Date.now() });
      }
    }, 30000); // Send heartbeat every 30 seconds
  };

  // Real-time event handlers
  const subscribeToLeadUpdates = useCallback((callback) => {
    if (!socket) return () => {};

    const handleLeadCreated = (data) => {
      console.log('📱 Real-time: Lead created', data);
      callback({ type: 'LEAD_CREATED', data });
      setLastUpdate({ type: 'LEAD_CREATED', timestamp: new Date(), data });
    };

    const handleLeadUpdated = (data) => {
      console.log('📱 Real-time: Lead updated', data);
      callback({ type: 'LEAD_UPDATED', data });
      setLastUpdate({ type: 'LEAD_UPDATED', timestamp: new Date(), data });
    };

    const handleLeadAssigned = (data) => {
      console.log('📱 Real-time: Lead assigned', data);
      callback({ type: 'LEAD_ASSIGNED', data });
      setLastUpdate({ type: 'LEAD_ASSIGNED', timestamp: new Date(), data });
    };

    const handleLeadDeleted = (data) => {
      console.log('📱 Real-time: Lead deleted', data);
      callback({ type: 'LEAD_DELETED', data });
      setLastUpdate({ type: 'LEAD_DELETED', timestamp: new Date(), data });
    };

    const handleNotesUpdated = (data) => {
      console.log('📝 Real-time: Notes updated', data);
      callback({ type: 'NOTES_UPDATED', data });
      setLastUpdate({ type: 'NOTES_UPDATED', timestamp: new Date(), data });
    };

    // Subscribe to events
    socket.on('lead_created', handleLeadCreated);
    socket.on('lead_updated', handleLeadUpdated);
    socket.on('lead_assigned', handleLeadAssigned);
    socket.on('lead_deleted', handleLeadDeleted);
    socket.on('notes_updated', handleNotesUpdated);

    // Return cleanup function
    return () => {
      socket.off('lead_created', handleLeadCreated);
      socket.off('lead_updated', handleLeadUpdated);
      socket.off('lead_assigned', handleLeadAssigned);
      socket.off('lead_deleted', handleLeadDeleted);
      socket.off('notes_updated', handleNotesUpdated);
    };
  }, [socket]);

  const subscribeToStatsUpdates = useCallback((callback) => {
    if (!socket) return () => {};

    const handleStatsUpdateNeeded = (data) => {
      console.log('📊 Real-time: Stats update needed', data);
      callback({ type: 'STATS_UPDATE_NEEDED', data });
      setLastUpdate({ type: 'STATS_UPDATE_NEEDED', timestamp: new Date(), data });
    };

    const handleBookingActivity = (data) => {
      console.log('📅 Real-time: Booking activity', data);
      callback({ type: 'BOOKING_ACTIVITY', data });
      setLastUpdate({ type: 'BOOKING_ACTIVITY', timestamp: new Date(), data });
    };

    // Subscribe to stats and booking events
    socket.on('stats_update_needed', handleStatsUpdateNeeded);
    socket.on('booking_activity', handleBookingActivity);

    // Return cleanup function
    return () => {
      socket.off('stats_update_needed', handleStatsUpdateNeeded);
      socket.off('booking_activity', handleBookingActivity);
    };
  }, [socket]);

  const subscribeToCalendarUpdates = useCallback((callback) => {
    if (!socket) return () => {};

    const handleCalendarUpdated = (data) => {
      console.log('📅 Real-time: Calendar updated', data);
      callback({ type: 'CALENDAR_UPDATED', data });
      setLastUpdate({ type: 'CALENDAR_UPDATED', timestamp: new Date(), data });
    };

    // Subscribe to calendar events
    socket.on('calendar_updated', handleCalendarUpdated);

    // Return cleanup function
    return () => {
      socket.off('calendar_updated', handleCalendarUpdated);
    };
  }, [socket]);

  const subscribeToDiaryUpdates = useCallback((callback) => {
    if (!socket) return () => {};

    const handleDiaryUpdated = (data) => {
      console.log('📅 Real-time: Diary updated', data);
      callback({ type: 'DIARY_UPDATED', data });
      setLastUpdate({ type: 'DIARY_UPDATED', timestamp: new Date(), data });
    };

    // Subscribe to diary events
    socket.on('diary_updated', handleDiaryUpdated);

    // Return cleanup function
    return () => {
      socket.off('diary_updated', handleDiaryUpdated);
    };
  }, [socket]);

  // Emit events to other clients
  const emitLeadUpdate = useCallback((data) => {
    if (socket && socket.connected) {
      socket.emit('lead_update', data);
    }
  }, [socket]);

  const emitStatsUpdate = useCallback((data) => {
    if (socket && socket.connected) {
      socket.emit('stats_update', data);
    }
  }, [socket]);

  const emitCalendarUpdate = useCallback((data) => {
    if (socket && socket.connected) {
      socket.emit('calendar_update', data);
    }
  }, [socket]);

  const emitDiaryUpdate = useCallback((data) => {
    if (socket && socket.connected) {
      socket.emit('diary_update', data);
    }
  }, [socket]);

  const value = {
    socket,
    isConnected,
    lastUpdate,
    connectionAttempts,
    lastConnectionError,
    subscribeToLeadUpdates,
    subscribeToStatsUpdates,
    subscribeToCalendarUpdates,
    subscribeToDiaryUpdates,
    emitLeadUpdate,
    emitStatsUpdate,
    emitCalendarUpdate,
    emitDiaryUpdate
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export default SocketContext; 