'use strict';
process.env.NOVA_EMBEDDED = '1';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createApp } = require('../server'); const S = require('../lib/security');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-'));
let app, base, jar = '', csrf = '';
const call = async (m, p, body, o = {}) => {
  const cookie = 'cookie' in o ? o.cookie : jar, token = 'token' in o ? o.token : csrf;
  const r = await fetch(base + p, { method: m, redirect: 'manual', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(token ? { 'x-csrf-token': token } : {}), ...(o.headers || {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, headers: r.headers, text };
};
const ev = (name, extra = {}) => ({ name, ...extra });
const collect = (events, o = {}) => call('POST', '/api/collect', { consent: true, sid: 'a'.repeat(24), dev: 'desktop', lang: 'tr', events, ...o }, { cookie: '', token: '' });

test.before(async () => {
  app = createApp({ dir });
  app.db.prepare('INSERT INTO users(username,pw,role,created_at) VALUES(?,?,?,?)').run('admin', S.hashPw('correct horse battery'), 'owner', Date.now());
  app.db.prepare('INSERT INTO users(username,pw,role,created_at) VALUES(?,?,?,?)').run('viewer', S.hashPw('viewer password 123'), 'viewer', Date.now());
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + app.server.address().port;
});
test.after(() => app.close());

test('public site is served unchanged with security headers', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 200); assert.match(r.text, /PROJECT NOVA/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.text, fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').replace('<!--NOVA_HEAD-->', ''), 'with nothing configured the page is served untouched');
});
test('static serving blocks traversal, dotfiles and unknown types', async () => {
  for (const p of ['/..%2f..%2fserver.js', '/%2e%2e/lib/db.js', '/.env', '/../server.js', '/admin/..%2f..%2fserver.js', '/nope.js%00']) assert.ok([400, 404].includes((await call('GET', p)).status), p);
});
test('protected API rejects unauthenticated requests server-side', async () => {
  for (const [m, p] of [['GET', '/api/admin/me'], ['GET', '/api/admin/content'], ['GET', '/api/admin/audit'], ['GET', '/api/admin/analytics/summary'], ['PUT', '/api/admin/content/site'], ['POST', '/api/admin/logout']])
    assert.equal((await call(m, p, m === 'GET' ? undefined : {}, { cookie: '', token: '' })).status, 401, p);
  assert.equal((await call('GET', '/api/admin/me', undefined, { cookie: 'nova_sid=forged' })).status, 401);
});
test('brute force is rate limited; unknown and wrong users look identical', async () => {
  for (let i = 0; i < 5; i++) { const r = await call('POST', '/api/admin/login', { username: 'victim', password: 'x' + i }); assert.equal(r.status, 401); assert.deepEqual(r.json, { error: 'invalid_credentials' }); }
  assert.equal((await call('POST', '/api/admin/login', { username: 'victim', password: 'whatever' })).status, 429);
  assert.equal((await call('POST', '/api/admin/login', { username: 'admin', password: 'wrong' })).status, 401);
});
test('login sets a hardened cookie and exposes a CSRF token', async () => {
  const r = await call('POST', '/api/admin/login', { username: 'admin', password: 'correct horse battery' });
  assert.equal(r.status, 200); const ck = r.headers.get('set-cookie'); assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Strict/);
  jar = ck.split(';')[0]; csrf = r.json.csrf; assert.ok(csrf.length > 20);
  assert.equal((await call('GET', '/api/admin/me')).json.user.username, 'admin');
});
test('mutations require CSRF token and same origin', async () => {
  assert.equal((await call('PUT', '/api/admin/content/site', { body: { title: 'x' } }, { token: '' })).status, 403);
  assert.equal((await call('PUT', '/api/admin/content/site', { body: { title: 'x' } }, { token: 'wrong' })).status, 403);
  assert.equal((await call('PUT', '/api/admin/content/site', { body: { title: 'x' } }, { headers: { origin: 'https://evil.example' } })).status, 403);
});
test('content: validation, drafts, publish, conflict, rollback', async () => {
  assert.equal((await call('PUT', '/api/admin/content/projects', { body: [{ title: 'A', live: 'javascript:alert(1)' }] })).status, 422);
  assert.equal((await call('PUT', '/api/admin/content/site', { body: JSON.parse('{"__proto__":{"x":1}}') })).status, 422);
  assert.equal((await call('PUT', '/api/admin/content/unknown', { body: {} })).status, 404);
  assert.equal((await call('PUT', '/api/admin/content/site', { body: { title: 'v1' }, base: 0 })).json.version, 1);
  assert.deepEqual((await call('GET', '/api/public/content', undefined, { cookie: '' })).json, {}, 'drafts must not be public');
  assert.equal((await call('POST', '/api/admin/content/site/publish', {})).status, 200);
  assert.equal((await call('GET', '/api/public/content', undefined, { cookie: '' })).json.site.title, 'v1');
  assert.equal((await call('PUT', '/api/admin/content/site', { body: { title: 'v2' }, base: 1 })).json.version, 2);
  assert.equal((await call('PUT', '/api/admin/content/site', { body: { title: 'stale' }, base: 1 })).status, 409);
  assert.equal((await call('GET', '/api/public/content', undefined, { cookie: '' })).json.site.title, 'v1', 'unpublished draft stays private');
  const revs = (await call('GET', '/api/admin/content/site/revisions')).json, first = revs[revs.length - 1];
  assert.equal((await call('POST', '/api/admin/content/site/rollback', { revisionId: first.id, publish: true })).status, 200);
  assert.equal((await call('GET', '/api/admin/content/site')).json.draft.title, 'v1');
});
test('analytics: consent enforced, validated, no raw IP stored, summary is computed from real rows', async () => {
  assert.equal((await call('POST', '/api/collect', { consent: false, sid: 'a'.repeat(24), events: [ev('page_view')] }, { cookie: '', token: '' })).json.stored, 0);
  assert.equal((await call('POST', '/api/collect', { consent: true, sid: 'short', events: [ev('page_view')] }, { cookie: '', token: '' })).status, 400);
  assert.equal((await call('GET', '/api/collect')).status, 404);
  assert.equal((await collect([ev('page_view', { ref: 'https://www.google.com/search?q=x' }), ev('section_view', { section: 'projects' }), ev('project_open', { el: 'project:example-a' }), ev('nav_click', { el: 'nav:about' }),
    ev('scroll_depth', { meta: { pct: 50 } }), ev('hacker_event'), ev('project_open', { el: 'project:example-a' })])).json.stored, 6);
  assert.equal((await collect([ev('page_view')], { sid: 'b'.repeat(24), dev: 'mobile' })).json.stored, 1);
  assert.equal((await call('POST', '/api/collect', { consent: true, sid: 'c'.repeat(24), events: [ev('page_view')] }, { cookie: '', token: '', headers: { dnt: '1' } })).json.reason, 'dnt');
  const cols = app.db.prepare('PRAGMA table_info(events)').all().map(c => c.name); assert.ok(!cols.some(c => /^ip/.test(c)), 'no IP column');
  const s = (await call('GET', '/api/admin/analytics/summary?days=7')).json;
  assert.equal(s.current.pageViews, 2); assert.equal(s.current.visitors, 2); assert.equal(s.topElements[0].el, 'project:example-a'); assert.equal(s.topElements[0].n, 2);
  assert.equal(s.sections[0].section, 'projects'); assert.equal(s.referrers.find(r => r.cat === 'search').host, 'google.com'); assert.equal(s.scroll[0].pct, 50);
  assert.deepEqual(s.devices.map(d => d.k).sort(), ['desktop', 'mobile']);
});
test('collect endpoint is rate limited', async () => {
  let last; for (let i = 0; i < 125; i++) last = (await collect([ev('page_view')], { sid: 'r'.repeat(24) })).status;
  assert.equal(last, 429);
});
test('role-based access: viewer cannot read audit or edit content', async () => {
  const v = await call('POST', '/api/admin/login', { username: 'viewer', password: 'viewer password 123' }, { cookie: '' });
  const ck = v.headers.get('set-cookie').split(';')[0], t = v.json.csrf;
  assert.equal((await call('GET', '/api/admin/audit', undefined, { cookie: ck, token: t })).status, 403);
  assert.equal((await call('PUT', '/api/admin/content/site', { body: {} }, { cookie: ck, token: t })).status, 403);
  assert.equal((await call('GET', '/api/admin/analytics/summary', undefined, { cookie: ck, token: t })).status, 200);
});
test('audit log is hash-chained, append-only and records sensitive actions', async () => {
  const v = (await call('GET', '/api/admin/audit/verify')).json; assert.equal(v.ok, true); assert.ok(v.count >= 6);
  const actions = (await call('GET', '/api/admin/audit')).json.map(a => a.action); for (const a of ['login', 'content_save', 'content_publish', 'content_rollback']) assert.ok(actions.includes(a), a);
  assert.throws(() => app.db.prepare("UPDATE audit SET outcome='success' WHERE id=1").run(), /append-only/);
  assert.throws(() => app.db.prepare('DELETE FROM audit WHERE id=1').run(), /append-only/);
  app.db.exec('DROP TRIGGER audit_no_update'); app.db.prepare("UPDATE audit SET outcome='tampered' WHERE id=1").run();   // simulate a DB-level attacker
  assert.equal((await call('GET', '/api/admin/audit/verify')).json.ok, false, 'tampering is detected');
});
test('password change revokes other sessions; logout invalidates the session', async () => {
  const second = await call('POST', '/api/admin/login', { username: 'admin', password: 'correct horse battery' }, { cookie: '' });
  const ck2 = second.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('POST', '/api/admin/password', { current: 'bad', next: 'a much longer password' })).status, 403);
  assert.equal((await call('POST', '/api/admin/password', { current: 'correct horse battery', next: 'short' })).status, 422);
  assert.equal((await call('POST', '/api/admin/password', { current: 'correct horse battery', next: 'a much longer password' })).status, 200);
  assert.equal((await call('GET', '/api/admin/me', undefined, { cookie: ck2 })).status, 401, 'other session revoked');
  assert.equal((await call('POST', '/api/admin/logout', {})).status, 200);
  assert.equal((await call('GET', '/api/admin/me')).status, 401, 'cookie unusable after logout');
});
test('admin shell is served with a strict CSP (no inline script allowed)', async () => {
  const r = await call('GET', '/admin/'); assert.equal(r.status, 200); const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/); assert.ok(!/unsafe-inline/.test(csp)); assert.ok(!/<script>[^<]/.test(r.text));
  assert.equal((await call('GET', '/admin/admin.js')).status, 200);
});
