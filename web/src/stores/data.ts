import { create } from 'zustand';
import { api, mutate } from '../lib/api';
import { useAuth } from './auth';
import { toast, useUi } from './ui';
import type {
  Activity,
  Announcement,
  ChecklistItem,
  Column,
  GroupData,
  GroupSummary,
  Member,
  Message,
  Notification,
  Reaction,
  Room,
  Task,
  TaskComment,
  User,
} from '../lib/types';

interface OpenTask {
  task: Task;
  comments: TaskComment[];
  checklist: ChecklistItem[];
}

interface TypingEntry {
  userId: number;
  name: string;
  until: number;
}

export type RecentKind = 'created' | 'updated' | 'moved' | 'deleted' | 'commented';

/** What just happened to a task, kept for a few seconds to drive card flashes. */
export interface RecentEvent {
  kind: RecentKind;
  actorId: number | null;
  at: number;
}

export interface EventMeta {
  kind: RecentKind;
  actorId: number | null;
}

const RECENT_TTL_MS = 4000;

interface DataState {
  users: Record<number, User>;
  groups: GroupSummary[];
  groupData: Record<number, GroupData>;
  announcements: Announcement[];
  notifications: Notification[];
  notifUnread: number;
  activity: Activity[];
  rooms: Room[];
  messages: Record<number, Message[]>;
  typing: Record<number, TypingEntry[]>;
  myTasks: Task[];
  activeRoomId: number | null;
  openTask: OpenTask | null;
  /** Task id -> the change a teammate just made (cleared after RECENT_TTL_MS). */
  recent: Record<number, RecentEvent>;
  /** False until the first fetchAll settles — pages show skeletons meanwhile. */
  loaded: boolean;

  // fetchers
  fetchUsers: () => Promise<void>;
  fetchGroups: () => Promise<void>;
  fetchGroup: (groupId: number) => Promise<void>;
  fetchAnnouncements: () => Promise<void>;
  fetchNotifications: () => Promise<void>;
  fetchActivity: () => Promise<void>;
  fetchRooms: () => Promise<void>;
  fetchMessages: (roomId: number) => Promise<void>;
  fetchMyTasks: () => Promise<void>;
  fetchAll: () => Promise<void>;

  // task modal
  openTaskModal: (taskId: number) => Promise<void>;
  closeTaskModal: () => void;

  // mutations (optimistic where it matters)
  moveTaskLocal: (taskId: number, groupId: number, columnId: number, position: number) => void;
  markAnnouncementRead: (id: number, read: boolean) => Promise<void>;
  setActiveRoom: (roomId: number | null) => void;
  markRoomRead: (roomId: number) => Promise<void>;
  /** Optimistic send: the bubble appears instantly and is swapped for the server copy. */
  sendMessage: (roomId: number, body: string, replyTo?: Message | null) => Promise<boolean>;
  markNotificationRead: (id: number) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  /** Optimistic emoji toggle on a message; the room's socket event settles the tally. */
  toggleReaction: (message: Message, emoji: string) => Promise<void>;

  // socket event appliers
  applyTaskUpsert: (task: Task, meta?: EventMeta) => void;
  applyTaskDelete: (taskId: number, groupId: number, actorId?: number | null) => void;
  applyColumns: (groupId: number, columns: Column[]) => void;
  /** A group was deleted: drop it and everything cached under it. */
  applyGroupDeleted: (groupId: number) => void;
  applyBoardRefresh: (groupId: number, tasks: Task[]) => void;
  applyComment: (taskId: number, comment: TaskComment, groupId?: number) => void;
  applyChecklist: (taskId: number, checklist: ChecklistItem[]) => void;
  applyAnnouncementUpsert: (a: Announcement, isNew: boolean) => void;
  applyAnnouncementDelete: (id: number) => void;
  applyMessage: (message: Message, clientId?: string) => void;
  applyReactions: (roomId: number, messageId: number, reactions: Reaction[]) => void;
  applyTyping: (roomId: number, userId: number, name: string) => void;
  applyChatRead: (roomId: number) => void;
  applyNotification: (n: Notification) => void;
  applyActivity: (a: Activity) => void;
  applyPresence: (userId: number, online: boolean, lastActiveAt: string) => void;
  applyMembers: (groupId: number, members: Member[]) => void;

