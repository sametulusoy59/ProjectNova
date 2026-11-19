'use strict';
// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) + secret encryption at rest. No dependencies.
const crypto = require('node:crypto');
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32(buf) { let bits = 0, v = 0, o = ''; for (const b of buf) { v = ((v << 8) | b) & 0xfff; bits += 8; while (bits >= 5) { o += A[(v >>> (bits - 5)) & 31]; bits -= 5; v &= (1 << bits) - 1; } } if (bits) o += A[(v << (5 - bits)) & 31]; return o; }
function unb32(s) { let bits = 0, v = 0; const o = []; for (const c of String(s).replace(/[=\s]/g, '').toUpperCase()) { const i = A.indexOf(c); if (i < 0) continue; v = ((v << 5) | i) & 0xfff; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; v &= (1 << bits) - 1; } } return Buffer.from(o); }
function hotp(key, ctr) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(ctr)); const h = crypto.createHmac('sha1', key).update(b).digest(), o = h[19] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0'); }
const newSecret = () => b32(crypto.randomBytes(20));
// returns the accepted time-step (store it to block replay) or null
function verify(secret, code, lastStep = 0, t = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const key = unb32(secret), step = Math.floor(t / 30000);
  for (const d of [-1, 0, 1]) { const s = step + d; if (s > lastStep && crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(String(code)))) return s; }
  return null;
}
const uri = (secret, user, issuer = 'PROJECT NOVA') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
const kdf = s => crypto.createHash('sha256').update(s + '|totp').digest();
function seal(text, secret) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', kdf(secret), iv), ct = Buffer.concat([c.update(text, 'utf8'), c.final()]); return [iv, c.getAuthTag(), ct].map(x => x.toString('base64url')).join('.'); }
function unseal(blob, secret) { const [iv, tag, ct] = String(blob).split('.').map(x => Buffer.from(x, 'base64url')), d = crypto.createDecipheriv('aes-256-gcm', kdf(secret), iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]).toString('utf8'); }
module.exports = { newSecret, verify, hotp, unb32, uri, seal, unseal };
