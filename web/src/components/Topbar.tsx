import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, ChevronDown, Keyboard, KeyRound, LogOut, Menu, MonitorPlay, Moon, Search, Sun, SunMoon, WifiOff } from 'lucide-react';
import { disconnectSocket } from '../lib/socket';
import { THEME_ORDER, useTheme, type Theme } from '../lib/theme';
import { useAuth } from '../stores/auth';
import { useData } from '../stores/data';
import { useUi } from '../stores/ui';
import { Avatar, Kbd, cx } from './ui';

const THEME_LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

function themeIcon(t: Theme, size = 15) {
  return t === 'dark' ? <Moon size={size} /> : t === 'light' ? <Sun size={size} /> : <SunMoon size={size} />;
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const reset = useData((s) => s.reset);
  const notifUnread = useData((s) => s.notifUnread);
  const bellPulse = useUi((s) => s.bellPulse);
  const online = useUi((s) => s.online);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);
  const [theme, setTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  // Click outside / Escape closes the user menu
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function signOut() {
    setMenuOpen(false);
    disconnectSocket();
    reset();
    logout();
    navigate('/login');
  }

  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  const itemCls = 'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-ink-700 hover:bg-paper';

  return (
    <header className="z-20 flex items-center gap-3 border-b border-line bg-panel px-4 py-2 lg:px-6">
      <button className="rounded-md p-1.5 text-ink-500 hover:bg-paper lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>

      {/* One search entry point: the command palette */}
      <button
        onClick={() => setPaletteOpen(true)}
        className="flex max-w-md flex-1 items-center gap-2 rounded-lg border border-line bg-panel py-1.5 pl-3 pr-2 text-left text-sm text-ink-400 transition hover:bg-paper"
        aria-label="Search and commands"
      >
        <Search size={15} className="shrink-0" />
        <span className="flex-1 truncate">Search tasks, people, groups… or run a command</span>
        <span className="hidden items-center gap-0.5 sm:flex">
          <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      {!online && (
        <span className="hidden items-center gap-1.5 rounded bg-high-soft px-2 py-1 text-xs font-semibold text-high sm:flex" role="status">
          <WifiOff size={12} />
          Reconnecting…
        </span>
      )}

      <button
        onClick={() => navigate('/notifications')}
        className="relative ml-auto rounded-md p-2 text-ink-500 hover:bg-paper hover:text-ink-900"
        aria-label={notifUnread > 0 ? `Notifications, ${notifUnread} unread` : 'Notifications'}
      >
        <span key={bellPulse} className={bellPulse > 0 ? 'bell-ring inline-block' : 'inline-block'}>
          <Bell size={18} />
        </span>
        {notifUnread > 0 && (
          <span
            key={`count-${notifUnread}`}
            className="count-pop absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded bg-ink-900 px-1 text-[10px] font-semibold text-panel"
            aria-hidden
          >
            {notifUnread > 9 ? '9+' : notifUnread}
          </span>
        )}
      </button>

      {me && (
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={cx('flex items-center gap-1.5 rounded-md p-1 pr-1.5 hover:bg-paper', menuOpen && 'bg-paper')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
          >
            <Avatar name={me.name} size={28} online />
            <ChevronDown size={14} className={cx('text-ink-400 transition', menuOpen && 'rotate-180')} />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-lg border border-line bg-panel p-1.5 shadow-pop"
              >
                <div className="flex items-center gap-2.5 px-3 py-2">
                  <Avatar name={me.name} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{me.name}</p>
                    <p className="truncate text-xs text-ink-400">{me.title || me.department}</p>
                  </div>
                </div>
                <div className="my-1 h-px bg-line" />
                <button role="menuitem" className={itemCls} onClick={() => setTheme(nextTheme)}>
                  {themeIcon(theme)} Theme: {THEME_LABEL[theme]}
                  <span className="ml-auto text-[11px] text-ink-400">→ {THEME_LABEL[nextTheme]}</span>
                </button>
                <button
                  role="menuitem"
                  className={itemCls}
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/password');
                  }}
                >
                  <KeyRound size={15} /> Change password
                </button>
                <button
                  role="menuitem"
                  className={itemCls}
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/kiosk');
                  }}
                >
                  <MonitorPlay size={15} /> Display mode
                </button>
                <button
                  role="menuitem"
                  className={itemCls}
                  onClick={() => {
                    setMenuOpen(false);
                    setShortcutsOpen(true);
                  }}
                >
                  <Keyboard size={15} /> Keyboard shortcuts
                  <span className="ml-auto"><Kbd>?</Kbd></span>
                </button>
                <div className="my-1 h-px bg-line" />
                <button role="menuitem" className={itemCls} onClick={signOut}>
                  <LogOut size={15} /> Sign out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </header>
  );
}
