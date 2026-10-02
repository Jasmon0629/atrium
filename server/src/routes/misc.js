import { Router } from 'express';
import crypto from 'node:crypto';
import { get, all, run, insert, now } from '../db.js';
import { signToken, hashPassword, passwordProblem } from '../auth.js';
import { notify } from '../services.js';
import { requireSuperAdmin, userGroupIds } from '../permissions.js';
import { notificationShape, activityShape, taskShapes, announcementShape, userShape, groupShape } from '../shapes.js';
import { getOnlineUserIds, disconnectUserSockets, emitToCompany } from '../live.js';

// ---- Notifications ----
export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const rows = await all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100', [req.user.id]);
  const unread = (
    await get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.id])
  ).c;
  res.json({ notifications: rows.map(notificationShape), unread });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [now(), req.user.id]);
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  await run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', [
    now(), Number(req.params.id), req.user.id,
  ]);
  res.json({ ok: true });
});

// ---- Activity ----
export const activityRouter = Router();

activityRouter.get('/', async (req, res) => {
  const gids = await userGroupIds(req.user);
  const filterGid = Number(req.query.groupId);
  const wanted = Number.isInteger(filterGid) && gids.includes(filterGid) ? [filterGid] : gids;
  if (!wanted.length) return res.json({ activity: [] });
  const placeholders = wanted.map(() => '?').join(',');
  const rows = await all(
    `SELECT * FROM activity_logs WHERE group_id IN (${placeholders}) ORDER BY created_at DESC, id DESC LIMIT 60`,
    wanted
  );
  res.json({ activity: await Promise.all(rows.map(activityShape)) });
});

// ---- Users directory (company-visible, powers assignee/DM pickers) ----
export const usersRouter = Router();

usersRouter.get('/', async (req, res) => {
  const online = new Set(getOnlineUserIds());
  // Disabled accounts stay out of pickers; the admin list below still shows them.
  const rows = await all('SELECT * FROM users WHERE disabled_at IS NULL ORDER BY name');
  res.json({ users: rows.map((r) => ({ ...userShape(r), online: online.has(r.id) })) });
});

// ---- Global search (permission-scoped) ----
export const searchRouter = Router();

searchRouter.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) return res.json({ tasks: [], announcements: [], messages: [], users: [], groups: [] });
  const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const gids = await userGroupIds(req.user);
  const gp = gids.map(() => '?').join(',');

  const tasks = gids.length
    ? await taskShapes(
        await all(
          `SELECT * FROM tasks WHERE group_id IN (${gp}) AND (title ILIKE ? ESCAPE '\\' OR description ILIKE ? ESCAPE '\\')
           ORDER BY updated_at DESC LIMIT 15`,
          [...gids, like, like]
        )
      )
    : [];

  const annSql = gids.length
    ? `SELECT * FROM announcements WHERE (scope = 'company' OR group_id IN (${gp})) AND (title ILIKE ? ESCAPE '\\' OR body ILIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 10`
    : `SELECT * FROM announcements WHERE scope = 'company' AND (title ILIKE ? ESCAPE '\\' OR body ILIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 10`;
  const announcements = await Promise.all(
    (await all(annSql, [...(gids.length ? gids : []), like, like])).map((r) => announcementShape(r, req.user.id))
  );

  // Messages only from rooms the user belongs to
  const messages = (
    await all(
      `SELECT m.*, u.name AS sender_name FROM messages m
       JOIN chat_members cm ON cm.room_id = m.room_id AND cm.user_id = ?
       JOIN users u ON u.id = m.user_id
       WHERE m.body ILIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 15`,
      [req.user.id, like]
    )
  ).map((r) => ({
    id: r.id,
    roomId: r.room_id,
    userId: r.user_id,
    senderName: r.sender_name,
    body: r.body,
    createdAt: r.created_at,
  }));

  const users = (
    await all(
      "SELECT * FROM users WHERE name ILIKE ? ESCAPE '\\' OR email ILIKE ? ESCAPE '\\' OR department ILIKE ? ESCAPE '\\' LIMIT 10",
      [like, like, like]
    )
  ).map(userShape);

  const groups = gids.length
    ? (
        await all(
          `SELECT * FROM groups WHERE id IN (${gp}) AND (name ILIKE ? ESCAPE '\\' OR description ILIKE ? ESCAPE '\\') LIMIT 10`,
          [...gids, like, like]
        )
      ).map(groupShape)
    : [];

  res.json({ tasks, announcements, messages, users, groups });
});

// ---- Admin (super admin only) ----
export const adminRouter = Router();

adminRouter.use(requireSuperAdmin);

adminRouter.get('/users', async (req, res) => {
  const rows = await all('SELECT * FROM users ORDER BY name');
  const users = [];
  for (const r of rows) {
    const memberships = await all(
      `SELECT g.id, g.name, gm.role FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = ?`,
      [r.id]
    );
    users.push({ ...userShape(r), memberships });
  }
  res.json({ users });
});

