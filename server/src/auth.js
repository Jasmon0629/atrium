import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { get, all, run, now } from './db.js';
import { userShape } from './shapes.js';

export const JWT_SECRET = process.env.ATRIUM_SECRET || 'atrium-dev-secret-change-in-production';
const TOKEN_TTL = '7d';
const BCRYPT_ROUNDS = 10;
const DEMO_PASSWORD = 'atrium123';

export function signToken(userId, expiresIn = TOKEN_TTL, jti = undefined) {
  return jwt.sign({ sub: String(userId), ...(jti ? { jti } : {}) }, JWT_SECRET, { expiresIn });
}

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Password rules shared by every path that sets a password. Returns an error string or null. */
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 200) return 'Password is too long';
  if (password.toLowerCase() === DEMO_PASSWORD) return 'Choose a password that is not the demo password';
  return null;
}

/**
 * Resolve a bearer token to a live user row, or null.
 *  - API tokens (with jti) are revocable through the api_tokens registry.
 *  - Session tokens (no jti) die when the user's password changes, so a reset
 *    or a change-password immediately signs out every other device.
 *  - Disabled accounts are rejected on every path, API tokens included.
 * Returns { user, jti } so callers can tell bots from people.
 */
export async function resolveUser(token) {
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
  if (payload.jti) {
    const row = await get('SELECT revoked_at FROM api_tokens WHERE jti = ?', [payload.jti]);
    if (!row || row.revoked_at) return null;
  }
  const user = await get('SELECT * FROM users WHERE id = ?', [Number(payload.sub)]);
  if (!user || user.disabled_at) return null;
  if (!payload.jti && user.password_changed_at) {
    const changedSec = Math.floor(Date.parse(user.password_changed_at) / 1000);
    if (Number.isFinite(changedSec) && payload.iat < changedSec) return null;
  }
  return { user, jti: payload.jti || null };
}

/** Express middleware: requires a valid Bearer token, loads req.user (raw DB row). */
export async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const resolved = token ? await resolveUser(token) : null;
  if (!resolved) return res.status(401).json({ error: 'Not authenticated' });
  req.user = resolved.user;
  req.authJti = resolved.jti; // non-null => request made with a long-lived API token
  next();
}

// Simple in-memory rate limit: 20 FAILED attempts per 10 minutes per IP.
// Successful sign-ins don't count and clear the counter, so a shared office
// IP can't lock everyone out through normal use.
const failures = new Map();
const WINDOW_MS = 10 * 60 * 1000;

function isLimited(ip) {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.start > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= 20;
}

function recordFailure(ip) {
  const nowMs = Date.now();
  const entry = failures.get(ip);
  if (!entry || nowMs - entry.start > WINDOW_MS) {
    failures.set(ip, { count: 1, start: nowMs });
  } else {
    entry.count += 1;
  }
}

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  if (isLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = await get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    recordFailure(req.ip);
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  if (user.disabled_at) {
    return res.status(403).json({ error: 'This account has been disabled. Contact an administrator.' });
  }
  failures.delete(req.ip);
  await run('UPDATE users SET last_active_at = ? WHERE id = ?', [now(), user.id]);
  res.json({ token: signToken(user.id), user: userShape(user) });
});

authRouter.get('/me', authRequired, (req, res) => {
  res.json({ user: userShape(req.user) });
});

// Public sign-in roster for the login screen: this is an internal tool, so
// colleagues' names and titles are not a secret and picking yourself from a
// list beats typing. Never includes anything password-related. Integration
// accounts (anyone with a live API token, e.g. the OpenClaw bot) are left out
// because nobody signs in as them. Set ATRIUM_LOGIN_ROSTER=off to hide it
// entirely (the login form still works).
authRouter.get('/accounts', async (req, res) => {
  if (process.env.ATRIUM_LOGIN_ROSTER === 'off') return res.json({ accounts: [] });
  const rows = await all(
    `SELECT id, name, email, title, department, avatar_color, is_super_admin FROM users u
     WHERE disabled_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM api_tokens t WHERE t.acts_as = u.id AND t.revoked_at IS NULL AND t.expires_at > ?
       )
     ORDER BY name`,
    [now()]
  );
  res.json({
    accounts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      title: r.title,
      department: r.department,
      avatarColor: r.avatar_color,
      isSuperAdmin: !!r.is_super_admin,
    })),
  });
});

// Self-service password change. Issues a fresh session token because the
// change invalidates every session token issued before it (other devices too).
authRouter.post('/change-password', authRequired, async (req, res) => {
  if (req.authJti) {
    return res.status(403).json({ error: 'API tokens cannot change the account password' });
  }
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'The new password must be different from the current one' });
  }
  // 400, not 401: the session is valid, only the input is wrong (the web
  // client treats 401 as an expired session and signs the user out).
  if (!(await bcrypt.compare(currentPassword, req.user.password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  const ts = now();
  await run(
    'UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?',
    [await hashPassword(newPassword), ts, req.user.id]
  );
  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  console.log(`[audit] ${user.name} changed their password`);
  res.json({ token: signToken(user.id), user: userShape(user) });
});
