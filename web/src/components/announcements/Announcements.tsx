import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Megaphone, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { api, mutate, tryMutate } from '../../lib/api';
import { timeAgo, formatDate } from '../../lib/format';
import { useAuth } from '../../stores/auth';
import { useData } from '../../stores/data';
import { useConfirm } from '../ConfirmDialog';
import { AnnBadge, EmptyState, cx } from '../ui';
import type { Announcement, AnnPriority } from '../../lib/types';

export function AnnouncementCard({ a }: { a: Announcement }) {
  const me = useAuth((s) => s.user);
  const groups = useData((s) => s.groups);
  const markRead = useData((s) => s.markAnnouncementRead);
  const ask = useConfirm();
  const ref = useRef<HTMLElement>(null);

  // Seen is read: once the card has been at least 60% visible for two seconds
  // it marks itself read — no more hunting for "Mark as read" buttons.
  useEffect(() => {
    const el = ref.current;
    if (a.read || !el || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          if (!timer) timer = setTimeout(() => markRead(a.id, true).catch(() => {}), 2000);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0.6] }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [a.id, a.read, markRead]);

  const canManage =
    me?.isSuperAdmin ||
    a.authorId === me?.id ||
    (a.groupId != null && groups.find((g) => g.id === a.groupId)?.role === 'admin');

  async function togglePin() {
    await tryMutate(api('PATCH', `/api/announcements/${a.id}`, { pinned: !a.pinned }), {
      errorTitle: 'Could not update the announcement',
    });
  }

  async function remove() {
    const ok = await ask({
      title: 'Delete this announcement?',
      body: 'It disappears for everyone who can see it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await tryMutate(api('DELETE', `/api/announcements/${a.id}`), {
      success: 'Announcement deleted',
      errorTitle: 'Could not delete the announcement',
    });
  }

  return (
    <article
      ref={ref}
      className={cx(
        'card-lift anim-in rounded-lg border bg-panel p-4 transition-colors',
        a.read ? 'border-line' : 'border-ink-300'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {a.pinned && (
          <span className="flex items-center gap-1 rounded bg-paper px-2 py-0.5 text-xs font-semibold text-ink-700">
            <Pin size={11} /> Pinned
          </span>
        )}
        <AnnBadge priority={a.priority} />
        <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-ink-500">
          {a.scope === 'company' ? 'Company-wide' : `${a.groupName}`}
        </span>
        {!a.read && <span className="h-2 w-2 rounded-full bg-ink-900" title="Unread" aria-label="Unread" />}
        <span className="ml-auto text-[11px] text-ink-400">
          {a.authorName} · {timeAgo(a.createdAt)}
        </span>
      </div>
      <h3 className="mt-2 text-sm font-semibold">{a.title}</h3>
      {a.body && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{a.body}</p>}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <button
          onClick={() => markRead(a.id, !a.read)}
          className="rounded-md border border-line px-2.5 py-1 font-medium text-ink-700 transition hover:bg-paper"
        >
          Mark as {a.read ? 'unread' : 'read'}
        </button>
        {canManage && (
          <>
            <button
              onClick={togglePin}
              className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 font-medium text-ink-700 transition hover:bg-paper"
            >
              {a.pinned ? <PinOff size={12} /> : <Pin size={12} />} {a.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              onClick={remove}
              className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 font-medium text-ink-500 transition hover:border-urgent hover:text-urgent"
            >
              <Trash2 size={12} /> Delete
            </button>
          </>
        )}
        {a.expiresAt && <span className="ml-auto text-ink-400">Expires {formatDate(a.expiresAt)}</span>}
      </div>
    </article>
  );
}

export function AnnouncementComposer({ fixedGroupId }: { fixedGroupId?: number }) {
  const me = useAuth((s) => s.user);
  const groups = useData((s) => s.groups);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<AnnPriority>('general');
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');

  const adminGroups = useMemo(() => groups.filter((g) => g.role === 'admin'), [groups]);
  const canCompany = !!me?.isSuperAdmin;
  const targets = useMemo(() => {
    const t: { value: string; label: string }[] = [];
    if (fixedGroupId != null) {
      const g = groups.find((x) => x.id === fixedGroupId);
      if (g && (g.role === 'admin' || canCompany)) t.push({ value: `group:${g.id}`, label: g.name });
      return t;
    }
    if (canCompany) t.push({ value: 'company', label: 'Company-wide' });
    for (const g of canCompany ? groups : adminGroups) t.push({ value: `group:${g.id}`, label: g.name });
    return t;
  }, [groups, adminGroups, canCompany, fixedGroupId]);

  const [target, setTarget] = useState('');
  const effectiveTarget = target || targets[0]?.value || '';

  if (targets.length === 0) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!title.trim()) return;
    const payload: any = {
      title: title.trim(),
      body,
      priority,
      pinned,
      expiresAt: expiresAt || undefined,
    };
    if (effectiveTarget === 'company') payload.scope = 'company';
    else {
      payload.scope = 'group';
      payload.groupId = Number(effectiveTarget.split(':')[1]);
    }
    try {
      await mutate(api('POST', '/api/announcements', payload), { success: 'Announcement posted' });
      setTitle('');
      setBody('');
      setPriority('general');
      setPinned(false);
      setExpiresAt('');
      setOpen(false);
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-brand flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white"
      >
        <Plus size={15} /> New announcement
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="anim-in w-full space-y-3 rounded-lg border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Megaphone size={16} className="text-ink-700" />
        <span className="text-sm font-bold">New announcement</span>
        <select
          value={effectiveTarget}
          onChange={(e) => setTarget(e.target.value)}
          className="ml-auto rounded-lg border border-line bg-paper px-2 py-1.5 text-xs font-medium outline-none"
        >
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as AnnPriority)}
          className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs font-medium outline-none"
        >
          <option value="general">General</option>
          <option value="important">Important</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        required
        className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write the announcement…"
        rows={3}
        className="w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 font-medium text-ink-500">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-ink-900" />
          Pin to top
        </label>
        <label className="flex items-center gap-1.5 font-medium text-ink-500">
          Expires
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-lg border border-line bg-paper px-2 py-1 outline-none"
          />
        </label>
        {error && <span className="text-urgent">{error}</span>}
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-xl border border-line px-3 py-1.5 font-semibold text-ink-500 hover:bg-paper"
          >
            Cancel
          </button>
          <button type="submit" className="btn-brand rounded-md px-3 py-1.5 font-medium text-white">
            Post
          </button>
        </span>
      </div>
    </form>
  );
}

export function AnnouncementList({ groupId, unreadOnly }: { groupId?: number; unreadOnly?: boolean }) {
  const announcements = useData((s) => s.announcements);
  const list = useMemo(() => {
    let filtered = groupId == null ? announcements : announcements.filter((a) => a.groupId === groupId);
    if (unreadOnly) filtered = filtered.filter((a) => !a.read);
    return [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.id - a.id);
  }, [announcements, groupId, unreadOnly]);

  if (list.length === 0) {
    return unreadOnly ? (
      <EmptyState icon={<Megaphone size={36} />} title="Nothing unread" hint="You have seen every announcement. Switch the filter off to browse older ones." />
    ) : (
      <EmptyState icon={<Megaphone size={36} />} title="No announcements yet" hint="Group admins can post announcements that reach every member instantly." />
    );
  }
  return (
    <div className="space-y-3">
      {list.map((a) => (
        <AnnouncementCard key={a.id} a={a} />
      ))}
    </div>
  );
}
