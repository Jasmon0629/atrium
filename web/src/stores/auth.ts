import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../lib/types';

interface AuthState {
  token: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  setSession: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: async (email, password) => {
        const base = import.meta.env.BASE_URL.replace(/\/$/, '');
        const res = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || 'Sign-in failed');
        set({ token: json.token, user: json.user });
      },
      setSession: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'atrium-auth' }
  )
);
