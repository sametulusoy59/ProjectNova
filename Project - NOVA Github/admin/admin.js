'use strict';
const app = document.getElementById('app'), S = { csrf: '', me: null, perms: [] };
const h = (t, a = {}, ...k) => { const e = document.createElement(t); for (const [x, v] of Object.entries(a)) { if (v == null || v === false) continue; if (x === 'class') e.className = v; else if (x === 'style') e.style.cssText = v; else if (x.startsWith('on')) e.addEventListener(x.slice(2), v); else e.setAttribute(x, v); } for (const c of k.flat()) e.append(c instanceof Node ? c : String(c ?? '')); return e; };
async function api(p, o = {}) {
  const hd = { ...(o.body ? { 'content-type': 'application/json' } : {}), ...(o.headers || {}), ...(S.csrf ? { 'x-csrf-token': S.csrf } : {}) };
  const r = await fetch('/api/admin' + p, { method: o.method || (o.raw || o.body ? 'POST' : 'GET'), credentials: 'same-origin', headers: hd, body: o.raw || (o.body ? JSON.stringify(o.body) : undefined) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, data: j }); return j;
}
const fmt = t => new Date(t).toLocaleString('tr-TR');
const ERR = { unsafe_url: 'Güvenli olmayan bağlantı', bad_email: 'Geçersiz e-posta', conflict: 'İçerik başka yerde değişmiş, sayfayı yenileyin', in_use: 'Dosya içerikte kullanılıyor', unsupported_file: 'Yalnızca PNG, JPG veya WEBP', too_large: 'Dosya çok büyük', string_too_long: 'Metin çok uzun', forbidden: 'Bu işlem için yetkiniz yok', csrf: 'Oturum doğrulanamadı, yeniden giriş yapın', weak_password: 'Parola en az 12 karakter olmalı', wrong_password: 'Mevcut parola yanlış', bad_setup_token: 'Kurulum anahtarı yanlış', too_many_attempts: 'Çok fazla deneme, 15 dakika sonra tekrar deneyin', invalid_credentials: 'Kullanıcı adı veya parola hatalı', totp_required: 'İki adımlı doğrulama kodu gerekli', bad_code: 'Kod hatalı', wrong_password_or_code: 'Parola veya kod hatalı', cannot_modify_self: 'Kendi hesabınızı kilitleyemez/düşüremezsiniz', last_owner: 'Son yönetici düşürülemez', user_exists: 'Bu kullanıcı adı var', bad_role: 'Geçersiz rol', bad_funnel_event: 'Geçersiz olay adı', bad_funnel: 'Huni 1–8 adım olmalı', already_running: 'Zaten çalışıyor', bad_username: 'Kullanıcı adı: 3-32 karakter, a-z 0-9 . _ -' };
const msg = e => { const [k, d] = String(e.message).split(':'); return (ERR[k] || k) + (d ? ` (${d})` : ''); };
const toast = (m, bad) => { const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, m); document.body.append(t); setTimeout(() => t.remove(), 3800); };
const table = (head, rows) => rows.length ? h('table', {}, h('thead', {}, h('tr', {}, head.map(x => h('th', {}, x)))), h('tbody', {}, rows.map(r => h('tr', {}, r.map(c => h('td', {}, c)))))) : h('div', { class: 'empty' }, 'Henüz veri yok.');
const delta = (a, b) => { if (!b) return h('small', { class: 'mut' }, 'önceki dönem verisi yok'); const p = Math.round((a - b) / b * 100); return h('small', { class: p >= 0 ? 'up' : 'dn' }, `${p >= 0 ? '+' : ''}${p}% önceki döneme göre`); };
const VIEWS = {}, NEEDS = { 'Analitik': 'analytics', 'İçerik': 'content', 'Medya': 'content', 'Kullanıcılar': 'security', 'Ayarlar': 'security', 'Denetim': 'audit' };

