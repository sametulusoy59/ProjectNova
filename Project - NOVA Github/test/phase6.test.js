'use strict';
process.env.NOVA_EMBEDDED = '1';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createApp } = require('../server'); const S = require('../lib/security'); const { cleanTheme } = require('../lib/inject');

let app, base, jar = '', csrf = '', ejar = '', ecsrf = '', vjar = '', vcsrf = '';
const call = async (m, p, body, o = {}) => {
  const cookie = 'cookie' in o ? o.cookie : jar, token = 'token' in o ? o.token : csrf;
  const r = await fetch(base + p, { method: m, redirect: 'manual', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(token ? { 'x-csrf-token': token } : {}), ...(o.headers || {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, headers: r.headers, text };
};
const login = async (username, password) => { const r = await call('POST', '/api/admin/login', { username, password }, { cookie: '', token: '' }); return { ck: r.headers.get('set-cookie').split(';')[0], csrf: r.json.csrf }; };
const star = (b, ip, origin = base) => call('POST', '/api/stars', { consent: true, ...b }, { cookie: '', token: '', headers: { ...(origin ? { origin } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}) } });
const INDEX = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test.before(async () => {
  app = createApp({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nova-p6-')), quiet: true, trustProxy: true });
  const add = (u, pw, role) => app.db.prepare('INSERT INTO users(username,pw,role,created_at) VALUES(?,?,?,?)').run(u, S.hashPw(pw), role, Date.now());
  add('owner', 'owner password 123', 'owner'); add('editor', 'editor password 123', 'editor'); add('viewer', 'viewer password 123', 'viewer');
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + app.server.address().port;
  ({ ck: jar, csrf } = await login('owner', 'owner password 123')); ({ ck: ejar, csrf: ecsrf } = await login('editor', 'editor password 123')); ({ ck: vjar, csrf: vcsrf } = await login('viewer', 'viewer password 123'));
});
test.after(() => app.close());

test('visitor stars: submissions need consent + same origin, are sanitised, stay hidden until approved, and store no IP', async () => {
  assert.equal((await star({ name: 'Ayşe' }, '10.0.0.1', '')).status, 403, 'no Origin header');
  assert.equal((await star({ name: 'Ayşe' }, '10.0.0.1', 'https://evil.example')).status, 403, 'cross-origin');
  assert.equal((await call('POST', '/api/stars', { name: 'Ayşe' }, { cookie: '', token: '', headers: { origin: base } })).status, 422, 'consent required');
  assert.equal((await star({ name: 'x' }, '10.0.0.1')).json.error, 'name_required');
  assert.equal((await star({ name: 'Spam', msg: 'visit https://spam.example' }, '10.0.0.1')).json.error, 'no_links');
  const hp = await star({ name: 'Bot', web: 'http://x' }, '10.0.0.9'); assert.equal(hp.status, 202, 'honeypot looks like success');
  const ok = await star({ name: '  Ayşe‮ <b>Yılmaz</b>  ', msg: 'Merhaba\nevren!', hue: 42 }, '10.0.0.2'); assert.equal(ok.status, 202); assert.equal(ok.json.status, 'pending');
  const rows = app.db.prepare('SELECT * FROM stars').all(); assert.equal(rows.length, 1, 'honeypot stored nothing');
  assert.equal(rows[0].name, 'Ayşe bYılmaz/b', 'bidi override and angle brackets removed'); assert.equal(rows[0].msg, 'Merhaba evren!'); assert.equal(rows[0].hue, 42);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['decided_at', 'decided_by', 'hue', 'id', 'msg', 'name', 'status', 'ts'], 'no ip / ua column exists');
  assert.deepEqual((await call('GET', '/api/stars', undefined, { cookie: '' })).json, [], 'pending stars are not public');
});

test('visitor stars: per-IP rate limit', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await star({ name: 'Rate ' + i }, '10.9.9.9')).status, 202);
  assert.equal((await star({ name: 'Rate 4' }, '10.9.9.9')).status, 429);
  assert.equal((await star({ name: 'Other' }, '10.9.9.8')).status, 202, 'other visitors unaffected');
});

