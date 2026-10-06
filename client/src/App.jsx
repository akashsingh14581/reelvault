import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import NetworkBanner from './components/NetworkBanner.jsx';
import { useAuth } from './hooks/useAuth.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';

// Heavy / owner-only screens are split out so the landing page stays tiny.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Upload = lazy(() => import('./pages/Upload.jsx'));
const Watch = lazy(() => import('./pages/Watch.jsx'));

function Protected({ children }) {
  const { authed } = useAuth();
  const loc = useLocation();
  if (!authed) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return children;
}

const Fallback = () => (
  <div className="center-state" role="status" aria-live="polite"><div className="loader-reel" /><p>Loading…</p></div>
);

function NotFound() {
  return (
    <div className="center-state">
      <h1>Page not found</h1>
      <p>This page does not exist.</p>
      <a className="btn btn-primary" href="/">Back to ReelVault</a>
    </div>
  );
}

export default function App() {
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <NetworkBanner />
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="/upload" element={<Protected><Upload /></Protected>} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route element={<Layout minimal />}>
            <Route path="/v/:shareId" element={<Watch />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
