'use strict';
// Usage:  ADMIN_PASSWORD='...' node scripts/create-admin.js <username> [owner|editor|viewer]
//         (without ADMIN_PASSWORD you are prompted; input is not echoed). Min 12 characters.
const readline = require('node:readline');
const { open } = require('../lib/db'); const S = require('../lib/security');
const path = require('node:path');

async function ask(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = s => { if (s.includes(label)) rl.output.write(s); };
  return new Promise(r => rl.question(label, a => { rl.close(); process.stdout.write('\n'); r(a); }));
}
(async () => {
  const name = String(process.argv[2] || '').toLowerCase(), role = process.argv[3] || 'owner';
  if (!/^[a-z0-9_.-]{3,32}$/.test(name) || !['owner', 'editor', 'viewer'].includes(role)) { console.error('usage: create-admin <username 3-32 chars [a-z0-9_.-]> [owner|editor|viewer]'); process.exit(1); }
  const pw = process.env.ADMIN_PASSWORD || await ask('Password (min 12 chars): ');
  if (pw.length < 12) { console.error('Password too short (min 12).'); process.exit(1); }
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), db = open(dir);
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(name)) { console.error('User exists.'); process.exit(1); }
  db.prepare('INSERT INTO users(username,pw,role,created_at) VALUES(?,?,?,?)').run(name, S.hashPw(pw), role, Date.now());
  S.auditLog(db, 'cli', 'user_create', name, 'success', { role });
  console.log(`Created ${role} "${name}".`);
})();
