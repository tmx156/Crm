import React, { createContext, useContext, useReducer, useEffect } from 'react';
import axios from 'axios';

// Configure axios base URL
axios.defaults.baseURL = process.env.NODE_ENV === 'production' 
  ? 'https://your-domain.com' 
  : 'http://localhost:5000';

const AuthContext = createContext();

const authReducer = (state, action) => {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, loading: true, error: null };
    case 'LOGIN_SUCCESS':
      return { 
        ...state, 
        loading: false, 
        isAuthenticated: true, 
        user: action.payload.user,
        token: action.payload.token,
        error: null 
      };
    case 'LOGIN_FAILURE':
      return { 
        ...state, 
        loading: false, 
        isAuthenticated: false, 
        user: null,
        token: null,
        error: action.payload 
      };
    case 'LOGOUT':
      return { 
        ...state, 
        isAuthenticated: false, 
        user: null,
        token: null,
        loading: false,
        error: null 
      };
    case 'SET_USER':
      return { 
        ...state, 
        user: action.payload 
      };
    default:
      return state;
  }
};

const initialState = {
  isAuthenticated: !!localStorage.getItem('token'), // Set to true if token exists
  user: null,
  token: localStorage.getItem('token'),
  loading: !!localStorage.getItem('token'), // Show loading while validating existing token
  error: null
};

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Set axios default header
  useEffect(() => {
    if (state.token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${state.token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [state.token]);

  // Check if user is logged in on app start
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          // Try /api/auth/me first
          let response;
          try {
            response = await axios.get('/api/auth/me');
          } catch (err) {
            // Fallback to /api/auth/profile for compatibility
            response = await axios.get('/api/auth/profile');
          }
          dispatch({
            type: 'LOGIN_SUCCESS',
            payload: {
              user: response.data.user || response.data,
              token
            }
          });
        } catch (error) {
          console.error('Token verification failed:', error);
          
          // Force logout on any auth error
          if (error.response?.data?.forceLogout || 
              error.response?.data?.clearToken ||
              error.response?.data?.message?.includes('Invalid user session')) {
            console.log('🚨 FORCE LOGOUT - Clearing all auth data');
            localStorage.removeItem('token');
            localStorage.removeItem('authToken');
            localStorage.removeItem('jwt');
            sessionStorage.clear();
          } else {
            localStorage.removeItem('token');
          }
          dispatch({ type: 'LOGOUT' });
        }
      } else {
        // No token found, set loading to false
        dispatch({ type: 'LOGOUT' });
      }
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      console.log('🔐 AuthContext: Sending login request to API');
      const response = await axios.post('/api/auth/login', { email, password });
      console.log('✅ AuthContext: Login response received:', response.data);
      
      const { token, user } = response.data;
      
      localStorage.setItem('token', token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      
      dispatch({
        type: 'LOGIN_SUCCESS',
        payload: { user, token }
      });
      
      return { success: true };
    } catch (error) {
      console.error('❌ AuthContext: Login error:', error);
      console.error('❌ Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      const message = error.response?.data?.message || 'Login failed';
      
      // Clear token if there's an account error or force logout
      if (message.includes('Account error') || 
          error.response?.data?.clearToken || 
          error.response?.data?.forceLogout ||
          message.includes('Invalid user session')) {
        console.log('🚨 FORCE LOGOUT DETECTED - Clearing all auth data');
        localStorage.removeItem('token');
        localStorage.removeItem('authToken');
        localStorage.removeItem('jwt');
        sessionStorage.clear();
        dispatch({ type: 'LOGOUT' });
      } else {
        dispatch({
          type: 'LOGIN_FAILURE',
          payload: message
        });
      }
      
      return { success: false, message };
    }
  };

  const register = async (userData) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const response = await axios.post('/api/auth/register', userData);
      const { token, user } = response.data;
      
      localStorage.setItem('token', token);
      dispatch({
        type: 'LOGIN_SUCCESS',
        payload: { user, token }
      });
      
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Registration failed';
      dispatch({
        type: 'LOGIN_FAILURE',
        payload: message
      });
      return { success: false, message };
    }
  };

  const logout = () => {
    console.log('🚨 LOGOUT CALLED - Clearing all auth data');
    localStorage.removeItem('token');
    localStorage.removeItem('authToken');
    localStorage.removeItem('jwt');
    localStorage.removeItem('user');
    localStorage.removeItem('userData');
    sessionStorage.clear();
    delete axios.defaults.headers.common['Authorization'];
    dispatch({ type: 'LOGOUT' });
  };

  return (
    <AuthContext.Provider value={{
      ...state,
      login,
      register,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 