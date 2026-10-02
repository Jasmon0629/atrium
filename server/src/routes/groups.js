import { Router } from 'express';
import { get, all, run, insert, withTransaction, now, today } from '../db.js';
import { groupRole, requireGroupRole, requireSuperAdmin, userGroupIds } from '../permissions.js';
import { groupShape, columnShape, taskShapes, userShape } from '../shapes.js';
import { emitToGroup, emitToUser, joinUserSockets, leaveUserSockets, getOnlineUserIds } from '../live.js';
import { logActivity, notify } from '../services.js';

export const groupsRouter = Router();

async function groupSummary(row, user) {
  const stats = await get(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN t.completed_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS done,
            COALESCE(SUM(CASE WHEN t.completed_at IS NULL AND t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue
     FROM tasks t WHERE t.group_id = ?`,
    [today(), row.id]
  );
  const memberCount = (
    await get('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?', [row.id])
  ).c;
  return {
    ...groupShape(row),
    role: await groupRole(user, row.id),
    memberCount,
    taskTotal: stats.total || 0,
    taskDone: stats.done || 0,
    taskOverdue: stats.overdue || 0,
  };
}

// My groups (super admin: all groups)
groupsRouter.get('/', async (req, res) => {
  const ids = await userGroupIds(req.user);
  const groups = [];
  for (const id of ids) {
    const g = await get('SELECT * FROM groups WHERE id = ?', [id]);
    if (g) groups.push(await groupSummary(g, req.user));
  }
  res.json({ groups });
});

// Full workspace payload: group, members (with roles + presence), columns, tasks
groupsRouter.get('/:groupId', requireGroupRole('viewer'), async (req, res) => {
  const group = await get('SELECT * FROM groups WHERE id = ?', [req.groupId]);
  const online = new Set(getOnlineUserIds());
  const members = (
    await all(
      `SELECT u.*, gm.role AS group_role FROM group_members gm
       JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.name`,
      [req.groupId]
    )
  ).map((r) => ({ ...userShape(r), role: r.group_role, online: online.has(r.id) }));
  const columns = (
    await all('SELECT * FROM board_columns WHERE group_id = ? ORDER BY position', [req.groupId])
  ).map(columnShape);
  const tasks = await taskShapes(
    await all('SELECT * FROM tasks WHERE group_id = ? ORDER BY position', [req.groupId])
  );
  res.json({ group: { ...(await groupSummary(group, req.user)) }, members, columns, tasks });
});

// Create group (super admin only)
groupsRouter.post('/', requireSuperAdmin, async (req, res) => {
  const { name, description = '', icon = '💼', color = '#14655c', isProject = false } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 80) {
    return res.status(400).json({ error: 'Group name is required (max 80 characters)' });
  }
  const ts = now();
  const groupId = await insert(
    'INSERT INTO groups (name, description, icon, color, is_project, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [name.trim(), String(description).slice(0, 500), String(icon).slice(0, 8), String(color).slice(0, 16), isProject ? 1 : 0, ts]
  );
  // Default board + group chat room
  const defaults = [
    ['To Do', 1, 0],
    ['In Progress', 2, 0],
    ['Review', 3, 0],
    ['Completed', 4, 1],
  ];
  for (const [colName, pos, isDone] of defaults) {
    await run('INSERT INTO board_columns (group_id, name, position, is_done) VALUES (?, ?, ?, ?)', [groupId, colName, pos, isDone]);
  }
  await run("INSERT INTO chat_rooms (kind, group_id, created_at) VALUES ('group', ?, ?)", [groupId, ts]);
  // Group rooms are joined at socket-connect time; join the creator's live
  // sockets now so the new board is realtime immediately, not after reconnect.
  joinUserSockets(req.user.id, `group:${groupId}`);
  emitToUser(req.user.id, 'groups.changed', {});
  const group = await get('SELECT * FROM groups WHERE id = ?', [groupId]);
  res.status(201).json({ group: await groupSummary(group, req.user) });
});

// Delete a group (super admin only). Everything inside it goes with it: board
// columns and tasks (with assignees, comments, checklists), the group chat room
// and its messages, group announcements, activity. Members are told, dropped
// from the live rooms and their group list refreshes everywhere.
groupsRouter.delete('/:groupId', requireSuperAdmin, async (req, res) => {
  const groupId = Number(req.params.groupId);
  const group = await get('SELECT * FROM groups WHERE id = ?', [groupId]);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const memberIds = (await all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId])).map((r) => r.user_id);
  const room = await get('SELECT id FROM chat_rooms WHERE group_id = ?', [groupId]);

  // Anyone looking at the board learns first, while the room still exists
  emitToGroup(groupId, 'group.deleted', { groupId, name: group.name });

  // Tasks reference columns without a cascade, so clear them explicitly before
  // the group row; every other table cascades from groups / tasks / chat_rooms.
  await withTransaction(async (q) => {
    await q('DELETE FROM tasks WHERE group_id = ?', [groupId]);
    await q('DELETE FROM board_columns WHERE group_id = ?', [groupId]);
    await q('DELETE FROM groups WHERE id = ?', [groupId]);
  });

  for (const uid of memberIds) {
    leaveUserSockets(uid, `group:${groupId}`);
    if (room) leaveUserSockets(uid, `room:${room.id}`);
    emitToUser(uid, 'groups.changed', {});
  }
  const others = memberIds.filter((id) => id !== req.user.id);
  if (others.length) await notify(others, 'group', `The group "${group.name}" was deleted`, '/', req.user.id);
  emitToUser(req.user.id, 'groups.changed', {});
  // The group's own activity log goes with it, so this line is the record of the deletion
  console.log(`[audit] group "${group.name}" (id ${groupId}, ${memberIds.length} members) deleted by ${req.user.name}`);
  res.json({ ok: true });
});

// Update group meta (group admin) — including the project's value & unit
groupsRouter.patch('/:groupId', requireGroupRole('admin'), async (req, res) => {
  const { name, description, icon, color, value, valueUnit } = req.body || {};
  const group = await get('SELECT * FROM groups WHERE id = ?', [req.groupId]);
  const next = {
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : group.name,
    description: typeof description === 'string' ? description.slice(0, 500) : group.description,
    icon: typeof icon === 'string' && icon ? icon.slice(0, 8) : group.icon,
    color: typeof color === 'string' && color ? color.slice(0, 16) : group.color,
    value:
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12
        ? Math.round(value * 100) / 100
        : group.value,
    valueUnit:
      typeof valueUnit === 'string' && valueUnit.trim()
        ? valueUnit.trim().slice(0, 8)
        : group.value_unit,
  };
  await run('UPDATE groups SET name = ?, description = ?, icon = ?, color = ?, value = ?, value_unit = ? WHERE id = ?', [
    next.name, next.description, next.icon, next.color, next.value, next.valueUnit, req.groupId,
  ]);
  if (next.value !== group.value) {
    await logActivity(req.groupId, req.user.id, 'updated project value', next.name, `to ${next.valueUnit} ${next.value.toLocaleString()}`);
  }
  emitToGroup(req.groupId, 'group.updated', { groupId: req.groupId });
  res.json({ ok: true });
});

// ---- Members ----

groupsRouter.post('/:groupId/members', requireGroupRole('admin'), async (req, res) => {
  const userId = Number(req.body?.userId);
  const role = ['admin', 'member', 'viewer'].includes(req.body?.role) ? req.body.role : 'member';
  const target = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const exists = await get('SELECT 1 AS x FROM group_members WHERE group_id = ? AND user_id = ?', [req.groupId, userId]);
  if (exists) return res.status(409).json({ error: 'Already a member' });
  await run('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [req.groupId, userId, role, now()]);
  // Join their group chat room too
  const room = await get('SELECT id FROM chat_rooms WHERE group_id = ?', [req.groupId]);
  if (room) {
    await run('INSERT INTO chat_members (room_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [room.id, userId]);
    joinUserSockets(userId, `room:${room.id}`);
  }
  joinUserSockets(userId, `group:${req.groupId}`);
  const group = await get('SELECT name FROM groups WHERE id = ?', [req.groupId]);
  await notify([userId], 'group', `You were added to ${group.name}`, `/groups/${req.groupId}`, req.user.id);
  emitToUser(userId, 'groups.changed', {});
  await logActivity(req.groupId, req.user.id, 'added', target.name, `as ${role}`);
  await emitMembers(req.groupId);
  res.status(201).json({ ok: true });
});

groupsRouter.patch('/:groupId/members/:userId', requireGroupRole('admin'), async (req, res) => {
  const userId = Number(req.params.userId);
  const role = req.body?.role;
  if (!['admin', 'member', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const r = await run('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?', [role, req.groupId, userId]);
  if (r.changes === 0) return res.status(404).json({ error: 'Not a member' });
  emitToUser(userId, 'groups.changed', {});
  await emitMembers(req.groupId);
  res.json({ ok: true });
});

groupsRouter.delete('/:groupId/members/:userId', requireGroupRole('admin'), async (req, res) => {
  const userId = Number(req.params.userId);
  const target = await get('SELECT name FROM users WHERE id = ?', [userId]);
  const r = await run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [req.groupId, userId]);
  if (r.changes === 0) return res.status(404).json({ error: 'Not a member' });
  const room = await get('SELECT id FROM chat_rooms WHERE group_id = ?', [req.groupId]);
  if (room) {
    await run('DELETE FROM chat_members WHERE room_id = ? AND user_id = ?', [room.id, userId]);
    leaveUserSockets(userId, `room:${room.id}`);
  }
  leaveUserSockets(userId, `group:${req.groupId}`);
  // Revoke access fully: stale assignee rows would keep leaking task content
  // (via /my-tasks and assignment notifications) to the removed user.
  await run(
    'DELETE FROM task_assignees WHERE user_id = ? AND task_id IN (SELECT id FROM tasks WHERE group_id = ?)',
    [userId, req.groupId]
  );
  const refreshed = await taskShapes(
    await all('SELECT * FROM tasks WHERE group_id = ? ORDER BY position', [req.groupId])
  );
  emitToGroup(req.groupId, 'board.refreshed', { groupId: req.groupId, tasks: refreshed });
  const group = await get('SELECT name FROM groups WHERE id = ?', [req.groupId]);
  await notify([userId], 'group', `You were removed from ${group.name}`, '', req.user.id);
  emitToUser(userId, 'groups.changed', {});
  if (target) await logActivity(req.groupId, req.user.id, 'removed', target.name, '');
  await emitMembers(req.groupId);
  res.json({ ok: true });
});

async function emitMembers(groupId) {
  const online = new Set(getOnlineUserIds());
  const members = (
    await all(
      `SELECT u.*, gm.role AS group_role FROM group_members gm
       JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.name`,
      [groupId]
    )
  ).map((r) => ({ ...userShape(r), role: r.group_role, online: online.has(r.id) }));
  emitToGroup(groupId, 'members.changed', { groupId, members });
}

// ---- Columns (board structure: admins only) ----

groupsRouter.post('/:groupId/columns', requireGroupRole('admin'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 40) return res.status(400).json({ error: 'Column name is required (max 40 characters)' });
  const max = (
    await get('SELECT COALESCE(MAX(position), 0) AS m FROM board_columns WHERE group_id = ?', [req.groupId])
  ).m;
  await run('INSERT INTO board_columns (group_id, name, position, is_done) VALUES (?, ?, ?, ?)', [
    req.groupId, name, max + 1, req.body?.isDone ? 1 : 0,
  ]);
  await logActivity(req.groupId, req.user.id, 'created column', name, '');
  await emitColumns(req.groupId);
  res.status(201).json({ ok: true });
});

groupsRouter.patch('/:groupId/columns/:columnId', requireGroupRole('admin'), async (req, res) => {
  const col = await get('SELECT * FROM board_columns WHERE id = ? AND group_id = ?', [Number(req.params.columnId), req.groupId]);
  if (!col) return res.status(404).json({ error: 'Column not found' });
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 40) : col.name;
  const position = typeof req.body?.position === 'number' ? req.body.position : col.position;
  const isDone = typeof req.body?.isDone === 'boolean' ? (req.body.isDone ? 1 : 0) : col.is_done;
  await run('UPDATE board_columns SET name = ?, position = ?, is_done = ? WHERE id = ?', [name, position, isDone, col.id]);
  // Tasks derive their done-state from the column they sit in — changing the
  // column's meaning must recompute the tasks already inside it.
  if (isDone !== col.is_done) {
    const ts = now();
    if (isDone) {
      await run('UPDATE tasks SET completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE column_id = ?', [ts, ts, col.id]);
    } else {
      await run('UPDATE tasks SET completed_at = NULL, updated_at = ? WHERE column_id = ?', [ts, col.id]);
    }
    const tasks = await taskShapes(
      await all('SELECT * FROM tasks WHERE group_id = ? ORDER BY position', [req.groupId])
    );
    emitToGroup(req.groupId, 'board.refreshed', { groupId: req.groupId, tasks });
  }
  await emitColumns(req.groupId);
  res.json({ ok: true });
});

groupsRouter.delete('/:groupId/columns/:columnId', requireGroupRole('admin'), async (req, res) => {
  const col = await get('SELECT * FROM board_columns WHERE id = ? AND group_id = ?', [Number(req.params.columnId), req.groupId]);
  if (!col) return res.status(404).json({ error: 'Column not found' });
  const others = await all('SELECT * FROM board_columns WHERE group_id = ? AND id != ? ORDER BY position', [req.groupId, col.id]);
  if (others.length === 0) return res.status(400).json({ error: 'A board needs at least one column' });
  // Move orphaned tasks to the first remaining column, adopting that column's
  // done-semantics and appending after its existing tasks — atomically.
  const target = others[0];
  const ts = now();
  const orphans = await all('SELECT * FROM tasks WHERE column_id = ? ORDER BY position', [col.id]);
  const base = (
    await get('SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE column_id = ?', [target.id])
  ).m;
  await withTransaction(async (q) => {
    for (let i = 0; i < orphans.length; i++) {
      const t = orphans[i];
      const completedAt = target.is_done ? t.completed_at || ts : null;
      await q('UPDATE tasks SET column_id = ?, position = ?, completed_at = ?, updated_at = ? WHERE id = ?', [
        target.id, base + i + 1, completedAt, ts, t.id,
      ]);
    }
    await q('DELETE FROM board_columns WHERE id = ?', [col.id]);
  });
  await logActivity(req.groupId, req.user.id, 'deleted column', col.name, '');
  await emitColumns(req.groupId);
  // Tasks changed column; resend the board's tasks
  const tasks = await taskShapes(
    await all('SELECT * FROM tasks WHERE group_id = ? ORDER BY position', [req.groupId])
  );
  emitToGroup(req.groupId, 'board.refreshed', { groupId: req.groupId, tasks });
  res.json({ ok: true });
});

async function emitColumns(groupId) {
  const columns = (
    await all('SELECT * FROM board_columns WHERE group_id = ? ORDER BY position', [groupId])
  ).map(columnShape);
  emitToGroup(groupId, 'columns.changed', { groupId, columns });
}