test('visitor stars: moderation is RBAC + CSRF protected and audited; approved stars become public', async () => {
  assert.equal((await call('GET', '/api/admin/stars', undefined, { cookie: '' })).status, 401);
  assert.equal((await call('GET', '/api/admin/stars', undefined, { cookie: vjar, token: vcsrf })).status, 403, 'viewer cannot moderate');
  const list = (await call('GET', '/api/admin/stars', undefined, { cookie: ejar, token: ecsrf })).json; assert.ok(list.length >= 5); assert.ok(list.every(r => r.status === 'pending'));
  const id = list.find(r => r.msg === 'Merhaba evren!').id;
  assert.equal((await call('POST', `/api/admin/stars/${id}/approve`, {}, { cookie: ejar, token: 'wrong' })).status, 403, 'csrf');
  assert.equal((await call('POST', `/api/admin/stars/${id}/approve`, {}, { cookie: ejar, token: ecsrf })).json.status, 'approved');
  const rej = list.find(r => r.name === 'Rate 0').id; assert.equal((await call('POST', `/api/admin/stars/${rej}/reject`, {})).json.status, 'rejected');
  const del = list.find(r => r.name === 'Rate 1').id; assert.equal((await call('DELETE', `/api/admin/stars/${del}`)).status, 200);
  assert.equal((await call('POST', '/api/admin/stars/999999/approve', {})).status, 404);
  const pub = (await call('GET', '/api/stars', undefined, { cookie: '' })).json;
  assert.equal(pub.length, 1); assert.deepEqual(Object.keys(pub[0]).sort(), ['day', 'hue', 'id', 'msg', 'name']); assert.equal(pub[0].msg, 'Merhaba evren!');
  const acts = app.db.prepare("SELECT action,actor FROM audit WHERE action LIKE 'star_%' ORDER BY id").all().map(r => r.action + ':' + r.actor);
  assert.deepEqual(acts, ['star_approve:editor', 'star_reject:owner', 'star_delete:owner']);
});

test('visitor stars can be switched off from the theme; sky location is clamped', async () => {
  const t = cleanTheme({ skyLat: 123, skyLon: -500, skyCity: '<script>Ankara</script>' }); assert.equal(t.skyLat, 89.9); assert.equal(t.skyLon, -180); assert.ok(!/[<>]/.test(t.skyCity)); assert.equal(cleanTheme({}).skyCity, 'İstanbul'); assert.equal(cleanTheme({}).visitorStars, true);
  await call('PUT', '/api/admin/content/theme', { body: { visitorStars: false } }); await call('POST', '/api/admin/content/theme/publish', {});
  assert.deepEqual((await call('GET', '/api/stars', undefined, { cookie: '' })).json, []);
  assert.equal((await star({ name: 'Late' }, '10.1.1.1')).json.error, 'disabled');
});

test('site: sky, constellation, visitor-star form, terminal and camera journey are wired in', () => {
  for (const s of ['id="sky"', 'id="starForm"', 'id="cli"', 'id="cliBtn"', 'function skyNow(', 'const CAT=', 'function bhPull(', 'Snd.update(', "fetch('/api/stars'", 'KVKK', 'id="msgForm"', 'function skillMap(', 'function orbitTl(', 'const QUICK=', 'const HOLD=', 'id="chap"', 'uLens', 'const debris=', 'function caseHTML(', 'const ACH=']) assert.ok(INDEX.includes(s), s);
});

test('contact messages: validated, rate-limited, private to admins; owner gets an SMTP notification', async () => {
  const net = require('node:net'), got = [];
  const smtp = net.createServer(c => { c.write('220 fake\r\n'); let buf = '', data = false; c.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2);
    if (data) { if (l === '.') { data = false; c.write('250 ok\r\n'); } else got.push(l); continue; }
    if (/^EHLO/.test(l)) c.write('250-fake\r\n250 AUTH LOGIN\r\n'); else if (l === 'AUTH LOGIN') c.write('334 VXNlcm5hbWU6\r\n'); else if (got.auth === undefined) { got.auth = 1; c.write('334 UGFzc3dvcmQ6\r\n'); } else if (got.auth === 1) { got.auth = 2; c.write('235 ok\r\n'); }
    else if (/^(MAIL|RCPT)/.test(l)) { got.push(l); c.write('250 ok\r\n'); } else if (l === 'DATA') { data = true; c.write('354 go\r\n'); } else if (l === 'QUIT') { c.write('221 bye\r\n'); c.end(); } } }); });
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  const a2 = createApp({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nova-p6m-')), quiet: true, mailInTests: true, origin: 'https://example.com', env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_SECURE: 'false', SMTP_USER: 'bot@example.com', SMTP_PASS: 'x', NOTIFY_TO: 'me@example.com' } });
  await new Promise(r => a2.server.listen(0, '127.0.0.1', r)); const b2 = 'http://127.0.0.1:' + a2.server.address().port;
  const post = (b, o = b2) => fetch(b2 + '/api/messages', { method: 'POST', headers: { 'content-type': 'application/json', origin: o }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, json: await r.json() }));
  assert.equal((await post({ consent: true, name: 'Ali', email: 'ali@example.com', body: 'Merhaba, birlikte çalışalım mı?' }, 'https://evil.example')).status, 403);
  assert.equal((await post({ name: 'Ali', email: 'ali@example.com', body: 'Merhaba, birlikte çalışalım mı?' })).json.error, 'consent_required');
  assert.equal((await post({ consent: true, name: 'Ali', email: 'not-an-email', body: 'Merhaba, birlikte çalışalım mı?' })).json.error, 'bad_email');
  assert.equal((await post({ consent: true, name: 'Ali', email: 'ali@example.com', body: 'kısa' })).json.error, 'message_too_short');
  assert.equal((await post({ consent: true, name: 'Ali\r\nBcc: x@evil.com', email: 'ali@example.com', body: 'Merhaba, birlikte çalışalım mı?\nSatır 2' })).status, 202);
  for (let i = 0; i < 20 && !got.some(l => l.startsWith('Subject')); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(got.includes('RCPT TO:<me@example.com>')); assert.ok(got.some(l => /^Reply-To: <ali@example\.com>$/.test(l))); assert.ok(!got.some(l => /^Bcc/i.test(l)), 'no header injection');
  const row = a2.db.prepare('SELECT * FROM messages').get(); assert.equal(row.name, 'Ali Bcc: x@evil.com'); assert.equal(row.body, 'Merhaba, birlikte çalışalım mı?\nSatır 2');
  assert.equal((await post({ consent: true, name: 'Ali', email: 'ali@example.com', body: 'ikinci mesaj burada' })).status, 202);
  assert.equal((await post({ consent: true, name: 'Ali', email: 'ali@example.com', body: 'üçüncü mesaj burada' })).status, 202);
  assert.equal((await post({ consent: true, name: 'Ali', email: 'ali@example.com', body: 'dördüncü mesaj burada' })).status, 429);
  a2.close(); smtp.close();
  // inbox on the main app: RBAC and badges
  await call('POST', '/api/messages', { consent: true, name: 'Ayşe', email: 'ayse@example.com', body: 'Bu bir deneme mesajıdır.' }, { cookie: '', token: '', headers: { origin: base, 'x-forwarded-for': '10.7.7.7' } });
  assert.equal((await call('GET', '/api/admin/messages', undefined, { cookie: vjar, token: vcsrf })).status, 403, 'viewer cannot read messages');
  const inbox = (await call('GET', '/api/admin/messages')).json; assert.equal(inbox.length, 1); assert.equal(inbox[0].read, 0);
  const bd = (await call('GET', '/api/admin/badges')).json; assert.equal(bd.messages, 1); assert.equal(typeof bd.stars, 'number');
  assert.equal((await call('POST', `/api/admin/messages/${inbox[0].id}/read`, {})).status, 200); assert.equal((await call('GET', '/api/admin/badges')).json.messages, 0);
  assert.equal((await call('DELETE', `/api/admin/messages/${inbox[0].id}`)).status, 200);
});

