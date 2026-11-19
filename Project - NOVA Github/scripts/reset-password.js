'use strict';
// Forgot your password? (No e-mail reset exists yet.)  docker compose exec app node scripts/reset-password.js <username>
// Non-interactive:  NEW_PASSWORD='...' node scripts/reset-password.js <username>.  Revokes all sessions of that user and writes an audit entry.
const readline = require('node:readline'), path = require('node:path');
const { open } = require('../lib/db'); const S = require('../lib/security');
const ask = label => new Promise(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }); rl._writeToOutput = s => { if (s.includes(label)) rl.output.write(s); }; rl.question(label, a => { rl.close(); process.stdout.write('\n'); r(a); }); });
(async () => {
  const name = String(process.argv[2] || '').toLowerCase(), db = open(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const u = db.prepare('SELECT id FROM users WHERE username=?').get(name); if (!u) { console.error('No such user.'); process.exit(1); }
  const pw = process.env.NEW_PASSWORD || await ask('New password (min 12 chars): '); if (pw.length < 12) { console.error('Too short.'); process.exit(1); }
  db.prepare('UPDATE users SET pw=? WHERE id=?').run(S.hashPw(pw), u.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  S.auditLog(db, 'cli', 'password_reset', name, 'success'); console.log('Password updated; all sessions revoked.');
})();
