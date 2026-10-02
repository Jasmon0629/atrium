import { Router } from 'express';
import { get, all, run, insert, now } from '../db.js';
import { canChatInRoom, isRoomMember } from '../permissions.js';
import { messageShape, messageReactions } from '../shapes.js';
import { emitToRoom, emitToUser, joinUserSockets } from '../live.js';
import { notify } from '../services.js';

export const chatRouter = Router();

async function roomSummary(room, userId) {
  const membership = await get('SELECT last_read_message_id FROM chat_members WHERE room_id = ? AND user_id = ?', [room.id, userId]);
  const lastRead = membership ? membership.last_read_message_id : 0;
  const unread = (
    await get('SELECT COUNT(*) AS c FROM messages WHERE room_id = ? AND id > ? AND user_id != ?', [room.id, lastRead, userId])
  ).c;
  const last = await get('SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT 1', [room.id]);

  let name = 'Chat';
  let icon = '💬';
  let otherUserId = null;
  let groupId = null;
  if (room.kind === 'group') {
    const group = await get('SELECT name, icon, id FROM groups WHERE id = ?', [room.group_id]);
    if (group) {
      name = group.name;
      icon = group.icon;
      groupId = group.id;
    }
  } else {
    const other = await get(
      `SELECT u.id, u.name FROM chat_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.room_id = ? AND cm.user_id != ?`,
      [room.id, userId]
    );
    if (other) {
      name = other.name;
      otherUserId = other.id;
    }
  }
  return {
    id: room.id,
    kind: room.kind,
    groupId,
    name,
    icon,
    otherUserId,
    unread,
    lastMessage: last ? { body: last.body, userId: last.user_id, createdAt: last.created_at } : null,
  };
}

// My chat rooms with unread counts
chatRouter.get('/rooms', async (req, res) => {
  const roomRows = await all(
    `SELECT r.* FROM chat_rooms r JOIN chat_members cm ON cm.room_id = r.id
     WHERE cm.user_id = ? ORDER BY r.id`,
    [req.user.id]
  );
  const rooms = await Promise.all(roomRows.map((r) => roomSummary(r, req.user.id)));
  rooms.sort((a, b) => {
    const ta = a.lastMessage?.createdAt || '';
    const tb = b.lastMessage?.createdAt || '';
    return tb.localeCompare(ta);
  });
  res.json({ rooms });
});

// Open (or create) a DM with another user
chatRouter.post('/dm', async (req, res) => {
  const otherId = Number(req.body?.userId);
  if (!Number.isInteger(otherId) || otherId === req.user.id) {
    return res.status(400).json({ error: 'Invalid user' });
  }
  const other = await get('SELECT * FROM users WHERE id = ?', [otherId]);
  if (!other) return res.status(404).json({ error: 'User not found' });

  const existing = await get(
    `SELECT r.* FROM chat_rooms r
     JOIN chat_members a ON a.room_id = r.id AND a.user_id = ?
     JOIN chat_members b ON b.room_id = r.id AND b.user_id = ?
     WHERE r.kind = 'dm'`,
    [req.user.id, otherId]
  );
  if (existing) return res.json({ room: await roomSummary(existing, req.user.id) });

  const roomId = await insert("INSERT INTO chat_rooms (kind, created_at) VALUES ('dm', ?)", [now()]);
  await run('INSERT INTO chat_members (room_id, user_id) VALUES (?, ?)', [roomId, req.user.id]);
  await run('INSERT INTO chat_members (room_id, user_id) VALUES (?, ?)', [roomId, otherId]);
  joinUserSockets(req.user.id, `room:${roomId}`);
  joinUserSockets(otherId, `room:${roomId}`);
  const room = await get('SELECT * FROM chat_rooms WHERE id = ?', [roomId]);
  emitToUser(otherId, 'rooms.changed', {});
  res.status(201).json({ room: await roomSummary(room, req.user.id) });
});

