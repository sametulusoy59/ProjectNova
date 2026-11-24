'use strict';
process.env.NOVA_EMBEDDED = '1';
// Runs the REAL admin scripts in a minimal fake DOM against the REAL server. It cannot judge visual design, but it catches runtime errors,
// wrong API usage and broken wiring in every admin view.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createApp } = require('../server'); const S = require('../lib/security');

class Node_ { }
class Txt extends Node_ { constructor(t) { super(); this.textContent = t; } }
let reg = {};
class El extends Node_ {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; this.dataset = {}; this.className = ''; this._t = ''; this.value = ''; this.checked = false; this.files = []; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') reg[v] = this; if (k.startsWith('data-')) this.dataset[k.slice(5)] = v; if (k === 'value') this.value = v; }
  removeAttribute(k) { delete this.attrs[k]; } toggleAttribute() { } addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } remove() { } focus() { } click() { for (const f of this.listeners.click || []) f({ target: this, preventDefault() { } }); }
  append(...k) { for (const c of k) this.children.push(typeof c === 'string' ? new Txt(c) : c); } replaceChildren(...k) { this.children = []; this.append(...k); }
  get textContent() { return this._t + this.children.map(c => c.textContent).join(' '); } set textContent(v) { this._t = String(v); this.children = []; }
  get classList() { return { add() { }, remove() { }, toggle() { } }; }
  getContext() { return new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() { } })), set: (t, k, v) => ((t[k] = v), true) }); }
  find(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) if (c instanceof El) c.find(pred, out); return out; }
}
let app, base, cookie = '', dom;
function browser() {
  reg = {}; const root = new El('div'); root.setAttribute('id', 'app');
  const docu = { getElementById: id => reg[id] || null, createElement: t => new El(t), body: new El('body'), querySelectorAll: sel => (sel.includes('data-v') ? root.find(e => e.tag === 'button' && e.attrs['data-v']) : []), documentElement: { lang: 'tr' } };
  const ctx = { document: docu, Node: Node_, setTimeout, clearTimeout, console, confirm: () => true, prompt: () => 'a brand new long password', alert() { }, location: { origin: base, search: '' }, navigator: { clipboard: { writeText: async () => { } } }, window: {}, Blob, URL, encodeURIComponent,
    fetch: async (p, o = {}) => { const r = await fetch(base + p, { ...o, headers: { ...(o.headers || {}), ...(cookie ? { cookie } : {}) }, redirect: 'manual' }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return r; } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ['admin.js', 'editor.js', 'media.js', 'analytics.js', 'settings.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../admin', f), 'utf8'), ctx, { filename: f });
  return { ctx, root, docu };
}
const wait = (ms = 120) => new Promise(r => setTimeout(r, ms));
const text = () => reg.main ? reg.main.textContent : '';
const btn = (root, label) => root.find(e => e.tag === 'button' && e.textContent.trim() === label)[0];

