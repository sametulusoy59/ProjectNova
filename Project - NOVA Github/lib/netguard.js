'use strict';
// SSRF guard for the admin-triggered link checker: only public http(s) hosts, re-validated on every redirect hop.
const dns = require('node:dns').promises, net = require('node:net');
function priv(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19)); }
  const x = ip.toLowerCase(); return x === '::1' || x === '::' || /^(fc|fd|fe[89ab]|ff)/.test(x) || x.startsWith('::ffff:');
}
async function isPublic(host) {
  host = host.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) return false;
  if (net.isIP(host)) return !priv(host);
  try { const r = await dns.lookup(host, { all: true }); return r.length > 0 && r.every(a => !priv(a.address)); } catch { return false; }
}
async function check(orig) {
  let url = orig;
  for (let hop = 0; hop < 4; hop++) {
    let u; try { u = new URL(url); } catch { return { url: orig, ok: false, note: 'invalid_url' }; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || !(await isPublic(u.hostname))) return { url: orig, ok: false, note: 'blocked' };
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000), h = { 'user-agent': 'NovaLinkCheck/1.0' };
    try {
      let r = await fetch(u, { method: 'HEAD', redirect: 'manual', signal: ctl.signal, headers: h });
      if (r.status === 405 || r.status === 403 || r.status === 501) r = await fetch(u, { method: 'GET', redirect: 'manual', signal: ctl.signal, headers: h });
      clearTimeout(t); r.body?.cancel?.().catch(() => {});
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, u).href; continue; }
      return { url: orig, status: r.status, ok: r.status < 400 };
    } catch { clearTimeout(t); return { url: orig, ok: false, note: 'unreachable' }; }
  }
  return { url: orig, ok: false, note: 'too_many_redirects' };
}
module.exports = { isPublic, check, priv };
