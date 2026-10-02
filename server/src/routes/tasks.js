import { Router } from 'express';
import { get, all, run, insert, now } from '../db.js';
import { requireGroupRole, requireTaskRole } from '../permissions.js';
import { taskShape, taskShapes, commentShape, checklistShape } from '../shapes.js';
import { emitToGroup } from '../live.js';
import { logActivity, notify } from '../services.js';

export const tasksRouter = Router();

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

function cleanDate(v) {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return v;
}

function cleanTags(v) {
  if (!Array.isArray(v)) return undefined;
  return JSON.stringify(v.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 30)).slice(0, 10));
}

// Every task event names the actor so clients can animate/announce teammates'
// changes ("Uma moved X") and stay quiet about the current user's own actions.
async function emitTask(groupId, event, task, actorId = null) {
  emitToGroup(groupId, event, {
    task: await taskShape(await get('SELECT * FROM tasks WHERE id = ?', [task.id])),
    actorId,
  });
}

/** Sync the assignee set; returns ids that are newly assigned. */
async function syncAssignees(taskId, assigneeIds, groupId) {
  const valid = new Set(
    (await all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId])).map((r) => r.user_id)
  );
  const wanted = [...new Set(assigneeIds)].filter((id) => valid.has(Number(id))).map(Number);
  const current = (await all('SELECT user_id FROM task_assignees WHERE task_id = ?', [taskId])).map((r) => r.user_id);
  const added = wanted.filter((id) => !current.includes(id));
  await run('DELETE FROM task_assignees WHERE task_id = ?', [taskId]);
  for (const id of wanted) {
    await run('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)', [taskId, id]);
  }
  return added;
}