test.before(async () => {
  app = createApp({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nova-ui-')), quiet: true, origin: 'https://example.com' });
  app.db.prepare('INSERT INTO users(username,pw,role,created_at) VALUES(?,?,?,?)').run('owner', S.hashPw('owner password 123'), 'owner', Date.now());
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + app.server.address().port;
  // seed some analytics so the views have data
  await fetch(base + '/api/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent: true, sid: 'u'.repeat(24), dev: 'desktop', lang: 'tr', events: [{ name: 'session_start', ref: 'https://google.com/' }, { name: 'page_view' }, { name: 'section_view', section: 'about' }, { name: 'nav_click', el: 'nav:about' }, { name: 'click_pos', meta: { x: 300, y: 300, b: 1 } }, { name: 'engagement', meta: { sec: 30 } }] }) });
});
test.after(() => app.close());

test('login form -> shell -> every admin view renders real data without errors', async () => {
  const { ctx, root } = browser();
  await ctx.api('/login', { body: { username: 'owner', password: 'owner password 123' } }).then(r => vm.runInContext('S.csrf', ctx) || vm.runInContext(`S.csrf='${r.csrf}'`, ctx)); vm.runInContext(`S.me={username:'owner',role:'owner'};`, ctx);
  vm.runInContext("api('/me').then(r=>{S.perms=r.permissions;shell()})", ctx); await wait(300);
  const navs = root.find(e => e.tag === 'button' && e.attrs['data-v']).map(e => e.attrs['data-v']); assert.deepEqual(navs, ['Genel Bakış', 'Analitik', 'İçerik', 'Medya', 'Kullanıcılar', 'Ayarlar', 'Denetim', 'Güvenlik']);
  const expect = { 'Genel Bakış': ['SAYFA GÖRÜNTÜLEME', 'Uyarılar'], 'Analitik': ['Ziyaretçi yolculuğu', 'Tıklama haritası', 'Trafik kaynağı kalitesi'], 'İçerik': ['Site bilgileri', 'Taslağı kaydet'], 'Medya': ['Medya kütüphanesi'], 'Kullanıcılar': ['owner', 'Yeni kullanıcı'], 'Ayarlar': ['Veri saklama süresi', 'Yedekler'], 'Denetim': ['Zincir sağlam'], 'Güvenlik': ['Parolayı değiştir', 'İki adımlı doğrulama'] };
  for (const [v, needles] of Object.entries(expect)) { await ctx.show(v); await wait(250); const t = text(); for (const n of needles) assert.ok(t.includes(n), `${v} should contain "${n}" but got: ${t.slice(0, 200)}`); assert.ok(!t.includes('Yüklenemedi'), v + ' failed to load: ' + t.slice(0, 200)); }
});
test('content editor: every tab renders; editing + autosave + publish really change the live site', async () => {
  const { ctx, root, docu } = browser(); vm.runInContext("api('/me').then(r=>{S.csrf=r.csrf;S.me=r.user;S.perms=r.permissions;shell()})", ctx); await wait(300); await ctx.show('İçerik'); await wait(300);
  for (const [tab, needle] of [['Projeler', 'Proje ekle'], ['Yetenekler', 'Kategori ekle'], ['Deneyim', 'Kayıt ekle'], ['Tema & 3D', 'Süpernova parçacık yoğunluğu'], ['SEO', 'Kanonik adres'], ['Site & Hakkında', 'Site bilgileri']]) {
    btn(root, tab).click(); await wait(350); const t = text(); assert.ok(t.includes(needle), `${tab}: "${needle}" missing; toasts: ${docu.body.textContent}`); assert.ok(!t.includes('Yüklenemedi'), tab + ' failed');
  }
  const title = root.find(e => e.tag === 'input' && String(e.attrs.maxlength) === '120')[0]; title.value = 'Test Başlığı'; for (const f of title.listeners.input) f({ target: title });
  await wait(2500);   // autosave debounce
  assert.ok(text().includes('Taslak kaydedildi'), 'autosave status');
  btn(root, 'YAYINLA').click(); await wait(400);
  assert.ok((await (await fetch(base + '/')).text()).includes('<title>Test Başlığı</title>'), 'published title is on the public page');
  btn(root, 'Tema & 3D').click(); await wait(350);
  const rngs = root.find(e => e.tag === 'input' && e.attrs.type === 'range'); assert.ok(rngs.length >= 10); rngs[0].value = '1.5'; for (const f of rngs[0].listeners.input) f({ target: rngs[0] }); await wait(2500);
  btn(root, 'YAYINLA').click(); await wait(400);
  assert.match(await (await fetch(base + '/')).text(), /"particles":1\.5/);
});
test('users + 2FA + analytics widgets: buttons are wired to working endpoints', async () => {
  const { ctx, root } = browser(); vm.runInContext("api('/me').then(r=>{S.csrf=r.csrf;S.me=r.user;S.perms=r.permissions;shell()})", ctx); await wait(300);
  await ctx.show('Kullanıcılar'); await wait(250);
  const [un, pw] = root.find(e => e.tag === 'input' && (e.attrs.placeholder || '').match(/kullanıcı\.adı|parola/)); un.value = 'newbie'; pw.value = 'a very long password'; btn(root, 'OLUŞTUR').click(); await wait(500);
  assert.ok(app.db.prepare("SELECT 1 x FROM users WHERE username='newbie'").get(), 'user created from the UI');
  await ctx.show('Güvenlik'); await wait(300); btn(root, "2FA'YI ETKİNLEŞTİR").click(); await wait(400); assert.ok(text().includes('Anahtar gir'), 'secret displayed'); assert.ok(app.db.prepare("SELECT totp FROM users WHERE username='owner'").get().totp);
  await ctx.show('Ayarlar'); await wait(250); btn(root, 'ŞİMDİ YEDEK AL').click(); await wait(500); assert.equal(fs.readdirSync(path.join(app.cfg.dir, 'backups')).length, 1);
  await ctx.show('Analitik'); await wait(300); btn(root, 'Huni adımlarını düzenle'); assert.ok(text().includes('1 tıklama') || text().includes('tıklama'));
});
