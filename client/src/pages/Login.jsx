import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Login() {
  const { authed, signIn } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Only allow same-site relative redirects.
  const raw = params.get('next') || '/dashboard';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
  if (authed) return <Navigate to={next} replace />;

  async function submit(e) {
    e.preventDefault();
    if (busy || !password || !email) return;
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="center-state">
      <form className="card login-card" onSubmit={submit} noValidate>
        <div className="state-icon"><Lock aria-hidden="true" /></div>
        <h1>Welcome back</h1>
        <p>Sign in to upload and manage your videos. Viewers never need an account — they only need your link.</p>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" inputMode="email" value={email}
            onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'pw-err' : undefined} />
          {error && <p id="pw-err" className="error-text" role="alert">{error}</p>}
        </div>
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !password || !email}>
          {busy && <Loader2 className="spin" aria-hidden="true" />}{busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
