import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, auth } from '../lib/api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [authed, setAuthed] = useState(Boolean(auth.get()));

  useEffect(() => {
    const out = () => setAuthed(false);
    window.addEventListener('reelvault:signed-out', out);
    return () => window.removeEventListener('reelvault:signed-out', out);
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { token } = await api.login(email, password);
    auth.set(token);
    setAuthed(true);
  }, []);

  const signOut = useCallback(() => { auth.clear(); setAuthed(false); }, []);

  const value = useMemo(() => ({ authed, signIn, signOut }), [authed, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
