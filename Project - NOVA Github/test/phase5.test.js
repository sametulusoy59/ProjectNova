'use strict';
process.env.NOVA_EMBEDDED = '1';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createApp } = require('../server'); const S = require('../lib/security'); const totp = require('../lib/totp'); const guard = require('../lib/netguard');

let app, base, jar = '', csrf = '';
const call = async (m, p, body, o = {}) => {
  const cookie = 'cookie' in o ? o.cookie : jar, token = 'token' in o ? o.token : csrf;
  const r = await fetch(base + p, { method: m, redirect: 'manual', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(token ? { 'x-csrf-token': token } : {}), ...(o.headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, headers: r.headers, text };
};
const login = async (username, password, extra = {}) => { const r = await call('POST', '/api/admin/login', { username, password, ...extra }, { cookie: '', token: '' }); if (r.status === 200) return { ck: r.headers.get('set-cookie').split(';')[0], csrf: r.json.csrf, r }; return { r }; };
const collect = (sid, dev, events) => call('POST', '/api/collect', { consent: true, sid: sid.padEnd(24, 'x'), dev, lang: 'tr', events }, { cookie: '', token: '' });
const ev = (name, o = {}) => ({ name, ...o });
const INDEX = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test.before(async () => {
  app = createApp({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nova-p5-')), quiet: true, origin: 'https://example.com' });
  const add = (u, pw, role) => app.db.prepare('INSERT INTO users(username,pw,role,created_at) VALUES(?,?,?,?)').run(u, S.hashPw(pw), role, Date.now());
  add('owner', 'owner password 123', 'owner'); add('editor', 'editor password 123', 'editor'); add('viewer', 'viewer password 123', 'viewer');
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + app.server.address().port;
  const l = await login('owner', 'owner password 123'); jar = l.ck; csrf = l.csrf;
});
test.after(() => app.close());
const pub = async key => { await call('POST', `/api/admin/content/${key}/publish`, {}); };

test('theme: values are clamped on save and injected server-side into the page; preview shows drafts only to admins', async () => {
  const t = (await call('PUT', '/api/admin/content/theme', { body: { accent: '#ff00aa', accent2: 'red; }</style><script>alert(1)</script>', particles: 99, journeyVh: 10, trail: false, quality: 'high' } })).json;
  assert.equal(t.version, 1);
  const saved = (await call('GET', '/api/admin/content/theme')).json.draft; assert.equal(saved.particles, 2); assert.equal(saved.journeyVh, 400); assert.equal(saved.accent2, '#0088FF'); assert.equal(saved.trail, false);
  let page = (await call('GET', '/', undefined, { cookie: '' })).text; assert.ok(!page.includes('nova-theme'), 'draft is not public');
  assert.ok((await call('GET', '/?nova_preview=1')).text.includes('--cyan:#ff00aa'), 'admin preview shows the draft');
  assert.ok(!(await call('GET', '/?nova_preview=1', undefined, { cookie: '' })).text.includes('nova-theme'), 'anonymous preview does not');
  await pub('theme'); page = (await call('GET', '/', undefined, { cookie: '' })).text;
  assert.match(page, /--cyan:#ff00aa;--blue:#0088FF/); assert.match(page, /#journey\{height:400vh\}/); assert.match(page, /window\.NOVA_SETTINGS=\{[^<]*"particles":2/); assert.ok(!page.includes('alert(1)'));
});
test('seo: title/description replaced, canonical + Open Graph + JSON-LD present and HTML-escaped; robots.txt and sitemap.xml', async () => {
  await call('PUT', '/api/admin/content/site', { body: { title: 'Çağrı <b>"x"</b>', description: 'Bir açıklama & test', profile: { name: 'Çağrı Samet' }, contact: { github: 'https://github.com/x', linkedin: 'javascript:1'.replace('javascript:1', 'https://linkedin.com/in/x') } } });
  await call('PUT', '/api/admin/content/seo', { body: { canonical: 'https://example.com/', ogImage: '/media/abcdefghijklmnop.png', robots: 'index', twitter: 'cagri' } }); await pub('site'); await pub('seo');
  const page = (await call('GET', '/', undefined, { cookie: '' })).text;
  assert.ok(page.includes('<title>Çağrı &lt;b&gt;&quot;x&quot;&lt;/b&gt;</title>')); assert.ok(page.includes('content="Bir açıklama &amp; test"'));
  for (const frag of ['<link rel="canonical" href="https://example.com/">', 'property="og:title"', 'property="og:image" content="https://example.com/media/abcdefghijklmnop.png"', 'name="twitter:site" content="@cagri"', 'application/ld+json', '"sameAs":["https://github.com/x","https://linkedin.com/in/x"]', 'content="index,follow"']) assert.ok(page.includes(frag), frag);
  assert.ok(!/<script type="application\/ld\+json">[^<]*<\/script>[^]*<\/b>/.test('') && !page.includes('<b>"x"'));
  const robots = (await call('GET', '/robots.txt')).text; assert.match(robots, /Disallow: \/admin\//); assert.match(robots, /Sitemap: https:\/\/example\.com\/sitemap\.xml/);
  assert.match((await call('GET', '/sitemap.xml')).text, /<loc>https:\/\/example\.com\/<\/loc>/);
  await call('PUT', '/api/admin/content/seo', { body: { robots: 'noindex' } }); await pub('seo');
  assert.equal((await call('GET', '/robots.txt')).text, 'User-agent: *\nDisallow: /\n'); assert.ok((await call('GET', '/')).text.includes('noindex,nofollow'));
  assert.equal((await call('PUT', '/api/admin/content/seo', { body: { canonical: 'javascript:alert(1)' } })).status, 422);
});
test('seo check reports real problems', async () => {
  const w = (await call('GET', '/api/admin/seo/check')).json.map(x => x.msg).join('\n'); assert.match(w, /noindex/); assert.match(w, /og:image/);
});
test('TOTP: RFC vectors, replay protection, encrypted at rest, enrol -> login requires code -> recovery code works once -> disable', async () => {
  assert.equal(totp.hotp(Buffer.from('12345678901234567890'), 1), '287082');
  const l = await login('editor', 'editor password 123'); const hdr = { cookie: l.ck, token: l.csrf };
  const st = (await call('POST', '/api/admin/2fa/start', {}, hdr)).json; assert.match(st.uri, /^otpauth:\/\/totp\//);
  const raw = app.db.prepare("SELECT totp FROM users WHERE username='editor'").get().totp; assert.ok(!raw.includes(st.secret), 'secret is encrypted in the DB');
  assert.equal((await call('POST', '/api/admin/2fa/enable', { code: '000000' }, hdr)).status, 422);
  const code = totp.hotp(totp.unb32(st.secret), Math.floor(Date.now() / 30000)); const en = (await call('POST', '/api/admin/2fa/enable', { code }, hdr)).json; assert.equal(en.recoveryCodes.length, 8);
  assert.equal((await call('GET', '/api/admin/me', undefined, hdr)).json.totp, true);
  assert.equal((await login('editor', 'editor password 123')).r.json.error, 'totp_required');
  assert.equal((await login('editor', 'editor password 123', { code: code })).r.status, 401, 'same code cannot be replayed');
  assert.equal((await login('editor', 'editor password 123', { code: '123456' })).r.status, 401);
  const rc = en.recoveryCodes[0]; assert.equal((await login('editor', 'editor password 123', { code: rc })).r.status, 200);
  assert.equal((await login('editor', 'editor password 123', { code: rc })).r.status, 401, 'recovery code is single-use');
  assert.equal((await call('POST', '/api/admin/2fa/disable', { password: 'wrong', code: en.recoveryCodes[1] }, hdr)).status, 403);
  assert.equal((await call('POST', '/api/admin/2fa/disable', { password: 'editor password 123', code: en.recoveryCodes[1] }, hdr)).status, 200);
  assert.equal((await login('editor', 'editor password 123')).r.status, 200);
});
test('users: owner-only management, no self-lockout, last-owner protection, sessions revoked on change', async () => {
  const ed = await login('editor', 'editor password 123'); assert.equal((await call('GET', '/api/admin/users', undefined, { cookie: ed.ck, token: ed.csrf })).status, 403);
  const list = (await call('GET', '/api/admin/users')).json, me = list.find(x => x.username === 'owner'), v = list.find(x => x.username === 'viewer');
  assert.equal((await call('PATCH', '/api/admin/users/' + me.id, { disabled: true })).json.error, 'cannot_modify_self');
  assert.equal((await call('PATCH', '/api/admin/users/' + me.id, { role: 'viewer' })).json.error, 'cannot_modify_self');
  assert.equal((await call('POST', '/api/admin/users', { username: 'new.user', role: 'editor', password: 'short' })).status, 422);
  assert.equal((await call('POST', '/api/admin/users', { username: 'new.user', role: 'editor', password: 'a long enough pass' })).status, 201);
  assert.equal((await call('POST', '/api/admin/users', { username: 'new.user', role: 'editor', password: 'a long enough pass' })).status, 409);
  const vs = await login('viewer', 'viewer password 123'); assert.equal((await call('GET', '/api/admin/me', undefined, { cookie: vs.ck, token: vs.csrf })).status, 200);
  assert.equal((await call('PATCH', '/api/admin/users/' + v.id, { disabled: true })).status, 200);
  assert.equal((await call('GET', '/api/admin/me', undefined, { cookie: vs.ck, token: vs.csrf })).status, 401, 'disabled user is logged out');
  assert.equal((await login('viewer', 'viewer password 123')).r.status, 401);
  // promote a 2nd owner, then demoting the first would still leave one; demoting the only remaining owner must fail
  const nu = (await call('GET', '/api/admin/users')).json.find(x => x.username === 'new.user');
  assert.equal((await call('PATCH', '/api/admin/users/' + nu.id, { role: 'owner' })).status, 200);
  const l2 = await login('new.user', 'a long enough pass'), h2 = { cookie: l2.ck, token: l2.csrf };
  assert.equal((await call('PATCH', '/api/admin/users/' + me.id, { disabled: true }, h2)).status, 200);
  assert.equal((await call('PATCH', '/api/admin/users/' + me.id, { role: 'owner', disabled: false }, h2)).status, 200);
  const l3 = await login('owner', 'owner password 123'); jar = l3.ck; csrf = l3.csrf;   // the original owner's sessions were (correctly) revoked
});
test('analytics: funnel, exits, heat map, device filter, source engagement computed from real events', async () => {
  const day = (sid, dev, evs) => collect(sid, dev, evs);
  await day('a', 'desktop', [ev('session_start', { ref: 'https://google.com/' }), ev('section_view', { section: 'about' }), ev('section_view', { section: 'projects' }), ev('project_click', { el: 'project:p' }), ev('section_view', { section: 'contact' }), ev('contact_click', { el: 'contact:email' }), ev('engagement', { meta: { sec: 40 } }), ev('click_pos', { meta: { x: 500, y: 500, b: 3 } })]);
  await day('b', 'desktop', [ev('session_start'), ev('section_view', { section: 'about' }), ev('section_view', { section: 'projects' }), ev('click_pos', { meta: { x: 510, y: 503, b: 3 } })]);
  await day('c', 'mobile', [ev('session_start'), ev('section_view', { section: 'about' }), ev('click_pos', { meta: { x: 100, y: 900, b: 0 } }), ev('click_pos', { meta: { x: 5000, y: -4, b: 0 } })]);
  await day('d', 'desktop', [ev('session_start')]);
  const f = (await call('GET', '/api/analytics/x'.replace('/api/analytics/x', '/api/admin/analytics/funnel?days=7'))).json;
  assert.deepEqual(f.steps.map(x => x.count), [4, 3, 2, 1, 1, 1]); assert.equal(f.steps[1].fromPrev, 75); assert.equal(f.steps[5].fromStart, 25);
  assert.deepEqual((await call('GET', '/api/admin/analytics/funnel?days=7&device=mobile')).json.steps.map(x => x.count), [1, 1, 0, 0, 0, 0]);
  const s = (await call('GET', '/api/admin/analytics/summary?days=7')).json; const exits = Object.fromEntries(s.exits.map(x => [x.section, x.n]));
  assert.deepEqual(exits, { contact: 1, projects: 1, about: 1 }); assert.equal(s.sourceEngagement.find(x => x.cat === 'search').contacted, 1); assert.equal(s.sourceEngagement.find(x => x.cat === 'search').avgSec, 40);
  assert.equal((await call('GET', '/api/admin/analytics/summary?days=7&device=mobile')).json.current.visitors, 1);
  const h = (await call('GET', '/api/admin/analytics/heatmap?days=7')).json; assert.equal(h.total, 3, 'out-of-range coordinates are ignored'); assert.deepEqual(h.cells.find(c => c[0] === 20 && c[1] === 11), [20, 11, 2]);
  assert.equal((await call('GET', '/api/admin/analytics/heatmap?days=7&bucket=0')).json.total, 1);
  assert.equal((await call('PUT', '/api/admin/analytics/funnel', { steps: [{ label: 'x', name: 'hack' }] })).status, 422);
  assert.equal((await call('PUT', '/api/admin/analytics/funnel', { steps: [{ label: 'Ziyaret', name: 'session_start' }, { label: 'Proje', name: 'project_click' }] })).status, 200);
  assert.deepEqual((await call('GET', '/api/admin/analytics/funnel?days=7')).json.steps.map(x => x.count), [4, 1]);
});
test('CSV export neutralises formula injection and requires auth; content export works', async () => {
  await collect('f', 'desktop', [ev('nav_click', { el: '=HYPERLINK("http://evil","x")' }), ev('nav_click', { el: '+cmd|calc' })]);
  const r = await call('GET', '/api/admin/export/events.csv?days=7'); assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.ok(r.text.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), 'quoted + prefixed'); assert.ok(r.text.includes("'+cmd|calc")); assert.ok(!/^[=+]/m.test(r.text.split('\r\n').slice(1).join('\n')));
  assert.equal((await call('GET', '/api/admin/export/events.csv', undefined, { cookie: '' })).status, 401); assert.equal((await call('GET', '/api/admin/export/content.json', undefined, { cookie: '' })).status, 401);
  assert.ok((await call('GET', '/api/admin/export/content.json')).json.content.theme.published);
});
test('settings: validated; analytics kill switch stops collection and disables the tracker; alerts and backups work', async () => {
  const ops = (await call('PUT', '/api/admin/settings', { retentionDays: 5, analytics: true, lcp: 99999, cls: 9, errors: 0 })).json.ops; assert.equal(ops.retentionDays, 7); assert.equal(ops.lcp, 10000); assert.equal(ops.cls, 1); assert.equal(ops.errors, 1);
  const al = (await call('GET', '/api/admin/alerts')).json.map(a => a.title); assert.ok(al.includes('Yedek yok / eski')); assert.ok(al.includes('İki adımlı doğrulama kapalı'));
  assert.equal((await call('POST', '/api/admin/backups', {})).status, 201); const bk = (await call('GET', '/api/admin/backups')).json; assert.equal(bk.length, 1); assert.ok(bk[0].size > 0);
  assert.ok(!(await call('GET', '/api/admin/alerts')).json.map(a => a.title).includes('Yedek yok / eski'));
  const before = app.db.prepare('SELECT COUNT(*) n FROM events').get().n;
  await call('PUT', '/api/admin/settings', { retentionDays: 90, analytics: false });
  assert.equal((await collect('z', 'desktop', [ev('page_view')])).json.reason, 'disabled'); assert.equal(app.db.prepare('SELECT COUNT(*) n FROM events').get().n, before);
  assert.match((await call('GET', '/', undefined, { cookie: '' })).text, /"analytics":false/);
  const ed = await login('editor', 'editor password 123'); assert.equal((await call('PUT', '/api/admin/settings', { analytics: true }, { cookie: ed.ck, token: ed.csrf })).status, 403);
  await call('PUT', '/api/admin/settings', { retentionDays: 90, analytics: true });
});
test('link checker never touches private / loopback / metadata addresses (SSRF guard)', async () => {
  for (const h of ['127.0.0.1', 'localhost', '169.254.169.254', '10.1.2.3', '192.168.0.1', '[::1]', 'fd00::1']) assert.equal(await guard.isPublic(h), false, h);
  for (const u of ['http://127.0.0.1:1/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'ftp://example.com/', 'http://user:pw@example.com/']) assert.equal((await guard.check(u)).note, 'blocked', u);
  await call('PUT', '/api/admin/content/projects', { body: [{ title: { en: 'P', tr: 'P' }, live: 'http://127.0.0.1:9/', code: 'http://169.254.169.254/' }] });
  const r = (await call('POST', '/api/admin/linkcheck', {})).json; assert.ok(r.results.length >= 2 && r.results.every(x => x.ok === false && x.note === 'blocked'));
  assert.ok((await call('GET', '/api/admin/alerts')).json.some(a => a.title === 'Kırık bağlantılar'));
});

test('.env loader: parses comments/quotes, never overrides real environment variables', () => {
  const { parse, load } = require('../lib/env');
  assert.deepEqual(parse('# c\nDOMAIN=ornek.com   # note\nSETUP_TOKEN="a b #c"\nBAD LINE\nPORT=3000\n'), { DOMAIN: 'ornek.com', SETUP_TOKEN: 'a b #c', PORT: '3000' });
  const f = path.join(os.tmpdir(), 'nova-env-' + Date.now()); fs.writeFileSync(f, 'NOVA_T1=from_file\nNOVA_T2=from_file\n'); process.env.NOVA_T2 = 'real'; load(f);
  assert.equal(process.env.NOVA_T1, 'from_file'); assert.equal(process.env.NOVA_T2, 'real'); load(f + '.missing');
});

test('holographic CV viewer: pdf.js is self-hosted with correct types and the CSP allows its module worker and fonts', async () => {
  for (const [f, t] of [['/vendor/pdfjs/pdf.min.mjs', /text\/javascript/], ['/vendor/pdfjs/pdf.worker.min.mjs', /text\/javascript/], ['/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf', /font\/ttf/], ['/vendor/pdfjs/standard_fonts/FoxitSerif.pfb', /octet-stream/]]) {
    const r = await call('GET', f, undefined, { cookie: '' }); assert.equal(r.status, 200, f); assert.match(r.headers.get('content-type'), t, f);
  }
  const csp = (await call('GET', '/', undefined, { cookie: '' })).headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/); assert.match(csp, /font-src 'self'/); assert.match(csp, /connect-src 'self'/);
  const page = (await call('GET', '/', undefined, { cookie: '' })).text;
  for (const k of ['function openCv(url)', "import('/vendor/pdfjs/pdf.min.mjs')", 'id="cvhStage"', 'cvhClose']) assert.ok(page.includes(k), k);
});
