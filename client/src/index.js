import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import './utils/apiRetry'; // Initialize API retry interceptors
import { unregisterServiceWorker } from './utils/serviceWorkerFix'; // Fix service worker errors

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Unregister service worker in development to prevent errors
if (process.env.NODE_ENV === 'development') {
  unregisterServiceWorker();
} 