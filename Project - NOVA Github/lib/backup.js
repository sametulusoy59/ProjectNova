'use strict';
const fs = require('node:fs'), path = require('node:path');
function makeBackup(db, dir) {   // consistent online snapshot (VACUUM INTO) + uploaded media; keeps the newest 14
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), out = path.join(dir, 'backups', stamp);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  db.exec(`VACUUM INTO '${path.join(out, 'nova.db').replace(/'/g, "''")}'`);
  if (fs.existsSync(path.join(dir, 'media'))) fs.cpSync(path.join(dir, 'media'), path.join(out, 'media'), { recursive: true });
  const all = fs.readdirSync(path.join(dir, 'backups')).sort(); for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.rmSync(path.join(dir, 'backups', old), { recursive: true, force: true });
  return stamp;
}
function listBackups(dir) {
  const b = path.join(dir, 'backups'); if (!fs.existsSync(b)) return [];
  return fs.readdirSync(b).sort().reverse().map(n => { const st = fs.statSync(path.join(b, n, 'nova.db'), { throwIfNoEntry: false }); return { name: n, size: st ? st.size : 0, ts: st ? st.mtimeMs : 0 }; });
}
module.exports = { makeBackup, listBackups };
