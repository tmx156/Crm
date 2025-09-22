import React from 'react';
import { 
  Routes, 
  Route, 
  Navigate,
  unstable_HistoryRouter as HistoryRouter // Import for more stable routing
} from 'react-router-dom';
import { createBrowserHistory } from 'history'; // Import history
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Leads from './pages/LeadsNew';
import LeadDetail from './pages/LeadDetail';
import Users from './pages/Users';
import Calendar from './pages/Calendar';
import Reports from './pages/Reports';
import Templates from './pages/Templates';
import DailyDiary from './pages/DailyDiary';
import Retargeting from './pages/Retargeting';
import BookersTemplates from './pages/BookersTemplates';
import Finance from './pages/Finance';
import Sales from './pages/Sales';
import Messages from './pages/Messages';
import Legacy from './pages/Legacy';
import BookerAnalytics from './pages/BookerAnalytics';

// Create browser history
const history = createBrowserHistory();

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  return isAuthenticated ? children : <Navigate to="/login" />;
};

const PublicRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/dashboard" /> : children;
};

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <HistoryRouter 
          history={history}
          // Add future flags to suppress warnings
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true
          }}
        >
          <div className="App">
            <Routes>
              <Route 
                path="/login" 
                element={
                  <PublicRoute>
                    <Login />
                  </PublicRoute>
                } 
              />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <SocketProvider>
                      <Layout>
                        <Routes>
                          <Route path="/dashboard" element={<Dashboard />} />
                          <Route path="/leads" element={<Leads />} />
                          <Route path="/leads/:id" element={<LeadDetail />} />
                          <Route path="/users" element={<Users />} />
                          <Route path="/templates" element={<Templates />} />
                          <Route path="/calendar" element={<Calendar />} />
                          <Route path="/reports" element={<Reports />} />
                          <Route path="/retargeting" element={<Retargeting />} />
                          <Route path="/daily-diary" element={<DailyDiary />} />
                          <Route path="/bookers-templates" element={<BookersTemplates />} />
                          <Route path="/finance" element={<Finance />} />
                          <Route path="/sales" element={<Sales />} />
                          <Route path="/messages" element={<Messages />} />
                          <Route path="/legacy" element={<Legacy />} />
                          <Route path="/booker-analytics" element={<BookerAnalytics />} />
                          <Route path="/" element={<Navigate to="/dashboard" />} />
                        </Routes>
                      </Layout>
                    </SocketProvider>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </div>
        </HistoryRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App; 