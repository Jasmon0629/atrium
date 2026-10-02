import { CalendarDays, CheckCircle2, CheckSquare, MessageSquare, UserPlus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '../../stores/auth';
import { useData, useRecent } from '../../stores/data';
import { Avatar, PriorityBadge, Tooltip, cx } from '../ui';
import { formatDate, isOverdue, isDueToday, tagColor, timeAgo } from '../../lib/format';
import type { Task } from '../../lib/types';

const RECENT_VERB: Record<string, string> = {
  created: 'added this',
  updated: 'updated this',
  moved: 'moved this',
  commented: 'commented',
  deleted: 'deleted this',
};

export function TaskCard({
  task,
  onOpen,
  onMarkDone,
  onAssignMe,
  canEdit = false,
  focusable = true,
}: {
  task: Task;
  onOpen: () => void;
  onMarkDone?: () => void;
  onAssignMe?: () => void;
  canEdit?: boolean;
  /** false when a sortable wrapper owns focus and keyboard handling (one tab stop per card). */
  focusable?: boolean;
}) {
  // Subscribe only to the people on this card, not the whole directory: a
  // presence change elsewhere must not re-render every card on the board.
  const assignees = useData(useShallow((s) => task.assignees.map((id) => s.users[id]).filter(Boolean)));
  const me = useAuth((s) => s.user);
  const recent = useRecent(task.id);
  const actor = useData((s) => (recent?.actorId ? s.users[recent.actorId] : undefined));
  const overdue = isOverdue(task);
  const dueToday = isDueToday(task);
  const isMine = !!me && task.assignees.includes(me.id);
  const showActions = canEdit && !task.completedAt && (onMarkDone || (onAssignMe && !isMine));

  return (
    <div
      role={focusable ? 'button' : undefined}
      tabIndex={focusable ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={
        focusable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      title={`Updated ${timeAgo(task.updatedAt)}`}
      className={cx(
        'group card-lift relative w-full cursor-pointer rounded-lg border border-line bg-panel p-3 text-left',
        recent && 'flash'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={cx(
            'text-sm font-medium leading-snug',
            task.completedAt ? 'text-ink-400 line-through' : 'text-ink-900'
          )}
        >
          {task.title}
        </p>
        <span className="relative shrink-0">
          <span className={cx(showActions && 'transition group-hover:opacity-0 group-focus-within:opacity-0')}>
            <PriorityBadge priority={task.priority} />
          </span>
          {showActions && (
            <span className="absolute right-0 top-0 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              {onAssignMe && !isMine && (
                <Tooltip label="Assign to me">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssignMe();
                    }}
                    className="rounded border border-line bg-panel p-1 text-ink-500 hover:bg-paper hover:text-ink-900"
                    aria-label="Assign to me"
                  >
                    <UserPlus size={13} />
                  </button>
                </Tooltip>
              )}
              {onMarkDone && (
                <Tooltip label="Mark done">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkDone();
                    }}
                    className="rounded border border-line bg-panel p-1 text-ink-500 hover:bg-success-soft hover:text-success"
                    aria-label="Mark done"
                  >
                    <CheckCircle2 size={13} />
                  </button>
                </Tooltip>
              )}
            </span>
          )}
        </span>
      </div>

      {task.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.map((t) => {
            const c = tagColor(t);
            return (
              <span
                key={t}
                className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: c.bg, color: c.fg }}
              >
                {t}
              </span>
            );
          })}
        </div>
      )}

      {task.progress > 0 && !task.completedAt && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-ink-700"
            style={{ width: `${task.progress}%`, transition: 'width 0.6s var(--ease-soft)' }}
          />
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-3 text-[11px] text-ink-500">
        {task.dueDate && (
          <span
            className={cx(
              'flex items-center gap-1 font-medium',
              overdue && !task.completedAt ? 'text-urgent' : dueToday && !task.completedAt ? 'text-high' : ''
            )}
          >
            <CalendarDays size={12} />
            {!task.completedAt && (overdue ? 'Overdue · ' : dueToday ? 'Today · ' : '')}
            {formatDate(task.dueDate)}
          </span>
        )}
        {task.checklistTotal > 0 && (
          <span className={cx('flex items-center gap-1', task.checklistDone === task.checklistTotal && 'text-success')}>
            <CheckSquare size={12} />
            {task.checklistDone}/{task.checklistTotal}
          </span>
        )}
        {task.commentCount > 0 && (
          <span className="flex items-center gap-1">
            <MessageSquare size={12} />
            {task.commentCount}
          </span>
        )}
        <span className="ml-auto flex -space-x-1.5">
          {assignees.slice(0, 3).map((u) => (
            <Avatar key={u.id} name={u.name} size={20} />
          ))}
          {task.assignees.length > 3 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line bg-paper text-[9px] font-semibold text-ink-500">
              +{task.assignees.length - 3}
            </span>
          )}
        </span>
      </div>

      {recent && actor && (
        <p className="anim-in mt-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-700">
          <Avatar name={actor.name} size={14} />
          {actor.name.split(' ')[0]} {RECENT_VERB[recent.kind] || 'changed this'} · just now
        </p>
      )}
    </div>
  );
}