function authForm(title, fields, submitText, onSubmit, note) {
  const err = h('div', { class: 'err', role: 'alert' }), inputs = fields.map(([id, label, type, ac, opt]) => h('input', { id, type: type || 'text', autocomplete: ac || 'off', required: opt ? null : '' }));
  app.replaceChildren(h('form', { class: 'login', onsubmit: async e => { e.preventDefault(); try { await onSubmit(Object.fromEntries(inputs.map(i => [i.id, i.value]))); } catch (x) { err.textContent = msg(x); inputs.forEach(i => { if (i.type === 'password') i.value = ''; }); } } },
    h('h1', {}, title), note ? h('p', { class: 'mut' }, note) : '', fields.flatMap(([id, label], i) => [h('label', { for: id }, label), inputs[i]]), h('button', { class: 'primary', type: 'submit' }, submitText), err));
  inputs[0].focus();
}
const enter = async r => { S.csrf = r.csrf; S.me = r.user; S.perms = (await api('/me')).permissions || []; shell(); };
const login = () => authForm('NOVA COMMAND CENTER', [['username', 'Kullanıcı adı', 'text', 'username'], ['password', 'Parola', 'password', 'current-password'], ['code', '2FA kodu (iki adımlı doğrulama açıksa)', 'text', 'one-time-code', true]], 'GİRİŞ YAP', async v => enter(await api('/login', { body: { username: v.username, password: v.password, ...(v.code ? { code: v.code.trim() } : {}) } })));
const setup = () => authForm('İLK KURULUM', [['token', 'Kurulum anahtarı', 'password'], ['username', 'Yönetici kullanıcı adı'], ['password', 'Parola (en az 12 karakter)', 'password', 'new-password']], 'HESABI OLUŞTUR', async v => enter(await api('/setup', { body: v })),
  'Kurulum anahtarı sunucu günlüğünde (docker compose logs app) ya da SETUP_TOKEN ortam değişkeninde yazar.');

