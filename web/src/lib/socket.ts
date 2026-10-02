import { io, Socket } from 'socket.io-client';
import { useData } from '../stores/data';
import { toast, useUi } from '../stores/ui';
import { noteServerBuild } from './version';
import type {
  Activity,
  Announcement,
  ChecklistItem,
  Column,
  Member,
  Message,
  Notification,
  Reaction,
  Task,
  TaskComment,
} from './types';

let socket: Socket | null = null;
let socketToken: string | null = null;

export function connectSocket(token: string) {
  // Reuse only if the live socket was authenticated with this same token;
  // a token change (re-login, user switch) must tear down the old rooms.
  if (socket && socketToken === token) return socket;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socketToken = token;
  const prefix = import.meta.env.BASE_URL.replace(/\/$/, '');
  socket = io('/', { auth: { token }, path: `${prefix}/socket.io/` });
  const d = () => useData.getState();
  const ui = () => useUi.getState();

  // Connection state + heartbeat for the kiosk "synced Xs ago" readout
  socket.onAny(() => ui().touch());
  socket.on('connect', () => ui().setOnline(true));
  socket.on('disconnect', () => ui().setOnline(false));
  // The server announces its build on every (re)connect — a deploy restarts the
  // server, so this is exactly when an open tab learns it is out of date.
  socket.on('server.hello', (p: { build?: string }) => noteServerBuild(p?.build));

  // Task events carry who did it, so the store can flash cards and announce
  // teammates' changes while staying quiet about the current user's own.
  socket.on('task.created', (p: { task: Task; actorId?: number | null }) =>
    d().applyTaskUpsert(p.task, { kind: 'created', actorId: p.actorId ?? null })
  );
  socket.on('task.updated', (p: { task: Task; actorId?: number | null }) =>
    d().applyTaskUpsert(p.task, { kind: 'updated', actorId: p.actorId ?? null })
  );
  socket.on('task.moved', (p: { task: Task; actorId?: number | null }) =>
    d().applyTaskUpsert(p.task, { kind: 'moved', actorId: p.actorId ?? null })
  );
  socket.on('task.deleted', (p: { taskId: number; groupId: number; actorId?: number | null }) =>
    d().applyTaskDelete(p.taskId, p.groupId, p.actorId ?? null)
  );
  socket.on('group.deleted', (p: { groupId: number; name?: string }) => {
    d().applyGroupDeleted(p.groupId);
    toast({ kind: 'info', title: `Group “${p.name ?? ''}” was deleted`, dedupeKey: `group-deleted-${p.groupId}` });
  });
  socket.on('columns.changed', (p: { groupId: number; columns: Column[] }) =>
    d().applyColumns(p.groupId, p.columns)
  );
  socket.on('board.refreshed', (p: { groupId: number; tasks: Task[] }) =>
    d().applyBoardRefresh(p.groupId, p.tasks)
  );
  socket.on('comment.added', (p: { taskId: number; groupId: number; comment: TaskComment }) =>
    d().applyComment(p.taskId, p.comment, p.groupId)
  );
  socket.on('checklist.changed', (p: { taskId: number; checklist: ChecklistItem[] }) =>
    d().applyChecklist(p.taskId, p.checklist)
  );

  socket.on('announcement.created', (p: { announcement: Announcement }) =>
    d().applyAnnouncementUpsert(p.announcement, true)
  );
  socket.on('announcement.updated', (p: { announcement: Announcement }) =>
    d().applyAnnouncementUpsert(p.announcement, false)
  );
  socket.on('announcement.deleted', (p: { id: number }) => d().applyAnnouncementDelete(p.id));

  socket.on('message.new', (p: { message: Message; clientId?: string }) => d().applyMessage(p.message, p.clientId));
  socket.on('message.reacted', (p: { messageId: number; roomId: number; reactions: Reaction[] }) =>
    d().applyReactions(p.roomId, p.messageId, p.reactions)
  );
  socket.on('chat.typing', (p: { roomId: number; userId: number; name: string }) =>
    d().applyTyping(p.roomId, p.userId, p.name)
  );
  socket.on('chat.read', (p: { roomId: number }) => d().applyChatRead(p.roomId));
  socket.on('rooms.changed', () => d().fetchRooms());

  socket.on('notification.new', (p: { notification: Notification }) =>
    d().applyNotification(p.notification)
  );
  socket.on('activity.new', (p: { activity: Activity }) => d().applyActivity(p.activity));
  socket.on('presence.changed', (p: { userId: number; online: boolean; lastActiveAt: string }) =>
    d().applyPresence(p.userId, p.online, p.lastActiveAt)
  );
  socket.on('members.changed', (p: { groupId: number; members: Member[] }) =>
    d().applyMembers(p.groupId, p.members)
  );
  socket.on('groups.changed', () => {
    d().fetchGroups();
    d().fetchRooms();
    d().fetchMyTasks();
  });
  socket.on('group.updated', () => d().fetchGroups());
  socket.on('users.changed', () => d().fetchUsers());

  // After any reconnect, resync — events may have been missed while offline
  socket.io.on('reconnect', () => {
    const st = d();
    const resync = Promise.all([
      st.fetchAll(),
      ...Object.keys(st.groupData).map((gid) => st.fetchGroup(Number(gid))),
      ...Object.keys(st.messages).map((roomId) => st.fetchMessages(Number(roomId))),
      st.openTask ? st.openTaskModal(st.openTask.task.id) : Promise.resolve(),
    ]);
    resync
      .then(() => toast({ kind: 'success', title: 'Back online', body: 'Everything is up to date.', dedupeKey: 'conn', ttl: 2500 }))
      .catch(() =>
        toast({ kind: 'error', title: 'Connection problem', body: 'Some data may be stale — retrying.', dedupeKey: 'conn' })
      );
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    socketToken = null;
  }
  useUi.getState().setOnline(true);
}

export function emitTyping(roomId: number) {
  socket?.emit('chat.typing', { roomId });
}
