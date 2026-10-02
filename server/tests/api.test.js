import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

// Isolated throwaway PostgreSQL database for the test run — created via the
// admin connection, dropped afterwards. Set DATABASE_URL BEFORE importing the app.
const ADMIN_URL =
  process.env.ATRIUM_TEST_ADMIN_URL || 'postgres://postgres:postgres@localhost:5410/postgres';
const TEST_DB = `atrium_test_${process.pid}_${Math.floor(Math.random() * 1e6)}`;

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`CREATE DATABASE ${TEST_DB}`);
process.env.DATABASE_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);

const { createServer } = await import('../src/app.js');
const { seedIfEmpty } = await import('../src/seed.js');
const { initDb, pool } = await import('../src/db.js');

let server;
let base;
const tokens = {};

async function api(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

async function login(email) {
  const { status, json } = await api('POST', '/api/auth/login', {
    body: { email, password: 'atrium123' },
  });
  assert.equal(status, 200, `login should succeed for ${email}`);
  return json.token;
}

before(async () => {
  await initDb();
  await seedIfEmpty();
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  tokens.smith = await login('smith@asmtech.international');
  tokens.uma = await login('uma@asmtech.international');
  tokens.nancy = await login('nancy@asmtech.international');
  tokens.cate = await login('cate@asmtech.international');
});

after(async () => {
  server.close();
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.end();
});

test('rejects a wrong password', async () => {
  const { status } = await api('POST', '/api/auth/login', {
    body: { email: 'uma@asmtech.international', password: 'wrong-password' },
  });
  assert.equal(status, 401);
});

test('rejects requests without a token', async () => {
  const { status } = await api('GET', '/api/groups');
  assert.equal(status, 401);
});

test('members see only their own groups', async () => {
  const { json } = await api('GET', '/api/groups', { token: tokens.uma });
  const names = json.groups.map((g) => g.name).sort();
  assert.deepEqual(names, ['Accounts', 'Administration', 'Project Alpha']);
});

test('a non-member cannot open another group workspace', async () => {
  const { json } = await api('GET', '/api/groups', { token: tokens.nancy });
  const hr = json.groups.find((g) => g.name === 'HR');
  // Uma is not in HR
  const denied = await api('GET', `/api/groups/${hr.id}`, { token: tokens.uma });
  assert.equal(denied.status, 403);
});

test('shared board: a task created by Cate is visible to other members via group fetch', async () => {
  const groups = (await api('GET', '/api/groups', { token: tokens.cate })).json.groups;
  const alpha = groups.find((g) => g.name === 'Project Alpha');
  const detail = (await api('GET', `/api/groups/${alpha.id}`, { token: tokens.cate })).json;
  const created = await api('POST', `/api/groups/${alpha.id}/tasks`, {
    token: tokens.cate,
    body: { title: 'Shared visibility check', columnId: detail.columns[0].id, priority: 'low' },
  });
  assert.equal(created.status, 201);
  // Uma (member of Project Alpha) sees the very same task, same id — not a copy
  const umaView = (await api('GET', `/api/groups/${alpha.id}`, { token: tokens.uma })).json;
  const found = umaView.tasks.find((t) => t.id === created.json.task.id);
  assert.ok(found, 'Uma should see the identical task record');
  assert.equal(found.title, 'Shared visibility check');
});

test('moving a task updates its column for every member', async () => {
  const groups = (await api('GET', '/api/groups', { token: tokens.cate })).json.groups;
  const alpha = groups.find((g) => g.name === 'Project Alpha');
  const detail = (await api('GET', `/api/groups/${alpha.id}`, { token: tokens.cate })).json;
  const task = detail.tasks[0];
  const target = detail.columns.find((c) => c.id !== task.columnId);
  const moved = await api('PATCH', `/api/tasks/${task.id}/move`, {
    token: tokens.uma,
    body: { columnId: target.id, position: 99 },
  });
  assert.equal(moved.status, 200);
  const cateView = (await api('GET', `/api/groups/${alpha.id}`, { token: tokens.cate })).json;
  assert.equal(cateView.tasks.find((t) => t.id === task.id).columnId, target.id);
});

test('a viewer cannot create or move tasks', async () => {
  // Nancy is a viewer in Accounts
  const groups = (await api('GET', '/api/groups', { token: tokens.nancy })).json.groups;
  const accounts = groups.find((g) => g.name === 'Accounts');
  assert.equal(accounts.role, 'viewer');
  const detail = (await api('GET', `/api/groups/${accounts.id}`, { token: tokens.nancy })).json;
  const denied = await api('POST', `/api/groups/${accounts.id}/tasks`, {
    token: tokens.nancy,
    body: { title: 'Should fail', columnId: detail.columns[0].id },
  });
  assert.equal(denied.status, 403);
  const deniedMove = await api('PATCH', `/api/tasks/${detail.tasks[0].id}/move`, {
    token: tokens.nancy,
    body: { columnId: detail.columns[0].id, position: 1 },
  });
  assert.equal(deniedMove.status, 403);
});

test('only group admins can manage columns', async () => {
  const groups = (await api('GET', '/api/groups', { token: tokens.cate })).json.groups;
  const alpha = groups.find((g) => g.name === 'Project Alpha');
  // Uma is a plain member of Project Alpha
  const denied = await api('POST', `/api/groups/${alpha.id}/columns`, {
    token: tokens.uma,
    body: { name: 'Blocked' },
  });
  assert.equal(denied.status, 403);
  const allowed = await api('POST', `/api/groups/${alpha.id}/columns`, {
    token: tokens.cate,
    body: { name: 'Blocked' },
  });
  assert.equal(allowed.status, 201);
});

test('group announcements require group admin; members are refused', async () => {
  const groups = (await api('GET', '/api/groups', { token: tokens.uma })).json.groups;
  const alpha = groups.find((g) => g.name === 'Project Alpha');
  const denied = await api('POST', '/api/announcements', {
    token: tokens.uma,
    body: { scope: 'group', groupId: alpha.id, title: 'Should fail' },
  });
  assert.equal(denied.status, 403);
});

test('company-wide announcements require super admin', async () => {
  const denied = await api('POST', '/api/announcements', {
    token: tokens.uma,
    body: { scope: 'company', title: 'Should fail' },
  });
  assert.equal(denied.status, 403);
  const allowed = await api('POST', '/api/announcements', {
    token: tokens.smith,
    body: { scope: 'company', title: 'All hands Friday', priority: 'general' },
  });
  assert.equal(allowed.status, 201);
});

test('announcement visibility respects group membership', async () => {
  // Nancy posted "Payroll cutoff is Thursday this month" in HR; Uma is not in HR
  const umaAnns = (await api('GET', '/api/announcements', { token: tokens.uma })).json.announcements;
  assert.ok(!umaAnns.some((a) => a.title.includes('Payroll cutoff')), 'Uma must not see HR announcements');
  const nancyAnns = (await api('GET', '/api/announcements', { token: tokens.nancy })).json.announcements;
  assert.ok(nancyAnns.some((a) => a.title.includes('Payroll cutoff')));
});

test('search never leaks another group\'s data', async () => {
  // "payroll cutoff" exists only in HR (announcement); Uma is not in HR
  const umaSearch = (await api('GET', '/api/search?q=payroll%20cutoff', { token: tokens.uma })).json;
  assert.equal(umaSearch.tasks.length, 0);
  assert.equal(umaSearch.announcements.length, 0);
  const nancySearch = (await api('GET', '/api/search?q=payroll%20cutoff', { token: tokens.nancy })).json;
  assert.ok(nancySearch.announcements.length > 0, 'Nancy should find the HR announcement');
});

test('chat rooms are membership-locked', async () => {
  const rooms = (await api('GET', '/api/chat/rooms', { token: tokens.nancy })).json.rooms;
  const hrRoom = rooms.find((r) => r.name === 'HR');
  assert.ok(hrRoom);
  const denied = await api('GET', `/api/chat/rooms/${hrRoom.id}/messages`, { token: tokens.uma });
  assert.equal(denied.status, 403);
  const deniedSend = await api('POST', `/api/chat/rooms/${hrRoom.id}/messages`, {
    token: tokens.uma,
    body: { body: 'Should fail' },
  });
  assert.equal(deniedSend.status, 403);
});

test('messages send and appear in history with unread counts', async () => {
  const rooms = (await api('GET', '/api/chat/rooms', { token: tokens.cate })).json.rooms;
  const alphaRoom = rooms.find((r) => r.name === 'Project Alpha');
  const sent = await api('POST', `/api/chat/rooms/${alphaRoom.id}/messages`, {
    token: tokens.cate,
    body: { body: 'Unread count check' },
  });
  assert.equal(sent.status, 201);
  const umaRooms = (await api('GET', '/api/chat/rooms', { token: tokens.uma })).json.rooms;
  const umaAlpha = umaRooms.find((r) => r.name === 'Project Alpha');
  assert.ok(umaAlpha.unread >= 1, 'Uma should have unread messages in Project Alpha');
});

test('a viewer can read group chat but cannot post to it', async () => {
  // Nancy is a viewer in Accounts — she is in the room, but read-only
  const rooms = (await api('GET', '/api/chat/rooms', { token: tokens.nancy })).json.rooms;
  const accountsRoom = rooms.find((r) => r.name === 'Accounts');
  assert.ok(accountsRoom, 'viewer should see the room');
  const read = await api('GET', `/api/chat/rooms/${accountsRoom.id}/messages`, { token: tokens.nancy });
  assert.equal(read.status, 200);
  const denied = await api('POST', `/api/chat/rooms/${accountsRoom.id}/messages`, {
    token: tokens.nancy,
    body: { body: 'Should fail — viewers are read-only' },
  });
  assert.equal(denied.status, 403);
});

test('removing a member also revokes their task assignments', async () => {
  // Uma (Accounts admin) assigns Cate a task, removes her, verifies the
  // assignee row is gone, then restores her membership.
  const groups = (await api('GET', '/api/groups', { token: tokens.uma })).json.groups;
  const accounts = groups.find((g) => g.name === 'Accounts');
  const detail = (await api('GET', `/api/groups/${accounts.id}`, { token: tokens.uma })).json;
  const cateId = detail.members.find((m) => m.name === 'Cate').id;
  const created = await api('POST', `/api/groups/${accounts.id}/tasks`, {
    token: tokens.uma,
    body: { title: 'Revocation check', columnId: detail.columns[0].id, assigneeIds: [cateId] },
  });
  assert.equal(created.status, 201);
  const removed = await api('DELETE', `/api/groups/${accounts.id}/members/${cateId}`, { token: tokens.uma });
  assert.equal(removed.status, 200);
  const assignees = (await api('GET', `/api/tasks/${created.json.task.id}`, { token: tokens.uma })).json.task.assignees;
  assert.ok(!assignees.includes(cateId), 'stale assignee row must be removed');
  // restore membership for other tests / demo data
  await api('POST', `/api/groups/${accounts.id}/members`, { token: tokens.uma, body: { userId: cateId, role: 'member' } });
});

test('group admins can set the project value; members cannot', async () => {
  const groups = (await api('GET', '/api/groups', { token: tokens.cate })).json.groups;
  const alpha = groups.find((g) => g.name === 'Project Alpha');
  const ok = await api('PATCH', `/api/groups/${alpha.id}`, {
    token: tokens.cate,
    body: { value: 300000, valueUnit: 'RM' },
  });
  assert.equal(ok.status, 200);
  const after = (await api('GET', '/api/groups', { token: tokens.cate })).json.groups.find(
    (g) => g.id === alpha.id
  );
  assert.equal(after.value, 300000);
  assert.equal(after.valueUnit, 'RM');
  // Uma is a plain member of Project Alpha — she cannot change the value
  const denied = await api('PATCH', `/api/groups/${alpha.id}`, { token: tokens.uma, body: { value: 1 } });
  assert.equal(denied.status, 403);
});

test('API tokens: super admin mints one that works; non-admins are refused', async () => {
  const denied = await api('POST', '/api/admin/api-token', { token: tokens.uma, body: { userId: 1 } });
  assert.equal(denied.status, 403);
  const users = (await api('GET', '/api/admin/users', { token: tokens.smith })).json.users;
  const umaId = users.find((u) => u.name === 'Uma').id;
  const minted = await api('POST', '/api/admin/api-token', {
    token: tokens.smith,
    body: { userId: umaId, days: 30 },
  });
  assert.equal(minted.status, 201);
  const me = await api('GET', '/api/auth/me', { token: minted.json.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.name, 'Uma');
  // Revoking kills the token immediately
  const revoked = await api('DELETE', `/api/admin/api-token/${minted.json.jti}`, { token: tokens.smith });
  assert.equal(revoked.status, 200);
  const dead = await api('GET', '/api/auth/me', { token: minted.json.token });
  assert.equal(dead.status, 401);
});

test('admin endpoints are super-admin only', async () => {
  const denied = await api('GET', '/api/admin/users', { token: tokens.uma });
  assert.equal(denied.status, 403);
  const allowed = await api('GET', '/api/admin/users', { token: tokens.smith });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.users.length, 4);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('password lifecycle: change rotates sessions, admin reset forces a change, disable locks the account', async () => {
  // A fresh account so the shared demo tokens stay valid for the other tests
  const created = await api('POST', '/api/admin/users', {
    token: tokens.smith,
    body: { name: 'Temp Tester', email: 'temp@asmtech.international', password: 'Start-pass-1', department: 'QA', title: 'Tester' },
  });
  assert.equal(created.status, 201);
  const uid = created.json.user.id;
  const first = await api('POST', '/api/auth/login', { body: { email: 'temp@asmtech.international', password: 'Start-pass-1' } });
  assert.equal(first.status, 200);
  assert.equal(first.json.user.mustChangePassword, false);
  const oldToken = first.json.token;

  // Refused: wrong current password, too short, the demo password
  const change = (token, currentPassword, newPassword) =>
    api('POST', '/api/auth/change-password', { token, body: { currentPassword, newPassword } });
  assert.equal((await change(oldToken, 'nope', 'Second-pass-2')).status, 400);
  assert.equal((await change(oldToken, 'Start-pass-1', 'short')).status, 400);
  assert.equal((await change(oldToken, 'Start-pass-1', 'atrium123')).status, 400);

  // Success returns a fresh token; the previous session token is dead; the old password no longer works
  await wait(1100); // JWT iat has 1-second resolution
  const changed = await change(oldToken, 'Start-pass-1', 'Second-pass-2');
  assert.equal(changed.status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token: changed.json.token })).status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token: oldToken })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'temp@asmtech.international', password: 'Start-pass-1' } })).status, 401);

  // Admin reset: super admin only, yields a temporary password, ends sessions, flags must-change
  assert.equal((await api('POST', `/api/admin/users/${uid}/reset-password`, { token: tokens.uma, body: {} })).status, 403);
  await wait(1100);
  const reset = await api('POST', `/api/admin/users/${uid}/reset-password`, { token: tokens.smith, body: {} });
  assert.equal(reset.status, 200);
  assert.ok(reset.json.temporaryPassword.length >= 8);
  assert.equal((await api('GET', '/api/auth/me', { token: changed.json.token })).status, 401);
  const relogin = await api('POST', '/api/auth/login', { body: { email: 'temp@asmtech.international', password: reset.json.temporaryPassword } });
  assert.equal(relogin.status, 200);
  assert.equal(relogin.json.user.mustChangePassword, true);

  // Long-lived API tokens survive a reset but may not change the password
  const minted = await api('POST', '/api/admin/api-token', { token: tokens.smith, body: { userId: uid, days: 1 } });
  assert.equal(minted.status, 201);
  assert.equal((await api('GET', '/api/auth/me', { token: minted.json.token })).status, 200);
  assert.equal((await change(minted.json.token, 'x', 'Third-pass-3')).status, 403);

  // Disable: not yourself; locks login, sessions AND API tokens; hidden from the directory; reversible
  const smithId = (await api('GET', '/api/admin/users', { token: tokens.smith })).json.users.find((u) => u.name === 'Smith').id;
  assert.equal((await api('PATCH', `/api/admin/users/${smithId}`, { token: tokens.smith, body: { disabled: true } })).status, 400);
  const disabled = await api('PATCH', `/api/admin/users/${uid}`, { token: tokens.smith, body: { disabled: true } });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.json.user.disabled, true);
  assert.equal((await api('GET', '/api/auth/me', { token: relogin.json.token })).status, 401);
  assert.equal((await api('GET', '/api/auth/me', { token: minted.json.token })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'temp@asmtech.international', password: reset.json.temporaryPassword } })).status, 403);
  assert.ok(!(await api('GET', '/api/users', { token: tokens.smith })).json.users.some((u) => u.id === uid));
  assert.ok((await api('GET', '/api/admin/users', { token: tokens.smith })).json.users.some((u) => u.id === uid && u.disabled));
  assert.equal((await api('PATCH', `/api/admin/users/${uid}`, { token: tokens.smith, body: { disabled: false } })).status, 200);
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'temp@asmtech.international', password: reset.json.temporaryPassword } })).status, 200);
});

