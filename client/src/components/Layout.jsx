import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';

export function Logo({ to = '/', byline = false }) {
  return (
    <Link to={to} className="logo" aria-label="ReelVault home">
      <span className="logo-mark" aria-hidden="true" />
      <span>REELVAULT</span>
      {byline && <small className="hide-sm">by Akash Singh</small>}
    </Link>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span>◉ ReelVault · Private sharing. Simple watching.</span>
        <span>Crafted by Akash Singh</span>
      </div>
    </footer>
  );
}

export default function Layout({ minimal = false }) {
  const { authed, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <div className="ambient" aria-hidden="true" />
      <header className="nav">
        <div className="container nav-inner">
          <Logo byline={!authed} />
          <nav className="nav-links" aria-label="Main">
            {authed && !minimal ? (
              <>
                <NavLink to="/dashboard" className="btn btn-ghost btn-sm">My Videos</NavLink>
                <NavLink to="/upload" className="btn btn-primary btn-sm">Upload</NavLink>
                <button className="btn btn-ghost btn-sm btn-icon" aria-label="Sign out" onClick={() => { signOut(); navigate('/'); }}><LogOut aria-hidden="true" /></button>
              </>
            ) : (
              !minimal && <Link to="/login" className="btn btn-sm">Sign in</Link>
            )}
          </nav>
        </div>
      </header>
      <main className="page container" id="main"><Outlet /></main>
      <Footer />
    </>
  );
}
