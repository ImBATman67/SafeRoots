import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Header } from './components/Layout/Header';
import { OfflineBanner } from './components/Layout/OfflineBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import QuickExit from './components/QuickExit';
import Home from './pages/Home';

// Lazy-load heavy route components for code splitting
const Shelters = lazy(() => import('./pages/Shelters'));
const Resources = lazy(() => import('./pages/Resources'));
const PeerSupport = lazy(() => import('./pages/PeerSupport'));
const CrisisAlerts = lazy(() => import('./pages/CrisisAlerts'));
const Volunteer = lazy(() => import('./pages/Volunteer'));
const Dashboard = lazy(() => import('./pages/Dashboard'));

// Simple loading fallback
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
  </div>
);

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <BrowserRouter>
          <div className="min-h-screen flex flex-col">
            <QuickExit />
            <OfflineBanner />
            <Header />
            <main className="flex-1">
              <Suspense fallback={<LoadingSpinner />}>
                <Routes>
                  <Route path="/"          element={<Home />} />
                  <Route path="/shelters"  element={<Shelters />} />
                  <Route path="/resources" element={<Resources />} />
                  <Route path="/support"   element={<PeerSupport />} />
                  <Route path="/alerts"    element={<CrisisAlerts />} />
                  <Route path="/volunteer" element={<Volunteer />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                </Routes>
              </Suspense>
            </main>
          </div>
        </BrowserRouter>
      </AppProvider>
    </ErrorBoundary>
  );
}
