import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, MessageSquare, Pin } from 'lucide-react';
import { timeAgo, todayStr } from '../../lib/format';
import { useData } from '../../stores/data';
import { Avatar, GroupMark, cx } from '../ui';
import { Bar, DueTag, KioskPopup, PRIORITY_DOT, TONE, sameLocalDay } from './shared';
import type { Announcement, Column, Task } from '../../lib/types';

/** Everything a display panel can expand into. `groupId` scopes to one project; absent = company-wide. */
export type KioskPopupKind =
  | { kind: 'announcements'; groupId?: number }
  | { kind: 'deadlines'; groupId?: number }
  | { kind: 'completed'; groupId?: number }
  | { kind: 'column'; groupId: number; columnId: number }
  | { kind: 'project'; groupId: number }
  | { kind: 'chat'; groupId?: number };

type ScopedTask = Task & { groupName?: string };

/** All tasks the store knows about, optionally limited to one group, tagged with the group name. */
function useScopedTasks(groupId?: number): ScopedTask[] {
  const groups = useData((s) => s.groups);
  const groupData = useData((s) => s.groupData);
  return useMemo(() => {
    const nameOf = new Map(groups.map((g) => [g.id, g.name]));
    return Object.entries(groupData)
      .filter(([gid]) => groupId === undefined || Number(gid) === groupId)
      .flatMap(([gid, gd]) => gd.tasks.map((t) => ({ ...t, groupName: nameOf.get(Number(gid)) })));
  }, [groupData, groups, groupId]);
}

function Owners({ ids, max = 3 }: { ids: number[]; max?: number }) {
  const users = useData((s) => s.users);
  const names = ids.map((id) => users[id]?.name.split(' ')[0]).filter(Boolean);
  if (names.length === 0) return null;
  return (
    <span className="truncate text-xs text-night-muted">
      {names.slice(0, max).join(', ')}
      {names.length > max ? ` +${names.length - max}` : ''}
    </span>
  );
}

