import { Router } from 'express';
import { get, all, run, insert, now, today } from '../db.js';
import { groupRole, roleRank, userGroupIds } from '../permissions.js';
import { announcementShape } from '../shapes.js';
import { emitToGroup, emitToCompany } from '../live.js';
import { logActivity, notify, groupMemberIds } from '../services.js';

export const announcementsRouter = Router();

async function visibleAnnouncementRows(user) {
  const gids = await userGroupIds(user);
  const placeholders = gids.map(() => '?').join(',');
  const sql = gids.length
    ? `SELECT * FROM announcements WHERE scope = 'company' OR group_id IN (${placeholders})
       ORDER BY pinned DESC, id DESC`
    : `SELECT * FROM announcements WHERE scope = 'company' ORDER BY pinned DESC, id DESC`;
  return all(sql, gids);
}

// All announcements visible to me (pinned first, newest first); expired ones filtered out
announcementsRouter.get('/', async (req, res) => {
  const cutoff = today();
  const rows = (await visibleAnnouncementRows(req.user)).filter(
    (r) => !r.expires_at || r.expires_at >= cutoff
  );
  res.json({ announcements: await Promise.all(rows.map((r) => announcementShape(r, req.user.id))) });
});

// Create: group scope needs group admin; company scope needs super admin
announcementsRouter.post('/', async (req, res) => {
  const { scope = 'group', groupId, title, body = '', priority = 'general', pinned = false, expiresAt } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    return res.status(400).json({ error: 'Announcement title is required (max 200 characters)' });
  }
  if (!['urgent', 'important', 'general'].includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority' });
  }
  let gid = null;
  if (scope === 'company') {
    if (!req.user.is_super_admin) {
      return res.status(403).json({ error: 'Only super admins can post company-wide announcements' });
    }
  } else if (scope === 'group') {
    gid = Number(groupId);
    const group = await get('SELECT * FROM groups WHERE id = ?', [gid]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const role = await groupRole(req.user, gid);
    if (roleRank(role) < roleRank('admin')) {
      return res.status(403).json({ error: 'Only group admins can post group announcements' });
    }
  } else {
    return res.status(400).json({ error: 'Invalid scope' });
  }

  const expires = typeof expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? expiresAt : null;
  const annId = await insert(
    'INSERT INTO announcements (scope, group_id, title, body, priority, pinned, expires_at, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [scope, gid, title.trim(), String(body).slice(0, 10000), priority, pinned ? 1 : 0, expires, req.user.id, now()]
  );

  const row = await get('SELECT * FROM announcements WHERE id = ?', [annId]);
  if (scope === 'company') {
    emitToCompany('announcement.created', { announcement: await announcementShape(row, null) });
    const everyone = (await all('SELECT id FROM users')).map((r) => r.id);
    await notify(everyone, 'announcement', `New company announcement: ${title.trim()}`, '/announcements', req.user.id);
  } else {
    emitToGroup(gid, 'announcement.created', { announcement: await announcementShape(row, null) });
    await notify(await groupMemberIds(gid), 'announcement', `New announcement in your group: ${title.trim()}`, '/announcements', req.user.id);
    await logActivity(gid, req.user.id, 'posted announcement', title.trim(), '');
  }
  res.status(201).json({ announcement: await announcementShape(row, req.user.id) });
});

async function loadWithPermission(req, res) {
  const row = await get('SELECT * FROM announcements WHERE id = ?', [Number(req.params.id)]);
  if (!row) {
    res.status(404).json({ error: 'Announcement not found' });
    return null;
  }
  const canManage =
    req.user.is_super_admin ||
    row.author_id === req.user.id ||
    (row.group_id && (await groupRole(req.user, row.group_id)) === 'admin');
  if (!canManage) {
    res.status(403).json({ error: 'You cannot modify this announcement' });
    return null;
  }
  return row;
}

// Edit / pin / unpin
announcementsRouter.patch('/:id', async (req, res) => {
  const row = await loadWithPermission(req, res);
  if (!row) return;
  const b = req.body || {};
  const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 200) : row.title;
  const body = typeof b.body === 'string' ? b.body.slice(0, 10000) : row.body;
  const priority = ['urgent', 'important', 'general'].includes(b.priority) ? b.priority : row.priority;
  const pinned = typeof b.pinned === 'boolean' ? (b.pinned ? 1 : 0) : row.pinned;
  await run('UPDATE announcements SET title = ?, body = ?, priority = ?, pinned = ? WHERE id = ?', [
    title, body, priority, pinned, row.id,
  ]);
  const updated = await get('SELECT * FROM announcements WHERE id = ?', [row.id]);
  const payload = { announcement: await announcementShape(updated, null) };
  if (row.scope === 'company') emitToCompany('announcement.updated', payload);
  else emitToGroup(row.group_id, 'announcement.updated', payload);
  res.json({ ok: true });
});

announcementsRouter.delete('/:id', async (req, res) => {
  const row = await loadWithPermission(req, res);
  if (!row) return;
  await run('DELETE FROM announcements WHERE id = ?', [row.id]);
  const payload = { id: row.id };
  if (row.scope === 'company') emitToCompany('announcement.deleted', payload);
  else emitToGroup(row.group_id, 'announcement.deleted', payload);
  res.json({ ok: true });
});

// Mark read / unread (any user who can see it)
announcementsRouter.post('/:id/read', async (req, res) => {
  const row = await get('SELECT * FROM announcements WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Announcement not found' });
  if (row.scope === 'group' && !(await groupRole(req.user, row.group_id))) {
    return res.status(403).json({ error: 'Not visible to you' });
  }
  await run(
    'INSERT INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
    [row.id, req.user.id, now()]
  );
  res.json({ ok: true });
});

announcementsRouter.post('/:id/unread', async (req, res) => {
  await run('DELETE FROM announcement_reads WHERE announcement_id = ? AND user_id = ?', [
    Number(req.params.id), req.user.id,
  ]);
  res.json({ ok: true });
});
