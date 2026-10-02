import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useData } from '../stores/data';
import { Avatar, EmptyState, GroupMark, PriorityBadge, AnnBadge } from '../components/ui';
import type { SearchResults } from '../lib/types';

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const openTaskModal = useData((s) => s.openTaskModal);
  const groups = useData((s) => s.groups);

  useEffect(() => {
    if (q.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    api<SearchResults>('GET', `/api/search?q=${encodeURIComponent(q)}`)
      .then(setResults)
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  }, [q]);

  const total = results
    ? results.tasks.length + results.announcements.length + results.messages.length + results.users.length + results.groups.length
    : 0;

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-8">
      <h1 className="text-xl font-semibold">Search</h1>
      <p className="mt-1 text-sm text-ink-400">
        {q ? (
          <>
            Results for <b>“{q}”</b> {results && `· ${total} found`} — scoped to what you're allowed to see
          </>
        ) : (
          'Type in the search bar above to search tasks, announcements, messages, people and groups.'
        )}
      </p>

      {loading && <p className="mt-6 text-sm text-ink-400">Searching…</p>}

      {results && total === 0 && !loading && (
        <EmptyState icon={<SearchX size={36} />} title="No results" hint="Try different keywords. Search only returns items from groups you belong to." />
      )}

      {results && (
        <div className="mt-6 space-y-7">
          {results.tasks.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">Tasks</h2>
              <div className="space-y-2">
                {results.tasks.map((t) => {
                  const g = groups.find((x) => x.id === t.groupId);
                  return (
                    <button
                      key={t.id}
                      onClick={() => openTaskModal(t.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 text-left transition hover:bg-paper"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{t.title}</span>
                        <span className="text-xs text-ink-400">{g?.name ?? ''}</span>
                      </span>
                      <PriorityBadge priority={t.priority} />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {results.announcements.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">Announcements</h2>
              <div className="space-y-2">
                {results.announcements.map((a) => (
                  <Link
                    key={a.id}
                    to="/announcements"
                    className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 transition hover:bg-paper"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{a.title}</span>
                      <span className="text-xs text-ink-400">
                        {a.scope === 'company' ? 'Company-wide' : a.groupName} · {a.authorName} · {timeAgo(a.createdAt)}
                      </span>
                    </span>
                    <AnnBadge priority={a.priority} />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.messages.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">Messages</h2>
              <div className="space-y-2">
                {results.messages.map((m) => (
                  <Link
                    key={m.id}
                    to={`/chat/${m.roomId}`}
                    className="block rounded-lg border border-line bg-panel px-4 py-3 transition hover:bg-paper"
                  >
                    <p className="truncate text-sm">{m.body}</p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {m.senderName} · {timeAgo(m.createdAt)}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.users.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">People</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {results.users.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
                    <Avatar name={u.name} color={u.avatarColor} size={34} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{u.name}</p>
                      <p className="truncate text-xs text-ink-400">{u.title || u.department}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {results.groups.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">Groups</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {results.groups.map((g) => (
                  <Link
                    key={g.id}
                    to={`/groups/${g.id}`}
                    className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 transition hover:bg-paper"
                  >
                    <GroupMark name={g.name} size={32} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{g.name}</p>
                      <p className="truncate text-xs text-ink-400">{g.description}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
