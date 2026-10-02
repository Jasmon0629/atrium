import { useState } from 'react';
import { AnnouncementComposer, AnnouncementList } from '../components/announcements/Announcements';
import { useData } from '../stores/data';
import { cx } from '../components/ui';

export function AnnouncementsPage() {
  const announcements = useData((s) => s.announcements);
  const unread = announcements.filter((a) => !a.read).length;
  const [unreadOnly, setUnreadOnly] = useState(false);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Announcements</h1>
          <p className="mt-1 text-sm text-ink-400">
            {unread > 0 ? `${unread} unread` : 'You are all caught up'} · company-wide and from your groups ·
            items mark themselves read once you have seen them
          </p>
        </div>
        <button
          onClick={() => setUnreadOnly((v) => !v)}
          aria-pressed={unreadOnly}
          className={cx(
            'rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
            unreadOnly ? 'border-ink-900 bg-paper text-ink-900' : 'border-line bg-panel text-ink-500 hover:bg-paper'
          )}
        >
          Unread only {unread > 0 && <span className="tabular-nums opacity-70">{unread}</span>}
        </button>
        <AnnouncementComposer />
      </header>
      <AnnouncementList unreadOnly={unreadOnly} />
    </div>
  );
}
