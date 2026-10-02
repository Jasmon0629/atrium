import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import type { User } from '../lib/types';

const inputCls =
  'w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40';

export function ChangePasswordPage() {
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const forced = !!user?.mustChangePassword;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (next !== confirm) {
      setError('The two new passwords do not match');
      return;
    }
    setBusy(true);
    try {
      // The server rotates the session: every token issued before this call
      // (other browsers, phones) stops working; this tab continues with the new one.
      const res = await api<{ token: string; user: User }>('POST', '/api/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      setSession(res.token, res.user);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Could not change the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-4 lg:p-8">
      <div className="anim-in rounded-lg border border-line bg-panel p-6 lg:p-8">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-paper text-ink-700">
            <KeyRound size={17} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Change password</h1>
            <p className="text-sm text-ink-500">{user?.email}</p>
          </div>
        </div>

        {forced && (
          <p className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            Your password was set by an administrator or is the shared starting password. Choose a private
            one to continue.
          </p>
        )}

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-500">
              Current password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-500">
              New password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-ink-400">At least 8 characters. Not the demo password.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-500">
              Repeat new password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              className={inputCls}
            />
          </div>
          {error && <p className="rounded-md border border-urgent/20 bg-urgent-soft px-3 py-2 text-sm text-urgent">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="btn-brand rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Change password'}
            </button>
            {!forced && (
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink-500 hover:bg-paper"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
