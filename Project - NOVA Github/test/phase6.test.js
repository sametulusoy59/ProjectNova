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
  for (const s of ['id="sky"', 'id="starForm"', 'id="cli"', 'id="cliBtn"', 'function skyNow(', 'const CAT=', 'function bhPull(', 'Snd.update(', "fetch('/api/stars'", 'KVKK']) assert.ok(INDEX.includes(s), s);
});