// Long-lived API token for integrations (bots, OpenClaw, scripts).
// Acts as the chosen user — create a dedicated bot user and grant it only the
// groups the integration should touch. Every mint is registered (revocable,
// audited) and announced to all super admins.
adminRouter.post('/api-token', async (req, res) => {
  const userId = Number(req.body?.userId);
  const days = Math.min(Math.max(Number(req.body?.days) || 365, 1), 3650);
  const user = await get('SELECT id, name FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  await run('INSERT INTO api_tokens (jti, issued_by, acts_as, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', [
    jti, req.user.id, user.id, expiresAt, now(),
  ]);
  console.log(`[audit] API token ${jti} minted by ${req.user.name} acting as ${user.name} (${days}d)`);
  const superAdmins = (await all('SELECT id FROM users WHERE is_super_admin = 1')).map((r) => r.id);
  await notify(superAdmins, 'admin', `${req.user.name} minted an API token acting as ${user.name} (${days} days)`, '/admin');
  res.status(201).json({
    token: signToken(user.id, `${days}d`, jti),
    jti,
    actsAs: user.name,
    expiresInDays: days,
  });
});

// List minted tokens (never the token itself — only its registry entry)
adminRouter.get('/api-tokens', async (req, res) => {
  const rows = await all(
    `SELECT t.jti, t.expires_at, t.created_at, t.revoked_at,
            i.name AS issued_by_name, a.name AS acts_as_name
     FROM api_tokens t
     JOIN users i ON i.id = t.issued_by
     JOIN users a ON a.id = t.acts_as
     ORDER BY t.created_at DESC`
  );
  res.json({
    tokens: rows.map((r) => ({
      jti: r.jti,
      issuedBy: r.issued_by_name,
      actsAs: r.acts_as_name,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      revokedAt: r.revoked_at,
    })),
  });
});

// Revoke: the token stops working on its next request
adminRouter.delete('/api-token/:jti', async (req, res) => {
  const r = await run('UPDATE api_tokens SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL', [
    now(), String(req.params.jti),
  ]);
  if (r.changes === 0) return res.status(404).json({ error: 'Token not found or already revoked' });
  console.log(`[audit] API token ${req.params.jti} revoked by ${req.user.name}`);
  res.json({ ok: true });
});

adminRouter.post('/users', async (req, res) => {
  const { name, email, password, department = '', title = '', isSuperAdmin = false, avatarColor = '#14655c' } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  const exists = await get('SELECT 1 AS x FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  if (exists) return res.status(409).json({ error: 'That email is already registered' });
  const userId = await insert(
    'INSERT INTO users (name, email, password_hash, avatar_color, department, title, is_super_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      name.trim().slice(0, 80),
      email.trim().toLowerCase(),
      await hashPassword(password),
      String(avatarColor).slice(0, 16),
      String(department).slice(0, 60),
      String(title).slice(0, 60),
      isSuperAdmin ? 1 : 0,
      now(),
    ]
  );
  emitToCompany('users.changed', {});
  res.status(201).json({ user: userShape(await get('SELECT * FROM users WHERE id = ?', [userId])) });
});

// Reset a user's password (super admin). Without a password in the body a
// temporary one is generated and returned ONCE. Either way the account must
// pick a new password at next sign-in, and every existing session of theirs
// ends immediately (long-lived API tokens are unaffected — revoke those).
adminRouter.post('/users/:id/reset-password', async (req, res) => {
  const user = await get('SELECT * FROM users WHERE id = ?', [Number(req.params.id)]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  let password = req.body?.password;
  const generated = password === undefined || password === null || password === '';
  if (generated) password = crypto.randomBytes(9).toString('base64url'); // 12 chars
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  await run(
    'UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = ? WHERE id = ?',
    [await hashPassword(password), now(), user.id]
  );
  disconnectUserSockets(user.id);
  console.log(`[audit] password of ${user.name} reset by ${req.user.name}`);
  res.json({ ok: true, ...(generated ? { temporaryPassword: password } : {}) });
});

// Edit a user (super admin): enable/disable and basic profile fields.
// Disabling ends their live sessions; tokens stop working on the next request.
adminRouter.patch('/users/:id', async (req, res) => {
  const user = await get('SELECT * FROM users WHERE id = ?', [Number(req.params.id)]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const b = req.body || {};
  if (typeof b.disabled === 'boolean' && b.disabled && user.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot disable your own account' });
  }
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : user.name;
  const department = typeof b.department === 'string' ? b.department.slice(0, 60) : user.department;
  const title = typeof b.title === 'string' ? b.title.slice(0, 60) : user.title;
  const disabledAt =
    typeof b.disabled === 'boolean' ? (b.disabled ? user.disabled_at || now() : null) : user.disabled_at;
  await run('UPDATE users SET name = ?, department = ?, title = ?, disabled_at = ? WHERE id = ?', [
    name, department, title, disabledAt, user.id,
  ]);
  if (disabledAt && !user.disabled_at) {
    disconnectUserSockets(user.id);
    console.log(`[audit] ${user.name} disabled by ${req.user.name}`);
  } else if (!disabledAt && user.disabled_at) {
    console.log(`[audit] ${user.name} re-enabled by ${req.user.name}`);
  }
  emitToCompany('users.changed', {});
  res.json({ user: userShape(await get('SELECT * FROM users WHERE id = ?', [user.id])) });
});
