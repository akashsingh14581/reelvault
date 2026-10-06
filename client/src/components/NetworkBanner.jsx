import { useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export default function NetworkBanner() {
  const [state, setState] = useState(navigator.onLine ? 'idle' : 'offline');
  const timer = useRef(null);

  useEffect(() => {
    const off = () => { clearTimeout(timer.current); setState('offline'); };
    const on = () => {
      setState((s) => (s === 'offline' ? 'online' : s));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2500);
    };
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => { window.removeEventListener('offline', off); window.removeEventListener('online', on); clearTimeout(timer.current); };
  }, []);

  if (state === 'idle') return null;
  const offline = state === 'offline';
  return (
    <div className={`net-banner ${state}`} role="status" aria-live="polite">
      {offline ? <WifiOff aria-hidden="true" /> : <Wifi aria-hidden="true" />}
      {offline ? 'You are offline.' : 'Back online.'}
    </div>
  );
}