/** One task, fully described: title, description, progress, checklist, owners, due. */
function TaskRow({ task: t, withGroup }: { task: ScopedTask; withGroup?: boolean }) {
  const pct = t.completedAt ? 100 : Math.max(0, Math.min(100, Math.round(t.progress)));
  return (
    <li className="rounded-lg border border-night-line bg-night-700/60 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_DOT[t.priority] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={cx('text-sm font-medium leading-snug', t.completedAt && 'text-night-muted line-through')}>{t.title}</p>
          {t.description && <p className="mt-1 text-xs leading-snug text-night-muted">{t.description}</p>}
          <div className="mt-2 flex items-center gap-3">
            <Bar pct={pct} className="w-28" />
            <span className="font-mono text-[11px] tabular-nums text-night-text">{pct}%</span>
            {t.checklistTotal > 0 && (
              <span className="text-[11px] tabular-nums text-night-muted">
                ✓ {t.checklistDone}/{t.checklistTotal}
              </span>
            )}
            {withGroup && t.groupName && <span className="text-[11px] text-night-muted">{t.groupName}</span>}
            <span className="ml-auto flex items-center gap-2">
              <Owners ids={t.assignees} />
              <DueTag task={t} />
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="rounded-lg border border-dashed border-night-line p-8 text-center text-sm text-night-muted">{children}</p>;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-night-muted">
        {title}
        {count !== undefined && <span className="font-mono normal-case tracking-normal">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

function AnnouncementsPopup({ groupId, onClose }: { groupId?: number; onClose: () => void }) {
  const announcements = useData((s) => s.announcements);
  const list = useMemo(() => {
    const scoped = groupId ? announcements.filter((a) => a.scope === 'company' || a.groupId === groupId) : announcements;
    const rank = { urgent: 0, important: 1, general: 2 } as Record<string, number>;
    return [...scoped].sort((a, b) => Number(b.pinned) - Number(a.pinned) || rank[a.priority] - rank[b.priority] || b.id - a.id);
  }, [announcements, groupId]);
  const tone = (a: Announcement) => (a.priority === 'urgent' ? TONE.red : a.priority === 'important' ? TONE.amber : TONE.muted);
  return (
    <KioskPopup title="Announcements" subtitle={`${list.length} in scope · pinned first`} onClose={onClose}>
      {list.length === 0 && <Empty>No announcements.</Empty>}
      <ul className="space-y-3">
        {list.map((a) => (
          <li key={a.id} className="rounded-lg border border-night-line bg-night-700/60 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest">
              <span className="rounded px-1.5 py-0.5" style={{ color: tone(a), backgroundColor: tone(a) + '1f' }}>
                {a.priority}
              </span>
              {a.pinned && (
                <span className="flex items-center gap-1 text-night-muted">
                  <Pin size={11} /> Pinned
                </span>
              )}
              <span className="ml-auto font-normal normal-case tracking-normal text-night-muted">
                {a.groupName || 'Company'} · {a.authorName} · {timeAgo(a.createdAt)}
              </span>
            </div>
            <h3 className="mt-2 text-base font-semibold leading-snug">{a.title}</h3>
            {a.body && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-night-text/85">{a.body}</p>}
          </li>
        ))}
      </ul>
    </KioskPopup>
  );
}

function DeadlinesPopup({ groupId, onClose }: { groupId?: number; onClose: () => void }) {
  const tasks = useScopedTasks(groupId);
  const groups = useMemo(() => {
    const open = tasks.filter((t) => t.dueDate && !t.completedAt).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    const today = todayStr();
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const weekStr = week.toISOString().slice(0, 10);
    return {
      overdue: open.filter((t) => t.dueDate! < today),
      today: open.filter((t) => t.dueDate === today),
      week: open.filter((t) => t.dueDate! > today && t.dueDate! <= weekStr),
      later: open.filter((t) => t.dueDate! > weekStr),
    };
  }, [tasks]);
  const total = groups.overdue.length + groups.today.length + groups.week.length + groups.later.length;
  return (
    <KioskPopup title="Coming up" subtitle={`${total} open tasks with a due date`} onClose={onClose} wide>
      {total === 0 && <Empty>No open deadlines — clear runway.</Empty>}
      <div className="space-y-6">
        {(
          [
            ['Overdue', groups.overdue],
            ['Today', groups.today],
            ['This week', groups.week],
            ['Later', groups.later],
          ] as [string, ScopedTask[]][]
        )
          .filter(([, list]) => list.length > 0)
          .map(([title, list]) => (
            <Section key={title} title={title} count={list.length}>
              <ul className="space-y-2">
                {list.map((t) => (
                  <TaskRow key={t.id} task={t} withGroup={groupId === undefined} />
                ))}
              </ul>
            </Section>
          ))}
      </div>
    </KioskPopup>
  );
}

function CompletedPopup({ groupId, onClose }: { groupId?: number; onClose: () => void }) {
  const tasks = useScopedTasks(groupId);
  const byDay = useMemo(() => {
    const since = Date.now() - 7 * 86400000;
    const done = tasks
      .filter((t) => t.completedAt && new Date(t.completedAt).getTime() >= since)
      .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
    const map = new Map<string, ScopedTask[]>();
    for (const t of done) {
      const key = sameLocalDay(t.completedAt!)
        ? 'Today'
        : new Date(t.completedAt!).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
      map.set(key, [...(map.get(key) || []), t]);
    }
    return [...map.entries()];
  }, [tasks]);
  const total = byDay.reduce((n, [, l]) => n + l.length, 0);
  return (
    <KioskPopup title="Completed" subtitle={`${total} finished in the last 7 days`} onClose={onClose}>
      {total === 0 && <Empty>Nothing finished this week yet.</Empty>}
      <div className="space-y-6">
        {byDay.map(([day, list]) => (
          <Section key={day} title={day} count={list.length}>
            <ul className="space-y-2">
              {list.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-lg border border-night-line bg-night-700/60 px-4 py-2.5">
                  <CheckCircle2 size={15} className="shrink-0" style={{ color: TONE.green }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-night-text/80 line-through decoration-night-muted">{t.title}</span>
                    <span className="text-[11px] text-night-muted">
                      {groupId === undefined && t.groupName ? `${t.groupName} · ` : ''}
                      {timeAgo(t.completedAt!)}
                    </span>
                  </span>
                  <Owners ids={t.assignees} />
                </li>
              ))}
            </ul>
          </Section>
        ))}
      </div>
    </KioskPopup>
  );
}

function ColumnPopup({ groupId, columnId, onClose }: { groupId: number; columnId: number; onClose: () => void }) {
  const gd = useData((s) => s.groupData[groupId]);
  const group = useData((s) => s.groups.find((g) => g.id === groupId));
  const col: Column | undefined = gd?.columns.find((c) => c.id === columnId);
  const tasks = useMemo(
    () => (gd?.tasks || []).filter((t) => t.columnId === columnId).sort((a, b) => a.position - b.position),
    [gd?.tasks, columnId]
  );
  return (
    <KioskPopup title={col?.name ?? 'Column'} subtitle={`${group?.name ?? ''} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}`} onClose={onClose}>
      {tasks.length === 0 && <Empty>Nothing in this column.</Empty>}
      <ul className="space-y-2">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ul>
    </KioskPopup>
  );
}

function ProjectPopup({ groupId, onClose }: { groupId: number; onClose: () => void }) {
  const group = useData((s) => s.groups.find((g) => g.id === groupId));
  const gd = useData((s) => s.groupData[groupId]);
  const columns = useMemo(() => [...(gd?.columns || [])].sort((a, b) => a.position - b.position), [gd?.columns]);
  const tasks = gd?.tasks || [];
  const done = tasks.filter((t) => t.completedAt).length;
  const overdue = tasks.filter((t) => t.dueDate && !t.completedAt && t.dueDate < todayStr()).length;
  return (
    <KioskPopup
      title={
        <span className="flex items-center gap-2">
          {group && <GroupMark name={group.name} size={26} dark />} {group?.name}
        </span>
      }
      subtitle={group?.description}
      onClose={onClose}
      wide
    >
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-night-line bg-night-700/60 px-4 py-3 text-sm">
        <span className="flex items-center gap-3">
          <Bar pct={tasks.length ? (done / tasks.length) * 100 : 0} className="w-32" />
          <span className="font-mono text-xs tabular-nums">{tasks.length ? Math.round((done / tasks.length) * 100) : 0}%</span>
        </span>
        <span>
          <span className="font-semibold tabular-nums">{tasks.length - done}</span> <span className="text-night-muted">open</span>
        </span>
        <span>
          <span className="font-semibold tabular-nums" style={{ color: TONE.green }}>{done}</span> <span className="text-night-muted">done</span>
        </span>
        <span>
          <span className="font-semibold tabular-nums" style={{ color: overdue > 0 ? TONE.red : TONE.muted }}>{overdue}</span>{' '}
          <span className="text-night-muted">overdue</span>
        </span>
        {group && group.value > 0 && (
          <span className="ml-auto text-night-muted">
            {group.valueUnit} {group.value.toLocaleString()}
          </span>
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {columns.map((col) => {
          const list = tasks.filter((t) => t.columnId === col.id).sort((a, b) => a.position - b.position);
          return (
            <Section key={col.id} title={col.name} count={list.length}>
              {list.length === 0 ? (
                <p className="text-xs text-night-muted">—</p>
              ) : (
                <ul className="space-y-2">
                  {list.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </ul>
              )}
            </Section>
          );
        })}
      </div>
    </KioskPopup>
  );
}

/**
 * Read-only view of team chat for the display: the project's room, or a room
 * picker on the overview. Live through the same socket as the app. Replies
 * happen in the app (link at the bottom) — a wall display has no keyboard.
 */
function ChatPopup({ groupId, onClose }: { groupId?: number; onClose: () => void }) {
  const rooms = useData((s) => s.rooms);
  const messages = useData((s) => s.messages);
  const users = useData((s) => s.users);
  const fetchMessages = useData((s) => s.fetchMessages);
  const groupRooms = useMemo(() => rooms.filter((r) => r.kind === 'group'), [rooms]);
  const [roomId, setRoomId] = useState<number | null>(() => {
    if (groupId) return groupRooms.find((r) => r.groupId === groupId)?.id ?? null;
    return groupRooms[0]?.id ?? null;
  });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (roomId) fetchMessages(roomId).catch(() => {});
  }, [roomId, fetchMessages]);

  const list = roomId ? messages[roomId] || [] : [];
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list.length, roomId]);

  const room = groupRooms.find((r) => r.id === roomId);
  const appUrl = window.location.origin + import.meta.env.BASE_URL;
  const showPicker = groupId === undefined && groupRooms.length > 1;

  return (
    <KioskPopup
      title={
        <span className="flex items-center gap-2">
          <MessageSquare size={17} className="text-night-muted" /> {room ? room.name : 'Team chat'}
        </span>
      }
      subtitle="Read-only on the display · live"
      onClose={onClose}
      wide={showPicker}
    >
      <div className={cx('grid gap-4', showPicker && 'lg:grid-cols-[260px_1fr]')}>
        {showPicker && (
          <ul className="space-y-1">
            {groupRooms.map((r) => {
              const last = r.lastMessage;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setRoomId(r.id)}
                    className={cx(
                      'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition',
                      r.id === roomId ? 'border-night-line bg-white/5' : 'border-transparent hover:bg-white/5'
                    )}
                    aria-current={r.id === roomId ? 'true' : undefined}
                  >
                    <GroupMark name={r.name} size={24} dark />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      {last && (
                        <span className="block truncate text-[11px] text-night-muted">
                          {users[last.userId]?.name.split(' ')[0]}: {last.body}
                        </span>
                      )}
                    </span>
                    {r.unread > 0 && <span className="rounded bg-white/10 px-1.5 text-[10px] font-semibold tabular-nums">{r.unread}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex min-h-[320px] flex-col rounded-lg border border-night-line bg-night-700/40">
          <div ref={listRef} className="thin-scroll max-h-[56vh] flex-1 space-y-3 overflow-y-auto p-4">
            {!roomId && <Empty>No team room available for this display.</Empty>}
            {roomId && list.length === 0 && <p className="text-center text-sm text-night-muted">No messages yet.</p>}
            {list.slice(-80).map((m) => {
              const u = users[m.userId];
              return (
                <div key={m.id} className="flex items-start gap-2.5">
                  {u && <Avatar name={u.name} size={28} className="mt-0.5" />}
                  <div className="min-w-0">
                    <p className="text-[11px] text-night-muted">
                      <span className="font-medium text-night-text">{u?.name ?? 'Someone'}</span> · {timeAgo(m.createdAt)}
                    </p>
                    {m.replyTo && (
                      <p className="mt-0.5 truncate border-l-2 border-night-line pl-2 text-[11px] text-night-muted">
                        {users[m.replyTo.userId]?.name.split(' ')[0]}: {m.replyTo.body}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words text-sm leading-snug">{m.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-night-line px-4 py-2 text-[11px] text-night-muted">
            <span>Replies are made in the app.</span>
            <a
              href={appUrl + 'chat'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded border border-night-line px-2 py-1 font-medium text-night-text hover:bg-white/5"
            >
              Open chat <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </div>
    </KioskPopup>
  );
}

/** Renders whichever popup is open. */
export function KioskPopups({ popup, onClose }: { popup: KioskPopupKind | null; onClose: () => void }) {
  if (!popup) return null;
  switch (popup.kind) {
    case 'announcements':
      return <AnnouncementsPopup groupId={popup.groupId} onClose={onClose} />;
    case 'deadlines':
      return <DeadlinesPopup groupId={popup.groupId} onClose={onClose} />;
    case 'completed':
      return <CompletedPopup groupId={popup.groupId} onClose={onClose} />;
    case 'column':
      return <ColumnPopup groupId={popup.groupId} columnId={popup.columnId} onClose={onClose} />;
    case 'project':
      return <ProjectPopup groupId={popup.groupId} onClose={onClose} />;
    case 'chat':
      return <ChatPopup groupId={popup.groupId} onClose={onClose} />;
  }
}
