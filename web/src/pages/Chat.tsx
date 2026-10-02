import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Plus, Search, X } from 'lucide-react';
import { api, tryMutate } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useAuth } from '../stores/auth';
import { useData } from '../stores/data';
import { ChatRoomView } from '../components/chat/ChatRoomView';
import { Avatar, Button, EmptyState, GroupMark, cx } from '../components/ui';
import type { Room } from '../lib/types';

export function ChatPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const rooms = useData((s) => s.rooms);
  const users = useData((s) => s.users);
  const groups = useData((s) => s.groups);
  const fetchRooms = useData((s) => s.fetchRooms);
  const [pickingDm, setPickingDm] = useState(false);
  const [dmQuery, setDmQuery] = useState('');
  const [roomQuery, setRoomQuery] = useState('');

  const active: Room | undefined = rooms.find((r) => r.id === Number(roomId));
  const q = roomQuery.trim().toLowerCase();
  const visibleRooms = q
    ? rooms.filter((r) => r.name.toLowerCase().includes(q) || r.lastMessage?.body.toLowerCase().includes(q))
    : rooms;
  const groupRooms = visibleRooms.filter((r) => r.kind === 'group');
  const dmRooms = visibleRooms.filter((r) => r.kind === 'dm');
  const activeRole = active?.groupId ? groups.find((g) => g.id === active.groupId)?.role : undefined;

  const dmCandidates = useMemo(() => {
    const dq = dmQuery.trim().toLowerCase();
    return Object.values(users)
      .filter((u) => u.id !== me?.id)
      .filter((u) => !dq || u.name.toLowerCase().includes(dq) || u.department.toLowerCase().includes(dq) || u.title.toLowerCase().includes(dq))
      .sort((a, b) => Number(!!b.online) - Number(!!a.online) || a.name.localeCompare(b.name));
  }, [users, me?.id, dmQuery]);

  async function startDm(userId: number) {
    const res = await tryMutate(api<{ room: Room }>('POST', '/api/chat/dm', { userId }), {
      errorTitle: 'Could not open the conversation',
    });
    if (!res) return;
    setPickingDm(false);
    setDmQuery('');
    await fetchRooms();
    navigate(`/chat/${res.room.id}`);
  }

  function RoomButton({ r }: { r: Room }) {
    const other = r.otherUserId ? users[r.otherUserId] : null;
    const isActive = active?.id === r.id;
    return (
      <button
        onClick={() => navigate(`/chat/${r.id}`)}
        className={cx(
          'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition',
          isActive ? 'bg-paper' : 'hover:bg-paper/60'
        )}
        aria-current={isActive ? 'true' : undefined}
      >
        {r.kind === 'dm' && other ? (
          <Avatar name={other.name} color={other.avatarColor} size={32} online={other.online} />
        ) : (
          <GroupMark name={r.name} size={32} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cx('truncate text-sm', r.unread > 0 ? 'font-bold text-ink-900' : 'font-semibold')}>{r.name}</span>
            {r.lastMessage && (
              <span className="shrink-0 text-[10px] text-ink-300">{timeAgo(r.lastMessage.createdAt)}</span>
            )}
          </span>
          <span className={cx('block truncate text-xs', r.unread > 0 ? 'font-medium text-ink-700' : 'text-ink-400')}>
            {r.lastMessage
              ? `${r.lastMessage.userId === me?.id ? 'You: ' : ''}${r.lastMessage.body}`
              : 'No messages yet'}
          </span>
        </span>
        {r.unread > 0 && (
          <span
            key={r.unread}
            className="count-pop rounded bg-ink-900 px-1.5 py-px text-[10px] font-semibold text-panel"
            aria-label={`${r.unread} unread`}
          >
            {r.unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Room list */}
      <aside
        className={cx(
          'min-h-0 w-full shrink-0 flex-col border-r border-line bg-panel sm:w-80',
          active ? 'hidden sm:flex' : 'flex'
        )}
      >
        <div className="flex items-center justify-between px-4 pb-1 pt-4">
          <h1 className="text-xl font-semibold">Chat</h1>
          <Button
            size="sm"
            variant="secondary"
            icon={pickingDm ? <X size={13} /> : <Plus size={13} />}
            onClick={() => {
              setPickingDm((v) => !v);
              setDmQuery('');
            }}
          >
            {pickingDm ? 'Cancel' : 'New DM'}
          </Button>
        </div>

        {pickingDm && (
          <div className="anim-in mx-3 mt-2 rounded-lg border border-line p-2">
            <div className="relative mb-1.5">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                autoFocus
                value={dmQuery}
                onChange={(e) => setDmQuery(e.target.value)}
                placeholder="Find a colleague…"
                aria-label="Find a colleague"
                className="w-full rounded-md border border-line bg-panel py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
            <div className="thin-scroll max-h-64 space-y-0.5 overflow-y-auto">
              {dmCandidates.length === 0 && <p className="px-2 py-3 text-center text-xs text-ink-400">No one matches.</p>}
              {dmCandidates.map((u) => (
                <button
                  key={u.id}
                  onClick={() => startDm(u.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-paper"
                >
                  <Avatar name={u.name} color={u.avatarColor} size={26} online={u.online} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{u.name}</span>
                    <span className="block truncate text-xs text-ink-400">{[u.title, u.department].filter(Boolean).join(' · ')}</span>
                  </span>
                  {u.online && <span className="ml-auto text-[10px] font-semibold text-success">online</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {rooms.length > 4 && (
          <div className="relative mx-3 mt-2">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={roomQuery}
              onChange={(e) => setRoomQuery(e.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
              className="w-full rounded-md border border-line bg-panel py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>
        )}

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {groupRooms.length > 0 && (
            <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Groups</p>
          )}
          {groupRooms.map((r) => (
            <RoomButton key={r.id} r={r} />
          ))}
          {dmRooms.length > 0 && (
            <p className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              Direct messages
            </p>
          )}
          {dmRooms.map((r) => (
            <RoomButton key={r.id} r={r} />
          ))}
          {visibleRooms.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-ink-400">No conversations match.</p>
          )}
        </div>
      </aside>

      {/* Conversation */}
      <div className={cx('min-h-0 min-w-0 flex-1 flex-col bg-paper/50', active ? 'flex' : 'hidden sm:flex')}>
        {active ? (
          <>
            <header className="flex items-center gap-2.5 border-b border-line bg-panel px-3 py-2.5 sm:px-4 sm:py-3">
              <button
                onClick={() => navigate('/chat')}
                className="rounded-lg p-1.5 text-ink-500 hover:bg-paper sm:hidden"
                aria-label="Back to conversations"
              >
                <ChevronLeft size={20} />
              </button>
              {active.kind === 'dm' && active.otherUserId && users[active.otherUserId] ? (
                <Avatar
                  name={users[active.otherUserId].name}
                  color={users[active.otherUserId].avatarColor}
                  size={30}
                  online={users[active.otherUserId].online}
                />
              ) : (
                <GroupMark name={active.name} size={28} />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-bold leading-tight">{active.name}</p>
                <p className="text-[11px] text-ink-400">
                  {active.kind === 'dm'
                    ? users[active.otherUserId!]?.online
                      ? 'Online now'
                      : `Active ${timeAgo(users[active.otherUserId!]?.lastActiveAt || null) || 'a while ago'}`
                    : 'Group conversation'}
                </p>
              </div>
            </header>
            <ChatRoomView key={active.id} room={active} readOnly={activeRole === 'viewer'} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<MessageSquare size={40} />}
              title="Pick a conversation"
              hint="Group chats mirror your group memberships. Start a DM with anyone in the company."
              action={
                <Button icon={<Plus size={14} />} onClick={() => setPickingDm(true)}>
                  New direct message
                </Button>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
