import { FormEvent, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../stores/auth';
import { Avatar } from '../components/ui';

// Internal tool: the sign-in page lists the team's accounts so people pick
// themselves instead of typing. Dev builds also pre-fill the shared demo
// password; production only fills the email and focuses the password box.
const DEV = import.meta.env.DEV;
const DEMO_PASSWORD = 'atrium123';
const LAST_EMAIL_KEY = 'atrium-last-email';
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface Account {
  id: number;
  name: string;
  email: string;
  title: string;
  department: string;
  avatarColor: string;
  isSuperAdmin: boolean;
}

function rememberedEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) || '';
  } catch {
    return '';
  }
}

const inputCls =
  'w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40';

export function LoginPage() {
  const token = useAuth((s) => s.token);
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [email, setEmail] = useState(() => rememberedEmail() || (DEV ? 'smith@asmtech.international' : ''));
  const [password, setPassword] = useState(DEV ? DEMO_PASSWORD : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${BASE}/api/auth/accounts`)
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((j) => setAccounts(j.accounts || []))
      .catch(() => {});
  }, []);

  if (token) return <Navigate to="/" replace />;

  function pick(a: Account) {
    setEmail(a.email);
    setError('');
    if (DEV) {
      setPassword(DEMO_PASSWORD);
    } else {
      setPassword('');
      passwordRef.current?.focus();
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      try {
        localStorage.setItem(LAST_EMAIL_KEY, email);
      } catch {}
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-4">
      <div className="anim-in w-full max-w-4xl overflow-hidden rounded-lg border border-line bg-panel md:grid md:grid-cols-5">
        {/* Brand panel: the inset grey with the brand line */}
        <div className="flex flex-col border-b border-line bg-paper p-8 md:col-span-2 md:border-b-0 md:border-r md:p-10">
          <p className="text-[11px] font-semibold tracking-widest text-brand">ASM TECH</p>
          <p className="text-base font-semibold leading-tight">Atrium</p>
          <p className="mt-0.5 text-xs text-ink-500">Workplace command center</p>
          <h1 className="mt-8 text-xl font-semibold leading-snug">Your workplace, live in one place.</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            Shared boards, announcements and team chat, synchronized in real time across everyone in your group.
          </p>
          <ul className="mt-6 space-y-1.5 text-sm text-ink-700">
            <li>✓ Move a task · teammates see it instantly</li>
            <li>✓ Post an announcement · the whole group knows</li>
            <li>✓ Office display mode for live status boards</li>
          </ul>
        </div>

        {/* Form panel */}
        <div className="p-8 md:col-span-3 md:p-10">
          <h2 className="text-xl font-semibold">Sign in</h2>

          {accounts.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-medium text-ink-500">Who are you?</p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => pick(a)}
                    className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-xs transition hover:bg-paper ${
                      email === a.email ? 'border-ink-900 bg-paper' : 'border-line'
                    }`}
                    aria-pressed={email === a.email}
                  >
                    <Avatar name={a.name} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink-900">
                        {a.name}
                        {a.isSuperAdmin && <span className="font-normal text-ink-500"> · Super admin</span>}
                      </span>
                      <span className="block truncate text-ink-500">
                        {[a.title, a.department].filter(Boolean).join(' · ') || a.email}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Email</label>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Password</label>
              <input
                ref={passwordRef}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={inputCls}
              />
            </div>
            {error && <p className="rounded-md border border-urgent/20 bg-urgent-soft px-3 py-2 text-sm text-urgent">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="btn-brand w-full rounded-md py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {DEV && (
            <p className="mt-4 text-[11px] text-ink-400">
              Dev build: the demo password <code className="font-mono">atrium123</code> is filled in for you.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
