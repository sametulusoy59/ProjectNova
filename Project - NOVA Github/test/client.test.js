'use strict';
process.env.NOVA_EMBEDDED = '1';
// Runs the REAL browser scripts in a stubbed DOM (vm) against the REAL server: verifies consent gating, payloads and content mapping.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createApp } = require('../server');
const read = f => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');

let app, base; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-c-'));
test.before(async () => { app = createApp({ dir }); await new Promise(r => app.server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + app.server.address().port; });
test.after(() => app.close());

function browser({ consent = null, dnt = null } = {}) {
  const dl = {}, wl = {}, store = consent ? { 'nova-consent': consent } : {}, beacons = [], banners = [];
  const el = () => ({ style: {}, setAttribute() {}, append() {}, remove() {}, querySelector: () => ({ focus() {} }), set textContent(v) { this._t = v; }, get textContent() { return this._t || ''; } });
  const doc = { readyState: 'complete', referrer: 'https://www.google.com/', visibilityState: 'visible', documentElement: { lang: 'en', scrollHeight: 3000 }, body: { classList: { contains: () => false }, append: e => banners.push(e) },
    addEventListener: (t, f) => (dl[t] ||= []).push(f), getElementById: () => null, querySelector: () => ({ append() {} }), createElement: el };
  const ctx = { document: doc, navigator: { doNotTrack: dnt, sendBeacon: (u, b) => { beacons.push(b.parts[0]); return true; } }, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem: k => delete store[k] },
    sessionStorage: { getItem: () => null, setItem() {} }, crypto: { getRandomValues: a => a.fill(7) }, btoa: s => Buffer.from(s, 'binary').toString('base64'), matchMedia: () => ({ matches: false }),
    IntersectionObserver: class { observe() {} }, MutationObserver: class { observe() {} }, PerformanceObserver: class { observe() {} }, performance: { now: () => 1000 }, requestAnimationFrame: () => 1,
    addEventListener: (t, f) => (wl[t] ||= []).push(f), setInterval: () => 0, setTimeout, Blob: class { constructor(p) { this.parts = p; } }, fetch: () => Promise.resolve(), innerHeight: 800, innerWidth: 1200, scrollY: 0,
    DATA: { projects: [{ title: { en: 'Example Project A' } }] } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('nova-track.js'), ctx);
  const deliver = async () => { for (const b of beacons.splice(0)) await fetch(base + '/api/collect', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: b }); };
  return { ctx, dl, wl, store, beacons, banners, deliver };
}
const count = () => app.db.prepare('SELECT COUNT(*) n FROM events').get().n;

test('no consent: banner shown, nothing tracked or sent', async () => {
  const b = browser(); assert.equal(b.banners.length, 1); assert.equal(b.ctx.NovaTrack.consent(), null);
  assert.equal(b.dl.click, undefined, 'no click listener before consent'); b.wl.pagehide[0](); assert.equal(b.beacons.length, 0);
});
test('Do-Not-Track / GPC counts as decline and shows no banner', () => {
  const b = browser({ dnt: '1' }); assert.equal(b.ctx.NovaTrack.consent(), 'denied'); assert.equal(b.banners.length, 0); assert.equal(b.dl.click, undefined);
});
test('opt-in sends session/page_view/click events that the server stores; opt-out stops everything', async () => {
  const before = count(), b = browser(); b.ctx.NovaTrack.optIn(); assert.equal(b.store['nova-consent'], 'granted');
  b.dl.click.forEach(f => f({ clientX: 600, clientY: 400, target: { closest: s => (s === '.card' ? { dataset: { p: '0' } } : null) } }));
  b.wl.pagehide[0](); await b.deliver();
  const rows = app.db.prepare('SELECT name,el,ref,rhost FROM events ORDER BY id').all().slice(before);
  assert.deepEqual(rows.map(r => r.name), ['session_start', 'page_view', 'click_pos', 'project_click']);
  assert.equal(rows[3].el, 'project:example-project-a'); assert.equal(rows[0].ref, 'search'); assert.equal(rows[0].rhost, 'google.com');
  b.ctx.NovaTrack.optOut(); b.dl.click.forEach(f => f({ clientX: 1, clientY: 1, target: { closest: () => ({ dataset: { p: '0' } }) } })); b.wl.pagehide[0](); assert.equal(b.beacons.length, 0, 'nothing sent after opt-out');
});
test('content loader applies published content and falls back silently on failure', async () => {
  let rendered = 0; const DATA = { profile: { name: 'x' }, contact: {}, projects: [], skills: [], exp: [] };
  const run = async f => { const ctx = { DATA, render: () => rendered++, fetch: f, document: { title: '', querySelector: () => null } }; vm.createContext(ctx); vm.runInContext(read('nova-content.js'), ctx); await new Promise(r => setTimeout(r, 20)); return ctx; };
  const c = await run(() => Promise.resolve({ ok: true, json: async () => ({ site: { profile: { name: 'Yeni' }, contact: { email: 'a@b.co' }, title: 'T' }, projects: [{ title: 'P' }], experience: [{ role: 'R' }] }) }));
  assert.equal(DATA.profile.name, 'Yeni'); assert.equal(DATA.contact.email, 'a@b.co'); assert.equal(DATA.projects.length, 1); assert.equal(DATA.exp.length, 1); assert.equal(c.document.title, 'T'); assert.equal(rendered, 1);
  await run(() => Promise.reject(new Error('offline'))); assert.equal(rendered, 1, 'no re-render and no crash when API is down');
});
test('the site keeps its server hooks and has the carousel, the new contact block and a well-formed nav', () => {
  const now = read('index.html');
  for (const k of ['<!--NOVA_HEAD-->', '/nova-content.js', '/nova-track.js', 'const NS=window.NOVA_SETTINGS', 'THE STAR: blue-white giant', 'const MK3=[', 'id="carPrev"', 'id="carDots"', 'function carousel()', 'function contactHTML(c)', "$('#cl').innerHTML=contactHTML(c);"]) assert.ok(now.includes(k), k);
  const nav = now.slice(now.indexOf('<nav id="nav">'), now.indexOf('</nav>'));
  for (const k of ['class="links"', 'id="lang"', 'id="snd"']) assert.ok(nav.includes(k), 'nav must contain ' + k);
  assert.equal((now.match(/<\/nav>/g) || []).length, 1);
});
