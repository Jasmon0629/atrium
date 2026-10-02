import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { AlarmClock, CheckCircle2, ChevronRight, ExternalLink, LayoutGrid, MessageSquare, Pause, Pin, Play } from 'lucide-react';
import { isOverdue, monogram, timeAgo } from '../lib/format';
import { useCountUp } from '../lib/useCountUp';
import { usePager } from '../lib/usePager';
import { useData, useRecent } from '../stores/data';
import { useUi } from '../stores/ui';
import { GroupMark, ProgressRing, cx } from '../components/ui';
import { Bar, DueTag, ExpandButton, PRIORITY_DOT, PageDots, PanelHeader, TONE, dueLabel, sameLocalDay } from '../components/kiosk/shared';
import { KioskPopups, type KioskPopupKind } from '../components/kiosk/popups';
import type { Activity, Announcement, Column, GroupSummary, Task } from '../lib/types';

// The wallpaper is display-only: the single control opens the full app
// EXTERNALLY (new tab / default browser) and never navigates the display away.
const APP_URL = window.location.origin + import.meta.env.BASE_URL;

type OpenPopup = (p: KioskPopupKind) => void;

/** Dim the controls when idle; Esc still escapes for browser/TV usage. */
function useKioskChrome(escTo: string, enabled = true) {
  const [awake, setAwake] = useState(true);
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled) return;
    let timer = setTimeout(() => setAwake(false), 5000);
    const wake = () => {
      setAwake(true);
      clearTimeout(timer);
      timer = setTimeout(() => setAwake(false), 5000);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate(escTo);
    };
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', onKey);
    };
  }, [escTo, navigate, enabled]);
  return awake;
}

const TOUR_KEY = 'atrium-kiosk-tour';

export interface KioskTour {
  /** Auto-tour running: the display walks overview → each project → overview. */
  on: boolean;
  toggle: () => void;
  /** Seconds spent on each stop (`?tour=45` in the URL; default 30). */
  dwell: number;
  /** null = the all-projects overview, otherwise a group id. */
  stops: (number | null)[];
  go: (id: number | null) => void;
}

/**
 * Every project gets its own display, and the screen can walk through them by
 * itself. ←/→ step between projects, Home returns to the overview (TV remotes
 * map to these keys). The tour setting is remembered per browser so a TV keeps
 * touring after a reload. `paused` (a popup is open) holds the current stop.
 */
function useKioskTour(current: number | null, paused: boolean): KioskTour {
  const groups = useData((s) => s.groups);
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const dwell = Math.min(600, Math.max(10, Number(params.get('tour')) || 30));
  const [on, setOn] = useState<boolean>(() => {
    if (params.has('tour')) return true;
    try {
      return localStorage.getItem(TOUR_KEY) === 'on';
    } catch {
      return false;
    }
  });
  const stops = useMemo<(number | null)[]>(() => [null, ...groups.map((g) => g.id)], [groups]);
  const search = location.search;
  const go = useCallback(
    (id: number | null) => navigate(`/kiosk${id === null ? '' : `/${id}`}${search}`),
    [navigate, search]
  );
  const toggle = useCallback(() => {
    setOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(TOUR_KEY, next ? 'on' : 'off');
      } catch {}
      return next;
    });
  }, []);

  // Move on after the dwell time; the timer restarts whenever the stop changes
  useEffect(() => {
    if (!on || paused || stops.length < 2) return;
    const i = stops.indexOf(current);
    const t = setTimeout(() => go(stops[(i + 1) % stops.length]), dwell * 1000);
    return () => clearTimeout(t);
  }, [on, paused, current, stops, dwell, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || paused) return;
      const i = stops.indexOf(current);
      if (e.key === 'ArrowRight') go(stops[(i + 1) % stops.length]);
      else if (e.key === 'ArrowLeft') go(stops[(i - 1 + stops.length) % stops.length]);
      else if (e.key === 'Home') go(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stops, current, go, paused]);

  return { on, toggle, dwell, stops, go };
}

/** Thin accent line along the top filling over the dwell time — how long until the tour moves on. */
function TourBar({ tour, current, paused }: { tour: KioskTour; current: number | null; paused: boolean }) {
  if (!tour.on) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-white/5">
      <div
        key={String(current)}
        className="kiosk-tour-bar h-full bg-brand"
        style={{ animationDuration: `${tour.dwell}s`, animationPlayState: paused ? 'paused' : 'running' }}
      />
    </div>
  );
}