// Message history (newest page by default, ?before=<id> for older)
chatRouter.get('/rooms/:roomId/messages', async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (!(await isRoomMember(req.user.id, roomId))) {
    return res.status(403).json({ error: 'You are not in this chat' });
  }
  // Default just above any real id — must stay inside PG's int4 range.
  const before = Number(req.query.before) || 2147483647;
  const rows = (
    await all('SELECT * FROM messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT 50', [roomId, before])
  ).reverse();
  res.json({ messages: await Promise.all(rows.map(messageShape)), hasMore: rows.length === 50 });
});

// Send message (viewers of a group are read-only in its chat)
chatRouter.post('/rooms/:roomId/messages', async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (!(await isRoomMember(req.user.id, roomId))) {
    return res.status(403).json({ error: 'You are not in this chat' });
  }
  if (!(await canChatInRoom(req.user, roomId))) {
    return res.status(403).json({ error: 'Viewers have read-only access to this chat' });
  }
  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 4000) {
    return res.status(400).json({ error: 'Message cannot be empty (max 4000 characters)' });
  }
  let replyToId = Number(req.body?.replyToId) || null;
  if (replyToId) {
    const parent = await get('SELECT room_id FROM messages WHERE id = ?', [replyToId]);
    if (!parent || parent.room_id !== roomId) replyToId = null;
  }
  // Echoed back so the sender's client can swap its optimistic bubble for the real one
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.slice(0, 64) : undefined;
  const messageId = await insert('INSERT INTO messages (room_id, user_id, body, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?)', [
    roomId, req.user.id, body, replyToId, now(),
  ]);
  // Sender has read their own message
  await run('UPDATE chat_members SET last_read_message_id = ? WHERE room_id = ? AND user_id = ?', [
    messageId, roomId, req.user.id,
  ]);
  const message = await messageShape(await get('SELECT * FROM messages WHERE id = ?', [messageId]));
  emitToRoom(roomId, 'message.new', { message, clientId });

  // DMs also raise a notification for the other person
  const room = await get('SELECT * FROM chat_rooms WHERE id = ?', [roomId]);
  if (room.kind === 'dm') {
    const others = (
      await all('SELECT user_id FROM chat_members WHERE room_id = ? AND user_id != ?', [roomId, req.user.id])
    ).map((r) => r.user_id);
    await notify(others, 'message', `${req.user.name}: ${body.slice(0, 80)}`, `/chat/${roomId}`, req.user.id);
  }
  res.status(201).json({ message, clientId });
});

// Toggle an emoji reaction on a message. Any room member may react (viewers
// included — it is not a message). Everyone in the room sees the new tally.
chatRouter.post('/messages/:messageId/reactions', async (req, res) => {
  const messageId = Number(req.params.messageId);
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim() : '';
  if (!Number.isInteger(messageId) || !emoji || emoji.length > 16 || [...emoji].length > 4) {
    return res.status(400).json({ error: 'Invalid reaction' });
  }
  const message = await get('SELECT id, room_id FROM messages WHERE id = ?', [messageId]);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (!(await isRoomMember(req.user.id, message.room_id))) {
    return res.status(403).json({ error: 'You are not in this chat' });
  }
  const existing = await get(
    'SELECT 1 AS x FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    [messageId, req.user.id, emoji]
  );
  if (existing) {
    await run('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [
      messageId, req.user.id, emoji,
    ]);
  } else {
    await run('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', [
      messageId, req.user.id, emoji, now(),
    ]);
  }
  const reactions = await messageReactions(messageId);
  emitToRoom(message.room_id, 'message.reacted', { messageId, roomId: message.room_id, reactions });
  res.json({ reactions, reacted: !existing });
});

// Mark room read up to latest
chatRouter.post('/rooms/:roomId/read', async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (!(await isRoomMember(req.user.id, roomId))) {
    return res.status(403).json({ error: 'You are not in this chat' });
  }
  const last = (await get('SELECT COALESCE(MAX(id), 0) AS m FROM messages WHERE room_id = ?', [roomId])).m;
  await run('UPDATE chat_members SET last_read_message_id = ? WHERE room_id = ? AND user_id = ?', [
    last, roomId, req.user.id,
  ]);
  emitToUser(req.user.id, 'chat.read', { roomId });
  res.json({ ok: true });
});