async function show(name) {
  const m = document.getElementById('main'); if (VIEWS._leave) { try { await VIEWS._leave(); } catch {} VIEWS._leave = null; }
  m.replaceChildren(h('p', { class: 'mut' }, 'Yükleniyor…'));
  document.querySelectorAll('nav button[data-v]').forEach(b => b.dataset.v === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  const box = h('div'); try { await VIEWS[name](box); m.replaceChildren(box); } catch (e) { if (e.status === 401) return login(); m.replaceChildren(h('div', { class: 'empty' }, e.status === 403 ? 'Bu bölüme erişim yetkiniz yok.' : 'Yüklenemedi: ' + msg(e))); }
}
function shell() {
  const names = ['Genel Bakış', 'Analitik', 'İçerik', 'Medya', 'Kullanıcılar', 'Ayarlar', 'Denetim', 'Güvenlik'].filter(n => VIEWS[n] && (!NEEDS[n] || S.perms.includes(NEEDS[n])));
  app.replaceChildren(h('div', { class: 'shell' }, h('nav', { 'aria-label': 'Bölümler' }, h('h1', {}, 'NOVA'), names.map(n => h('button', { 'data-v': n, onclick: () => show(n) }, n)),
    h('p', { class: 'mut mono' }, S.me.username + ' · ' + S.me.role), h('a', { href: '/', target: '_blank', rel: 'noopener', class: 'mut' }, 'Siteyi aç ↗'), h('br'), h('button', { onclick: async () => { try { await api('/logout', { method: 'POST', body: {} }); } catch {} S.csrf = ''; login(); } }, 'ÇIKIŞ')), h('main', { id: 'main' })));
  show(names[0]);
}

VIEWS['Genel Bakış'] = async el => {
  const days = 7, s = await api('/analytics/summary?days=' + days), c = s.current, p = s.previous, max = Math.max(1, ...s.daily.map(d => d.pageViews));
  el.append(h('h2', {}, `Genel Bakış — son ${days} gün`), h('div', { class: 'cards' },
    [['Sayfa görüntüleme', 'pageViews'], ['Ziyaretçi', 'visitors'], ['Olay', 'events'], ['JS hatası', 'errors']].map(([l, k]) => h('div', { class: 'card' }, h('small', { class: 'mut' }, l.toUpperCase()), h('b', {}, c[k]), delta(c[k], p[k])))),
    h('p', { class: 'mut' }, 'Ziyaretçi = günlük değişen anonim kimlik sayısı; 3 gün gelen kişi 3 kez sayılır (gizlilik için bilinçli tasarım). Yalnızca onay veren ziyaretçiler sayılır.'),
    h('h3', {}, 'Günlük sayfa görüntüleme'), table(['Gün', 'Görüntüleme', 'Ziyaretçi', ''], s.daily.map(d => [d.d, d.pageViews, d.visitors, h('div', { class: 'bar', style: `width:${Math.round(d.pageViews / max * 100)}%` })])),
    h('h3', {}, 'En çok tıklanan öğeler'), table(['Öğe', 'Olay', 'Tıklama'], s.topElements.map(r => [r.el, r.name, r.n])),
    h('h3', {}, 'Bölümlere ulaşma (tekil ziyaretçi)'), table(['Bölüm', 'Ulaşan'], s.sections.map(r => [r.section, r.reach])),
    h('h3', {}, 'Performans (gerçek ziyaretçiler, %75)'), h('div', { class: 'cards' }, [['LCP (ms)', s.perf.lcpP75 == null ? '—' : Math.round(s.perf.lcpP75)], ['CLS', s.perf.clsP75 == null ? '—' : s.perf.clsP75.toFixed(3)], ['Ort. etkileşim (sn)', s.perf.avgEngagementSec == null ? '—' : Math.round(s.perf.avgEngagementSec)], ['WebGL hatası', s.perf.webglFailures + ' / ' + s.perf.samples]].map(([l, v]) => h('div', { class: 'card' }, h('small', { class: 'mut' }, l.toUpperCase()), h('b', {}, v)))),
    h('h3', {}, 'JavaScript hataları'), table(['Mesaj', 'Adet'], s.errorList.map(r => [r.msg, r.n])),
    h('div', { class: 'row' }, h('div', {}, h('h3', {}, 'Cihazlar'), table(['Cihaz', 'Ziyaretçi'], s.devices.map(r => [r.k, r.n]))), h('div', {}, h('h3', {}, 'Kaynaklar'), table(['Tür', 'Alan adı', 'Ziyaretçi'], s.referrers.map(r => [r.cat, r.host || '—', r.n])))));
};
VIEWS['Denetim'] = async el => {
  const [rows, v] = await Promise.all([api('/audit'), api('/audit/verify')]);
  el.append(h('h2', {}, 'Denetim günlüğü'), h('p', { class: v.ok ? 'up' : 'dn' }, v.ok ? `Zincir sağlam (${v.count} kayıt).` : `ZİNCİR BOZUK — kayıt ${v.brokenAt}.`), table(['Zaman', 'Kullanıcı', 'İşlem', 'Kaynak', 'Sonuç'], rows.map(r => [fmt(r.ts), r.actor || '—', r.action, r.resource || '—', r.outcome])));
};
VIEWS['Güvenlik'] = async el => {
  const ss = await api('/sessions'), lg = await api('/logins').catch(() => []);
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password' });
  el.append(h('h2', {}, 'Güvenlik'), h('h3', {}, 'Parolayı değiştir'), h('div', { style: 'max-width:360px' }, h('label', { class: 'f' }, h('span', {}, 'Mevcut parola'), cur), h('label', { class: 'f' }, h('span', {}, 'Yeni parola (en az 12 karakter)'), nw),
    h('button', { onclick: async () => { try { await api('/password', { body: { current: cur.value, next: nw.value } }); cur.value = nw.value = ''; toast('Parola değişti, diğer oturumlar kapatıldı.'); } catch (e) { toast(msg(e), true); } } }, 'KAYDET')),
    h('h3', {}, 'Açık oturumlar'), table(['Başlangıç', 'Son görülme', 'Cihaz', ''], ss.map(s => [fmt(s.created_at), fmt(s.last_seen), (s.ua || '').slice(0, 60), s.current ? 'bu oturum' : ''])),
    h('button', { onclick: async () => { const r = await api('/sessions/revoke-others', { body: {} }); toast(`${r.revoked} oturum kapatıldı.`); show('Güvenlik'); } }, 'DİĞER TÜM OTURUMLARI KAPAT'),
    h('h3', {}, 'Giriş geçmişi'), table(['Zaman', 'Kullanıcı', 'Sonuç'], lg.map(l => [fmt(l.ts), l.username, l.ok ? 'başarılı' : 'BAŞARISIZ'])));
};