/** Bottom-centre switcher: the overview plus every project, the current one lit. */
function ProjectSwitcher({ current, awake, tour }: { current: number | null; awake: boolean; tour: KioskTour }) {
  const groups = useData((s) => s.groups);
  if (groups.length === 0) return null;
  const pill = (active: boolean) =>
    cx(
      'flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors',
      active ? 'bg-white/10 text-white ring-1 ring-white/15' : 'text-night-muted hover:bg-white/5 hover:text-night-text'
    );
  return (
    <nav
      aria-label="Projects"
      className={cx(
        'thin-scroll fixed bottom-4 left-1/2 z-50 flex max-w-[72vw] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-lg border border-night-line bg-night-800/95 p-1 transition-opacity duration-500',
        awake || tour.on ? 'opacity-95' : 'opacity-25'
      )}
    >
      <button type="button" onClick={() => tour.go(null)} className={pill(current === null)} aria-current={current === null ? 'page' : undefined} title="All projects (Home)">
        <LayoutGrid size={13} /> All
      </button>
      {groups.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => tour.go(g.id)}
          className={pill(current === g.id)}
          aria-current={current === g.id ? 'page' : undefined}
          title={`${g.name} display`}
        >
          <span className="max-w-[9rem] truncate">{g.name}</span>
        </button>
      ))}
    </nav>
  );
}

const kioskIconBtn =
  'relative flex h-8 w-8 items-center justify-center rounded-md border border-night-line bg-night-800/95 text-night-text/80 hover:border-night-text/40 hover:text-white';

/** Corner controls: chat, auto-tour, overview, open the app. Icon-only, dimmed when idle. */
function KioskControls({
  awake,
  showOverviewLink,
  tour,
  openPopup,
  groupId,
}: {
  awake: boolean;
  showOverviewLink?: boolean;
  tour: KioskTour;
  openPopup: OpenPopup;
  groupId?: number;
}) {
  const rooms = useData((s) => s.rooms);
  const unread = rooms.filter((r) => r.kind === 'group' && (groupId === undefined || r.groupId === groupId)).reduce((n, r) => n + r.unread, 0);
  return (
    <div className={cx('fixed bottom-4 right-4 z-50 flex items-center gap-2 transition-opacity duration-500', awake ? 'opacity-90' : 'opacity-20')}>
      <button type="button" onClick={() => openPopup({ kind: 'chat', groupId })} className={kioskIconBtn} title="Team chat" aria-label="Open team chat">
        <MessageSquare size={13} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded bg-night-text px-1 text-[9px] font-semibold text-night-900" aria-hidden>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={tour.toggle}
        className={cx(kioskIconBtn, tour.on && 'border-brand/60 text-brand')}
        title={tour.on ? `Auto-tour on: next project every ${tour.dwell}s — click to pause` : 'Auto-tour every project'}
        aria-label="Toggle project auto-tour"
        aria-pressed={tour.on}
      >
        {tour.on ? <Pause size={13} /> : <Play size={13} />}
      </button>
      {showOverviewLink && (
        <Link to="/kiosk" className={kioskIconBtn} title="All projects overview" aria-label="All projects overview">
          <LayoutGrid size={13} />
        </Link>
      )}
      <a href={APP_URL} target="_blank" rel="noopener noreferrer" className={kioskIconBtn} title="Open Atrium in the browser" aria-label="Open Atrium in the browser">
        <ExternalLink size={13} />
      </a>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-right">
      <p className="text-5xl font-semibold tabular-nums leading-none">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p>
      <p className="mt-1 text-sm text-night-muted">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    </div>
  );
}

