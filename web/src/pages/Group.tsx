import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowUpDown,
  KanbanSquare,
  Megaphone,
  MessageSquare,
  MonitorPlay,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api, mutate, tryMutate } from '../lib/api';
import { useAuth } from '../stores/auth';
import { useData } from '../stores/data';
import { Board, BoardFilter, BoardSort, EMPTY_FILTER } from '../components/board/Board';
import { ChatRoomView } from '../components/chat/ChatRoomView';
import { AnnouncementComposer, AnnouncementList } from '../components/announcements/Announcements';
import { useConfirm } from '../components/ConfirmDialog';
import { Avatar, Button, GroupMark, Kbd, PriorityBadge, RoleBadge, Skeleton, Tabs, ValueProgressBar, badgeCls, cx, inputSmCls, selectSmCls } from '../components/ui';
import { timeAgo } from '../lib/format';
import type { Priority, Role } from '../lib/types';

const ALL_PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];

type Tab = 'board' | 'announcements' | 'chat' | 'members';

// Board filters survive tab switches and reloads within the session, per group.
const filterKey = (groupId: number) => `atrium-filter-${groupId}`;
function loadFilter(groupId: number): BoardFilter {
  try {
    const raw = sessionStorage.getItem(filterKey(groupId));
    if (raw) return { ...EMPTY_FILTER, ...JSON.parse(raw) };
  } catch {}
  return EMPTY_FILTER;
}
function saveFilter(groupId: number, f: BoardFilter) {
  try {
    sessionStorage.setItem(filterKey(groupId), JSON.stringify(f));
  } catch {}
}

function BoardSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy>
      <div className="border-b border-line bg-panel px-4 pt-4 lg:px-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-2xl" />
          <div className="flex-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-1.5 h-3 w-72" />
          </div>
        </div>
        <Skeleton className="mt-4 h-2 max-w-xl" />
        <div className="mt-4 flex gap-4 pb-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5 w-24" />
          ))}
        </div>
      </div>
      <div className="flex gap-4 overflow-hidden px-4 py-4 lg:px-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="w-72 shrink-0 space-y-2 rounded-2xl bg-paper p-2">
            <Skeleton className="mx-1 mt-1 h-4 w-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GroupPage() {
  const { groupId: gid } = useParams();
  const groupId = Number(gid);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'board';
  const navigate = useNavigate();
  const ask = useConfirm();

  const me = useAuth((s) => s.user);
  const groups = useData((s) => s.groups);
  const gd = useData((s) => s.groupData[groupId]);
  const rooms = useData((s) => s.rooms);
  const fetchGroup = useData((s) => s.fetchGroup);
  const fetchGroups = useData((s) => s.fetchGroups);
  const openTaskModal = useData((s) => s.openTaskModal);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_FILTER);
  // Phones: priority and people filters sit behind one toggle so the bar stays one line
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editingValue, setEditingValue] = useState(false);
  const [valueDraft, setValueDraft] = useState('');
  const [unitDraft, setUnitDraft] = useState('RM');
  const [valueError, setValueError] = useState('');
  const [savingValue, setSavingValue] = useState(false);

  const group = groups.find((g) => g.id === groupId);
  const role: Role | null = group?.role ?? (me?.isSuperAdmin ? 'admin' : null);
  const room = rooms.find((r) => r.kind === 'group' && r.groupId === groupId);

  function updateFilter(f: BoardFilter) {
    setFilter(f);
    saveFilter(groupId, f);
  }

  useEffect(() => {
    // Per-group UI state must not leak into the next group the user opens
    setError('');
    setFilter(loadFilter(groupId));
    setEditingValue(false);
    setValueError('');
    fetchGroup(groupId).catch((e) => setError(e.message));
  }, [groupId, fetchGroup]);

  // Deep-link: ?task=123 opens the task modal
  useEffect(() => {
    const taskParam = params.get('task');
    if (taskParam) {
      openTaskModal(Number(taskParam)).catch(() => {});
      params.delete('task');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('task')]);

  if (error) {
    return (
      <div className="p-8">
        <p className="rounded-md border border-urgent/20 bg-urgent-soft px-4 py-3 text-sm text-urgent">{error}</p>
      </div>
    );
  }
  // Groups are loaded but this one isn't among them: access was revoked
  // (e.g. removed from the group while viewing it) — don't spin forever.
  if (!group && groups.length > 0) {
    return (
      <div className="p-8">
        <p className="rounded-md border border-urgent/20 bg-urgent-soft px-4 py-3 text-sm text-urgent">
          You no longer have access to this workspace.
        </p>
      </div>
    );
  }
  if (!group || !gd) return <BoardSkeleton />;

  const filtering = filter.text || filter.priorities.length > 0 || filter.assignees.length > 0;

  async function deleteGroup() {
    if (!group) return;
    const ok = await ask({
      title: `Delete “${group.name}”?`,
      body: `Its board and ${group.taskTotal} task${group.taskTotal === 1 ? '' : 's'}, chat history and announcements are permanently removed for all ${group.memberCount} members. This cannot be undone.`,
      confirmLabel: 'Delete group',
      danger: true,
    });
    if (!ok) return;
    const r = await tryMutate(api('DELETE', `/api/groups/${groupId}`), { success: 'Group deleted', errorTitle: 'Could not delete the group' });
    if (r !== undefined) navigate('/');
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line bg-panel px-4 pt-4 lg:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <GroupMark name={group.name} size={40} />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 truncate text-xl font-semibold leading-tight">
              {group.name}
              {group.isProject && <span className={cx(badgeCls, 'bg-paper text-ink-500')}>Project</span>}
            </h1>
            <p className="truncate text-xs text-ink-500">{group.description}</p>
          </div>
          {/* On phones the title keeps the room: avatars hide, actions collapse to icons */}
          <div className="flex items-center gap-2">
            <span className="hidden -space-x-2 sm:flex">
              {gd.members.slice(0, 5).map((m) => (
                <Avatar key={m.id} name={m.name} size={26} online={m.online} />
              ))}
            </span>
            <Link
              to={`/kiosk/${groupId}`}
              className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-paper sm:px-3"
              title="Display mode"
              aria-label="Display mode"
            >
              <MonitorPlay size={14} /> <span className="hidden sm:inline">Display mode</span>
            </Link>
            {me?.isSuperAdmin && (
              <button
                type="button"
                onClick={deleteGroup}
                className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs font-medium text-ink-500 transition hover:border-urgent/30 hover:bg-urgent-soft hover:text-urgent sm:px-3"
                title="Delete this group"
                aria-label="Delete group"
              >
                <Trash2 size={13} /> <span className="hidden sm:inline">Delete group</span>
              </button>
            )}
          </div>
        </div>

        {/* Project progress + customizable value */}
        <div className="mt-3 max-w-xl">
          {editingValue ? (
            <form
              onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                setValueError('');
                const raw = valueDraft.replace(/[,\s]/g, '');
                if (raw === '') {
                  // Empty means "leave as is" — never silently overwrite with 0
                  setEditingValue(false);
                  return;
                }
                const v = Number(raw);
                if (!Number.isFinite(v) || v < 0 || v > 1e12) {
                  setValueError('Enter a plain number, e.g. 250000');
                  return;
                }
                setSavingValue(true);
                try {
                  await mutate(api('PATCH', `/api/groups/${groupId}`, { value: v, valueUnit: unitDraft }), {
                    success: 'Project value updated',
                  });
                  await fetchGroups();
                  setEditingValue(false);
                } catch (err: any) {
                  setValueError(err.message || 'Could not save');
                } finally {
                  setSavingValue(false);
                }
              }}
              className="anim-in flex flex-wrap items-center gap-2"
            >
              <input
                value={unitDraft}
                onChange={(e) => setUnitDraft(e.target.value)}
                className={cx(inputSmCls, 'w-16 font-medium')}
                aria-label="Currency / unit"
              />
              <input
                autoFocus
                value={valueDraft}
                onChange={(e) => setValueDraft(e.target.value)}
                placeholder="Project value e.g. 250000"
                className={cx(inputSmCls, 'w-40')}
                aria-label="Project value"
              />
              <Button type="submit" size="sm" loading={savingValue}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingValue(false);
                  setValueError('');
                }}
              >
                Cancel
              </Button>
              {valueError && <span className="text-xs font-medium text-urgent">{valueError}</span>}
            </form>
          ) : (
            <ValueProgressBar
              progress={group.taskTotal ? (group.taskDone / group.taskTotal) * 100 : 0}
              value={group.value}
              valueUnit={group.valueUnit}
              onEditValue={
                role === 'admin'
                  ? () => {
                      setValueDraft(group.value ? String(group.value) : '');
                      setUnitDraft(group.valueUnit || 'RM');
                      setEditingValue(true);
                    }
                  : undefined
              }
            />
          )}
        </div>
        <Tabs<Tab>
          className="mt-3 overflow-x-auto"
          value={tab}
          onChange={(k) => setParams({ tab: k })}
          tabs={[
            { key: 'board', label: 'Board', icon: <KanbanSquare size={15} /> },
            { key: 'announcements', label: 'Announcements', icon: <Megaphone size={15} /> },
            { key: 'chat', label: 'Chat', icon: <MessageSquare size={15} /> },
            { key: 'members', label: 'Members', icon: <Users size={15} />, count: gd.members.length },
          ]}
        />
      </header>

      <div className="min-h-0 flex-1">
        {tab === 'board' && (
          <div className="flex h-full flex-col">
            {/* Trello-style board filter bar — stays put while the board scrolls */}
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-2 lg:px-6">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  value={filter.text}
                  onChange={(e) => updateFilter({ ...filter, text: e.target.value })}
                  placeholder="Filter cards…"
                  aria-label="Filter cards"
                  className={cx(inputSmCls, 'w-44 pl-8')}
                />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={cx(
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium md:hidden',
                  filtersOpen || filter.priorities.length + filter.assignees.length > 0 ? 'border-ink-900 bg-paper text-ink-900' : 'border-line text-ink-500'
                )}
                aria-expanded={filtersOpen}
                aria-label={filtersOpen ? 'Hide filters' : 'Show filters'}
              >
                <SlidersHorizontal size={13} /> Filters
                {filter.priorities.length + filter.assignees.length > 0 && (
                  <span className="rounded bg-line px-1 text-[10px] tabular-nums">{filter.priorities.length + filter.assignees.length}</span>
                )}
              </button>
              <div className={cx('flex flex-wrap items-center gap-2', filtersOpen ? 'basis-full md:basis-auto' : 'hidden md:flex')}>
              {ALL_PRIORITIES.map((p) => {
                const active = filter.priorities.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() =>
                      updateFilter({
                        ...filter,
                        priorities: active
                          ? filter.priorities.filter((x) => x !== p)
                          : [...filter.priorities, p],
                      })
                    }
                    className={cx(
                      'rounded border transition',
                      active ? 'border-ink-900' : 'border-transparent opacity-60 hover:opacity-100'
                    )}
                    aria-pressed={active}
                  >
                    <PriorityBadge priority={p} />
                  </button>
                );
              })}
              <span className="mx-1 h-4 w-px bg-line" aria-hidden />
              {gd.members.map((m) => {
                const active = filter.assignees.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() =>
                      updateFilter({
                        ...filter,
                        assignees: active
                          ? filter.assignees.filter((x) => x !== m.id)
                          : [...filter.assignees, m.id],
                      })
                    }
                    className={cx(
                      'rounded-full transition',
                      active ? 'ring-2 ring-ink-900 ring-offset-1 ring-offset-panel' : 'opacity-60 hover:opacity-100'
                    )}
                    title={`Filter by ${m.name}`}
                    aria-pressed={active}
                  >
                    <Avatar name={m.name} size={24} />
                  </button>
                );
              })}
              {filtering && (
                <button
                  onClick={() => updateFilter({ ...EMPTY_FILTER, sort: filter.sort })}
                  className="rounded-md px-2 py-1 text-xs font-medium text-ink-900 underline underline-offset-2"
                >
                  Clear filters
                </button>
              )}
              </div>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-500">
                <ArrowUpDown size={13} aria-hidden />
                <select
                  value={filter.sort}
                  onChange={(e) => updateFilter({ ...filter, sort: e.target.value as BoardSort })}
                  className={cx(selectSmCls, 'font-medium')}
                  aria-label="Sort cards"
                >
                  <option value="position">Board order</option>
                  <option value="due">Due date</option>
                  <option value="priority">Priority</option>
                </select>
              </label>
              {filter.sort !== 'position' && (
                <span className="text-[10px] text-ink-400">Drag is off while sorted</span>
              )}
              <span className="hidden items-center gap-1 text-[10px] text-ink-300 xl:flex">
                <Kbd>n</Kbd> new task
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <Board groupId={groupId} role={role || 'viewer'} filter={filter} />
            </div>
          </div>
        )}
        {tab === 'announcements' && (
          <div className="thin-scroll mx-auto h-full max-w-3xl space-y-4 overflow-y-auto p-4 lg:p-6">
            <AnnouncementComposer fixedGroupId={groupId} />
            <AnnouncementList groupId={groupId} />
          </div>
        )}
        {tab === 'chat' &&
          (room ? (
            <ChatRoomView room={room} readOnly={role === 'viewer'} />
          ) : (
            <p className="p-8 text-sm text-ink-400">Chat room not available.</p>
          ))}
        {tab === 'members' && <MembersTab groupId={groupId} role={role || 'viewer'} />}
      </div>
    </div>
  );
}

