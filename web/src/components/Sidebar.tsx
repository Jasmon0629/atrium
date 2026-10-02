import { NavLink, useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckSquare,
  KeyRound,
  LayoutDashboard,
  ListTree,
  LogOut,
  Megaphone,
  MessageSquare,
  MonitorPlay,
  Moon,
  Settings2,
  Sun,
  SunMoon,
  X,
} from 'lucide-react';
import { useAuth } from '../stores/auth';
import { useData } from '../stores/data';
import { Avatar, GroupMark, Tooltip, cx } from './ui';
import { disconnectSocket } from '../lib/socket';
import { THEME_ORDER, useTheme, type Theme } from '../lib/theme';

const THEME_META: Record<Theme, { icon: JSX.Element; label: string }> = {
  light: { icon: <Sun size={15} />, label: 'Theme: light' },
  dark: { icon: <Moon size={15} />, label: 'Theme: dark' },
  system: { icon: <SunMoon size={15} />, label: 'Theme: follow system' },
};

/** Small monochrome count for unread items and overdue tasks. */
function Count({ n, tone = 'ink', label }: { n: number; tone?: 'ink' | 'urgent'; label: string }) {
  if (!n) return null;
  return (
    <span
      className={cx(
        'ml-auto rounded px-1.5 py-px text-[11px] font-semibold tabular-nums',
        tone === 'urgent' ? 'bg-urgent-soft text-urgent' : 'bg-line text-ink-700'
      )}
      aria-label={label}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

/**
 * Fixed 240px sidebar on the inset grey. Monochrome line icons beside labels;
 * the active item is a white card with the one allowed shadow. Off-canvas on
 * phones.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const groups = useData((s) => s.groups);
  const rooms = useData((s) => s.rooms);
  const notifUnread = useData((s) => s.notifUnread);
  const reset = useData((s) => s.reset);
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();

  const chatUnread = rooms.reduce((sum, r) => sum + r.unread, 0);

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cx(
      'group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
      isActive ? 'bg-panel font-semibold text-ink-900 shadow-sm' : 'font-medium text-ink-500 hover:bg-panel/70 hover:text-ink-900'
    );

  function handleLogout() {
    disconnectSocket();
    reset();
    logout();
    navigate('/login');
  }

  function cycleTheme() {
    setTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]);
  }

  const Item = ({ to, icon, label, count, end }: { to: string; icon: JSX.Element; label: string; count?: number; end?: boolean }) => (
    <NavLink to={to} end={end} className={linkCls} onClick={onClose}>
      <span className="flex w-5 shrink-0 justify-center text-ink-400 group-[.text-ink-900]:text-ink-900 group-hover:text-ink-700" aria-hidden>
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {count ? <Count n={count} label={`${count} unread`} /> : null}
    </NavLink>
  );

  return (
    <>
      {open && <button className="fixed inset-0 z-30 bg-ink-900/30 lg:hidden" onClick={onClose} aria-label="Close menu" />}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-line bg-paper transition-transform duration-200 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand line: the accent's one appearance in the shell */}
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-brand">ASM TECH</p>
            <p className="text-base font-semibold leading-tight">Atrium</p>
            <p className="mt-0.5 text-xs text-ink-500">Workplace command center</p>
          </div>
          <button className="rounded-md p-1 text-ink-500 hover:bg-panel lg:hidden" onClick={onClose} aria-label="Close menu">
            <X size={16} />
          </button>
        </div>

        <nav aria-label="Main" className="thin-scroll flex-1 space-y-0.5 overflow-y-auto p-3">
          <Item to="/" end icon={<LayoutDashboard size={16} />} label="Dashboard" />
          <Item to="/tasks" icon={<CheckSquare size={16} />} label="My Tasks" />
          <Item to="/announcements" icon={<Megaphone size={16} />} label="Announcements" />
          <Item to="/chat" icon={<MessageSquare size={16} />} label="Chat" count={chatUnread} />
          <Item to="/notifications" icon={<Bell size={16} />} label="Notifications" count={notifUnread} />
          <Item to="/activity" icon={<ListTree size={16} />} label="Activity" />
          {user?.isSuperAdmin && <Item to="/admin" icon={<Settings2 size={16} />} label="Admin" />}

          <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wide text-ink-500">Groups</p>
          {groups.map((g) => (
            <NavLink key={g.id} to={`/groups/${g.id}`} className={linkCls} onClick={onClose}>
              <GroupMark name={g.name} size={20} />
              <span className="truncate">{g.name}</span>
              {g.taskOverdue > 0 ? (
                <Count n={g.taskOverdue} tone="urgent" label={`${g.taskOverdue} overdue`} />
              ) : (
                <span className="ml-auto text-[11px] tabular-nums text-ink-400">{g.taskTotal}</span>
              )}
            </NavLink>
          ))}

          <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wide text-ink-500">Office</p>
          <Item to="/kiosk" icon={<MonitorPlay size={16} />} label="Display mode" />
        </nav>

        {user && (
          <div className="flex items-center gap-2 border-t border-line px-4 py-3">
            <Avatar name={user.name} online size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-[11px] text-ink-500">{user.title || user.department}</p>
            </div>
            <div className="flex items-center">
              <Tooltip label={THEME_META[theme].label} side="top">
                <button onClick={cycleTheme} className="rounded-md p-1.5 text-ink-500 hover:bg-panel hover:text-ink-900" aria-label={THEME_META[theme].label}>
                  {THEME_META[theme].icon}
                </button>
              </Tooltip>
              <Tooltip label="Change password" side="top">
                <button
                  onClick={() => {
                    navigate('/password');
                    onClose();
                  }}
                  className="rounded-md p-1.5 text-ink-500 hover:bg-panel hover:text-ink-900"
                  aria-label="Change password"
                >
                  <KeyRound size={15} />
                </button>
              </Tooltip>
              <Tooltip label="Sign out" side="top">
                <button onClick={handleLogout} className="rounded-md p-1.5 text-ink-500 hover:bg-panel hover:text-ink-900" aria-label="Sign out">
                  <LogOut size={15} />
                </button>
              </Tooltip>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
