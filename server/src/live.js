import { Server } from 'socket.io';
import { all, run, now } from './db.js';
import { resolveUser } from './auth.js';
import { userGroupIds, canChatInRoom } from './permissions.js';

let io = null;

// userId -> number of open sockets (presence is ephemeral by design)
const socketCounts = new Map();

export function getOnlineUserIds() {
  return [...socketCounts.keys()];
}

export function initLive(httpServer, { corsOrigin = true, buildId = 'dev' } = {}) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const resolved = token ? await resolveUser(token) : null;
      if (!resolved) return next(new Error('unauthorized'));
      socket.data.user = resolved.user;
      next();
    } catch (err) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;

    // Which build is running: a tab reconnecting after a deploy learns it is stale
    socket.emit('server.hello', { build: buildId, serverTime: now() });

    // Personal lane
    socket.join(`user:${user.id}`);
    // Shared lanes: one room per group membership
    for (const gid of await userGroupIds(user)) socket.join(`group:${gid}`);
    // Chat rooms
    const rooms = await all('SELECT room_id FROM chat_members WHERE user_id = ?', [user.id]);
    for (const r of rooms) socket.join(`room:${r.room_id}`);

    const prev = socketCounts.get(user.id) || 0;
    socketCounts.set(user.id, prev + 1);
    if (prev === 0) {
      io.emit('presence.changed', { userId: user.id, online: true, lastActiveAt: now() });
    }

    socket.on('chat.typing', async (payload) => {
      const roomId = Number(payload?.roomId);
      if (!Number.isInteger(roomId) || !(await canChatInRoom(user, roomId))) return;
      socket.to(`room:${roomId}`).emit('chat.typing', {
        roomId,
        userId: user.id,
        name: user.name,
      });
    });

    socket.on('disconnect', async () => {
      const count = (socketCounts.get(user.id) || 1) - 1;
      if (count <= 0) {
        socketCounts.delete(user.id);
        const ts = now();
        await run('UPDATE users SET last_active_at = ? WHERE id = ?', [ts, user.id]).catch(() => {});
        io.emit('presence.changed', { userId: user.id, online: false, lastActiveAt: ts });
      } else {
        socketCounts.set(user.id, count);
      }
    });
  });

  return io;
}

export function emitToGroup(groupId, event, payload) {
  if (io) io.to(`group:${groupId}`).emit(event, payload);
}

export function emitToUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}

export function emitToRoom(roomId, event, payload) {
  if (io) io.to(`room:${roomId}`).emit(event, payload);
}

export function emitToCompany(event, payload) {
  if (io) io.emit(event, payload);
}

/** Join/leave every live socket of a user to a socket.io room (membership changes). */
export function joinUserSockets(userId, room) {
  if (io) io.in(`user:${userId}`).socketsJoin(room);
}

export function leaveUserSockets(userId, room) {
  if (io) io.in(`user:${userId}`).socketsLeave(room);
}

/** Drop every live connection of a user (account disabled, password reset). */
export function disconnectUserSockets(userId) {
  if (io) io.in(`user:${userId}`).disconnectSockets(true);
}