function MembersTab({ groupId, role }: { groupId: number; role: Role }) {
  const gd = useData((s) => s.groupData[groupId]);
  const users = useData((s) => s.users);
  const me = useAuth((s) => s.user);
  const ask = useConfirm();
  const [adding, setAdding] = useState(false);
  // Role chosen per candidate before adding (defaults to member)
  const [addRole, setAddRole] = useState<Record<number, Role>>({});
  const isAdmin = role === 'admin';

  const nonMembers = useMemo(() => {
    const memberIds = new Set((gd?.members || []).map((m) => m.id));
    return Object.values(users).filter((u) => !memberIds.has(u.id));
  }, [users, gd?.members]);

  if (!gd) return null;

  async function addMember(userId: number, memberRole: Role) {
    const ok = await tryMutate(api('POST', `/api/groups/${groupId}/members`, { userId, role: memberRole }), {
      success: 'Member added',
      errorTitle: 'Could not add the member',
    });
    if (ok !== undefined) setAdding(false);
  }

  async function changeRole(userId: number, newRole: string) {
    await tryMutate(api('PATCH', `/api/groups/${groupId}/members/${userId}`, { role: newRole }), {
      errorTitle: 'Could not change the role',
    });
  }

  async function removeMember(userId: number, name: string) {
    const ok = await ask({
      title: `Remove ${name} from this group?`,
      body: 'They lose access to the board, chat and announcements, and their task assignments here are cleared.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await tryMutate(api('DELETE', `/api/groups/${groupId}/members/${userId}`), {
      success: `${name} removed`,
      errorTitle: 'Could not remove the member',
    });
  }

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6">
      {isAdmin && (
        <div className="mb-4">
          {adding ? (
            <div className="anim-in rounded-lg border border-line bg-panel p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Add a member</p>
                <button onClick={() => setAdding(false)} className="text-ink-400 hover:text-ink-700" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {nonMembers.length === 0 && <p className="text-sm text-ink-400">Everyone is already in this group.</p>}
                {nonMembers.map((u) => (
                  <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2">
                    <Avatar name={u.name} size={28} online={u.online} />
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate text-sm font-semibold">{u.name}</p>
                      <p className="truncate text-xs text-ink-400">{u.department}</p>
                    </div>
                    {/* One role picker + one action, so the row never overflows */}
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        value={addRole[u.id] ?? 'member'}
                        onChange={(e) => setAddRole((m) => ({ ...m, [u.id]: e.target.value as Role }))}
                        className={cx(selectSmCls, 'font-medium')}
                        aria-label={`Role for ${u.name}`}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                      <Button size="sm" variant="secondary" onClick={() => addMember(u.id, addRole[u.id] ?? 'member')}>
                        Add
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Button icon={<Plus size={15} />} onClick={() => setAdding(true)}>
              Add member
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {gd.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
            <Avatar name={m.name} size={34} online={m.online} />
            <div className="min-w-[10rem] flex-1">
              <p className="text-sm font-semibold">
                {m.name} {m.id === me?.id && <span className="text-xs font-normal text-ink-400">(you)</span>}
              </p>
              <p className="truncate text-xs text-ink-400">
                {m.title || m.department} · {m.online ? 'online now' : m.lastActiveAt ? `active ${timeAgo(m.lastActiveAt)}` : 'offline'}
              </p>
            </div>
            {isAdmin && m.id !== me?.id ? (
              <>
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                  className={cx(selectSmCls, 'font-medium')}
                  aria-label={`Role for ${m.name}`}
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <Button size="sm" variant="danger" onClick={() => removeMember(m.id, m.name)}>
                  Remove
                </Button>
              </>
            ) : (
              <RoleBadge role={m.role} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
