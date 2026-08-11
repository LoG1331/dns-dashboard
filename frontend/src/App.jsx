import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ZoneDetails from './pages/ZoneDetails';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import Settings from './pages/Settings';
import Templates from './pages/Templates';
import TemplateDetails from './pages/TemplateDetails';
import MailPage from './pages/Mail';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import './index.css';

function App() {
  return (
    <ToastProvider>
      <Router>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Auth />} />

        {/* Protected/Dashboard Routes */}
        <Route path="/*" element={
          <Layout>
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/zones" element={<Dashboard />} />
              <Route path="/zones/:id" element={<ZoneDetails />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/templates/:id" element={<TemplateDetails />} />
              <Route path="/mail" element={<MailPage />} />
              <Route path="/settings" element={<Settings />} />
              {/* Fallback to dashboard for unknown routes within layout? Or public 404? */}
              {/* For now, just redirecting / to landing is handled above */}
            </Routes>
          </Layout>
        } />
      </Routes>
    </Router>
    </ToastProvider>
  );
}

export default App;