/** "Live · synced 3s ago" — a frozen screen becomes obvious, a lost connection shows amber. */
function Heartbeat({ label }: { label: string }) {
  const online = useUi((s) => s.online);
  const lastEventAt = useUi((s) => s.lastEventAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((Date.now() - lastEventAt) / 1000));
  const ago = secs < 5 ? 'just now' : secs < 60 ? `${secs}s ago` : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`;
  return (
    <p className="mt-0.5 flex items-center gap-2 text-sm text-night-muted">
      <span className="live-dot inline-block h-2 w-2 rounded-full" style={{ backgroundColor: online ? TONE.green : TONE.amber }} />
      {online ? (
        <>
          {label} · <span className="font-mono text-xs">synced {ago}</span>
        </>
      ) : (
        <span className="font-semibold" style={{ color: TONE.amber }}>
          Reconnecting…
        </span>
      )}
    </p>
  );
}

/** Small, quiet progress readout: thin bar + percent (+ value when set). */
function MiniProgress({ progress, value, valueUnit }: { progress: number; value: number; valueUnit: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const shown = useCountUp(pct);
  return (
    <span className="flex items-center gap-2.5">
      <Bar pct={pct} className="w-32" />
      <span className="font-mono text-xs font-semibold text-night-text tabular-nums">{shown}%</span>
      {value > 0 && (
        <span className="text-xs text-night-muted tabular-nums">
          {valueUnit} {value.toLocaleString()}
        </span>
      )}
    </span>
  );
}

const LIVE_VERB: Record<string, string> = { created: 'added', updated: 'updated', moved: 'moved', commented: 'commented on', deleted: 'removed' };

/**
 * Bottom strip: what matters right now — never the activity log. A teammate's
 * change flashes here the moment it happens (for the few seconds the store
 * keeps it "recent"); otherwise it rotates through open deadlines, nearest
 * first, then pinned notices. Expands to the full deadline list.
 */
function NowStrip({ tasks, notices, onExpand }: { tasks: (Task & { groupName?: string })[]; notices: Announcement[]; onExpand: () => void }) {
  const recent = useData((s) => s.recent);
  const users = useData((s) => s.users);
  const groupData = useData((s) => s.groupData);

  const live = useMemo(() => {
    let best: { task: Task; at: number; kind: string; actorId: number | null } | null = null;
    for (const t of tasks) {
      const ev = recent[t.id];
      if (ev && (!best || ev.at > best.at)) best = { task: t, at: ev.at, kind: ev.kind, actorId: ev.actorId };
    }
    return best;
  }, [recent, tasks]);

  const items = useMemo(() => {
    const out: { text: string; color: string }[] = [];
    const due = tasks.filter((t) => t.dueDate && !t.completedAt).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    for (const t of due.slice(0, 8)) {
      const d = dueLabel(t);
      const when = d.text === 'OVERDUE' ? 'Overdue' : d.text === 'TODAY' ? 'Due today' : d.text === 'TOMORROW' ? 'Due tomorrow' : `Due ${d.text.toLowerCase()}`;
      out.push({ text: `${when} · ${t.title}${t.groupName ? ` · ${t.groupName}` : ''}`, color: d.color });
    }
    for (const a of notices.filter((a) => a.pinned).slice(0, 3)) out.push({ text: `Pinned · ${a.title}`, color: TONE.text });
    return out;
  }, [tasks, notices]);

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000);
    return () => clearInterval(t);
  }, [items.length]);

  let shown: { text: string; color: string };
  if (live) {
    const who = (live.actorId && users[live.actorId]?.name.split(' ')[0]) || 'Someone';
    const col = groupData[live.task.groupId]?.columns.find((c) => c.id === live.task.columnId);
    shown = {
      text: `${who} ${LIVE_VERB[live.kind] ?? 'changed'} “${live.task.title}”${live.kind === 'moved' && col ? ` → ${col.name}` : ''}`,
      color: TONE.text,
    };
  } else {
    shown = items.length ? items[idx % items.length] : { text: 'Nothing due — clear runway', color: TONE.muted };
  }

  return (
    <div
      className={cx(
        'mt-4 flex items-center gap-3 overflow-hidden rounded-lg border bg-night-800/80 px-5 py-2.5 transition-colors duration-300',
        live ? 'border-brand/60' : 'border-night-line'
      )}
    >
      <span className={cx('h-2 w-2 shrink-0 rounded-full', live && 'live-dot')} style={{ backgroundColor: live ? 'var(--color-brand)' : shown.color }} />
      <p
        key={live ? `live-${live.task.id}-${live.at}` : `item-${idx}`}
        className="ticker-item min-w-0 flex-1 truncate text-sm"
        style={{ color: shown.color === TONE.muted ? TONE.muted : TONE.text }}
      >
        {live && <span className="mr-2 text-[10px] font-semibold uppercase tracking-widest text-brand">Live</span>}
        {shown.text}
      </p>
      <ExpandButton label="deadlines" onClick={onExpand} />
    </div>
  );
}

type RailPanel = 'announcement' | 'deadlines' | 'today';
const RAIL_LABEL: Record<RailPanel, string> = { announcement: 'Notices', deadlines: 'Coming up', today: 'Done today' };

/**
 * Tab row above the rotating right rail: shows which panel is on screen (with
 * a thin line filling over the 15 s dwell) and lets someone hold one — click a
 * tab to pin it, "Auto" to rotate again.
 */
function RailTabs({
  panels,
  active,
  pinned,
  cycleKey,
  onSelect,
  onAuto,
}: {
  panels: RailPanel[];
  active: RailPanel;
  pinned: boolean;
  cycleKey: number;
  onSelect: (p: RailPanel) => void;
  onAuto: () => void;
}) {
  return (
    <div role="tablist" aria-label="Right panel" className="flex shrink-0 items-center gap-1 rounded-lg border border-night-line bg-night-800/90 p-1">
      {panels.map((p) => (
        <button
          key={p}
          role="tab"
          type="button"
          aria-selected={p === active}
          onClick={() => onSelect(p)}
          className={cx(
            'relative flex-1 overflow-hidden rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            p === active ? 'bg-white/10 text-night-text' : 'text-night-muted hover:bg-white/5 hover:text-night-text'
          )}
        >
          {RAIL_LABEL[p]}
          {p === active && !pinned && (
            <span key={cycleKey} aria-hidden className="kiosk-tour-bar absolute inset-x-2 bottom-0.5 h-px bg-night-text/50" style={{ animationDuration: '15s' }} />
          )}
        </button>
      ))}
      {pinned && (
        <button
          type="button"
          onClick={onAuto}
          className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-night-muted hover:bg-white/5 hover:text-night-text"
          title="Rotate through the panels again"
        >
          Auto
        </button>
      )}
    </div>
  );
}

/** Deadline digest: nearest open deadlines, paged — expands to everything grouped by when. */
function DeadlinesPanel({
  tasks,
  withGroup,
  max = 6,
  onExpand,
}: {
  tasks: (Task & { groupName?: string })[];
  withGroup?: boolean;
  max?: number;
  onExpand: () => void;
}) {
  const users = useData((s) => s.users);
  const upcoming = useMemo(
    () => tasks.filter((t) => t.dueDate && !t.completedAt).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)),
    [tasks]
  );
  const { page, index, pages } = usePager(upcoming, max, 10000);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-night-line bg-night-800/90 p-5">
      <PanelHeader
        right={
          <>
            {upcoming.length > 0 && <span className="font-mono normal-case tracking-normal">{upcoming.length}</span>}
            <PageDots index={index} pages={pages} />
            <ExpandButton label="deadlines" onClick={onExpand} />
          </>
        }
      >
        <AlarmClock size={13} /> Coming up
      </PanelHeader>
      <ul key={index} className="fade-in mt-3 min-h-0 flex-1 space-y-2.5 overflow-hidden">
        {upcoming.length === 0 && <li className="text-sm text-night-muted">No open deadlines — clear runway.</li>}
        {page.map((t) => {
          const names = t.assignees
            .map((id) => users[id]?.name.split(' ')[0])
            .filter(Boolean)
            .join(', ');
          return (
            <li key={t.id} className="flex items-center gap-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_DOT[t.priority] }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-snug text-night-text">{t.title}</span>
                <span className="text-[11px] text-night-muted">
                  {withGroup && t.groupName ? `${t.groupName}${names ? ' · ' : ''}` : ''}
                  {names}
                </span>
              </span>
              <DueTag task={t} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Today's completions — a small win list for the wall; expands to the week. */
function CompletedTodayPanel({ tasks, withGroup, onExpand }: { tasks: (Task & { groupName?: string })[]; withGroup?: boolean; onExpand: () => void }) {
  const users = useData((s) => s.users);
  const done = useMemo(
    () =>
      tasks
        .filter((t) => t.completedAt && sameLocalDay(t.completedAt))
        .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!))
        .slice(0, 8),
    [tasks]
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-night-line bg-night-800/90 p-5">
      <PanelHeader
        right={
          <>
            <span className="text-lg font-semibold" style={{ color: TONE.green }}>
              {done.length}
            </span>
            <ExpandButton label="completed tasks" onClick={onExpand} />
          </>
        }
      >
        <CheckCircle2 size={13} style={{ color: TONE.green }} /> Completed today
      </PanelHeader>
      <ul className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-hidden">
        {done.length === 0 && <li className="text-sm text-night-muted">Nothing finished yet today — the day is young.</li>}
        {done.map((t) => (
          <li key={t.id} className="flex items-center gap-2.5">
            <CheckCircle2 size={14} className="shrink-0" style={{ color: TONE.green }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-snug text-night-text/80 line-through decoration-night-muted">{t.title}</span>
              <span className="text-[11px] text-night-muted">
                {withGroup && t.groupName ? `${t.groupName} · ` : ''}
                {t.assignees.map((id) => users[id]?.name.split(' ')[0]).filter(Boolean).join(', ')}
                {' · '}
                {timeAgo(t.completedAt!)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "3 done · 2 moved · 1 comment today" — the digest as one quiet line. */
function digestLine(activity: Activity[], tasks: Task[]): string {
  const todays = activity.filter((a) => sameLocalDay(a.createdAt));
  const parts: string[] = [];
  const done = tasks.filter((t) => t.completedAt && sameLocalDay(t.completedAt)).length;
  const moved = todays.filter((a) => a.verb === 'moved task').length;
  const created = todays.filter((a) => a.verb === 'created task').length;
  const comments = todays.filter((a) => a.verb === 'commented on').length;
  if (done) parts.push(`${done} completed`);
  if (moved) parts.push(`${moved} moved`);
  if (created) parts.push(`${created} new`);
  if (comments) parts.push(`${comments} comment${comments > 1 ? 's' : ''}`);
  return parts.length ? `Today: ${parts.join(' · ')}` : 'Quiet so far today';
}

/**
 * What the announcement card shows: pinned notices only. With nothing pinned
 * it falls back to the single most important recent one so the slot is never
 * blank; the expand control opens everything.
 */
function pinnedOf(announcements: Announcement[], groupId?: number): { list: Announcement[]; pinned: boolean } {
  const scoped = groupId ? announcements.filter((a) => a.scope === 'company' || a.groupId === groupId) : announcements;
  const rank = { urgent: 0, important: 1, general: 2 } as Record<string, number>;
  const sorted = [...scoped].sort((a, b) => Number(b.pinned) - Number(a.pinned) || rank[a.priority] - rank[b.priority] || b.id - a.id);
  const pinned = sorted.filter((a) => a.pinned);
  if (pinned.length) return { list: pinned.slice(0, 2), pinned: true };
  return { list: sorted.slice(0, 1), pinned: false };
}

function AnnouncementCard({ items, pinned, count, onExpand }: { items: Announcement[]; pinned: boolean; count: number; onExpand: () => void }) {
  const tone = (a: Announcement) => (a.priority === 'urgent' ? TONE.red : a.priority === 'important' ? TONE.amber : TONE.muted);
  return (
    <div className="shrink-0 rounded-lg border border-night-line bg-night-800/90 p-4">
      <PanelHeader
        right={
          <>
            {count > items.length && <span className="font-mono normal-case tracking-normal">{count}</span>}
            <ExpandButton label="announcements" onClick={onExpand} />
          </>
        }
      >
        {pinned ? <Pin size={12} /> : null} {pinned ? 'Pinned' : 'Announcement'}
      </PanelHeader>
      <ul className="mt-2 space-y-3">
        {items.length === 0 && <li className="text-sm text-night-muted">No announcements.</li>}
        {items.map((a) => (
          <li key={a.id}>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: tone(a) }}>
              <span className={cx('inline-block h-1.5 w-1.5 rounded-full', a.priority === 'urgent' && 'live-dot')} style={{ backgroundColor: tone(a) }} />
              {a.priority}
            </p>
            <h3 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug">{a.title}</h3>
            {a.body && <p className="mt-1 line-clamp-3 text-xs leading-snug text-night-text/70">{a.body}</p>}
            <p className="mt-1 text-[11px] text-night-muted">
              {a.authorName} · {timeAgo(a.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small count for the compact stat strip — tweens between values. */
function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  const shown = useCountUp(value);
  return (
    <span className="flex items-baseline gap-1.5">
      <span key={value} className="count-pop text-xl font-semibold tabular-nums" style={{ color }}>
        {shown}
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wider text-night-muted">{label}</span>
    </span>
  );
}

/** One board column on the display: paged list, animated count, pulse on teammates' changes; expands to the full column. */
function KioskColumn({ col, tasks, onExpand }: { col: Column; tasks: Task[]; onExpand: () => void }) {
  const count = useCountUp(tasks.length);
  const { page, index, pages } = usePager(tasks, 6, 9000);
  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-night-line bg-night-800/90 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-night-muted">
          {col.name}
          <PageDots index={index} pages={pages} />
        </h3>
        <span className="flex items-center gap-2">
          <span key={tasks.length} className="count-pop text-xl font-semibold tabular-nums">
            {count}
          </span>
          <ExpandButton label={`${col.name} column`} onClick={onExpand} />
        </span>
      </div>
      <ul key={index} className="fade-in mt-3 min-h-0 flex-1 space-y-2 overflow-hidden">
        {page.map((t) => (
          <KioskCard key={t.id} task={t} done={col.isDone} />
        ))}
        {tasks.length === 0 && <li className="text-xs text-night-muted">—</li>}
      </ul>
    </div>
  );
}

function KioskCard({ task: t, done }: { task: Task; done: boolean }) {
  const users = useData((s) => s.users);
  const recent = useRecent(t.id);
  const pct = t.completedAt ? 100 : Math.max(0, Math.min(100, Math.round(t.progress)));
  const names = t.assignees
    .map((id) => users[id]?.name.split(' ')[0])
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
  return (
    <motion.li
      layout
      layoutId={`kiosk-task-${t.id}`}
      transition={{ layout: { type: 'spring', stiffness: 380, damping: 36 } }}
      className={cx('rounded-md border border-transparent bg-night-700 px-3 py-2', recent && 'kiosk-pulse')}
    >
      <p className="flex items-start gap-2 text-[13px] font-medium leading-snug">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_DOT[t.priority] }} />
        <span className={cx('min-w-0 flex-1', done && 'text-night-muted line-through decoration-night-muted')}>{t.title}</span>
        <DueTag task={t} />
      </p>
      {t.description && <p className="mt-1 line-clamp-2 pl-4 text-[12px] leading-snug text-night-muted">{t.description}</p>}
      <div className="mt-1.5 flex items-center gap-2 pl-4">
        <Bar pct={pct} className="flex-1" />
        <span className="w-8 text-right font-mono text-[10px] font-semibold tabular-nums text-night-text">{pct}%</span>
        {t.checklistTotal > 0 && (
          <span className="text-[10px] tabular-nums text-night-muted">
            ✓ {t.checklistDone}/{t.checklistTotal}
          </span>
        )}
        {names && <span className="ml-auto truncate text-[10px] text-night-muted">{names}</span>}
      </div>
    </motion.li>
  );
}

/** Company overview wallpaper: every project on one screen — each card expands to its detail, the chevron opens its live board. */
function KioskOverview({ tour, awake, openPopup, paused }: { tour: KioskTour; awake: boolean; openPopup: OpenPopup; paused: boolean }) {
  const groups = useData((s) => s.groups);
  const groupData = useData((s) => s.groupData);
  const announcements = useData((s) => s.announcements);
  const activity = useData((s) => s.activity);
  const fetchGroup = useData((s) => s.fetchGroup);
  const [pinned, setPinned] = useState<RailPanel | null>(null);

  // Deadlines need every board; refresh them all on a slow loop
  useEffect(() => {
    if (groups.length === 0) return;
    const loadAll = () => groups.forEach((g) => fetchGroup(g.id).catch(() => {}));
    loadAll();
    const t = setInterval(loadAll, 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length, fetchGroup]);

  const allTasks = useMemo(() => {
    const nameOf = new Map(groups.map((g) => [g.id, g.name]));
    return Object.entries(groupData).flatMap(([gid, gd]) => gd.tasks.map((t) => ({ ...t, groupName: nameOf.get(Number(gid)) })));
  }, [groupData, groups]);

  const notice = useMemo(() => pinnedOf(announcements), [announcements]);
  const { page: groupPage, index: groupIndex, pages: groupPages } = usePager(groups, 8, 12000);

  // Right rail rotates between what is available — unless someone pinned a tab
  const panels = useMemo(() => {
    const p: RailPanel[] = [];
    if (notice.list.length) p.push('announcement');
    p.push('deadlines');
    if (allTasks.some((t) => t.completedAt && sameLocalDay(t.completedAt))) p.push('today');
    return p;
  }, [notice, allTasks]);
  const { page: railPage, index: railIndex } = usePager(panels, 1, 15000);
  const rail: RailPanel = pinned && panels.includes(pinned) ? pinned : railPage[0] ?? 'deadlines';

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-night-900 p-6 pb-16 text-night-text lg:p-8 lg:pb-16">
      <TourBar tour={tour} current={null} paused={paused} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <header className="flex items-end justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-brand">ASM TECH</p>
            <h1 className="text-3xl font-semibold leading-tight">Atrium · Live overview</h1>
            <Heartbeat label={`Every team and project, live · ${digestLine(activity, allTasks)}`} />
          </div>
          <Clock />
        </header>

        <div className="mt-5 grid min-h-0 flex-1 grid-cols-3 gap-5">
          {/* Project cards, two per row, paged */}
          <div className="col-span-2 flex min-h-0 flex-col gap-3 overflow-hidden">
            <div key={groupIndex} className="fade-in grid grid-cols-2 gap-3">
              {groupPage.map((g: GroupSummary) => {
                const pct = g.taskTotal ? (g.taskDone / g.taskTotal) * 100 : 0;
                return (
                  // Wallpaper-safe: the card itself is inert — only the two
                  // small controls act, so stray clicks can't switch the display.
                  <div key={g.id} className="flex items-center gap-4 rounded-lg border border-night-line bg-night-800/90 px-5 py-4">
                    <ProgressRing value={pct} size={58} stroke={4} color={TONE.text} track="rgba(255,255,255,0.08)">
                      <span className="text-sm font-semibold uppercase tracking-wide">{monogram(g.name)}</span>
                    </ProgressRing>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[17px] font-semibold">{g.name}</p>
                      <p className="mt-0.5 text-xs text-night-muted">
                        {g.taskTotal - g.taskDone} open · {g.taskDone} done
                        {g.taskOverdue > 0 && (
                          <span className="font-semibold" style={{ color: TONE.red }}>
                            {' '}
                            · {g.taskOverdue} overdue
                          </span>
                        )}
                      </p>
                      <p className="mt-1 flex items-center gap-2 font-mono text-xs tabular-nums text-night-text">
                        {Math.round(pct)}%
                        {g.value > 0 && (
                          <span className="font-sans text-night-muted">
                            {g.valueUnit} {g.value.toLocaleString()}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="flex shrink-0 flex-col items-center gap-1.5">
                      <ExpandButton label={`${g.name} details`} onClick={() => openPopup({ kind: 'project', groupId: g.id })} />
                      <Link
                        to={`/kiosk/${g.id}`}
                        title={`Open the ${g.name} display`}
                        aria-label={`Open the ${g.name} display`}
                        className="flex h-6 w-6 items-center justify-center rounded border border-transparent text-night-muted/70 transition-colors hover:border-night-line hover:bg-white/5 hover:text-night-text"
                      >
                        <ChevronRight size={13} />
                      </Link>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-auto flex justify-center">
              <PageDots index={groupIndex} pages={groupPages} />
            </div>
          </div>

          {/* Right rail: rotates notices / deadlines / today's wins; the tab row shows which, and holds one on request */}
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <RailTabs panels={panels} active={rail} pinned={pinned !== null} cycleKey={railIndex} onSelect={setPinned} onAuto={() => setPinned(null)} />
            <div key={rail} className="fade-in flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              {rail === 'announcement' && (
                <AnnouncementCard items={notice.list} pinned={notice.pinned} count={announcements.length} onExpand={() => openPopup({ kind: 'announcements' })} />
              )}
              {rail === 'today' ? (
                <CompletedTodayPanel tasks={allTasks} withGroup onExpand={() => openPopup({ kind: 'completed' })} />
              ) : (
                <DeadlinesPanel tasks={allTasks} withGroup max={rail === 'announcement' ? 6 : 9} onExpand={() => openPopup({ kind: 'deadlines' })} />
              )}
            </div>
          </div>
        </div>

        <NowStrip tasks={allTasks} notices={notice.list} onExpand={() => openPopup({ kind: 'deadlines' })} />
      </div>
      <ProjectSwitcher current={null} awake={awake} tour={tour} />
      <KioskControls awake={awake} tour={tour} openPopup={openPopup} />
    </div>
  );
}

export function KioskPage() {
  const { groupId: gid } = useParams();
  const groupId = Number(gid);
  const validId = !gid || Number.isInteger(groupId);
  const groups = useData((s) => s.groups);
  const gd = useData((s) => s.groupData[groupId]);
  const announcements = useData((s) => s.announcements);
  const activity = useData((s) => s.activity);
  const fetchGroup = useData((s) => s.fetchGroup);
  const [loadError, setLoadError] = useState(false);
  const [zeroGlow, setZeroGlow] = useState(false);
  const [popup, setPopup] = useState<KioskPopupKind | null>(null);
  const prevOverdue = useRef<number | null>(null);
  const awake = useKioskChrome(`/groups/${groupId}`, !!gid);
  const tour = useKioskTour(gid ? groupId : null, popup !== null);
  const openPopup = useCallback<OpenPopup>((p) => setPopup(p), []);
  const closePopup = useCallback(() => setPopup(null), []);

  const group = groups.find((g) => g.id === groupId);

  useEffect(() => {
    if (!gid || !Number.isInteger(Number(gid))) return;
    const load = () =>
      fetchGroup(Number(gid))
        .then(() => setLoadError(false)) // self-heal when access/network returns
        .catch(() => setLoadError(true));
    load();
    // Safety net for a screen that stays open for weeks: full resync every 5 minutes
    const resync = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(resync);
  }, [gid, fetchGroup]);

  const stats = useMemo(() => {
    const tasks = gd?.tasks || [];
    return {
      total: tasks.length,
      open: tasks.filter((t) => !t.completedAt).length,
      done: tasks.filter((t) => !!t.completedAt).length,
      overdue: tasks.filter(isOverdue).length,
    };
  }, [gd?.tasks]);

  // Overdue count dropping to zero gets a one-time pulse on the stat strip
  useEffect(() => {
    if (prevOverdue.current !== null && prevOverdue.current > 0 && stats.overdue === 0) {
      setZeroGlow(true);
      const t = setTimeout(() => setZeroGlow(false), 3200);
      return () => clearTimeout(t);
    }
    prevOverdue.current = stats.overdue;
  }, [stats.overdue]);

  const notice = useMemo(() => pinnedOf(announcements, groupId), [announcements, groupId]);
  const groupActivity = useMemo(() => activity.filter((a) => a.groupId === groupId), [activity, groupId]);
  const scopedCount = useMemo(
    () => announcements.filter((a) => a.scope === 'company' || a.groupId === groupId).length,
    [announcements, groupId]
  );

  // No group in the URL: the company-wide overview display
  if (!gid) {
    return (
      <>
        <KioskOverview tour={tour} awake={awake} openPopup={openPopup} paused={popup !== null} />
        <KioskPopups popup={popup} onClose={closePopup} />
      </>
    );
  }
  if (!validId) return <Navigate to="/kiosk" replace />;

  if (!group || !gd) {
    if (loadError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-night-900 text-night-text/80">
          <p className="text-2xl font-semibold text-night-text">This board isn't available</p>
          <p className="text-sm">The group may have been removed, or this account lost access to it.</p>
          <a
            href={APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 rounded-md border border-night-line px-4 py-2 text-sm font-medium hover:bg-white/5 hover:text-white"
          >
            Open Atrium
          </a>
        </div>
      );
    }
    return (
      <div className="flex h-screen items-center justify-center bg-night-900 text-night-muted">
        <span className="flex items-center gap-3">
          <span className="live-dot h-2 w-2 rounded-full" style={{ backgroundColor: TONE.green }} /> Loading live display…
        </span>
      </div>
    );
  }

  const columns = [...gd.columns].sort((a, b) => a.position - b.position);

  function tasksIn(colId: number): Task[] {
    return (gd?.tasks || []).filter((t) => t.columnId === colId).sort((a, b) => a.position - b.position);
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-night-900 p-6 pb-16 text-night-text lg:p-8 lg:pb-16">
      <TourBar tour={tour} current={groupId} paused={popup !== null} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Header: identity left, clock right */}
        <header className="flex items-end justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <GroupMark name={group.name} size={48} dark />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-widest text-brand">ASM TECH</p>
              <h1 className="truncate text-3xl font-semibold leading-tight">{group.name}</h1>
              <Heartbeat label="Live team board" />
            </div>
          </div>
          <Clock />
        </header>

        {/* One compact strip: progress, counts, today's digest — expands to the full project */}
        <div
          className={cx(
            'mt-4 flex flex-wrap items-center gap-x-7 gap-y-2 rounded-lg border border-night-line bg-night-800/80 px-5 py-3',
            zeroGlow && 'kiosk-pulse'
          )}
        >
          <MiniProgress progress={stats.total ? (stats.done / stats.total) * 100 : 0} value={group.value} valueUnit={group.valueUnit} />
          <span className="h-5 w-px bg-night-line" aria-hidden />
          <Stat value={stats.open} label="open" color={TONE.text} />
          <Stat value={stats.done} label="done" color={TONE.green} />
          <Stat value={stats.overdue} label="overdue" color={stats.overdue > 0 ? TONE.red : TONE.muted} />
          <span className="ml-auto flex items-center gap-3 text-xs text-night-muted">
            {digestLine(groupActivity, gd.tasks)}
            <ExpandButton label="project details" onClick={() => openPopup({ kind: 'project', groupId })} />
          </span>
        </div>

        {/* Board + deadlines, everything sized to the screen */}
        <div className="mt-5 grid min-h-0 flex-1 grid-cols-4 gap-5">
          <div className="col-span-3 grid min-h-0 gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, 1fr)` }}>
            {columns.slice(0, 4).map((col) => (
              <KioskColumn key={col.id} col={col} tasks={tasksIn(col.id)} onExpand={() => openPopup({ kind: 'column', groupId, columnId: col.id })} />
            ))}
          </div>

          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <AnnouncementCard items={notice.list} pinned={notice.pinned} count={scopedCount} onExpand={() => openPopup({ kind: 'announcements', groupId })} />
            <DeadlinesPanel tasks={gd.tasks} max={6} onExpand={() => openPopup({ kind: 'deadlines', groupId })} />
          </div>
        </div>

        <NowStrip tasks={gd.tasks} notices={notice.list} onExpand={() => openPopup({ kind: 'deadlines', groupId })} />
      </div>

      <ProjectSwitcher current={groupId} awake={awake} tour={tour} />
      <KioskControls awake={awake} showOverviewLink tour={tour} openPopup={openPopup} groupId={groupId} />
      <KioskPopups popup={popup} onClose={closePopup} />
    </div>
  );
}
