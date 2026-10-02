import { useMemo, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { isDueToday, isOverdue, formatDate } from '../lib/format';
import { useData } from '../stores/data';
import { Avatar, EmptyState, PriorityBadge, Skeleton, Tabs, cx } from '../components/ui';
import type { Task } from '../lib/types';

type Filter = 'open' | 'today' | 'overdue' | 'done';

export function MyTasksPage() {
  const loaded = useData((s) => s.loaded);
  const myTasks = useData((s) => s.myTasks);
  const groups = useData((s) => s.groups);
  const users = useData((s) => s.users);
  const openTaskModal = useData((s) => s.openTaskModal);
  const [filter, setFilter] = useState<Filter>('open');

  const buckets = useMemo(() => {
    const open = myTasks.filter((t) => !t.completedAt);
    return {
      open,
      today: open.filter(isDueToday),
      overdue: open.filter(isOverdue),
      done: myTasks.filter((t) => !!t.completedAt),
    };
  }, [myTasks]);

  const shown: Task[] = useMemo(() => {
    const list = buckets[filter];
    return [...list].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  }, [buckets, filter]);

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-8">
      <h1 className="text-xl font-semibold">My Tasks</h1>
      <p className="mt-1 text-sm text-ink-500">Everything assigned to you, across every group.</p>

      <Tabs<Filter>
        className="mt-5"
        variant="pills"
        value={filter}
        onChange={setFilter}
        tabs={[
          { key: 'open', label: 'Open', count: buckets.open.length },
          { key: 'today', label: 'Due today', count: buckets.today.length },
          { key: 'overdue', label: 'Overdue', count: buckets.overdue.length },
          { key: 'done', label: 'Completed', count: buckets.done.length },
        ]}
      />

      <div className="mt-4 space-y-2">
        {!loaded && [0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
        {loaded && shown.length === 0 && (
          <EmptyState
            icon={<CheckSquare size={36} />}
            title="Nothing here"
            hint="Tasks assigned to you will appear in this list automatically."
          />
        )}
        {shown.map((t) => {
          const g = groups.find((x) => x.id === t.groupId);
          const overdue = isOverdue(t);
          const today = isDueToday(t);
          return (
            <button
              key={t.id}
              onClick={() => openTaskModal(t.id)}
              className={cx(
                'card-lift flex w-full items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 text-left'
              )}
            >
              <div className="min-w-0 flex-1">
                <p className={cx('truncate text-sm font-semibold', t.completedAt && 'text-ink-400 line-through')}>
                  {t.title}
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-400">
                  <span>{g?.name ?? ''}</span>
                  {t.checklistTotal > 0 && <span>· {t.checklistDone}/{t.checklistTotal} checklist</span>}
                  {t.commentCount > 0 && <span>· {t.commentCount} comments</span>}
                  {t.progress > 0 && !t.completedAt && (
                    <span className="flex items-center gap-1.5">
                      · <span className="h-1 w-14 overflow-hidden rounded-full bg-line">
                        <span className="block h-full rounded-full bg-ink-700" style={{ width: `${t.progress}%` }} />
                      </span>
                      <span className="font-mono text-[10px]">{t.progress}%</span>
                    </span>
                  )}
                </p>
              </div>
              <span className="hidden -space-x-1.5 sm:flex">
                {t.assignees.slice(0, 3).map((id) =>
                  users[id] ? <Avatar key={id} name={users[id].name} color={users[id].avatarColor} size={20} /> : null
                )}
              </span>
              {t.dueDate && (
                <span
                  className={cx(
                    'text-xs font-semibold',
                    overdue && !t.completedAt ? 'text-urgent' : today && !t.completedAt ? 'text-high' : 'text-ink-500'
                  )}
                >
                  {!t.completedAt && (overdue ? 'Overdue · ' : today ? 'Today · ' : '')}
                  {formatDate(t.dueDate)}
                </span>
              )}
              <PriorityBadge priority={t.priority} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
