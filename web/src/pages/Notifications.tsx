import { Fragment, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, MessageSquare, Megaphone, ClipboardList, Users } from 'lucide-react';
import { tryMutate } from '../lib/api';
import { formatDayLabel, timeAgo } from '../lib/format';
import { useData } from '../stores/data';
import { Button, EmptyState, Skeleton, cx } from '../components/ui';

const TYPE_ICON: Record<string, React.ReactNode> = {
  task: <ClipboardList size={16} className="text-ink-500" />,
  comment: <MessageSquare size={16} className="text-ink-500" />,
  announcement: <Megaphone size={16} className="text-ink-500" />,
  message: <MessageSquare size={16} className="text-ink-500" />,
  group: <Users size={16} className="text-ink-500" />,
  admin: <Users size={16} className="text-ink-500" />,
};

export function NotificationsPage() {
  const loaded = useData((s) => s.loaded);
  const notifications = useData((s) => s.notifications);
  const unread = useData((s) => s.notifUnread);
  const markRead = useData((s) => s.markNotificationRead);
  const markAll = useData((s) => s.markAllNotificationsRead);
  const navigate = useNavigate();

  // Day headers ("Today", "Yesterday", "Monday, Sep 7") — the list is newest first
  const days = useMemo(() => {
    const out: { label: string; startsAt: number }[] = [];
    notifications.forEach((n, i) => {
      const label = formatDayLabel(n.createdAt);
      if (out.length === 0 || out[out.length - 1].label !== label) out.push({ label, startsAt: i });
    });
    return new Map(out.map((d) => [d.startsAt, d.label]));
  }, [notifications]);

  function open(id: number, link: string) {
    markRead(id).catch(() => {});
    if (link) navigate(link);
  }

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-8">
      <header className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="mt-1 text-sm text-ink-400">{unread > 0 ? `${unread} unread` : 'All caught up'}</p>
        </div>
        {unread > 0 && (
          <Button
            size="sm"
            variant="secondary"
            icon={<CheckCheck size={14} />}
            onClick={() => tryMutate(markAll(), { errorTitle: 'Could not mark notifications read' })}
          >
            Mark all read
          </Button>
        )}
      </header>

      <div className="mt-5 space-y-1.5">
        {!loaded && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
        {loaded && notifications.length === 0 && (
          <EmptyState
            icon={<Bell size={36} />}
            title="No notifications"
            hint="Task assignments, mentions, announcements and messages will show up here."
          />
        )}
        {notifications.map((n, i) => (
          <Fragment key={n.id}>
            {days.has(i) && (
              <p className={cx('px-1 pb-1 text-xs font-medium uppercase tracking-wide text-ink-500', i > 0 && 'pt-4')}>
                {days.get(i)}
              </p>
            )}
            <button
              onClick={() => open(n.id, n.link)}
              className={cx(
                'anim-in card-lift flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left',
                n.readAt ? 'border-line bg-panel' : 'border-ink-300 bg-paper'
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paper">
                {TYPE_ICON[n.type] || <Bell size={16} className="text-ink-500" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cx('block text-sm', n.readAt ? 'text-ink-700' : 'font-semibold text-ink-900')}>
                  {n.body}
                </span>
                <span className="text-xs text-ink-400">{timeAgo(n.createdAt)}</span>
              </span>
              {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-ink-900" aria-label="Unread" />}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
