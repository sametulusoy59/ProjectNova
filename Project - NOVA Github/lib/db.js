'use strict';
function sqlite() {
  try { return require('node:sqlite'); }
  catch { const e = new Error(`Node.js 22.13 or newer is required (found ${process.version})`); e.code = 'NOVA_NODE_VERSION'; throw e; }
}
const fs = require('node:fs'), path = require('node:path');

function open(dir) {
  const { DatabaseSync } = sqlite();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dir, 'nova.db'));
  db.exec(`
  PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pw TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner', created_at INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL, ua TEXT, ip_hash TEXT);
  CREATE TABLE IF NOT EXISTS login_events(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, username TEXT, ok INTEGER NOT NULL, ip_hash TEXT, ua TEXT);
  CREATE TABLE IF NOT EXISTS content(key TEXT PRIMARY KEY, draft TEXT NOT NULL, published TEXT, version INTEGER NOT NULL DEFAULT 0,
    pubver INTEGER, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY, key TEXT NOT NULL, body TEXT NOT NULL, author TEXT, ts INTEGER NOT NULL, kind TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS rev_key ON revisions(key, id DESC);
  CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, sid TEXT NOT NULL, name TEXT NOT NULL, section TEXT, el TEXT,
    cat TEXT, ref TEXT, rhost TEXT, device TEXT, br TEXT, os TEXT, lang TEXT, country TEXT, meta TEXT);
  CREATE INDEX IF NOT EXISTS ev_ts ON events(ts); CREATE INDEX IF NOT EXISTS ev_name ON events(name, ts);
  CREATE TABLE IF NOT EXISTS media(id INTEGER PRIMARY KEY, name TEXT NOT NULL, file TEXT UNIQUE NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
    w INTEGER, h INTEGER, alt TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, author TEXT);
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL, resource TEXT,
    outcome TEXT NOT NULL, detail TEXT, prev TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END;
  `);
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  for (const [c, d] of [['totp', 'TEXT'], ['totp_on', 'INTEGER NOT NULL DEFAULT 0'], ['totp_last', 'INTEGER NOT NULL DEFAULT 0'], ['recovery', 'TEXT']]) if (!cols.includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${d}`);
  return db;
}
module.exports = { open };
