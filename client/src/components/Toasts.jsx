import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 260);
  }, []);

  const push = useCallback((type, message, ms = 4200) => {
    const id = nextId.current++;
    // Collapse identical consecutive messages so retries cannot spam the screen.
    setItems((list) => (list.some((t) => t.message === message && !t.leaving) ? list : [...list.slice(-3), { id, type, message }]));
    if (ms) setTimeout(() => dismiss(id), ms);
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (m) => push('success', m),
    error: (m) => push('error', m, 6500),
    info: (m) => push('info', m),
  }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div key={t.id} className={`toast toast-${t.type} ${t.leaving ? 'leaving' : ''}`} role={t.type === 'error' ? 'alert' : 'status'}>
              <Icon aria-hidden="true" />
              <p>{t.message}</p>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dismiss(t.id)} aria-label="Dismiss notification"><X aria-hidden="true" /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
