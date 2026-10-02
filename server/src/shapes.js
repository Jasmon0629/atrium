import { get, all } from './db.js';

// Row -> API shape mappers. DB is snake_case, the API speaks camelCase.
// Shapes that need related rows are async; plain field mappers stay sync.

export function userShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarColor: row.avatar_color,
    department: row.department,
    title: row.title,
    isSuperAdmin: !!row.is_super_admin,
    mustChangePassword: !!row.must_change_password,
    disabled: !!row.disabled_at,
    lastActiveAt: row.last_active_at,
  };
}

export function groupShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    isProject: !!row.is_project,
    value: row.value || 0,
    valueUnit: row.value_unit || 'RM',
    createdAt: row.created_at,
  };
}

export function columnShape(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    position: row.position,
    isDone: !!row.is_done,
  };
}

export async function taskShape(row) {
  if (!row) return null;
  const [assignees, commentCount, check] = await Promise.all([
    all('SELECT user_id FROM task_assignees WHERE task_id = ?', [row.id]),
    get('SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ?', [row.id]),
    get('SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS done FROM checklist_items WHERE task_id = ?', [row.id]),
  ]);
  return {
    id: row.id,
    groupId: row.group_id,
    columnId: row.column_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    position: row.position,
    startDate: row.start_date,
    dueDate: row.due_date,
    tags: JSON.parse(row.tags || '[]'),
    progress: row.progress,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    assignees: assignees.map((r) => r.user_id),
    commentCount: commentCount.c,
    checklistDone: check.done,
    checklistTotal: check.total,
  };
}

/** Map an array of task rows (the common case for board payloads). */
export function taskShapes(rows) {
  return Promise.all(rows.map(taskShape));
}

export function commentShape(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function checklistShape(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    label: row.label,
    done: !!row.done,
    position: row.position,
  };
}

export async function announcementShape(row, userId) {
  if (!row) return null;
  const read = userId
    ? !!(await get('SELECT 1 AS x FROM announcement_reads WHERE announcement_id = ? AND user_id = ?', [row.id, userId]))
    : false;
  const author = await get('SELECT name FROM users WHERE id = ?', [row.author_id]);
  const group = row.group_id
    ? await get('SELECT name FROM groups WHERE id = ?', [row.group_id])
    : null;
  return {
    id: row.id,
    scope: row.scope,
    groupId: row.group_id,
    groupName: group ? group.name : null,
    title: row.title,
    body: row.body,
    priority: row.priority,
    pinned: !!row.pinned,
    expiresAt: row.expires_at,
    authorId: row.author_id,
    authorName: author ? author.name : 'Unknown',
    createdAt: row.created_at,
    read,
  };
}

/** Reactions on a message, grouped by emoji in first-used order: [{ emoji, count, userIds }]. */
export async function messageReactions(messageId) {
  const rows = await all(
    `SELECT emoji, COUNT(*) AS count, ARRAY_AGG(user_id ORDER BY created_at) AS user_ids
     FROM message_reactions WHERE message_id = ?
     GROUP BY emoji ORDER BY MIN(created_at)`,
    [messageId]
  );
  return rows.map((r) => ({ emoji: r.emoji, count: r.count, userIds: r.user_ids }));
}

export async function messageShape(row) {
  if (!row) return null;
  let replyTo = null;
  if (row.reply_to_id) {
    const parent = await get('SELECT m.id, m.user_id, m.body FROM messages m WHERE m.id = ?', [row.reply_to_id]);
    if (parent) replyTo = { id: parent.id, userId: parent.user_id, body: parent.body };
  }
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    body: row.body,
    replyToId: row.reply_to_id,
    replyTo,
    createdAt: row.created_at,
    reactions: await messageReactions(row.id),
  };
}

export function notificationShape(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    body: row.body,
    link: row.link,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export async function activityShape(row) {
  const [user, group] = await Promise.all([
    get('SELECT name FROM users WHERE id = ?', [row.user_id]),
    get('SELECT name FROM groups WHERE id = ?', [row.group_id]),
  ]);
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: group ? group.name : '',
    userId: row.user_id,
    userName: user ? user.name : 'Unknown',
    verb: row.verb,
    subject: row.subject,
    detail: row.detail,
    createdAt: row.created_at,
  };
}
