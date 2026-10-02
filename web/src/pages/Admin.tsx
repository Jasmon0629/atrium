import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Plus, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { useData } from '../stores/data';
import { Avatar, GroupMark, RoleBadge, badgeCls, cx } from '../components/ui';
import type { GroupSummary } from '../lib/types';
import { useConfirm } from '../components/ConfirmDialog';
import type { User } from '../lib/types';

interface AdminUser extends User {
  memberships: { id: number; name: string; role: string }[];
}

const COLORS = ['#14655c', '#7c4a9e', '#b3541e', '#3e7cb1', '#5a6b3b', '#a63d5f'];

export function AdminPage() {
  const me = useAuth((s) => s.user);
  const fetchUsers = useData((s) => s.fetchUsers);
  const fetchGroups = useData((s) => s.fetchGroups);
  const groups = useData((s) => s.groups);
  const ask = useConfirm();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [error, setError] = useState('');
  // temporary passwords from admin resets, shown once per user until dismissed
  const [tempPw, setTempPw] = useState<Record<number, string>>({});

  // user form
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uDept, setUDept] = useState('');
  const [uTitle, setUTitle] = useState('');
  // group form
  const [gName, setGName] = useState('');
  const [gDesc, setGDesc] = useState('');
  const [gProject, setGProject] = useState(false);

  async function load() {
    const res = await api<{ users: AdminUser[] }>('GET', '/api/admin/users').catch(() => null);
    if (res) setUsers(res.users);
  }

  useEffect(() => {
    load();
  }, []);

  if (!me?.isSuperAdmin) {
    return <p className="p-8 text-sm text-ink-400">Super admin access required.</p>;
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('POST', '/api/admin/users', {
        name: uName,
        email: uEmail,
        password: uPassword,
        department: uDept,
        title: uTitle,
        avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
      setUName(''); setUEmail(''); setUPassword(''); setUDept(''); setUTitle('');
      setShowUserForm(false);
      await Promise.all([load(), fetchUsers()]);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('POST', '/api/groups', { name: gName, description: gDesc, isProject: gProject });
      setGName(''); setGDesc(''); setGProject(false);
      setShowGroupForm(false);
      await fetchGroups();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deleteGroup(g: GroupSummary) {
    const ok = await ask({
      title: `Delete “${g.name}”?`,
      body: `Its board and ${g.taskTotal} task${g.taskTotal === 1 ? '' : 's'}, chat history and announcements are permanently removed for all ${g.memberCount} members. This cannot be undone.`,
      confirmLabel: 'Delete group',
      danger: true,
    });
    if (!ok) return;
    setError('');
    try {
      await api('DELETE', `/api/groups/${g.id}`);
      await fetchGroups();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function resetPassword(u: AdminUser) {
    const ok = await ask({
      title: `Reset ${u.name}'s password?`,
      body: 'They are signed out everywhere and must choose a new password at next sign-in. A one-time temporary password is shown to you once.',
      confirmLabel: 'Reset password',
      danger: true,
    });
    if (!ok) return;
    setError('');
    try {
      const res = await api<{ temporaryPassword?: string }>('POST', `/api/admin/users/${u.id}/reset-password`, {});
      if (res.temporaryPassword) setTempPw((m) => ({ ...m, [u.id]: res.temporaryPassword! }));
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function toggleDisabled(u: AdminUser) {
    const disabled = !u.disabled;
    if (
      disabled &&
      !(await ask({
        title: `Disable ${u.name}?`,
        body: 'They are signed out immediately and cannot sign in until re-enabled. Their data stays intact.',
        confirmLabel: 'Disable account',
        danger: true,
      }))
    )
      return;
    setError('');
    try {
      await api('PATCH', `/api/admin/users/${u.id}`, { disabled });
      await Promise.all([load(), fetchUsers()]);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40';

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 lg:p-8">
      <header className="flex items-center gap-2.5">
        <ShieldCheck size={20} className="text-ink-700" />
        <div>
          <h1 className="text-xl font-semibold">Administration</h1>
          <p className="text-sm text-ink-400">Manage users and groups across the whole workspace.</p>
        </div>
      </header>

      {error && <p className="rounded-md border border-urgent/20 bg-urgent-soft px-4 py-2.5 text-sm text-urgent">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setShowUserForm((v) => !v)}
          className="btn-brand flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white"
        >
          <Plus size={15} /> New user
        </button>
        <button
          onClick={() => setShowGroupForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-sm font-medium text-ink-900 hover:bg-paper"
        >
          <Plus size={15} /> New group
        </button>
      </div>

      {showUserForm && (
        <form onSubmit={createUser} className="anim-in grid gap-3 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
          <input className={inputCls} placeholder="Full name" value={uName} onChange={(e) => setUName(e.target.value)} required />
          <input className={inputCls} type="email" placeholder="Email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} required />
          <input className={inputCls} type="password" placeholder="Password (min 8 chars)" value={uPassword} onChange={(e) => setUPassword(e.target.value)} required minLength={8} />
          <input className={inputCls} placeholder="Department" value={uDept} onChange={(e) => setUDept(e.target.value)} />
          <input className={inputCls} placeholder="Job title" value={uTitle} onChange={(e) => setUTitle(e.target.value)} />
          <button type="submit" className="btn-brand rounded-md py-1.5 text-sm font-medium text-white">
            Create user
          </button>
        </form>
      )}

      {showGroupForm && (
        <form onSubmit={createGroup} className="anim-in grid gap-3 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
          <input className={inputCls} placeholder="Group name" value={gName} onChange={(e) => setGName(e.target.value)} required />
          <input className={inputCls} placeholder="Description" value={gDesc} onChange={(e) => setGDesc(e.target.value)} />
          <label className="flex items-center gap-2 text-sm font-medium text-ink-500">
            <input type="checkbox" checked={gProject} onChange={(e) => setGProject(e.target.checked)} className="accent-ink-900" />
            Cross-team project (not a department)
          </label>
          <button type="submit" className="btn-brand rounded-md py-1.5 text-sm font-medium text-white">
            Create group
          </button>
        </form>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Groups · {groups.length}</h2>
        <div className="space-y-2">
          {groups.length === 0 && <p className="text-sm text-ink-400">No groups yet.</p>}
          {groups.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
              <GroupMark name={g.name} size={32} />
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {g.name}
                  {g.isProject && <span className={cx(badgeCls, 'bg-paper text-ink-500')}>Project</span>}
                </p>
                <p className="truncate text-xs text-ink-400">
                  {g.memberCount} member{g.memberCount === 1 ? '' : 's'} · {g.taskTotal} task{g.taskTotal === 1 ? '' : 's'}
                  {g.description ? ` · ${g.description}` : ''}
                </p>
              </div>
              <Link to={`/groups/${g.id}`} className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-paper">
                Open
              </Link>
              <button
                onClick={() => deleteGroup(g)}
                className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-500 hover:border-urgent/30 hover:bg-urgent-soft hover:text-urgent"
                title="Delete group"
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">All users · {users.length}</h2>
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className={`flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 ${u.disabled ? 'opacity-70' : ''}`}
            >
              <Avatar name={u.name} color={u.avatarColor} size={36} />
              <div className="min-w-[14rem] flex-1">
                <p className="text-sm font-semibold">
                  {u.name}
                  {u.isSuperAdmin && (
                    <span className="ml-2 rounded border border-line bg-panel px-2 py-0.5 text-[11px] font-semibold text-ink-900">
                      Super admin
                    </span>
                  )}
                  {u.disabled && (
                    <span className="ml-2 rounded bg-urgent-soft px-2 py-0.5 text-[11px] font-semibold text-urgent">
                      Disabled
                    </span>
                  )}
                  {!u.disabled && u.mustChangePassword && (
                    <span className="ml-2 rounded bg-high-soft px-2 py-0.5 text-[11px] font-semibold text-high">
                      Must change password
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-ink-400">
                  {u.email} · {u.title || u.department}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {u.memberships.map((m) => (
                  <span key={m.id} className="flex items-center gap-1 rounded border border-line px-2 py-0.5 text-[11px] font-medium text-ink-500">
                    {m.name} <RoleBadge role={m.role} />
                  </span>
                ))}
              </div>
              {u.id !== me.id && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => resetPassword(u)}
                    className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-paper"
                    title="Reset password"
                  >
                    <KeyRound size={13} /> Reset password
                  </button>
                  <button
                    onClick={() => toggleDisabled(u)}
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                      u.disabled
                        ? 'border-line text-ink-700 hover:bg-paper'
                        : 'border-line text-ink-500 hover:border-urgent hover:text-urgent'
                    }`}
                    title={u.disabled ? 'Re-enable account' : 'Disable account'}
                  >
                    {u.disabled ? <UserCheck size={13} /> : <UserX size={13} />} {u.disabled ? 'Enable' : 'Disable'}
                  </button>
                </div>
              )}
              {tempPw[u.id] && (
                <div className="flex w-full flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-xs text-ink-700">
                  Temporary password for {u.name}:
                  <code className="select-all rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-sm font-semibold text-ink-900">{tempPw[u.id]}</code>
                  Share it privately — it is shown only once. They must replace it at sign-in.
                  <button
                    onClick={() => setTempPw((m) => { const n = { ...m }; delete n[u.id]; return n; })}
                    className="ml-auto rounded-lg px-2 py-1 font-semibold text-ink-500 hover:bg-panel"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