  reset: () => void;
}

let groupsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const recentTimers = new Map<number, ReturnType<typeof setTimeout>>();

function meId(): number {
  return useAuth.getState().user?.id ?? -1;
}

/** Is the user currently looking at this group's board (or any kiosk screen)? */
function viewingGroup(groupId: number): boolean {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = window.location.pathname.replace(base, '');
  return path === `/groups/${groupId}` || path.startsWith('/kiosk');
}

export const useData = create<DataState>()((set, get) => {
  const firstName = (id: number | null | undefined) =>
    (id && get().users[id]?.name.split(' ')[0]) || 'Someone';

  /** Remember a teammate's change on a task for a few seconds (drives card flashes). */
  const noteRecent = (taskId: number, meta: EventMeta) => {
    set((s) => ({ recent: { ...s.recent, [taskId]: { ...meta, at: Date.now() } } }));
    const prev = recentTimers.get(taskId);
    if (prev) clearTimeout(prev);
    recentTimers.set(
      taskId,
      setTimeout(() => {
        recentTimers.delete(taskId);
        set((s) => {
          if (!s.recent[taskId]) return s;
          const { [taskId]: _gone, ...rest } = s.recent;
          return { recent: rest };
        });
      }, RECENT_TTL_MS)
    );
  };

  return {
    users: {},
    groups: [],
    groupData: {},
    announcements: [],
    notifications: [],
    notifUnread: 0,
    activity: [],
    rooms: [],
    messages: {},
    typing: {},
    myTasks: [],
    activeRoomId: null,
    openTask: null,
    recent: {},
    loaded: false,

    fetchUsers: async () => {
      const { users } = await api<{ users: User[] }>('GET', '/api/users');
      const map: Record<number, User> = {};
      for (const u of users) map[u.id] = u;
      set({ users: map });
    },

    fetchGroups: async () => {
      const { groups } = await api<{ groups: GroupSummary[] }>('GET', '/api/groups');
      set({ groups });
    },

    fetchGroup: async (groupId) => {
      const data = await api<{ group: GroupSummary; members: Member[]; columns: Column[]; tasks: Task[] }>(
        'GET',
        `/api/groups/${groupId}`
      );
      set((s) => ({
        groupData: {
          ...s.groupData,
          [groupId]: { members: data.members, columns: data.columns, tasks: data.tasks },
        },
        groups: s.groups.some((g) => g.id === groupId)
          ? s.groups.map((g) => (g.id === groupId ? data.group : g))
          : [...s.groups, data.group],
      }));
    },

    fetchAnnouncements: async () => {
      const { announcements } = await api<{ announcements: Announcement[] }>('GET', '/api/announcements');
      set({ announcements });
    },

    fetchNotifications: async () => {
      const { notifications, unread } = await api<{ notifications: Notification[]; unread: number }>(
        'GET',
        '/api/notifications'
      );
      set({ notifications, notifUnread: unread });
    },

    fetchActivity: async () => {
      const { activity } = await api<{ activity: Activity[] }>('GET', '/api/activity');
      set({ activity });
    },

    fetchRooms: async () => {
      const { rooms } = await api<{ rooms: Room[] }>('GET', '/api/chat/rooms');
      set({ rooms });
    },

    fetchMessages: async (roomId) => {
      const { messages } = await api<{ messages: Message[] }>('GET', `/api/chat/rooms/${roomId}/messages`);
      set((s) => ({ messages: { ...s.messages, [roomId]: messages } }));
    },

    fetchMyTasks: async () => {
      const { tasks } = await api<{ tasks: Task[] }>('GET', '/api/my-tasks');
      set({ myTasks: tasks });
    },

    fetchAll: async () => {
      try {
        await Promise.all([
          get().fetchUsers(),
          get().fetchGroups(),
          get().fetchAnnouncements(),
          get().fetchNotifications(),
          get().fetchActivity(),
          get().fetchRooms(),
          get().fetchMyTasks(),
        ]);
      } finally {
        // Even a partial failure ends the skeleton state; the failure itself
        // is reported by the caller (connection toast).
        set({ loaded: true });
      }
    },

    openTaskModal: async (taskId) => {
      const data = await api<OpenTask>('GET', `/api/tasks/${taskId}`);
      set({ openTask: data });
    },

    closeTaskModal: () => set({ openTask: null }),

    moveTaskLocal: (taskId, groupId, columnId, position) => {
      set((s) => {
        const gd = s.groupData[groupId];
        if (!gd) return s;
        const col = gd.columns.find((c) => c.id === columnId);
        const tasks = gd.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                columnId,
                position,
                completedAt: col?.isDone ? t.completedAt || new Date().toISOString() : null,
              }
            : t
        );
        return { groupData: { ...s.groupData, [groupId]: { ...gd, tasks } } };
      });
    },

    markAnnouncementRead: async (id, read) => {
      set((s) => ({
        announcements: s.announcements.map((a) => (a.id === id ? { ...a, read } : a)),
      }));
      await api('POST', `/api/announcements/${id}/${read ? 'read' : 'unread'}`);
    },

    setActiveRoom: (roomId) => set({ activeRoomId: roomId }),

    markRoomRead: async (roomId) => {
      set((s) => ({
        rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, unread: 0 } : r)),
      }));
      await api('POST', `/api/chat/rooms/${roomId}/read`);
    },

    sendMessage: async (roomId, body, replyTo) => {
      const me = useAuth.getState().user;
      if (!me) return false;
      const clientId = `${me.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const pending: Message = {
        id: -Date.now(),
        roomId,
        userId: me.id,
        body,
        replyToId: replyTo?.id ?? null,
        replyTo: replyTo ? { id: replyTo.id, userId: replyTo.userId, body: replyTo.body } : null,
        createdAt: new Date().toISOString(),
        pending: true,
        clientId,
      };
      set((s) => ({ messages: { ...s.messages, [roomId]: [...(s.messages[roomId] || []), pending] } }));
      try {
        const res = await mutate(
          api<{ message: Message; clientId?: string }>('POST', `/api/chat/rooms/${roomId}/messages`, {
            body,
            replyToId: replyTo?.id,
            clientId,
          }),
          { errorTitle: 'Message not sent' }
        );
        // The socket usually reconciles first; this makes it robust when it doesn't.
        get().applyMessage(res.message, clientId);
        return true;
      } catch {
        set((s) => ({
          messages: { ...s.messages, [roomId]: (s.messages[roomId] || []).filter((m) => m.clientId !== clientId) },
        }));
        return false;
      }
    },

    markNotificationRead: async (id) => {
      const target = get().notifications.find((n) => n.id === id);
      if (!target || target.readAt) return;
      const ts = new Date().toISOString();
      set((s) => ({
        notifications: s.notifications.map((n) => (n.id === id ? { ...n, readAt: ts } : n)),
        notifUnread: Math.max(0, s.notifUnread - 1),
      }));
      await api('POST', `/api/notifications/${id}/read`);
    },

    toggleReaction: async (message, emoji) => {
      const me = meId();
      const apply = (fn: (r: Reaction[]) => Reaction[]) =>
        set((s) => ({
          messages: {
            ...s.messages,
            [message.roomId]: (s.messages[message.roomId] || []).map((m) =>
              m.id === message.id ? { ...m, reactions: fn(m.reactions || []) } : m
            ),
          },
        }));
      // Optimistic: flip my own entry immediately
      apply((list) => {
        const hit = list.find((r) => r.emoji === emoji);
        if (hit?.userIds.includes(me)) {
          return list
            .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, userIds: r.userIds.filter((u) => u !== me) } : r))
            .filter((r) => r.count > 0);
        }
        return hit
          ? list.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, userIds: [...r.userIds, me] } : r))
          : [...list, { emoji, count: 1, userIds: [me] }];
      });
      try {
        const res = await api<{ reactions: Reaction[] }>('POST', `/api/chat/messages/${message.id}/reactions`, { emoji });
        apply(() => res.reactions);
      } catch (err: any) {
        toast({ kind: 'error', title: "Couldn't add the reaction", body: err?.message });
        get().fetchMessages(message.roomId).catch(() => {});
      }
    },

    markAllNotificationsRead: async () => {
      const ts = new Date().toISOString();
      set((s) => ({
        notifications: s.notifications.map((n) => (n.readAt ? n : { ...n, readAt: ts })),
        notifUnread: 0,
      }));
      await api('POST', '/api/notifications/read-all');
    },

    // ---- socket appliers ----

    applyTaskUpsert: (task, meta) => {
      set((s) => {
        const gd = s.groupData[task.groupId];
        const next: Partial<DataState> = {};
        if (gd) {
          const exists = gd.tasks.some((t) => t.id === task.id);
          next.groupData = {
            ...s.groupData,
            [task.groupId]: {
              ...gd,
              tasks: exists ? gd.tasks.map((t) => (t.id === task.id ? task : t)) : [...gd.tasks, task],
            },
          };
        }
        // Keep "My Tasks" in sync
        const mine = task.assignees.includes(meId());
        const inMine = s.myTasks.some((t) => t.id === task.id);
        if (mine) {
          next.myTasks = inMine ? s.myTasks.map((t) => (t.id === task.id ? task : t)) : [...s.myTasks, task];
        } else if (inMine) {
          next.myTasks = s.myTasks.filter((t) => t.id !== task.id);
        }
        // Keep the open modal in sync
        if (s.openTask && s.openTask.task.id === task.id) {
          next.openTask = { ...s.openTask, task };
        }
        return next as DataState;
      });
      scheduleGroupsRefresh(get);

      // Everything below is about *teammates'* changes: flash the card and
      // announce it when the user isn't looking.
      const me = meId();
      if (!meta || meta.actorId === me) return;
      noteRecent(task.id, meta);

      if ((meta.kind === 'created' || meta.kind === 'moved') && !viewingGroup(task.groupId)) {
        // Assignees get a notification for new tasks already — don't double up.
        if (meta.kind === 'created' && task.assignees.includes(me)) return;
        const col = get().groupData[task.groupId]?.columns.find((c) => c.id === task.columnId);
        const group = get().groups.find((g) => g.id === task.groupId);
        const verb =
          meta.kind === 'created'
            ? `added “${task.title}”`
            : `moved “${task.title}”${col ? ` to ${col.name}` : ''}`;
        toast({
          kind: 'live',
          actorId: meta.actorId,
          title: `${firstName(meta.actorId)} ${verb}`,
          body: group?.name,
          action: { label: 'View', to: `/groups/${task.groupId}?task=${task.id}` },
          dedupeKey: `task:${task.id}`,
        });
      }
    },

    applyTaskDelete: (taskId, groupId, actorId) => {
      const gone = get().groupData[groupId]?.tasks.find((t) => t.id === taskId);
      set((s) => {
        const gd = s.groupData[groupId];
        return {
          groupData: gd
            ? { ...s.groupData, [groupId]: { ...gd, tasks: gd.tasks.filter((t) => t.id !== taskId) } }
            : s.groupData,
          myTasks: s.myTasks.filter((t) => t.id !== taskId),
          openTask: s.openTask?.task.id === taskId ? null : s.openTask,
        };
      });
      scheduleGroupsRefresh(get);
      if (actorId && actorId !== meId() && gone && viewingGroup(groupId)) {
        toast({
          kind: 'live',
          actorId,
          title: `${firstName(actorId)} deleted “${gone.title}”`,
          dedupeKey: `task:${taskId}`,
          ttl: 4000,
        });
      }
    },

    applyColumns: (groupId, columns) => {
      set((s) => {
        const gd = s.groupData[groupId];
        if (!gd) return s;
        return { groupData: { ...s.groupData, [groupId]: { ...gd, columns } } };
      });
    },

    applyGroupDeleted: (groupId) =>
      set((s) => {
        const groupData = { ...s.groupData };
        delete groupData[groupId];
        return {
          groups: s.groups.filter((g) => g.id !== groupId),
          groupData,
          rooms: s.rooms.filter((r) => r.groupId !== groupId),
          myTasks: s.myTasks.filter((t) => t.groupId !== groupId),
          openTask: s.openTask && s.openTask.task.groupId === groupId ? null : s.openTask,
        };
      }),

    applyBoardRefresh: (groupId, tasks) => {
      set((s) => {
        const gd = s.groupData[groupId];
        if (!gd) return s;
        return { groupData: { ...s.groupData, [groupId]: { ...gd, tasks } } };
      });
    },

    applyComment: (taskId, comment, groupId) => {
      set((s) => {
        if (!s.openTask || s.openTask.task.id !== taskId) return s;
        if (s.openTask.comments.some((c) => c.id === comment.id)) return s;
        return { openTask: { ...s.openTask, comments: [...s.openTask.comments, comment] } };
      });
      const me = meId();
      if (comment.userId === me) return;
      noteRecent(taskId, { kind: 'commented', actorId: comment.userId });
      const mine = get().myTasks.find((t) => t.id === taskId);
      const open = get().openTask?.task.id === taskId;
      if (mine && !open) {
        toast({
          kind: 'live',
          actorId: comment.userId,
          title: `${firstName(comment.userId)} commented on “${mine.title}”`,
          body: comment.body,
          action: { label: 'Open', to: `/groups/${groupId ?? mine.groupId}?task=${taskId}` },
          dedupeKey: `comment:${taskId}`,
        });
      }
    },

    applyChecklist: (taskId, checklist) => {
      set((s) => {
        if (!s.openTask || s.openTask.task.id !== taskId) return s;
        return { openTask: { ...s.openTask, checklist } };
      });
    },

    applyAnnouncementUpsert: (a, isNew) => {
      set((s) => {
        const exists = s.announcements.some((x) => x.id === a.id);
        let list = exists
          ? s.announcements.map((x) => (x.id === a.id ? { ...a, read: x.read } : x))
          : [{ ...a, read: false }, ...s.announcements];
        list = [...list].sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.id - x.id);
        return { announcements: list };
      });
      if (isNew && a.authorId !== meId()) {
        toast({
          kind: 'live',
          actorId: a.authorId,
          title: `${a.priority === 'urgent' ? 'Urgent: ' : ''}${a.title}`,
          body: `${a.authorName} · ${a.scope === 'company' ? 'Company-wide' : a.groupName || 'Group'} announcement`,
          action: { label: 'Read', to: '/announcements' },
          dedupeKey: `ann:${a.id}`,
          ttl: a.priority === 'urgent' ? 10000 : 6000,
        });
      }
    },

    applyAnnouncementDelete: (id) => {
      set((s) => ({ announcements: s.announcements.filter((a) => a.id !== id) }));
    },

    applyMessage: (message, clientId) => {
      const s = get();
      const isActive = s.activeRoomId === message.roomId && document.visibilityState === 'visible';
      set((st) => {
        const list = st.messages[message.roomId];
        let messages = st.messages;
        if (list) {
          const pendingIdx = clientId ? list.findIndex((m) => m.clientId === clientId) : -1;
          if (pendingIdx >= 0) {
            // Swap the optimistic bubble for the real message
            messages = { ...st.messages, [message.roomId]: list.map((m, i) => (i === pendingIdx ? message : m)) };
          } else if (!list.some((m) => m.id === message.id)) {
            messages = { ...st.messages, [message.roomId]: [...list, message] };
          }
        }
        const rooms = st.rooms.map((r) =>
          r.id === message.roomId
            ? {
                ...r,
                lastMessage: { body: message.body, userId: message.userId, createdAt: message.createdAt },
                unread: isActive || message.userId === meId() ? r.unread : r.unread + 1,
              }
            : r
        );
        // clear typing entry for the sender
        const typing = {
          ...st.typing,
          [message.roomId]: (st.typing[message.roomId] || []).filter((t) => t.userId !== message.userId),
        };
        return { messages, rooms, typing };
      });
      if (isActive && message.userId !== meId()) {
        get().markRoomRead(message.roomId);
      }
      if (!get().rooms.some((r) => r.id === message.roomId)) {
        get().fetchRooms();
      }
      if (!isActive && message.userId !== meId()) {
        const room = get().rooms.find((r) => r.id === message.roomId);
        toast({
          kind: 'live',
          actorId: message.userId,
          title: room && room.kind === 'group' ? `${firstName(message.userId)} in ${room.name}` : firstName(message.userId),
          body: message.body,
          action: { label: 'Reply', to: `/chat/${message.roomId}` },
          dedupeKey: `room:${message.roomId}`,
        });
      }
    },

    applyReactions: (roomId, messageId, reactions) => {
      set((s) => {
        const list = s.messages[roomId];
        if (!list) return s;
        return { messages: { ...s.messages, [roomId]: list.map((m) => (m.id === messageId ? { ...m, reactions } : m)) } };
      });
    },

    applyTyping: (roomId, userId, name) => {
      if (userId === meId()) return;
      set((s) => {
        const list = (s.typing[roomId] || []).filter((t) => t.userId !== userId);
        return { typing: { ...s.typing, [roomId]: [...list, { userId, name, until: Date.now() + 3500 }] } };
      });
    },

    applyChatRead: (roomId) => {
      set((s) => ({ rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, unread: 0 } : r)) }));
    },

    applyNotification: (n) => {
      set((s) => ({
        notifications: [n, ...s.notifications].slice(0, 100),
        notifUnread: s.notifUnread + 1,
      }));
      useUi.getState().ringBell();
      toast({
        kind: 'info',
        title: n.body,
        action: n.link ? { label: 'Open', to: n.link } : undefined,
        dedupeKey: `notif:${n.id}`,
      });
    },

    applyActivity: (a) => {
      set((s) => ({ activity: [a, ...s.activity].slice(0, 60) }));
    },

    applyPresence: (userId, online, lastActiveAt) => {
      set((s) => {
        const users = s.users[userId]
          ? { ...s.users, [userId]: { ...s.users[userId], online, lastActiveAt } }
          : s.users;
        const groupData: typeof s.groupData = {};
        for (const [gid, gd] of Object.entries(s.groupData)) {
          groupData[Number(gid)] = {
            ...gd,
            members: gd.members.map((m) => (m.id === userId ? { ...m, online, lastActiveAt } : m)),
          };
        }
        return { users, groupData };
      });
    },

    applyMembers: (groupId, members) => {
      set((s) => {
        const gd = s.groupData[groupId];
        if (!gd) return s;
        return { groupData: { ...s.groupData, [groupId]: { ...gd, members } } };
      });
    },

    reset: () => {
      for (const t of recentTimers.values()) clearTimeout(t);
      recentTimers.clear();
      set({
        users: {},
        groups: [],
        groupData: {},
        announcements: [],
        notifications: [],
        notifUnread: 0,
        activity: [],
        rooms: [],
        messages: {},
        typing: {},
        myTasks: [],
        activeRoomId: null,
        openTask: null,
        recent: {},
        loaded: false,
      });
    },
  };
});

/** The teammate change that just hit this task, if any (for flash rings and captions). */
export function useRecent(taskId: number): RecentEvent | undefined {
  return useData((s) => s.recent[taskId]);
}

/** Group cards show live task counts; refresh them at most every 2s during bursts. */
function scheduleGroupsRefresh(get: () => DataState) {
  if (groupsRefreshTimer) return;
  groupsRefreshTimer = setTimeout(() => {
    groupsRefreshTimer = null;
    get().fetchGroups().catch(() => {});
  }, 2000);
}
