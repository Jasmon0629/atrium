import pg from 'pg';

// PostgreSQL returns BIGINT (COUNT, SUM) and NUMERIC as strings; the app
// works with plain numbers everywhere, so parse them at the driver boundary.
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric

const connectionString =
  process.env.DATABASE_URL || 'postgres://atrium:atrium@localhost:5410/atrium';

export const pool = new pg.Pool({ connectionString, max: 10 });
// node-postgres requires this: an idle client that errors out (e.g. a forced
// disconnect) otherwise surfaces as an unhandled 'error' event and crashes the process.
pool.on('error', (err) => console.error('[pg pool]', err.message));

/** SQLite-style `?` placeholders -> PostgreSQL `$1..$n`. */
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function all(sql, params = []) {
  const r = await pool.query(toPg(sql), params);
  return r.rows;
}

export async function get(sql, params = []) {
  const r = await pool.query(toPg(sql), params);
  return r.rows[0];
}

/** Write without needing the new id. Returns { changes } like better-sqlite. */
export async function run(sql, params = []) {
  const r = await pool.query(toPg(sql), params);
  return { changes: r.rowCount };
}

/** INSERT that returns the new row's id. */
export async function insert(sql, params = []) {
  const r = await pool.query(toPg(sql) + ' RETURNING id', params);
  return r.rows[0].id;
}

/** Run fn with queries pinned to one connection inside BEGIN/COMMIT. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = (sql, params = []) => client.query(toPg(sql), params);
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#14655c',
  department TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  password_changed_at TEXT,
  disabled_at TEXT,
  last_active_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '💼',
  color TEXT NOT NULL DEFAULT '#14655c',
  is_project INTEGER NOT NULL DEFAULT 0,
  value DOUBLE PRECISION NOT NULL DEFAULT 0,
  value_unit TEXT NOT NULL DEFAULT 'RM',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gm_user ON group_members(user_id);

CREATE TABLE IF NOT EXISTS board_columns (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position DOUBLE PRECISION NOT NULL,
  is_done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_col_group ON board_columns(group_id, position);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  column_id INTEGER NOT NULL REFERENCES board_columns(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  position DOUBLE PRECISION NOT NULL,
  start_date TEXT,
  due_date TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  progress INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_col ON tasks(column_id, position);
CREATE INDEX IF NOT EXISTS idx_task_group ON tasks(group_id);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ta_user ON task_assignees(user_id);

CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tc_task ON task_comments(task_id);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ci_task ON checklist_items(task_id, position);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'group' CHECK (scope IN ('company','group')),
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'general' CHECK (priority IN ('urgent','important','general')),
  pinned INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ann_group ON announcements(group_id);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_rooms (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'group' CHECK (kind IN ('group','dm')),
  group_id INTEGER UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_members (
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_user ON chat_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  reply_to_id INTEGER REFERENCES messages(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_room ON messages(room_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  verb TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_group ON activity_logs(group_id, id);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS api_tokens (
  jti TEXT PRIMARY KEY,
  issued_by INTEGER NOT NULL REFERENCES users(id),
  acts_as INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_mr_message ON message_reactions(message_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

// Versioned, forward-only migrations for databases created before a schema
// change. SCHEMA above always describes a fresh install; each migration here
// brings an older database up to it and is recorded in schema_migrations.
// Keep statements idempotent (IF NOT EXISTS) so a half-applied run is safe.
const MIGRATIONS = [
  {
    id: 1,
    name: 'users: password lifecycle + disable',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TEXT;
    `,
  },
  {
    id: 2,
    name: 'chat: message reactions',
    sql: `
      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, user_id, emoji)
      );
      CREATE INDEX IF NOT EXISTS idx_mr_message ON message_reactions(message_id);
    `,
  },
];

async function runMigrations() {
  for (const m of MIGRATIONS) {
    const done = await get('SELECT 1 AS x FROM schema_migrations WHERE id = ?', [m.id]);
    if (done) continue;
    await withTransaction(async (q) => {
      await q(m.sql);
      await q('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', [m.id, m.name, now()]);
    });
    console.log(`Applied migration ${m.id}: ${m.name}`);
  }
}

// Errors worth waiting out while the database container is still coming up.
// Anything else (SQL syntax, auth) is a real bug and must surface immediately.
const TRANSIENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', '57P03', '3D000']);

/** Create the schema (idempotent) — call once at startup, retrying while
 *  the database container is still coming up. */
export async function initDb({ retries = 30, delayMs = 1000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(SCHEMA);
      await runMigrations();
      return;
    } catch (err) {
      if (attempt >= retries || !TRANSIENT.has(err.code)) throw err;
      if (attempt === 1) console.log('Waiting for PostgreSQL…');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export function now() {
  return new Date().toISOString();
}

/** Local calendar date (YYYY-MM-DD) — due dates are day-precision and local. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