test('login roster is public, lists active accounts and never leaks secrets', async () => {
  const { status, json } = await api('GET', '/api/auth/accounts');
  assert.equal(status, 200);
  assert.ok(json.accounts.some((a) => a.email === 'smith@asmtech.international'));
  assert.ok(json.accounts.every((a) => !Object.keys(a).some((k) => /password|hash|token/i.test(k))));
});

test('message reactions toggle on and off, appear in history, and are room-members only', async () => {
  const umaId = (await api('GET', '/api/auth/me', { token: tokens.uma })).json.user.id;
  const cateId = (await api('GET', '/api/auth/me', { token: tokens.cate })).json.user.id;
  // A DM between Uma and Cate: Nancy is unambiguously an outsider
  const dm = await api('POST', '/api/chat/dm', { token: tokens.uma, body: { userId: cateId } });
  assert.ok(dm.status === 200 || dm.status === 201);
  const room = dm.json.room;
  const sent = await api('POST', `/api/chat/rooms/${room.id}/messages`, { token: tokens.uma, body: { body: 'react to me', clientId: 'c-1' } });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.clientId, 'c-1');
  const id = sent.json.message.id;

  const on = await api('POST', `/api/chat/messages/${id}/reactions`, { token: tokens.uma, body: { emoji: '👍' } });
  assert.equal(on.status, 200);
  assert.equal(on.json.reacted, true);
  assert.deepEqual(on.json.reactions, [{ emoji: '👍', count: 1, userIds: [umaId] }]);

  const history = await api('GET', `/api/chat/rooms/${room.id}/messages`, { token: tokens.uma });
  assert.deepEqual(history.json.messages.find((m) => m.id === id).reactions, [{ emoji: '👍', count: 1, userIds: [umaId] }]);

  const off = await api('POST', `/api/chat/messages/${id}/reactions`, { token: tokens.uma, body: { emoji: '👍' } });
  assert.equal(off.json.reacted, false);
  assert.equal(off.json.reactions.length, 0);

  // Nancy is not in this DM; empty emoji is invalid
  assert.equal((await api('POST', `/api/chat/messages/${id}/reactions`, { token: tokens.nancy, body: { emoji: '👍' } })).status, 403);
  assert.equal((await api('POST', `/api/chat/messages/${id}/reactions`, { token: tokens.uma, body: { emoji: '' } })).status, 400);
});

