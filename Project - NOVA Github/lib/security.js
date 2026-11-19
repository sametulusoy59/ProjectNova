'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const SC = { r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
function hashPw(pw) {
  const salt = crypto.randomBytes(16), N = 32768;
  return `scrypt$${N}$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 64, { ...SC, N }).toString('base64')}`;
}
function verifyPw(pw, stored) {
  try {
    const [, N, s, h] = stored.split('$');
    return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, { ...SC, N: +N }), Buffer.from(h, 'base64'));
  } catch { return false; }
}
let _dummy; const dummyHash = () => (_dummy ||= hashPw('not-a-real-password')); // equalises timing for unknown users

function loadSecret(dir) {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
  const f = path.join(dir, 'secret.key');
  try { return fs.readFileSync(f, 'utf8').trim(); }
  catch { const s = rand(48); fs.writeFileSync(f, s, { mode: 0o600 }); return s; }
}

class Limiter {
  constructor(max, winMs) { this.max = max; this.win = winMs; this.m = new Map(); }
  _a(k) { const t = Date.now(), a = (this.m.get(k) || []).filter(x => t - x < this.win); this.m.set(k, a); return a; }
  hit(k) { const a = this._a(k); a.push(Date.now()); return a.length <= this.max; }   // false once over the limit
  blocked(k) { return this._a(k).length >= this.max; }
  add(k) { this._a(k).push(Date.now()); }
  reset(k) { this.m.delete(k); }
  sweep() { for (const k of [...this.m.keys()]) if (!this._a(k).length) this.m.delete(k); }
}

// Tamper-evident audit trail: each row hashes the previous row's hash. The table is also append-only via triggers.
function auditLog(db, actor, action, resource, outcome, detail) {
  const last = db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').get();
  const prev = last ? last.hash : 'genesis', ts = Date.now();
  const dj = detail ? JSON.stringify(detail) : null;
  const hash = sha(prev + JSON.stringify([ts, actor || null, action, resource || null, outcome, dj]));
  db.prepare('INSERT INTO audit(ts,actor,action,resource,outcome,detail,prev,hash) VALUES(?,?,?,?,?,?,?,?)')
    .run(ts, actor || null, action, resource || null, outcome, dj, prev, hash);
}
function verifyAudit(db) {
  let prev = 'genesis', n = 0;
  for (const r of db.prepare('SELECT * FROM audit ORDER BY id').all()) {
    const h = sha(prev + JSON.stringify([r.ts, r.actor, r.action, r.resource, r.outcome, r.detail]));
    if (r.prev !== prev || r.hash !== h) return { ok: false, count: n, brokenAt: r.id };
    prev = r.hash; n++;
  }
  return { ok: true, count: n };
}
module.exports = { sha, rand, safeEq, hashPw, verifyPw, dummyHash, loadSecret, Limiter, auditLog, verifyAudit };
