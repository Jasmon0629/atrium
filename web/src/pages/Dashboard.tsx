import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlarmClock,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  MessageSquare,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { greeting, isDueToday, isOverdue, tagColor, timeAgo } from '../lib/format';
import { useCountUp } from '../lib/useCountUp';
import { verbStyle } from '../lib/verbs';
import { useAuth } from '../stores/auth';
import { useData } from '../stores/data';
import { AnnouncementCard } from '../components/announcements/Announcements';
import { Avatar, GroupMark, PriorityBadge, ProgressRing, Skeleton, Sparkline, ValueProgressBar, badgeCls, cx } from '../components/ui';
import type { Activity, Task } from '../lib/types';

function StatTile({
  label,
  value,
  icon,
  tone,
  ring,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
  ring?: number;
}) {
  const shown = useCountUp(value);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-panel p-4">
      {ring !== undefined ? (
        <ProgressRing value={ring} size={36} stroke={3}>
          {icon}
        </ProgressRing>
      ) : (
        <span className={cx('flex h-9 w-9 items-center justify-center rounded-md', tone)}>{icon}</span>
      )}
      <div>
        <p className="text-xl font-semibold leading-none tabular-nums">{shown}</p>
        <p className="mt-1 text-xs text-ink-500">{label}</p>
      </div>
    </div>
  );
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Tasks completed per day over the last 14 days (7 shown + 7 for the delta). */
function completionSeries(tasks: Task[]): { week: number[]; total: number; prevTotal: number; labels: string[] } {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (!t.completedAt) continue;
    const k = dayKey(new Date(t.completedAt));
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  const values = days.map((k) => counts.get(k) || 0);
  const week = values.slice(7);
  const prev = values.slice(0, 7);
  return {
    week,
    total: week.reduce((a, b) => a + b, 0),
    prevTotal: prev.reduce((a, b) => a + b, 0),
    labels: days.slice(7).map((k) => new Date(k).toLocaleDateString(undefined, { weekday: 'narrow' })),
  };
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-8" aria-busy>
      <div>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[76px]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-40" />
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <Skeleton className="h-16" />
          <Skeleton className="h-48" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const loaded = useData((s) => s.loaded);
  const myTasks = useData((s) => s.myTasks);
  const groups = useData((s) => s.groups);
  const groupData = useData((s) => s.groupData);
  const users = useData((s) => s.users);
  const announcements = useData((s) => s.announcements);
  const activity = useData((s) => s.activity);
  const rooms = useData((s) => s.rooms);
  const openTaskModal = useData((s) => s.openTaskModal);

  const stats = useMemo(() => {
    const open = myTasks.filter((t) => !t.completedAt);
    return {
      dueToday: open.filter(isDueToday).length,
      overdue: open.filter(isOverdue).length,
      open: open.length,
      done: myTasks.filter((t) => !!t.completedAt).length,
    };
  }, [myTasks]);

  // Everything the store knows about, deduplicated — boards visited this session plus my tasks
  const knownTasks = useMemo(() => {
    const map = new Map<number, Task>();
    for (const gd of Object.values(groupData)) for (const t of gd.tasks) map.set(t.id, t);
    for (const t of myTasks) map.set(t.id, t);
    return [...map.values()];
  }, [groupData, myTasks]);
  const series = useMemo(() => completionSeries(knownTasks), [knownTasks]);
  const weekTotal = useCountUp(series.total);

  const chatUnread = rooms.reduce((s, r) => s + r.unread, 0);
  const latestAnns = useMemo(
    () => [...announcements].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.id - a.id).slice(0, 3),
    [announcements]
  );
  const focusTasks = useMemo(
    () =>
      myTasks
        .filter((t) => !t.completedAt)
        .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
        .slice(0, 5),
    [myTasks]
  );
  const onlineTeam = useMemo(
    () => Object.values(users).filter((u) => u.online && u.id !== user?.id),
    [users, user?.id]
  );

  if (!loaded) return <DashboardSkeleton />;

  const completion = stats.open + stats.done ? (stats.done / (stats.open + stats.done)) * 100 : 0;
  const delta = series.total - series.prevTotal;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {greeting()}, {user?.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} ·
            what your teams are working on right now.
          </p>
        </div>
        {onlineTeam.length > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-line bg-panel py-1 pl-1 pr-3">
            <span className="flex -space-x-2">
              {onlineTeam.slice(0, 5).map((u) => (
                <Avatar key={u.id} name={u.name} size={24} online />
              ))}
            </span>
            <span className="text-xs text-ink-500">{onlineTeam.length} online now</span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Due today" value={stats.dueToday} icon={<CalendarCheck size={17} className="text-ink-700" />} tone="bg-paper" />
        <StatTile label="Overdue" value={stats.overdue} icon={<AlarmClock size={17} className={stats.overdue > 0 ? 'text-urgent' : 'text-ink-700'} />} tone={stats.overdue > 0 ? 'bg-urgent-soft' : 'bg-paper'} />
        <StatTile label="Open tasks" value={stats.open} icon={<ClipboardList size={17} className="text-ink-700" />} tone="bg-paper" />
        <StatTile label="Completed" value={stats.done} icon={<CheckCircle2 size={15} className="text-ink-700" />} tone="bg-paper" ring={completion} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* My focus */}
          <section className="rounded-lg border border-line bg-panel">
            <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-sm font-semibold">My focus</h2>
              <Link to="/tasks" className="text-xs font-medium text-ink-500 hover:text-ink-900 hover:underline">
                All my tasks →
              </Link>
            </header>
            <ul className="divide-y divide-line px-2 pb-2">
              {focusTasks.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-ink-400">Nothing assigned to you — enjoy the calm.</li>
              )}
              {focusTasks.map((t) => {
                const g = groups.find((x) => x.id === t.groupId);
                const overdue = isOverdue(t);
                const today = isDueToday(t);
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => openTaskModal(t.id)}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-paper"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{t.title}</span>
                          <PriorityBadge priority={t.priority} />
                          {t.tags.slice(0, 2).map((tag) => {
                            const c = tagColor(tag);
                            return (
                              <span
                                key={tag}
                                className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium"
                                style={{ backgroundColor: c.bg, color: c.fg }}
                              >
                                {tag}
                              </span>
                            );
                          })}
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-xs text-ink-500">
                          {g?.name ?? ''}
                          {t.progress > 0 && (
                            <span className="flex items-center gap-1.5">
                              <span className="h-1 w-16 overflow-hidden rounded-full bg-line">
                                <span className="block h-full rounded-full bg-ink-700" style={{ width: `${t.progress}%` }} />
                              </span>
                              <span className="font-mono text-[11px]">{t.progress}%</span>
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="flex -space-x-1.5">
                        {t.assignees.slice(0, 3).map((id) =>
                          users[id] ? <Avatar key={id} name={users[id].name} size={20} /> : null
                        )}
                      </span>
                      {t.dueDate && (
                        <span
                          className={cx(
                            'w-16 text-right text-xs font-medium',
                            overdue ? 'text-urgent' : today ? 'text-high' : 'text-ink-500'
                          )}
                        >
                          {overdue ? 'Overdue' : today ? 'Today' : t.dueDate.slice(5)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Groups overview */}
          <section>
            <h2 className="mb-2 px-1 text-sm font-semibold">My groups</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((g) => {
                const online = groupData[g.id]?.members.filter((m) => m.online) || [];
                return (
                  <Link key={g.id} to={`/groups/${g.id}`} className="card-lift rounded-lg border border-line bg-panel p-4">
                    <div className="flex items-center gap-2.5">
                      <GroupMark name={g.name} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{g.name}</p>
                        <p className="flex items-center gap-1 text-[11px] text-ink-500">
                          <Users size={11} /> {g.memberCount} · {g.role}
                        </p>
                      </div>
                      {online.length > 0 && (
                        <span className="flex -space-x-1.5" title={`${online.length} online`}>
                          {online.slice(0, 3).map((m) => (
                            <Avatar key={m.id} name={m.name} size={20} online />
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-3 text-xs text-ink-500">
                      <span className="font-medium text-ink-900 tabular-nums">{g.taskTotal} tasks</span>
                      <span className="tabular-nums">{g.taskDone} done</span>
                      {g.taskOverdue > 0 && (
                        <span className={cx(badgeCls, 'bg-urgent-soft text-urgent tabular-nums')}>{g.taskOverdue} overdue</span>
                      )}
                    </div>
                    <div className="mt-2">
                      <ValueProgressBar
                        compact
                        progress={g.taskTotal ? (g.taskDone / g.taskTotal) * 100 : 0}
                        value={g.value}
                        valueUnit={g.valueUnit}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {/* This week */}
          <section className="rounded-lg border border-line bg-panel p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-500">Completed this week</p>
                <p className="mt-1 text-xl font-semibold leading-none tabular-nums">{weekTotal}</p>
              </div>
              <span
                className={cx(
                  badgeCls,
                  delta > 0 ? 'bg-success-soft text-success' : delta < 0 ? 'bg-urgent-soft text-urgent' : 'bg-paper text-ink-500'
                )}
              >
                {delta > 0 ? <TrendingUp size={12} /> : delta < 0 ? <TrendingDown size={12} /> : null}
                {delta > 0 ? `+${delta}` : delta} vs last week
              </span>
            </div>
            <div className="mt-3">
              <Sparkline values={series.week} height={48} />
              <div className="mt-1 flex justify-between text-[10px] font-medium text-ink-300">
                {series.labels.map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </div>
            </div>
          </section>

          {/* Unread messages */}
          <Link to="/chat" className="card-lift flex items-center gap-3 rounded-lg border border-line bg-panel p-4">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-md bg-paper">
              <MessageSquare size={17} className="text-ink-700" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {chatUnread > 0 ? `${chatUnread} unread message${chatUnread > 1 ? 's' : ''}` : 'Chat'}
              </p>
              <p className="text-xs text-ink-500">{chatUnread > 0 ? 'Catch up with your teams' : 'All caught up'}</p>
            </div>
            {chatUnread > 0 && <span className={cx(badgeCls, 'bg-line text-ink-700')}>{chatUnread}</span>}
          </Link>

          {/* Announcements */}
          <section>
            <header className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold">Latest announcements</h2>
              <Link to="/announcements" className="text-xs font-medium text-ink-500 hover:text-ink-900 hover:underline">
                All →
              </Link>
            </header>
            <div className="space-y-3">
              {latestAnns.map((a) => (
                <AnnouncementCard key={a.id} a={a} />
              ))}
            </div>
          </section>

          {/* Activity */}
          <section className="rounded-lg border border-line bg-panel">
            <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-sm font-semibold">Recent activity</h2>
              <Link to="/activity" className="text-xs font-medium text-ink-500 hover:text-ink-900 hover:underline">
                All →
              </Link>
            </header>
            <ul className="space-y-1 px-3 pb-3 pt-2">
              {activity.slice(0, 8).map((a: Activity) => {
                const u = users[a.userId];
                const v = verbStyle(a.verb);
                return (
                  <li key={a.id} className="anim-in">
                    <Link
                      to={`/groups/${a.groupId}`}
                      className="flex items-start gap-2.5 rounded-md px-2 py-1.5 transition hover:bg-paper"
                    >
                      <span className="relative mt-0.5 shrink-0">
                        {u ? (
                          <Avatar name={u.name} size={26} />
                        ) : (
                          <span className="block h-[26px] w-[26px] rounded-full bg-paper" />
                        )}
                        <span
                          className={cx(
                            'absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-panel',
                            v.tone
                          )}
                        >
                          {v.icon}
                        </span>
                      </span>
                      <span className="min-w-0 text-xs leading-relaxed text-ink-500">
                        <span className="font-medium text-ink-900">{a.userName}</span> {a.verb}{' '}
                        <span className="text-ink-700">“{a.subject}”</span>
                        {a.detail ? ` ${a.detail}` : ''}
                        <span className="block text-[11px] text-ink-400">
                          {a.groupName} · {timeAgo(a.createdAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