test('SEO: published content is embedded in the HTML, /en has its own language, hreflang + sitemap list both; self-hosted libraries are preferred when present', async () => {
  const a3 = createApp({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nova-p6s-')), quiet: true, origin: 'https://example.com' });
  const put = (k, v) => { const t = JSON.stringify(v); a3.db.prepare('INSERT INTO content(key,draft,published,version,pubver,updated_at) VALUES(?,?,?,1,1,?)').run(k, t, t, Date.now()); };
  put('projects', [{ title: { tr: 'Gizli <b>Proje</b>', en: 'Secret Project' }, desc: { tr: 'Açıklama', en: 'Description' }, tech: ['Node.js'], problem: { tr: 'Sorun metni', en: 'Problem text' } }, { title: { tr: 'Taslak', en: 'Draft' }, hidden: true }]);
  await new Promise(r => a3.server.listen(0, '127.0.0.1', r)); const b3 = 'http://127.0.0.1:' + a3.server.address().port;
  const tr = await (await fetch(b3 + '/')).text(), en = await (await fetch(b3 + '/en')).text();
  assert.match(tr, /<h3>Gizli &lt;b&gt;Proje&lt;\/b&gt;<\/h3>/); assert.match(tr, /<p>Sorun metni<\/p>/); assert.ok(!tr.includes('<h3>Taslak'), 'hidden projects are not prerendered');
  assert.match(en, /<html lang="en">/); assert.match(en, /<h3>Secret Project<\/h3>/); assert.match(en, /<link rel="canonical" href="https:\/\/example\.com\/en">/);
  assert.match(tr, /hreflang="en" href="https:\/\/example\.com\/en"/); assert.match(tr, /window\.NOVA_CONTENT=\{/); assert.ok(!/NOVA_CONTENT=[^<]*<\/script/.test(tr.replace(/<\/script>/g, '')), 'json is script-safe');
  const sm = await (await fetch(b3 + '/sitemap.xml')).text(); assert.match(sm, /<loc>https:\/\/example\.com\/en<\/loc>/); assert.match(sm, /xhtml:link/);
  const vdir = path.join(__dirname, '../public/assets/vendor'), f = path.join(vdir, 'gsap.min.js'); fs.mkdirSync(vdir, { recursive: true }); fs.writeFileSync(f, '/* test */');
  try { const pg = await (await fetch(b3 + '/')).text(); assert.ok(pg.includes('src="/assets/vendor/gsap.min.js"')); assert.ok(pg.includes('three.js/r128/three.min.js'), 'missing files keep the CDN'); }
  finally { fs.rmSync(f); try { fs.rmdirSync(vdir); } catch {} }
  a3.close();
});