test('health reports the build id and API responses are never cached', async () => {
  const health = await fetch(base + '/api/health');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  const json = await health.json();
  assert.equal(json.ok, true);
  assert.equal(typeof json.build, 'string');
  assert.ok(json.build.length >= 3, 'build id present (hash of the shell, or "dev" without a build)');

  const groups = await fetch(base + '/api/groups', { headers: { Authorization: `Bearer ${tokens.uma}` } });
  assert.equal(groups.status, 200);
  assert.equal(groups.headers.get('cache-control'), 'no-store');
});

test('super admin can delete a group; everything inside is gone and members lose access', async () => {
  // Create a throwaway group with Nancy as a member and one task in it
  const created = await api('POST', '/api/groups', { token: tokens.smith, body: { name: 'Temp Delete Me', description: 'x' } });
  assert.equal(created.status, 201);
  const gid = created.json.group.id;
  assert.equal((await api('POST', `/api/groups/${gid}/members`, { token: tokens.smith, body: { userId: 3, role: 'member' } })).status, 201);
  const ws = await api('GET', `/api/groups/${gid}`, { token: tokens.smith });
  const colId = ws.json.columns[0].id;
  const task = await api('POST', `/api/groups/${gid}/tasks`, { token: tokens.smith, body: { title: 'doomed', columnId: colId } });
  assert.equal(task.status, 201);

  // Only a super admin may delete
  assert.equal((await api('DELETE', `/api/groups/${gid}`, { token: tokens.nancy })).status, 403);

  const del = await api('DELETE', `/api/groups/${gid}`, { token: tokens.smith });
  assert.equal(del.status, 200);
  assert.equal((await api('GET', `/api/groups/${gid}`, { token: tokens.smith })).status, 404);
  assert.equal((await api('GET', `/api/tasks/${task.json.task.id}`, { token: tokens.smith })).status, 404);
  const nancyGroups = await api('GET', '/api/groups', { token: tokens.nancy });
  assert.ok(!nancyGroups.json.groups.some((g) => g.id === gid), 'deleted group is gone from members lists');
  assert.equal((await api('DELETE', `/api/groups/${gid}`, { token: tokens.smith })).status, 404, 'second delete is a 404');
});