// Create task (member+)
tasksRouter.post('/groups/:groupId/tasks', requireGroupRole('member'), async (req, res) => {
  const { title, description = '', priority = 'normal', columnId, dueDate, startDate, tags, assigneeIds } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    return res.status(400).json({ error: 'Task title is required (max 200 characters)' });
  }
  const column = await get('SELECT * FROM board_columns WHERE id = ? AND group_id = ?', [Number(columnId), req.groupId]);
  if (!column) return res.status(400).json({ error: 'Invalid column' });
  if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });

  const max = (
    await get('SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE column_id = ?', [column.id])
  ).m;
  const ts = now();
  const taskId = await insert(
    `INSERT INTO tasks (group_id, column_id, title, description, priority, position, start_date, due_date, tags, created_by, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.groupId, column.id, title.trim(), String(description).slice(0, 5000), priority,
      max + 1, cleanDate(startDate) ?? null, cleanDate(dueDate) ?? null,
      cleanTags(tags) ?? '[]', req.user.id, ts, ts, column.is_done ? ts : null,
    ]
  );

  const added = Array.isArray(assigneeIds) ? await syncAssignees(taskId, assigneeIds, req.groupId) : [];
  if (added.length) {
    await notify(added, 'task', `${req.user.name} assigned you: ${title.trim()}`, `/groups/${req.groupId}?task=${taskId}`, req.user.id);
  }
  await logActivity(req.groupId, req.user.id, 'created task', title.trim(), '');
  await emitTask(req.groupId, 'task.created', { id: taskId }, req.user.id);
  res.status(201).json({ task: await taskShape(await get('SELECT * FROM tasks WHERE id = ?', [taskId])) });
});

// Task detail: comments + checklist (viewer+)
tasksRouter.get('/tasks/:taskId', requireTaskRole('viewer'), async (req, res) => {
  const comments = (
    await all('SELECT * FROM task_comments WHERE task_id = ? ORDER BY id', [req.task.id])
  ).map(commentShape);
  const checklist = (
    await all('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position', [req.task.id])
  ).map(checklistShape);
  res.json({ task: await taskShape(req.task), comments, checklist });
});

// Edit task fields (member+)
tasksRouter.patch('/tasks/:taskId', requireTaskRole('member'), async (req, res) => {
  const t = req.task;
  const b = req.body || {};
  const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 200) : t.title;
  const description = typeof b.description === 'string' ? b.description.slice(0, 5000) : t.description;
  const priority = PRIORITIES.includes(b.priority) ? b.priority : t.priority;
  const dueDate = cleanDate(b.dueDate) !== undefined ? cleanDate(b.dueDate) : t.due_date;
  const startDate = cleanDate(b.startDate) !== undefined ? cleanDate(b.startDate) : t.start_date;
  const tags = cleanTags(b.tags) !== undefined ? cleanTags(b.tags) : t.tags;
  const progress = Number.isInteger(b.progress) && b.progress >= 0 && b.progress <= 100 ? b.progress : t.progress;

  await run(
    `UPDATE tasks SET title = ?, description = ?, priority = ?, due_date = ?, start_date = ?, tags = ?, progress = ?, updated_at = ? WHERE id = ?`,
    [title, description, priority, dueDate, startDate, tags, progress, now(), t.id]
  );

  if (Array.isArray(b.assigneeIds)) {
    const added = await syncAssignees(t.id, b.assigneeIds, t.group_id);
    if (added.length) {
      await notify(added, 'task', `${req.user.name} assigned you: ${title}`, `/groups/${t.group_id}?task=${t.id}`, req.user.id);
    }
  }
  await logActivity(t.group_id, req.user.id, 'updated task', title, '');
  await emitTask(t.group_id, 'task.updated', t, req.user.id);
  res.json({ task: await taskShape(await get('SELECT * FROM tasks WHERE id = ?', [t.id])) });
});

// Move task between/within columns (member+) — the core realtime path
tasksRouter.patch('/tasks/:taskId/move', requireTaskRole('member'), async (req, res) => {
  const t = req.task;
  const columnId = Number(req.body?.columnId);
  const position = Number(req.body?.position);
  const column = await get('SELECT * FROM board_columns WHERE id = ? AND group_id = ?', [columnId, t.group_id]);
  if (!column) return res.status(400).json({ error: 'Invalid column' });
  if (!Number.isFinite(position)) return res.status(400).json({ error: 'Invalid position' });

  const fromColumn = await get('SELECT * FROM board_columns WHERE id = ?', [t.column_id]);
  const ts = now();
  const completedAt = column.is_done ? (t.completed_at || ts) : null;
  // progress is deliberately untouched: completion is derived from completed_at,
  // so an accidental drop into "Completed" and back never destroys the value.
  await run('UPDATE tasks SET column_id = ?, position = ?, completed_at = ?, updated_at = ? WHERE id = ?', [
    column.id, position, completedAt, ts, t.id,
  ]);

  if (fromColumn && fromColumn.id !== column.id) {
    await logActivity(t.group_id, req.user.id, 'moved task', t.title, `from ${fromColumn.name} to ${column.name}`);
    // Tell assignees (other than the mover) their task changed state
    const assignees = (await all('SELECT user_id FROM task_assignees WHERE task_id = ?', [t.id])).map((r) => r.user_id);
    await notify(assignees, 'task', `"${t.title}" moved to ${column.name}`, `/groups/${t.group_id}?task=${t.id}`, req.user.id);
  }
  await emitTask(t.group_id, 'task.moved', t, req.user.id);
  res.json({ task: await taskShape(await get('SELECT * FROM tasks WHERE id = ?', [t.id])) });
});

// Delete task: group admins, or the member who created it
tasksRouter.delete('/tasks/:taskId', requireTaskRole('member'), async (req, res) => {
  const t = req.task;
  if (req.groupRole !== 'admin' && t.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Only group admins or the task creator can delete a task' });
  }
  await run('DELETE FROM tasks WHERE id = ?', [t.id]);
  await logActivity(t.group_id, req.user.id, 'deleted task', t.title, '');
  emitToGroup(t.group_id, 'task.deleted', { taskId: t.id, groupId: t.group_id, actorId: req.user.id });
  res.json({ ok: true });
});

// ---- Comments (member+) ----

tasksRouter.post('/tasks/:taskId/comments', requireTaskRole('member'), async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 2000) return res.status(400).json({ error: 'Comment cannot be empty (max 2000 characters)' });
  const commentId = await insert('INSERT INTO task_comments (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', [
    req.task.id, req.user.id, body, now(),
  ]);
  const comment = commentShape(await get('SELECT * FROM task_comments WHERE id = ?', [commentId]));
  const assignees = (await all('SELECT user_id FROM task_assignees WHERE task_id = ?', [req.task.id])).map((r) => r.user_id);
  await notify(
    [...assignees, req.task.created_by],
    'comment',
    `${req.user.name} commented on "${req.task.title}"`,
    `/groups/${req.task.group_id}?task=${req.task.id}`,
    req.user.id
  );
  await logActivity(req.task.group_id, req.user.id, 'commented on', req.task.title, '');
  emitToGroup(req.task.group_id, 'comment.added', { taskId: req.task.id, groupId: req.task.group_id, comment });
  await emitTask(req.task.group_id, 'task.updated', req.task, req.user.id);
  res.status(201).json({ comment });
});

// ---- Checklist (member+) ----

tasksRouter.post('/tasks/:taskId/checklist', requireTaskRole('member'), async (req, res) => {
  const label = String(req.body?.label || '').trim();
  if (!label || label.length > 200) return res.status(400).json({ error: 'Checklist item text is required' });
  const max = (
    await get('SELECT COALESCE(MAX(position), 0) AS m FROM checklist_items WHERE task_id = ?', [req.task.id])
  ).m;
  const itemId = await insert('INSERT INTO checklist_items (task_id, label, position) VALUES (?, ?, ?)', [
    req.task.id, label, max + 1,
  ]);
  await emitChecklist(req.task);
  res.status(201).json({ item: checklistShape(await get('SELECT * FROM checklist_items WHERE id = ?', [itemId])) });
});

tasksRouter.patch('/tasks/:taskId/checklist/:itemId', requireTaskRole('member'), async (req, res) => {
  const item = await get('SELECT * FROM checklist_items WHERE id = ? AND task_id = ?', [Number(req.params.itemId), req.task.id]);
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });
  const done = typeof req.body?.done === 'boolean' ? (req.body.done ? 1 : 0) : item.done;
  const label = typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim().slice(0, 200) : item.label;
  await run('UPDATE checklist_items SET done = ?, label = ? WHERE id = ?', [done, label, item.id]);
  await emitChecklist(req.task);
  res.json({ ok: true });
});

tasksRouter.delete('/tasks/:taskId/checklist/:itemId', requireTaskRole('member'), async (req, res) => {
  const r = await run('DELETE FROM checklist_items WHERE id = ? AND task_id = ?', [Number(req.params.itemId), req.task.id]);
  if (r.changes === 0) return res.status(404).json({ error: 'Checklist item not found' });
  await emitChecklist(req.task);
  res.json({ ok: true });
});

async function emitChecklist(task) {
  const checklist = (
    await all('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position', [task.id])
  ).map(checklistShape);
  emitToGroup(task.group_id, 'checklist.changed', { taskId: task.id, groupId: task.group_id, checklist });
  emitToGroup(task.group_id, 'task.updated', {
    task: await taskShape(await get('SELECT * FROM tasks WHERE id = ?', [task.id])),
  });
}

// My tasks across all groups. Membership is re-checked here as defense in
// depth: an assignee row must never outlive the person's group access.
tasksRouter.get('/my-tasks', async (req, res) => {
  const rows = await all(
    `SELECT t.* FROM tasks t
     JOIN task_assignees ta ON ta.task_id = t.id
     WHERE ta.user_id = ?
       AND (? = 1 OR EXISTS (
         SELECT 1 FROM group_members gm
         WHERE gm.group_id = t.group_id AND gm.user_id = ta.user_id
       ))
     ORDER BY t.due_date IS NULL, t.due_date, t.priority = 'urgent' DESC`,
    [req.user.id, req.user.is_super_admin ? 1 : 0]
  );
  res.json({ tasks: await taskShapes(rows) });
});
