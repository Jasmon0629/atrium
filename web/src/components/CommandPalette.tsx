import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  CheckSquare,
  ClipboardList,
  KeyRound,
  LayoutDashboard,
  ListTree,
  LogOut,
  Megaphone,
  MessageSquare,
  MonitorPlay,
  Moon,
  Search,
  Settings2,
  Sun,
  SunMoon,
  User as UserIcon,
  Keyboard,
} from 'lucide-react';
import { api, tryMutate } from '../lib/api';
import { disconnectSocket } from '../lib/socket';
import { THEME_ORDER, useTheme } from '../lib/theme';
import { useAuth } from '../stores/auth';
import { useData } from '../stores/data';
import { useUi } from '../stores/ui';
import { Avatar, GroupMark, Kbd, cx } from './ui';
import type { Room, SearchResults } from '../lib/types';

interface Item {
  id: string;
  section: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void | Promise<void>;
}

/** 3 = substring, 2 = every query word starts a word, 1 = characters in order, 0 = no match. */
function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (t.includes(q)) return 3;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.split(/[\s·/-]+/).some((tw) => tw.startsWith(w)))) return 2;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

/**
 * Ctrl/⌘+K: jump anywhere, open any task, message anyone, run an action —
 * without leaving the keyboard. Local data ranks first; the server search
 * fills in tasks, announcements and messages beyond what the store holds.
 */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const groups = useData((s) => s.groups);
  const myTasks = useData((s) => s.myTasks);
  const rooms = useData((s) => s.rooms);
  const users = useData((s) => s.users);
  const reset = useData((s) => s.reset);
  const fetchRooms = useData((s) => s.fetchRooms);
  const [theme, setTheme] = useTheme();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [remote, setRemote] = useState<SearchResults | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) {
      setQ('');
      setRemote(null);
      setIdx(0);
    } else {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced server search for anything the store doesn't already hold
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      setRemote(null);
      return;
    }
    const t = setTimeout(() => {
      api<SearchResults>('GET', `/api/search?q=${encodeURIComponent(term)}`)
        .then(setRemote)
        .catch(() => setRemote(null));
    }, 220);
    return () => clearTimeout(t);
  }, [q, open]);

  const close = () => setOpen(false);
  const go = (to: string) => {
    close();
    navigate(to);
  };

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    const themeIcon = nextTheme === 'dark' ? <Moon size={15} /> : nextTheme === 'light' ? <Sun size={15} /> : <SunMoon size={15} />;

    const pages: Item[] = [
      { id: 'p-dash', section: 'Go to', label: 'Dashboard', icon: <LayoutDashboard size={15} />, run: () => go('/') },
      { id: 'p-tasks', section: 'Go to', label: 'My Tasks', icon: <CheckSquare size={15} />, run: () => go('/tasks') },
      { id: 'p-ann', section: 'Go to', label: 'Announcements', icon: <Megaphone size={15} />, run: () => go('/announcements') },
      { id: 'p-chat', section: 'Go to', label: 'Chat', icon: <MessageSquare size={15} />, run: () => go('/chat') },
      { id: 'p-notif', section: 'Go to', label: 'Notifications', icon: <Bell size={15} />, run: () => go('/notifications') },
      { id: 'p-act', section: 'Go to', label: 'Activity', icon: <ListTree size={15} />, run: () => go('/activity') },
      { id: 'p-kiosk', section: 'Go to', label: 'Display mode', hint: 'office TV / wallpaper', icon: <MonitorPlay size={15} />, run: () => go('/kiosk') },
      ...(me?.isSuperAdmin
        ? [{ id: 'p-admin', section: 'Go to', label: 'Admin', icon: <Settings2 size={15} />, run: () => go('/admin') } as Item]
        : []),
    ];

    const groupItems: Item[] = groups.map((g) => ({
      id: `g-${g.id}`,
      section: 'Groups',
      label: g.name,
      hint: `${g.taskTotal - g.taskDone} open${g.taskOverdue ? ` · ${g.taskOverdue} overdue` : ''}`,
      icon: <GroupMark name={g.name} size={18} />,
      keywords: g.description,
      run: () => go(`/groups/${g.id}`),
    }));

    const taskItems: Item[] = myTasks
      .filter((t) => !t.completedAt)
      .map((t) => ({
        id: `t-${t.id}`,
        section: 'My tasks',
        label: t.title,
        hint: groups.find((g) => g.id === t.groupId)?.name,
        icon: <ClipboardList size={15} />,
        keywords: t.tags.join(' '),
        run: () => go(`/groups/${t.groupId}?task=${t.id}`),
      }));

    const roomItems: Item[] = rooms.map((r: Room) => ({
      id: `r-${r.id}`,
      section: 'Conversations',
      label: r.name,
      hint: r.unread ? `${r.unread} unread` : r.kind === 'dm' ? 'direct message' : 'group chat',
      icon: r.kind === 'dm' && r.otherUserId && users[r.otherUserId] ? (
        <Avatar name={users[r.otherUserId].name} color={users[r.otherUserId].avatarColor} size={18} />
      ) : (
        <GroupMark name={r.name} size={18} />
      ),
      run: () => go(`/chat/${r.id}`),
    }));

    const dmRooms = new Set(rooms.filter((r) => r.kind === 'dm').map((r) => r.otherUserId));
    const peopleItems: Item[] = Object.values(users)
      .filter((u) => u.id !== me?.id && !dmRooms.has(u.id))
      .map((u) => ({
        id: `u-${u.id}`,
        section: 'People',
        label: `Message ${u.name}`,
        hint: [u.title, u.department].filter(Boolean).join(' · '),
        icon: <Avatar name={u.name} color={u.avatarColor} size={18} online={u.online} />,
        keywords: u.email,
        run: async () => {
          close();
          const res = await tryMutate(api<{ room: Room }>('POST', '/api/chat/dm', { userId: u.id }), {
            errorTitle: 'Could not open the conversation',
          });
          if (!res) return;
          await fetchRooms();
          navigate(`/chat/${res.room.id}`);
        },
      }));

    const actions: Item[] = [
      {
        id: 'a-theme',
        section: 'Actions',
        label: `Switch theme to ${nextTheme}`,
        hint: `now: ${theme}`,
        icon: themeIcon,
        keywords: 'dark light mode appearance',
        run: () => setTheme(nextTheme),
      },
      { id: 'a-pw', section: 'Actions', label: 'Change password', icon: <KeyRound size={15} />, run: () => go('/password') },
      {
        id: 'a-keys',
        section: 'Actions',
        label: 'Keyboard shortcuts',
        icon: <Keyboard size={15} />,
        run: () => {
          close();
          setShortcutsOpen(true);
        },
      },
      {
        id: 'a-out',
        section: 'Actions',
        label: 'Sign out',
        icon: <LogOut size={15} />,
        run: () => {
          close();
          disconnectSocket();
          reset();
          logout();
          navigate('/login');
        },
      },
    ];

    const remoteItems: Item[] = remote
      ? [
          ...remote.tasks
            .filter((t) => !myTasks.some((m) => m.id === t.id))
            .slice(0, 5)
            .map((t) => ({
              id: `rt-${t.id}`,
              section: 'Tasks',
              label: t.title,
              hint: groups.find((g) => g.id === t.groupId)?.name,
              icon: <ClipboardList size={15} />,
              run: () => go(`/groups/${t.groupId}?task=${t.id}`),
            })),
          ...remote.announcements.slice(0, 3).map((a) => ({
            id: `ra-${a.id}`,
            section: 'Announcements',
            label: a.title,
            hint: a.groupName || 'Company-wide',
            icon: <Megaphone size={15} />,
            run: () => go('/announcements'),
          })),
          ...remote.messages.slice(0, 3).map((m) => ({
            id: `rm-${m.id}`,
            section: 'Messages',
            label: m.body.length > 70 ? m.body.slice(0, 70) + '…' : m.body,
            hint: m.senderName,
            icon: <MessageSquare size={15} />,
            run: () => go(`/chat/${m.roomId}`),
          })),
        ]
      : [];

    if (!term) {
      return [...pages, ...groupItems.slice(0, 5), ...roomItems.filter((r) => r.hint?.includes('unread')).slice(0, 3), ...actions];
    }
    const scored = [...pages, ...groupItems, ...taskItems, ...roomItems, ...peopleItems, ...actions]
      .map((it) => ({ it, s: Math.max(score(it.label, term), it.keywords ? score(it.keywords, term) - 1 : 0, it.hint ? score(it.hint, term) - 1 : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);
    const searchAll: Item = {
      id: 'a-search',
      section: 'Search',
      label: `Search everything for “${q.trim()}”`,
      icon: <Search size={15} />,
      run: () => go(`/search?q=${encodeURIComponent(q.trim())}`),
    };
    return [...scored.slice(0, 10), ...remoteItems, searchAll];
  }, [q, theme, groups, myTasks, rooms, users, me, remote]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setIdx(0);
  }, [q, items.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[idx]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  // Section headers appear before the first item of each section
  const sectionStarts = new Set<number>();
  let lastSection = '';
  items.forEach((it, i) => {
    if (it.section !== lastSection) {
      sectionStarts.add(i);
      lastSection = it.section;
    }
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          className="fixed inset-0 z-[65] flex items-start justify-center bg-ink-900/40 px-3 pt-[12vh] dark:bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="w-full max-w-xl overflow-hidden rounded-lg border border-line bg-panel shadow-pop"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search size={16} className="shrink-0 text-ink-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Jump to a group, task, person, or action…"
                aria-label="Command palette search"
                aria-controls="palette-list"
                aria-activedescendant={items[idx]?.id}
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
                style={{ boxShadow: 'none' }}
              />
              <Kbd>Esc</Kbd>
            </div>
            <ul id="palette-list" ref={listRef} role="listbox" className="thin-scroll max-h-[55vh] overflow-y-auto p-2">
              {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-400">Nothing matches.</li>}
              {items.map((it, i) => (
                <li key={it.id} className={cx(sectionStarts.has(i) && i > 0 && 'mt-1')}>
                  {sectionStarts.has(i) && (
                    <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-500">{it.section}</p>
                  )}
                  <button
                    id={it.id}
                    role="option"
                    aria-selected={i === idx}
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => it.run()}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition',
                      i === idx ? 'bg-paper text-ink-900' : 'text-ink-700 hover:bg-paper'
                    )}
                  >
                    <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center', i === idx ? 'text-ink-900' : 'text-ink-400')}>
                      {it.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{it.label}</span>
                    {it.hint && <span className="shrink-0 truncate text-xs text-ink-400">{it.hint}</span>}
                    {i === idx && <Kbd>↵</Kbd>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[10px] text-ink-400">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
              <span className="ml-auto flex items-center gap-1"><UserIcon size={11} /> {me?.name}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
