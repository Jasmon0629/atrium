import bcrypt from 'bcryptjs';
import { get, run, insert, initDb, pool, now } from './db.js';

const DEMO_PASSWORD = 'atrium123';
// Real deployments start from this seed too: force every seeded person to pick
// a private password at first sign-in. Local dev keeps the shared demo password.
const MUST_CHANGE = process.env.NODE_ENV === 'production' ? 1 : 0;

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function hoursAgo(n) {
  return new Date(Date.now() - n * 3600 * 1000).toISOString();
}

export async function seedIfEmpty() {
  const count = (await get('SELECT COUNT(*) AS c FROM users')).c;
  if (count > 0) return false;

  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const ts = now();

  const insUser = (name, email, color, dept, title, superAdmin, lastActive) =>
    insert(
      'INSERT INTO users (name, email, password_hash, avatar_color, department, title, is_super_admin, must_change_password, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, email, hash, color, dept, title, superAdmin, MUST_CHANGE, lastActive, ts]
    );

  const users = {
    smith: await insUser('Smith', 'smith@asmtech.international', '#7c4a9e', 'Management', 'Owner', 1, hoursAgo(1)),
    uma: await insUser('Uma', 'uma@asmtech.international', '#b3541e', 'Accounts', 'Accountant', 0, hoursAgo(2)),
    nancy: await insUser('Nancy', 'nancy@asmtech.international', '#3e7cb1', 'Human Resources', 'HR Manager', 0, hoursAgo(3)),
    cate: await insUser('Cate', 'cate@asmtech.international', '#14655c', 'Administration', 'Personal Assistant', 0, hoursAgo(5)),
  };

  const insGroup = (name, desc, icon, color, isProject, value, unit) =>
    insert(
      'INSERT INTO groups (name, description, icon, color, is_project, value, value_unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, desc, icon, color, isProject, value, unit, ts]
    );

  const groups = {
    management: await insGroup('Management', 'Company leadership and strategic planning', '🏛️', '#7c4a9e', 0, 0, 'RM'),
    accounts: await insGroup('Accounts', 'Invoicing, payments, payroll and reporting', '💰', '#b3541e', 0, 180000, 'RM'),
    hr: await insGroup('HR', 'People, hiring, benefits and compliance', '👥', '#3e7cb1', 0, 0, 'RM'),
    admin: await insGroup('Administration', 'Office operations, facilities and paperwork', '🗂️', '#5a6b3b', 0, 0, 'RM'),
    alpha: await insGroup('Project Alpha', 'Cross-team delivery for the Meridian Corp rollout', '🚀', '#14655c', 1, 250000, 'RM'),
  };

  const memberships = [
    [groups.management, users.smith, 'admin'],
    [groups.management, users.cate, 'member'],
    [groups.accounts, users.uma, 'admin'],
    [groups.accounts, users.cate, 'member'],
    [groups.accounts, users.nancy, 'viewer'],
    [groups.hr, users.nancy, 'admin'],
    [groups.hr, users.cate, 'member'],
    [groups.admin, users.cate, 'admin'],
    [groups.admin, users.uma, 'member'],
    [groups.admin, users.nancy, 'member'],
    [groups.alpha, users.cate, 'admin'],
    [groups.alpha, users.uma, 'member'],
    [groups.alpha, users.nancy, 'member'],
  ];
  for (const [g, u, r] of memberships) {
    await run('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [g, u, r, ts]);
  }

  // Boards: default columns per group
  const cols = {};
  for (const g of Object.values(groups)) {
    cols[g] = {
      todo: await insert('INSERT INTO board_columns (group_id, name, position, is_done) VALUES (?, ?, ?, ?)', [g, 'To Do', 1, 0]),
      progress: await insert('INSERT INTO board_columns (group_id, name, position, is_done) VALUES (?, ?, ?, ?)', [g, 'In Progress', 2, 0]),
      review: await insert('INSERT INTO board_columns (group_id, name, position, is_done) VALUES (?, ?, ?, ?)', [g, 'Review', 3, 0]),
      done: await insert('INSERT INTO board_columns (group_id, name, position, is_done) VALUES (?, ?, ?, ?)', [g, 'Completed', 4, 1]),
    };
  }

  // Chat rooms: one per group, membership mirrors group membership
  const rooms = {};
  for (const [key, g] of Object.entries(groups)) {
    rooms[key] = await insert("INSERT INTO chat_rooms (kind, group_id, created_at) VALUES ('group', ?, ?)", [g, ts]);
    const members = memberships.filter(([gid]) => gid === g);
    for (const [, uid] of members) {
      await run('INSERT INTO chat_members (room_id, user_id) VALUES (?, ?)', [rooms[key], uid]);
    }
  }

  async function task(g, col, title, opts = {}) {
    const id = await insert(
      `INSERT INTO tasks (group_id, column_id, title, description, priority, position, start_date, due_date, tags, progress, created_by, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        g, col, title, opts.desc || '', opts.priority || 'normal', opts.pos || 1,
        opts.start || null, opts.due || null, JSON.stringify(opts.tags || []),
        opts.progress || 0, opts.by, opts.created || hoursAgo(48), opts.updated || hoursAgo(4),
        opts.completed || null,
      ]
    );
    for (const a of opts.assignees || []) {
      await run('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)', [id, a]);
    }
    return id;
  }

  const comment = (taskId, userId, body, at) =>
    run('INSERT INTO task_comments (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', [taskId, userId, body, at]);
  const check = (taskId, label, done, pos) =>
    run('INSERT INTO checklist_items (task_id, label, done, position) VALUES (?, ?, ?, ?)', [taskId, label, done, pos]);

  // Accounts board
  const tInvoice = await task(groups.accounts, cols[groups.accounts].progress, 'Prepare Client A invoice', {
    desc: 'Full invoice for the Client A system upgrade: hardware, licensing and installation labour. Use the September numbering format.',
    priority: 'high', pos: 1, due: daysFromNow(1), tags: ['client-a', 'invoicing'], progress: 60,
    by: users.uma, assignees: [users.uma], updated: hoursAgo(2),
  });
  await comment(tInvoice, users.uma, 'Draft is ready — Cate, please double-check the delivery address block.', hoursAgo(5));
  await comment(tInvoice, users.cate, 'Checked, address updated to the new office.', hoursAgo(4));
  await check(tInvoice, 'Hardware pricing', 1, 1);
  await check(tInvoice, 'License costs', 1, 2);
  await check(tInvoice, 'Payment terms', 0, 3);

  await task(groups.accounts, cols[groups.accounts].todo, 'Chase Meridian Corp payment', {
    desc: 'PO 4471 is past terms — call procurement about the outstanding balance and log the promised date.',
    priority: 'high', pos: 1, due: daysFromNow(-1), tags: ['meridian', 'receivables'],
    by: users.uma, assignees: [users.uma],
  });
  await task(groups.accounts, cols[groups.accounts].todo, 'Q3 management accounts', {
    desc: 'P&L, cashflow and receivables aging for the leadership review.',
    priority: 'normal', pos: 2, due: daysFromNow(5), tags: ['reporting'],
    by: users.uma, assignees: [users.uma, users.cate],
  });
  await task(groups.accounts, cols[groups.accounts].done, 'File SST return', {
    priority: 'normal', pos: 1, tags: ['tax'], progress: 100,
    by: users.uma, assignees: [users.uma], completed: hoursAgo(30), updated: hoursAgo(30),
  });

  // HR board
  const tOnboard = await task(groups.hr, cols[groups.hr].progress, 'New hire onboarding — service technician', {
    desc: 'Contract signed. Prepare equipment, accounts and first-week schedule before the start date.',
    priority: 'high', pos: 1, due: daysFromNow(2), tags: ['onboarding'], progress: 70,
    by: users.nancy, assignees: [users.nancy], updated: hoursAgo(6),
  });
  await comment(tOnboard, users.nancy, 'Laptop ordered, email account requested.', hoursAgo(7));
  await task(groups.hr, cols[groups.hr].todo, 'Renew group hospitalization insurance', {
    desc: 'Policy renewal — forms signed, waiting on the benefits schedule from the agent.',
    priority: 'normal', pos: 1, due: daysFromNow(14), tags: ['benefits'],
    by: users.nancy, assignees: [users.nancy],
  });
  await task(groups.hr, cols[groups.hr].review, 'Update employee handbook', {
    desc: 'Fold in the new leave policy and the remote-work section.',
    priority: 'normal', pos: 1, due: daysFromNow(3), tags: ['policy'], progress: 85,
    by: users.nancy, assignees: [users.nancy, users.cate], updated: hoursAgo(9),
  });

  // Administration board
  await task(groups.admin, cols[groups.admin].todo, 'Renew office lease paperwork', {
    priority: 'normal', pos: 1, due: daysFromNow(14), tags: ['facilities'],
    by: users.cate, assignees: [users.cate],
  });
  await task(groups.admin, cols[groups.admin].progress, 'Order pantry and office supplies', {
    priority: 'low', pos: 1, due: daysFromNow(0), tags: ['office'], progress: 40,
    by: users.cate, assignees: [users.cate], updated: hoursAgo(3),
  });
  await task(groups.admin, cols[groups.admin].done, 'Arrange courier for signed contracts', {
    priority: 'normal', pos: 1, tags: ['courier'], progress: 100,
    by: users.cate, assignees: [users.cate], completed: hoursAgo(20), updated: hoursAgo(20),
  });

  // Management board
  const tContract = await task(groups.management, cols[groups.management].review, 'Review contract — Northgate vendor', {
    desc: 'Legal has flagged clauses 4.2 and 7 — confirm indemnity terms before signing.',
    priority: 'urgent', pos: 1, due: daysFromNow(1), tags: ['legal', 'vendor'], progress: 50,
    by: users.smith, assignees: [users.smith], updated: hoursAgo(3),
  });
  await check(tContract, 'Clause 4.2 indemnity', 1, 1);
  await check(tContract, 'Clause 7 termination terms', 0, 2);

  // Project Alpha board
  const tPresent = await task(groups.alpha, cols[groups.alpha].progress, 'Prepare presentation for kickoff review', {
    desc: 'Joint deck: scope, timeline, commercial terms for the Meridian rollout.',
    priority: 'high', pos: 1, due: daysFromNow(2), tags: ['meridian', 'kickoff'], progress: 30,
    by: users.cate, assignees: [users.cate, users.uma], updated: hoursAgo(1),
  });
  await comment(tPresent, users.uma, 'I will cover the commercial slides, Cate takes the timeline.', hoursAgo(2));
  await check(tPresent, 'Scope overview slides', 0, 1);
  await check(tPresent, 'Commercial terms slides', 0, 2);
  await check(tPresent, 'Timeline & milestones', 1, 3);
  await task(groups.alpha, cols[groups.alpha].todo, 'Draft onboarding and training plan', {
    desc: 'Training sessions for Meridian staff: schedule, materials, sign-off sheet.',
    priority: 'normal', pos: 1, due: daysFromNow(6), tags: ['training'],
    by: users.nancy, assignees: [users.nancy],
  });
  await task(groups.alpha, cols[groups.alpha].todo, 'Confirm on-site access dates with Meridian', {
    priority: 'normal', pos: 2, due: daysFromNow(4), tags: ['meridian'],
    by: users.cate, assignees: [users.cate],
  });

  // Announcements
  const ann = (scope, gid, title, body, priority, pinned, expires, author, at) =>
    run(
      'INSERT INTO announcements (scope, group_id, title, body, priority, pinned, expires_at, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [scope, gid, title, body, priority, pinned, expires, author, at]
    );
  await ann('company', null, 'Office network maintenance this Friday 7–9 PM',
    'IT will be upgrading the core switches. Expect brief internet interruptions. Save your work before 7 PM. The office Wi-Fi guest network stays available.',
    'important', 1, daysFromNow(10), users.smith, hoursAgo(28));
  await ann('company', null, 'Welcome to Atrium — our new workplace hub',
    'All departments now coordinate tasks, announcements and chat here. Your department board is already set up. Questions? Message Cate.',
    'general', 0, null, users.smith, hoursAgo(96));
  await ann('group', groups.hr, 'Payroll cutoff is Thursday this month',
    'Submit all claims and overtime forms to Nancy before Thursday noon — late entries roll to next month.',
    'important', 1, daysFromNow(4), users.nancy, hoursAgo(6));
  await ann('group', groups.accounts, 'New invoice numbering format from September',
    'All invoices now use ASM-YYYY-NNN. The template in the shared drive is updated — old drafts must be renumbered.',
    'important', 0, null, users.uma, hoursAgo(50));
  await ann('group', groups.alpha, 'Kickoff review moved to Thursday 10 AM',
    'Meridian confirmed Thursday. Deck must be frozen Wednesday evening.',
    'important', 1, daysFromNow(5), users.cate, hoursAgo(12));

  // Chat history
  const msg = (roomId, userId, body, replyTo, at) =>
    insert('INSERT INTO messages (room_id, user_id, body, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?)', [
      roomId, userId, body, replyTo, at,
    ]);
  await msg(rooms.accounts, users.uma, 'Meridian payment is 12 days past terms — sending a reminder today. 📨', null, hoursAgo(7));
  const mCate = await msg(rooms.accounts, users.cate, 'Want me to prepare the reminder letter?', null, hoursAgo(6.5));
  await msg(rooms.accounts, users.uma, 'Yes please — use the new template.', mCate, hoursAgo(6));
  await msg(rooms.alpha, users.cate, 'Meridian asked to move kickoff to Thursday — announcement is up.', null, hoursAgo(12));
  await msg(rooms.alpha, users.uma, 'Works for me. Commercial slides frozen by Wednesday night.', null, hoursAgo(11.5));
  await msg(rooms.alpha, users.nancy, 'Training plan draft will be ready before that.', null, hoursAgo(11));
  await msg(rooms.hr, users.nancy, 'Reminder: overtime forms to me by Thursday noon please. 📋', null, hoursAgo(24));

  // A DM between Cate and Uma
  const dmRoom = await insert("INSERT INTO chat_rooms (kind, created_at) VALUES ('dm', ?)", [hoursAgo(30)]);
  await run('INSERT INTO chat_members (room_id, user_id) VALUES (?, ?)', [dmRoom, users.cate]);
  await run('INSERT INTO chat_members (room_id, user_id) VALUES (?, ?)', [dmRoom, users.uma]);
  await msg(dmRoom, users.cate, 'Can you double-check the Client A invoice before I post it out?', null, hoursAgo(5));
  await msg(dmRoom, users.uma, 'Done — totals verified, you are good to send.', null, hoursAgo(3));

  // Activity trail
  const act = (gid, uid, verb, subject, detail, at) =>
    run('INSERT INTO activity_logs (group_id, user_id, verb, subject, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      gid, uid, verb, subject, detail, at,
    ]);
  await act(groups.accounts, users.uma, 'created task', 'Prepare Client A invoice', '', hoursAgo(48));
  await act(groups.accounts, users.uma, 'moved task', 'Prepare Client A invoice', 'from To Do to In Progress', hoursAgo(24));
  await act(groups.hr, users.nancy, 'posted announcement', 'Payroll cutoff is Thursday this month', '', hoursAgo(6));
  await act(groups.alpha, users.cate, 'moved task', 'Prepare presentation for kickoff review', 'from To Do to In Progress', hoursAgo(10));
  await act(groups.alpha, users.uma, 'commented on', 'Prepare presentation for kickoff review', '', hoursAgo(2));
  await act(groups.admin, users.cate, 'created task', 'Renew office lease paperwork', '', hoursAgo(72));

  // A few starter notifications
  const notif = (uid, type, body, link, at) =>
    run('INSERT INTO notifications (user_id, type, body, link, created_at) VALUES (?, ?, ?, ?, ?)', [uid, type, body, link, at]);
  await notif(users.cate, 'task', `Uma assigned you: Q3 management accounts`, `/groups/${groups.accounts}`, hoursAgo(8));
  await notif(users.uma, 'announcement', 'New announcement in your group: Kickoff review moved to Thursday 10 AM', '/announcements', hoursAgo(12));
  await notif(users.nancy, 'task', `Cate assigned you: Draft onboarding and training plan`, `/groups/${groups.alpha}`, hoursAgo(30));

  console.log('Seeded demo data. Demo password for all users: ' + DEMO_PASSWORD);
  return true;
}

// Run directly: node src/seed.js
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.js')) {
  await initDb();
  await seedIfEmpty();
  await pool.end();
}
