import { get, all } from './db.js';

// Role ranks: higher rank = more power. Super admins act as admin everywhere.
const RANK = { viewer: 1, member: 2, admin: 3 };

export function roleRank(role) {
  return RANK[role] || 0;
}

/** The user's effective role in a group, or null if no access. */
export async function groupRole(user, groupId) {
  if (user.is_super_admin || user.isSuperAdmin) return 'admin';
  const row = await get('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', [
    groupId,
    user.id,
  ]);
  return row ? row.role : null;
}

/** All group ids the user can see. Super admins see every group. */
export async function userGroupIds(user) {
  if (user.is_super_admin || user.isSuperAdmin) {
    return (await all('SELECT id FROM groups')).map((r) => r.id);
  }
  const rows = await all('SELECT group_id FROM group_members WHERE user_id = ?', [user.id]);
  return rows.map((r) => r.group_id);
}

/** Express middleware factory: group id taken from req.params[param]. */
export function requireGroupRole(minRole, param = 'groupId') {
  return async (req, res, next) => {
    const groupId = Number(req.params[param]);
    if (!Number.isInteger(groupId)) return res.status(400).json({ error: 'Invalid group id' });
    const group = await get('SELECT id FROM groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const role = await groupRole(req.user, groupId);
    if (!role) return res.status(403).json({ error: 'You are not a member of this group' });
    if (roleRank(role) < roleRank(minRole)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    req.groupId = groupId;
    req.groupRole = role;
    next();
  };
}

/** Loads a task, checks the actor holds at least minRole in its group. */
export function requireTaskRole(minRole, param = 'taskId') {
  return async (req, res, next) => {
    const taskId = Number(req.params[param]);
    if (!Number.isInteger(taskId)) return res.status(400).json({ error: 'Invalid task id' });
    const task = await get('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const role = await groupRole(req.user, task.group_id);
    if (!role) return res.status(403).json({ error: 'You are not a member of this group' });
    if (roleRank(role) < roleRank(minRole)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    req.task = task;
    req.groupRole = role;
    next();
  };
}

export function requireSuperAdmin(req, res, next) {
  if (!req.user.is_super_admin) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
}

/** True if the user belongs to the chat room. */
export async function isRoomMember(userId, roomId) {
  return !!(await get('SELECT 1 AS x FROM chat_members WHERE room_id = ? AND user_id = ?', [
    roomId,
    userId,
  ]));
}

/** True if the user may SEND into the room: viewers of a group are read-only. */
export async function canChatInRoom(user, roomId) {
  if (!(await isRoomMember(user.id, roomId))) return false;
  const room = await get('SELECT kind, group_id FROM chat_rooms WHERE id = ?', [roomId]);
  if (!room) return false;
  if (room.kind === 'group') {
    return roleRank(await groupRole(user, room.group_id)) >= roleRank('member');
  }
  return true;
}
