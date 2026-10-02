import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListTree } from 'lucide-react';
import { formatDayLabel, formatTime, timeAgo } from '../lib/format';
import { verbStyle } from '../lib/verbs';
import { useData } from '../stores/data';
import { Avatar, EmptyState, Skeleton, cx } from '../components/ui';

export function ActivityPage() {
  const loaded = useData((s) => s.loaded);
  const activity = useData((s) => s.activity);
  const groups = useData((s) => s.groups);
  const users = useData((s) => s.users);
  const [groupFilter, setGroupFilter] = useState<number | 'all'>('all');

  const shown = useMemo(
    () => (groupFilter === 'all' ? activity : activity.filter((a) => a.groupId === groupFilter)),
    [activity, groupFilter]
  );

  const dayStarts = useMemo(() => {
    const map = new Map<number, string>();
    let last = '';
    shown.forEach((a, i) => {
      const label = formatDayLabel(a.createdAt);
      if (label !== last) {
        map.set(i, label);
        last = label;
      }
    });
    return map;
  }, [shown]);

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Activity</h1>
          <p className="mt-1 text-sm text-ink-400">A live audit trail of everything happening in your groups.</p>
        </div>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="rounded-xl border border-line bg-panel px-3 py-1.5 text-sm font-medium"
          aria-label="Filter by group"
        >
          <option value="all">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </header>

      <div className="mt-5">
        {!loaded && (
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        )}
        {loaded && shown.length === 0 && (
          <EmptyState
            icon={<ListTree size={36} />}
            title="No activity yet"
            hint="Task moves, new announcements and membership changes will be logged here."
          />
        )}
        {/* Timeline: a rail on the left, avatars as nodes, day separators */}
        <ol className="relative ml-4 border-l border-line pl-6">
          {shown.map((a, i) => {
            const u = users[a.userId];
            const v = verbStyle(a.verb);
            return (
              <Fragment key={a.id}>
                {dayStarts.has(i) && (
                  <li className={cx('relative mb-2', i > 0 && 'mt-6')}>
                    <span className="absolute -left-[31px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-panel bg-ink-300" />
                    <span className="text-xs font-medium uppercase tracking-wide text-ink-500">{dayStarts.get(i)}</span>
                  </li>
                )}
                <li className="anim-in relative mb-1">
                  <span className="absolute -left-[41px] top-1.5">
                    {u ? (
                      <Avatar name={u.name} color={u.avatarColor} size={30} className="ring-4 ring-paper" />
                    ) : (
                      <span className="block h-[30px] w-[30px] rounded-full bg-paper" />
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
                  <Link
                    to={`/groups/${a.groupId}`}
                    className="block rounded-md px-3 py-2.5 transition hover:bg-paper"
                    title={`Open ${a.groupName}`}
                  >
                    <p className="text-sm leading-snug">
                      <span className="font-semibold">{a.userName}</span>{' '}
                      <span className="text-ink-500">{a.verb}</span>{' '}
                      <span className="font-medium">“{a.subject}”</span>
                      {a.detail && <span className="text-ink-500"> {a.detail}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {a.groupName} · {formatTime(a.createdAt)} · {timeAgo(a.createdAt)}
                    </p>
                  </Link>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
