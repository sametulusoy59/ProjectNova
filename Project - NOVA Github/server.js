'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { open } = require('./lib/db');
require('./lib/env').load(path.join(__dirname, '.env'));
const S = require('./lib/security'), crypto = require('node:crypto');
const mail = require('./lib/mail'), totp = require('./lib/totp'), netguard = require('./lib/netguard'), { makeBackup, listBackups } = require('./lib/backup'), { injectIndex, cleanTheme, cleanSeo } = require('./lib/inject');

const KEYS = new Set(['site', 'projects', 'skills', 'experience', 'theme', 'seo']);
const EVENTS = new Set(['session_start', 'page_view', 'section_view', 'nav_click', 'project_click', 'project_open', 'link_click',
  'contact_click', 'cv_download', 'lang_switch', 'cta_click', 'scroll_depth', 'engagement', 'scene_transition', 'core_interact', 'js_error', 'perf', 'click_pos', 'star_submit', 'cli_command', 'sky_view']);
const CLICKS = ['star_submit', 'nav_click', 'project_click', 'project_open', 'link_click', 'contact_click', 'cv_download', 'cta_click'];
const PERM = { owner: ['content', 'analytics', 'audit', 'security'], editor: ['content', 'analytics'], viewer: ['analytics'] };
const FUNNEL_DEFAULT = [{ label: 'Ziyaret', name: 'session_start' }, { label: 'Hakkında bölümü', name: 'section_view', section: 'about' }, { label: 'Projeler bölümü', name: 'section_view', section: 'projects' },
  { label: 'Proje tıklaması', name: 'project_click' }, { label: 'İletişim bölümü', name: 'section_view', section: 'contact' }, { label: 'İletişim / CV tıklaması', names: ['contact_click', 'cv_download'] }];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.mjs': 'text/javascript; charset=utf-8', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };
// The public site uses inline scripts/styles + cdnjs + Google Fonts (see audit). Admin UI is strict: no inline code at all.
const CSP_SITE = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const CSP_ADMIN = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const VENDOR = [['three.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'], ['gsap.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js'], ['ScrollTrigger.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js']];
const httpErr = (code, msg) => Object.assign(new Error(msg), { code });

function defaultDataDir() {   // ./data if writable, otherwise ~/nova-data (some hosts mount the app folder read-only)
  const local = path.join(__dirname, 'data');
  try { fs.mkdirSync(local, { recursive: true }); fs.accessSync(local, fs.constants.W_OK); return local; }
  catch { return path.join(require('node:os').homedir(), 'nova-data'); }
}

function createApp(opts = {}) {
  const cfg = {
    dir: process.env.DATA_DIR || defaultDataDir(), secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
    origin: process.env.PUBLIC_ORIGIN || '', retentionDays: +process.env.ANALYTICS_RETENTION_DAYS || 90, sessionHours: +process.env.SESSION_HOURS || 12,
    idleMin: +process.env.SESSION_IDLE_MIN || 120, trustProxy: process.env.TRUST_PROXY === 'true', respectDnt: process.env.RESPECT_DNT !== 'false', maxUpload: (+process.env.MAX_UPLOAD_MB || 5) * 1048576, ...opts,
  };
  const db = open(cfg.dir), secret = S.loadSecret(cfg.dir);
  const COOKIE = cfg.secure ? '__Host-nova_sid' : 'nova_sid';
  const q = (sql, ...a) => db.prepare(sql).all(...a), one = (sql, ...a) => db.prepare(sql).get(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
  // ---- first-run setup, site defaults, media ---------------------------------------------------------------------
  const needSetup = () => !one('SELECT 1 x FROM users LIMIT 1');
  let setupToken = cfg.setupToken || process.env.SETUP_TOKEN || null;
  if (needSetup()) { setupToken ||= S.rand(18); if (!cfg.quiet) console.log(`[nova] FIRST RUN -> open /admin/ and create the owner account. Setup token: ${setupToken}`); }
  const MEDIA = path.join(cfg.dir, 'media'); fs.mkdirSync(MEDIA, { recursive: true, mode: 0o700 });
  let DEFAULTS = {};
  try {   // the site's built-in content becomes the editor's starting point, so nothing has to be retyped
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'), m = /const DATA=(\{[\s\S]*?\n\});\s*\nconst I18N/.exec(html);
    const d = require('node:vm').runInNewContext('(' + m[1] + ')', {}, { timeout: 1000 });
    DEFAULTS = { site: { title: '', description: '', profile: d.profile, contact: d.contact }, projects: d.projects, skills: d.skills, experience: d.exp, theme: cleanTheme({}), seo: cleanSeo({}) };
  } catch (e) { console.error('[nova] could not extract site defaults:', e.message); }
  function sniff(b) {
    if (b.length > 16 && b.toString('latin1', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', pdf: true };   // real content-type detection by magic bytes (never trust the extension or header); SVG is deliberately NOT allowed
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') return { mime: 'image/png', ext: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const mk = b[i + 1];
        if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0xff) { i += mk === 0xff ? 1 : 2; continue; }
        if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) return { mime: 'image/jpeg', ext: 'jpg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const t = b.toString('ascii', 12, 16), o = { mime: 'image/webp', ext: 'webp' };
      if (t === 'VP8X') return { ...o, w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (t === 'VP8 ') return { ...o, w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (t === 'VP8L') { const v = b.readUInt32LE(21); return { ...o, w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    }
    return null;
  }
  const byUser = new S.Limiter(5, 15 * 60e3), byIp = new S.Limiter(20, 15 * 60e3), collectLim = new S.Limiter(120, 60e3), apiLim = new S.Limiter(600, 60e3), starLim = new S.Limiter(3, 60 * 60e3), starDay = new S.Limiter(40, 24 * 3600e3), msgLim = new S.Limiter(3, 60 * 60e3), msgDay = new S.Limiter(60, 24 * 3600e3);
  const MAIL = mail.config(cfg.env || process.env);
  const notify = (subject, text, replyTo) => { if (!MAIL.ok || cfg.quiet && !cfg.mailInTests) return; mail.send(MAIL, { subject, text, replyTo }).catch(e => console.error('[nova] notification e-mail failed:', e.message)); };
  const audit = (actor, action, resource, outcome, detail) => S.auditLog(db, actor, action, resource, outcome, detail);
  const now = () => Date.now();
  const ipOf = req => (cfg.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const ipHash = req => S.sha(secret + ipOf(req)).slice(0, 16);   // never store raw IPs
  const dailySalt = () => S.sha(secret + Math.floor(now() / 864e5));
  const getRow = (key, draft) => { const r = one('SELECT draft,published FROM content WHERE key=?', key), t = r && (draft ? r.draft : r.published); return t ? JSON.parse(t) : null; };
  const getSet = (k, d) => { const r = one('SELECT value FROM settings WHERE key=?', k); try { return r ? JSON.parse(r.value) : d; } catch { return d; } };
  const setSet = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v));
  const OPS = () => ({ retentionDays: cfg.retentionDays, analytics: true, lcp: 2500, cls: 0.1, errors: 5, ...getSet('ops', {}) });
  function totpOk(user, code) {
    try {
      const sec = totp.unseal(user.totp, secret), step = totp.verify(sec, code, user.totp_last);
      if (step) { run('UPDATE users SET totp_last=? WHERE id=?', step, user.id); return true; }
      const h = S.sha(code.toLowerCase().replace(/[\s-]/g, '')), list = JSON.parse(user.recovery || '[]');
      if (list.includes(h)) { run('UPDATE users SET recovery=? WHERE id=?', JSON.stringify(list.filter(x => x !== h)), user.id); return true; }
    } catch { /* fall through */ }
    return false;
  }
  function cleanFunnel(a) {
    if (!Array.isArray(a) || a.length < 1 || a.length > 8) throw httpErr(422, 'bad_funnel');
    return a.map(st => {
      const names = (Array.isArray(st.names) ? st.names : [st.name]).filter(n => EVENTS.has(n)); if (!names.length) throw httpErr(422, 'bad_funnel_event');
      return { label: String(st.label || names[0]).replace(/[\u0000-\u001f<>]/g, '').slice(0, 40), ...(names.length > 1 ? { names } : { name: names[0] }), ...(/^[a-z]{2,20}$/.test(st.section || '') ? { section: st.section } : {}), ...(st.el ? { el: String(st.el).slice(0, 80) } : {}) };
    });
  }
  const csvCell = v => { let t = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };   // neutralises spreadsheet formula injection
  const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => { const i = c.indexOf('='); return i < 0 ? [] : [c.slice(0, i).trim(), c.slice(i + 1).trim()]; }).filter(a => a.length));

  function headers(res, csp) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY'); if (csp) res.setHeader('Content-Security-Policy', csp);
    if (cfg.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  const json = (res, code, obj, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(obj)); };
  function body(req, limit) {
    return new Promise((ok, no) => {
      const ct = String(req.headers['content-type'] || '');
      if (!/^(application\/json|text\/plain)/i.test(ct)) return no(httpErr(415, 'unsupported_media_type'));
      let n = 0, over = false; const ch = [];
      req.on('data', c => { n += c.length; if (n > limit) { over = true; if (n > limit * 4) req.destroy(); } else ch.push(c); });   // drain, then answer 413 (a reset looks like a network error to clients)
      req.on('end', () => { if (over) return no(httpErr(413, 'too_large')); try { ok(n ? JSON.parse(Buffer.concat(ch).toString('utf8')) : {}); } catch { no(httpErr(400, 'bad_json')); } });
      req.on('error', no);
    });
  }
  function raw(req, limit) {
    return new Promise((ok, no) => { let n = 0, over = false; const ch = []; req.on('data', c => { n += c.length; if (n > limit) { over = true; if (n > limit * 4) req.destroy(); } else ch.push(c); }); req.on('end', () => (over ? no(httpErr(413, 'too_large')) : ok(Buffer.concat(ch)))); req.on('error', no); });
  }
  const sameOrigin = req => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host || (cfg.origin && o === cfg.origin); } catch { return false; } };

  // ---- sessions -------------------------------------------------------------------------------------------------
  function newSession(user, req) {
    const tok = S.rand(32), csrf = S.rand(24), t = now();
    run('INSERT INTO sessions(id,user_id,csrf,created_at,last_seen,expires_at,ua,ip_hash) VALUES(?,?,?,?,?,?,?,?)', S.sha(tok), user.id, csrf, t, t,
      t + cfg.sessionHours * 3600e3, String(req.headers['user-agent'] || '').slice(0, 200), ipHash(req));
    return { tok, csrf };
  }
  function getSession(req) {
    const tok = cookies(req)[COOKIE]; if (!tok) return null;
    const id = S.sha(tok);
    const s = one('SELECT s.id,s.csrf,s.last_seen,s.expires_at,u.id uid,u.username,u.role,u.disabled FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?', id);
    if (!s) return null;
    const t = now();
    if (s.disabled || s.expires_at < t || t - s.last_seen > cfg.idleMin * 60e3) { run('DELETE FROM sessions WHERE id=?', id); return null; }
    if (t - s.last_seen > 60e3) run('UPDATE sessions SET last_seen=? WHERE id=?', t, id);
    return s;
  }
  const setCookie = (tok, maxAge) => `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${cfg.secure ? '; Secure' : ''}`;
  const allow = (s, perm) => (PERM[s.role] || []).includes(perm);
  function guard(req, res, perm, mutating) {   // server-side authN + authZ + CSRF on every protected endpoint
    const s = getSession(req);
    if (!s) { json(res, 401, { error: 'unauthenticated' }); return null; }
    if (perm && !allow(s, perm)) { audit(s.username, 'access', req.url.split('?')[0], 'denied'); json(res, 403, { error: 'forbidden' }); return null; }
    if (mutating && (!sameOrigin(req) || !S.safeEq(req.headers['x-csrf-token'] || '', s.csrf))) { json(res, 403, { error: 'csrf' }); return null; }
    return s;
  }

  // ---- content --------------------------------------------------------------------------------------------------
  function validate(key, b) {
    let nodes = 0;
    const walk = (v, k, d) => {
      if (++nodes > 5000 || d > 8) throw httpErr(422, 'too_complex');
      if (typeof v === 'string') {
        if (v.length > 5000) throw httpErr(422, `string_too_long:${k}`);
        if (/(^|_)(url|live|code|href|src|link|cv|image|gallery|github|linkedin|canonical)$/i.test(k || '') && v && !/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(v)) throw httpErr(422, `unsafe_url:${k}`);
        if (k === 'email' && v && !/^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/.test(v)) throw httpErr(422, 'bad_email');
      } else if (Array.isArray(v)) v.forEach(x => walk(x, k, d + 1));
      else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) { if (['__proto__', 'constructor', 'prototype'].includes(kk)) throw httpErr(422, 'forbidden_key'); walk(vv, kk, d + 1); }
      else if (v !== null && !['number', 'boolean'].includes(typeof v)) throw httpErr(422, 'bad_type');
    };
    if (['projects', 'skills', 'experience'].includes(key) && !Array.isArray(b)) throw httpErr(422, `${key}_must_be_array`);
    if (b === null || typeof b !== 'object') throw httpErr(422, 'object_or_array_required');
    walk(b, '', 0);
    if (key === 'funnel') cleanFunnel(b);
  }
  const revision = (key, text, who, kind) => {
    run('INSERT INTO revisions(key,body,author,ts,kind) VALUES(?,?,?,?,?)', key, text, who, now(), kind);
    run('DELETE FROM revisions WHERE key=? AND id NOT IN (SELECT id FROM revisions WHERE key=? ORDER BY id DESC LIMIT 100)', key, key);
  };

  // ---- analytics ------------------------------------------------------------------------------------------------
  const str = (v, n = 80) => (typeof v === 'string' && v ? v.replace(/[\u0000-\u001f]/g, '').slice(0, n) : null);
  function refInfo(ref, host) {
    if (!ref) return ['direct', null];
    let h; try { h = new URL(ref).hostname.replace(/^www\./, ''); } catch { return ['other', null]; }
    if (h === String(host).split(':')[0].replace(/^www\./, '')) return ['internal', h];
    if (/(^|\.)(google|bing|duckduckgo|yandex|yahoo|ecosia|baidu|brave)\./.test(h)) return ['search', h];
    if (/(^|\.)(twitter\.com|x\.com|t\.co|facebook\.com|instagram\.com|linkedin\.com|lnkd\.in|reddit\.com|youtube\.com|tiktok\.com|github\.com|medium\.com|t\.me|whatsapp\.com)$/.test(h)) return ['social', h];
    return ['other', h];
  }
  function ua(u = '') {
    const br = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Other';
    const os = /Windows/.test(u) ? 'Windows' : /Android/.test(u) ? 'Android' : /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Mac OS/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : 'Other';
    const dev = /iPad|Tablet/.test(u) ? 'tablet' : /Mobi|Android|iPhone/.test(u) ? 'mobile' : 'desktop';
    return { br, os, dev };
  }
  async function collect(req, res) {
    if (OPS().analytics === false) return json(res, 202, { stored: 0, reason: 'disabled' });
    if (cfg.respectDnt && req.headers.dnt === '1') return json(res, 202, { stored: 0, reason: 'dnt' });
    if (!collectLim.hit(ipHash(req))) return json(res, 429, { error: 'rate_limited' });
    const b = await body(req, 16384);
    if (b.consent !== true) return json(res, 202, { stored: 0, reason: 'no_consent' });   // server enforces consent, not just the client
    const sid = String(b.sid || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(sid)) throw httpErr(400, 'bad_sid');
    const sh = S.sha(dailySalt() + sid).slice(0, 24);                                       // rotates daily: no cross-day tracking
    const u = ua(req.headers['user-agent']), country = str(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'], 2);
    const dev = ['desktop', 'tablet', 'mobile'].includes(b.dev) ? b.dev : u.dev, lang = ['tr', 'en'].includes(b.lang) ? b.lang : null;
    let n = 0;
    db.exec('BEGIN');
    try {
      for (const e of (Array.isArray(b.events) ? b.events : []).slice(0, 20)) {
        if (!e || !EVENTS.has(e.name)) continue;
        let meta = null;
        if (e.meta && typeof e.meta === 'object') {
          const m = {};
          for (const [k, v] of Object.entries(e.meta).slice(0, 8)) if (/^[a-z_]{1,24}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) m[k] = typeof v === 'string' ? v.slice(0, 80) : v;
          meta = Object.keys(m).length ? JSON.stringify(m) : null;
        }
        const [rc, rh] = e.name === 'session_start' || e.name === 'page_view' ? refInfo(str(e.ref, 300), req.headers.host) : [null, null];
        run('INSERT INTO events(ts,sid,name,section,el,cat,ref,rhost,device,br,os,lang,country,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          now(), sh, e.name, str(e.section, 40), str(e.el, 80), str(e.cat, 40), rc, rh, dev, u.br, u.os, lang, country, meta);
        n++;
      }
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    return json(res, 202, { stored: n });
  }
  function withEv(days, device, fn) {   // one filtered temp table => every query shares the same window and device filter
    db.exec('DROP TABLE IF EXISTS temp.evf');
    db.prepare(`CREATE TEMP TABLE evf AS SELECT * FROM events WHERE ts>=? ${device ? 'AND device=?' : ''}`).run(...(device ? [now() - days * 864e5 * 2, device] : [now() - days * 864e5 * 2]));
    try { return fn(); } finally { db.exec('DROP TABLE IF EXISTS temp.evf'); }
  }
  function summary(days, device) { return withEv(days, device, () => {
    const to = now(), from = to - days * 864e5, pf = from - days * 864e5;
    const tot = (a, b) => one(`SELECT COUNT(*) events, COALESCE(SUM(name='page_view'),0) pageViews, COUNT(DISTINCT sid) visitors, COALESCE(SUM(name='js_error'),0) errors FROM evf WHERE ts>=? AND ts<?`, a, b);
    const inList = CLICKS.map(c => `'${c}'`).join(',');
    const pv = k => q(`SELECT CAST(json_extract(meta,'$.${k}') AS REAL) v FROM evf WHERE ts>=? AND name='perf' AND json_extract(meta,'$.${k}') IS NOT NULL ORDER BY v`, from).map(r => r.v);
    const p75 = a => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.75))] : null);
    const wg = one(`SELECT COUNT(*) n, COALESCE(SUM(json_extract(meta,'$.webgl')=0),0) bad FROM evf WHERE ts>=? AND name='perf'`, from);
    return {
      days, from, to, note: 'visitors = distinct daily-rotating anonymous IDs; a person visiting on 3 days counts 3 times (by design, for privacy).',
      current: tot(from, to), previous: tot(pf, from),
      daily: q(`SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch') d, COALESCE(SUM(name='page_view'),0) pageViews, COUNT(DISTINCT sid) visitors FROM evf WHERE ts>=? GROUP BY d ORDER BY d`, from),
      topElements: q(`SELECT el, name, COUNT(*) n FROM evf WHERE ts>=? AND el IS NOT NULL AND name IN (${inList}) GROUP BY el,name ORDER BY n DESC LIMIT 20`, from),
      sections: q(`SELECT section, COUNT(DISTINCT sid) reach FROM evf WHERE ts>=? AND name='section_view' AND section IS NOT NULL GROUP BY section ORDER BY reach DESC`, from),
      scroll: q(`SELECT json_extract(meta,'$.pct') pct, COUNT(*) n FROM evf WHERE ts>=? AND name='scroll_depth' GROUP BY pct ORDER BY pct`, from),
      devices: q(`SELECT device k, COUNT(DISTINCT sid) n FROM evf WHERE ts>=? GROUP BY device ORDER BY n DESC`, from),
      browsers: q(`SELECT br k, COUNT(DISTINCT sid) n FROM evf WHERE ts>=? GROUP BY br ORDER BY n DESC`, from),
      referrers: q(`SELECT ref cat, rhost host, COUNT(DISTINCT sid) n FROM evf WHERE ts>=? AND ref IS NOT NULL GROUP BY ref,rhost ORDER BY n DESC LIMIT 20`, from),
      perf: { samples: wg.n, lcpP75: p75(pv('lcp')), clsP75: p75(pv('cls')), webglFailures: wg.bad,
        avgEngagementSec: (one(`SELECT AVG(json_extract(meta,'$.sec')) a FROM evf WHERE ts>=? AND name='engagement'`, from) || {}).a },
      errorList: q(`SELECT json_extract(meta,'$.msg') msg, COUNT(*) n FROM evf WHERE ts>=? AND name='js_error' GROUP BY msg ORDER BY n DESC LIMIT 10`, from),
      exits: q(`SELECT section, COUNT(*) n FROM (SELECT e.sid, (SELECT e2.section FROM evf e2 WHERE e2.sid=e.sid AND e2.name='section_view' AND e2.ts>=? ORDER BY e2.id DESC LIMIT 1) section FROM evf e WHERE e.ts>=? GROUP BY e.sid) WHERE section IS NOT NULL GROUP BY section ORDER BY n DESC`, from, from),
      elements: q(`SELECT el, name, COUNT(*) n FROM evf WHERE ts>=? AND el IS NOT NULL AND name IN (${inList}) GROUP BY el,name ORDER BY n DESC LIMIT 200`, from),
      sourceEngagement: q(`SELECT s.ref cat, COUNT(DISTINCT s.sid) visitors, AVG(g.sec) avgSec, SUM(c.sid IS NOT NULL) contacted FROM evf s LEFT JOIN (SELECT sid, MAX(json_extract(meta,'$.sec')) sec FROM evf WHERE name='engagement' AND ts>=? GROUP BY sid) g ON g.sid=s.sid LEFT JOIN (SELECT DISTINCT sid FROM evf WHERE name IN ('contact_click','cv_download') AND ts>=?) c ON c.sid=s.sid WHERE s.name='session_start' AND s.ts>=? GROUP BY s.ref ORDER BY visitors DESC`, from, from, from),
      languages: q(`SELECT lang k, COUNT(DISTINCT sid) n FROM evf WHERE ts>=? AND lang IS NOT NULL GROUP BY lang`, from),
      countries: q(`SELECT country k, COUNT(DISTINCT sid) n FROM evf WHERE ts>=? AND country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 20`, from),
    }; });
  }
  function funnel(days, device) {
    const steps = getSet('funnel', null) || FUNNEL_DEFAULT;
    return withEv(days, device, () => {
      const from = now() - days * 864e5; let prev = null, first = 0; const out = [];
      for (const st of steps) {
        const names = st.names || [st.name], where = ['ts>=?', `name IN (${names.map(() => '?').join(',')})`], args = [from, ...names];
        if (st.section) { where.push('section=?'); args.push(st.section); } if (st.el) { where.push('el=?'); args.push(st.el); }
        let ids = new Set(q(`SELECT DISTINCT sid FROM evf WHERE ${where.join(' AND ')} LIMIT 100000`, ...args).map(r => r.sid));
        if (prev) ids = new Set([...ids].filter(x => prev.has(x)));
        if (!out.length) first = ids.size;
        out.push({ label: st.label, count: ids.size, fromPrev: out.length ? (prev.size ? Math.round(ids.size / prev.size * 100) : 0) : 100, fromStart: first ? Math.round(ids.size / first * 100) : 0 });
        prev = ids;
      }
      return { days, device: device || 'all', steps: out, config: steps, note: 'Each step counts visitors (same-day anonymous IDs) who also completed every earlier step. A click shows interest, not a real-world outcome.' };
    });
  }
  function heat(days, device, bucket) {
    return withEv(days, device, () => {
      const args = [now() - days * 864e5]; let bk = '';
      if (bucket !== null) { bk = "AND CAST(json_extract(meta,'$.b') AS INT)=?"; args.push(bucket); }
      const cells = q(`SELECT CAST(json_extract(meta,'$.x') AS INT)/25 gx, CAST(json_extract(meta,'$.y') AS INT)/42 gy, COUNT(*) n FROM evf WHERE name='click_pos' AND ts>=? ${bk} AND CAST(json_extract(meta,'$.x') AS INT) BETWEEN 0 AND 999 AND CAST(json_extract(meta,'$.y') AS INT) BETWEEN 0 AND 999 GROUP BY gx,gy`, ...args);
      return { w: 40, h: 24, total: cells.reduce((t, c) => t + c.n, 0), cells: cells.map(c => [c.gx, c.gy, c.n]) };
    });
  }
  function alerts() {
    const o = OPS(), out = [], day = 864e5, t = now(), add = (level, title, detail) => out.push({ level, title, detail });
    const fails = one('SELECT COUNT(*) n FROM login_events WHERE ok=0 AND ts>=?', t - day).n; if (fails >= 5) add('warn', 'Başarısız giriş denemeleri', `Son 24 saatte ${fails} başarısız giriş.`);
    const errs = one(`SELECT COUNT(*) n FROM events WHERE name='js_error' AND ts>=?`, t - day).n; if (errs >= o.errors) add('warn', 'JavaScript hataları', `Son 24 saatte ${errs} hata (eşik ${o.errors}).`);
    const perf = k => q(`SELECT CAST(json_extract(meta,'$.${k}') AS REAL) v FROM events WHERE name='perf' AND ts>=? AND json_extract(meta,'$.${k}') IS NOT NULL ORDER BY v`, t - 7 * day).map(r => r.v);
    const p75 = a => (a.length >= 10 ? a[Math.floor(a.length * 0.75)] : null), lcp = p75(perf('lcp')), cls = p75(perf('cls'));
    if (lcp != null && lcp > o.lcp) add('warn', 'Yavaş yükleme (LCP)', `%75 ziyaretçide ${Math.round(lcp)} ms (eşik ${o.lcp} ms).`);
    if (cls != null && cls > o.cls) add('warn', 'Yerleşim kayması (CLS)', `%75 ziyaretçide ${cls.toFixed(3)} (eşik ${o.cls}).`);
    const today = one(`SELECT COUNT(*) n FROM events WHERE name='page_view' AND ts>=?`, t - day).n, before = one(`SELECT COUNT(*) n FROM events WHERE name='page_view' AND ts>=? AND ts<?`, t - 8 * day, t - day).n / 7;
    if (today >= 20 && today > before * 3) add('info', 'Trafik artışı', `Son 24 saatte ${today} görüntüleme (önceki 7 gün ortalaması ${Math.round(before)}).`);
    const bk = listBackups(cfg.dir)[0]; if (!bk || t - bk.ts > 7 * day) add('warn', 'Yedek yok / eski', bk ? 'Son yedek 7 günden eski.' : 'Henüz hiç yedek alınmadı. Ayarlar sayfasından alın.');
    if (!one('SELECT 1 x FROM content WHERE published IS NOT NULL LIMIT 1')) add('info', 'İçerik yayınlanmadı', 'Site şu an yerleşik içeriği gösteriyor. İçerik sayfasından yayınlayın.');
    if (one("SELECT 1 x FROM users WHERE role='owner' AND totp_on=0 AND disabled=0 LIMIT 1")) add('info', 'İki adımlı doğrulama kapalı', 'Güvenlik sayfasından 2FA etkinleştirmeniz önerilir.');
    const lc = getSet('linkcheck', null); if (lc && lc.results.some(r => !r.ok)) add('warn', 'Kırık bağlantılar', `${lc.results.filter(r => !r.ok).length} bağlantı erişilemedi (son kontrol ${new Date(lc.ts).toLocaleDateString('tr-TR')}).`);
    if (o.analytics === false) add('info', 'Analitik kapalı', 'Ziyaretçi analitiği genel olarak kapatılmış.');
    return out;
  }
  function seoCheck() {
    const site = getRow('site', false) || getRow('site', true) || {}, seo = cleanSeo(getRow('seo', false) || getRow('seo', true) || {}), projects = getRow('projects', false) || getRow('projects', true) || [], out = [];
    const add = (level, msg) => out.push({ level, msg }), title = site.title || '', desc = site.description || '';
    if (!title) add('warn', 'Sayfa başlığı girilmemiş (yerleşik başlık kullanılıyor).'); else if (title.length > 60) add('warn', `Başlık ${title.length} karakter; arama sonuçlarında ~60 karakterden sonrası kesilir.`);
    if (!desc) add('warn', 'Açıklama (meta description) girilmemiş.'); else if (desc.length < 50 || desc.length > 160) add('warn', `Açıklama ${desc.length} karakter; 50–160 arası önerilir.`);
    if (!cfg.origin && !seo.canonical) add('warn', 'Kanonik adres yok: PUBLIC_ORIGIN ayarlanmamış ve SEO sayfasında kanonik girilmemiş (sitemap.xml de üretilemez).');
    else if (cfg.origin && !cfg.origin.startsWith('https://')) add('warn', 'PUBLIC_ORIGIN https:// ile başlamıyor.');
    if (!seo.ogImage) add('warn', 'Sosyal paylaşım görseli (og:image) seçilmemiş.');
    if (seo.robots === 'noindex') add('warn', 'Arama motorlarına kapalı (noindex) — yayına çıkarken "index" yapın.');
    const noAlt = one("SELECT COUNT(*) n FROM media WHERE alt='' AND mime LIKE 'image/%'").n; if (noAlt) add('warn', `${noAlt} medya dosyasının alt metni boş.`);
    const pAlt = projects.filter(p => p && p.image && !p.imageAlt).length; if (pAlt) add('warn', `${pAlt} projenin kapak görselinde alt metin yok.`);
    const noLink = projects.filter(p => p && !p.hidden && !p.live && !p.code).length; if (noLink) add('info', `${noLink} projede ne canlı demo ne kaynak kod bağlantısı var.`);
    if (!out.some(x => x.level === 'warn')) add('ok', 'Temel SEO kontrolleri temiz.');
    return out;
  }
  function purge() {
    run('DELETE FROM events WHERE ts<?', now() - OPS().retentionDays * 864e5); run('DELETE FROM login_events WHERE ts<?', now() - 180 * 864e5);
    run('DELETE FROM sessions WHERE expires_at<?', now());
  }
  purge();
  const timer = setInterval(() => { purge(); [byUser, byIp, collectLim, apiLim].forEach(l => l.sweep()); }, 3600e3); timer.unref();

  // ---- static ---------------------------------------------------------------------------------------------------
  function serve(req, res, root, rel, csp, noStore) {
    try { rel = decodeURIComponent(rel); } catch { return json(res, 400, { error: 'bad_path' }); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep) || path.basename(file).startsWith('.') || !MIME[path.extname(file)]) return json(res, 404, { error: 'not_found' });
    fs.stat(file, (e, st) => {
      if (e || !st.isFile()) return json(res, 404, { error: 'not_found' });
      headers(res, csp);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)], 'cache-control': noStore || file.endsWith('.html') ? 'no-cache' : 'public, max-age=86400' });
      req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res);
    });
  }

  // ---- router ---------------------------------------------------------------------------------------------------
  let linkRunning = false;
  async function route(req, res) {
    const u = new URL(req.url, 'http://x'), p = u.pathname, m = req.method;
    if (p.startsWith('/api/')) {
      headers(res, "default-src 'none'");
      if (!apiLim.hit(ipHash(req))) return json(res, 429, { error: 'rate_limited' });
      if (p === '/api/health') return json(res, 200, { ok: true });
      if (p === '/api/collect' && m === 'POST') return collect(req, res);
      if (p === '/api/public/content' && m === 'GET') {
        const out = {}; for (const r of q('SELECT key,published FROM content WHERE published IS NOT NULL')) out[r.key] = JSON.parse(r.published);
        return json(res, 200, out, { 'cache-control': 'public, max-age=30' });
      }
      // ---- visitor stars: public submit (moderated), public list (approved only), admin moderation ----------------
      if (p === '/api/stars' && m === 'GET') {
        if (getRow('theme', false)?.visitorStars === false) return json(res, 200, [], { 'cache-control': 'public, max-age=60' });
        return json(res, 200, q("SELECT id,name,msg,hue,strftime('%Y-%m-%d',ts/1000,'unixepoch') day FROM stars WHERE status='approved' ORDER BY id DESC LIMIT 300"), { 'cache-control': 'public, max-age=60' });
      }
      if (p === '/api/stars' && m === 'POST') {
        if (!req.headers.origin || !sameOrigin(req)) return json(res, 403, { error: 'bad_origin' });   // browsers always send Origin on a POST fetch
        if (getRow('theme', false)?.visitorStars === false) return json(res, 403, { error: 'disabled' });
        const b = await body(req, 4096);
        if (b.consent !== true) return json(res, 422, { error: 'consent_required' });
        if (b.web) return json(res, 202, { ok: true, status: 'pending' });   // honeypot: pretend success, store nothing
        const clean = (v, n) => (typeof v === 'string' ? v.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069<>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n) : '');
        const name = clean(b.name, 24), text = clean(b.msg, 90), hue = Number.isInteger(b.hue) && b.hue >= 0 && b.hue < 360 ? b.hue : 190;
        if (name.length < 2) return json(res, 422, { error: 'name_required' });
        if (/(https?:|www\.|\.(com|net|org|io|ru|xyz|top)\b|@)/i.test(name + ' ' + text)) return json(res, 422, { error: 'no_links' });
        if (!starLim.hit(ipHash(req)) || !starDay.hit('all')) return json(res, 429, { error: 'rate_limited' });
        if ((one("SELECT COUNT(*) n FROM stars WHERE status='pending'") || {}).n >= 500) return json(res, 429, { error: 'queue_full' });
        run('INSERT INTO stars(ts,name,msg,hue) VALUES(?,?,?,?)', now(), name, text, hue);   // no IP, no cookie, no e-mail is stored with a star
        notify('NOVA · yeni yıldız onay bekliyor', `${name}${text ? ' — ' + text : ''}\n\nOnaylamak için: ${(cfg.origin || '').replace(/\/$/, '')}/admin/  →  Yıldızlar`);
        return json(res, 202, { ok: true, status: 'pending' });
      }
      if (p === '/api/admin/stars' && m === 'GET') {
        const s = guard(req, res, 'content'); if (!s) return;
        run("DELETE FROM stars WHERE status='rejected' AND decided_at<?", now() - 30 * 864e5);   // rejected submissions are kept 30 days at most
        return json(res, 200, q("SELECT id,ts,name,msg,hue,status,decided_by,decided_at FROM stars ORDER BY status='pending' DESC, id DESC LIMIT 500"));
      }
      const sm = /^\/api\/admin\/stars\/(\d{1,9})(?:\/(approve|reject))?$/.exec(p);
      if (sm) {
        const s = guard(req, res, 'content', true); if (!s) return;
        const id = +sm[1], row = one('SELECT id,name FROM stars WHERE id=?', id); if (!row) return json(res, 404, { error: 'not_found' });
        if (m === 'POST' && sm[2]) {
          const st = sm[2] === 'approve' ? 'approved' : 'rejected';
          run('UPDATE stars SET status=?,decided_by=?,decided_at=? WHERE id=?', st, s.username, now(), id); audit(s.username, 'star_' + sm[2], 'star:' + id, 'success');
          return json(res, 200, { ok: true, status: st });
        }
        if (m === 'DELETE' && !sm[2]) { run('DELETE FROM stars WHERE id=?', id); audit(s.username, 'star_delete', 'star:' + id, 'success'); return json(res, 200, { ok: true }); }
        return json(res, 405, { error: 'method_not_allowed' });
      }
      // ---- contact messages: public submit, admin inbox -----------------------------------------------------
      if (p === '/api/messages' && m === 'POST') {
        if (!req.headers.origin || !sameOrigin(req)) return json(res, 403, { error: 'bad_origin' });
        const b = await body(req, 8192);
        if (b.consent !== true) return json(res, 422, { error: 'consent_required' });
        if (b.web) return json(res, 202, { ok: true });   // honeypot
        const cl = (v, n) => (typeof v === 'string' ? v.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, n) : '');
        const name = cl(b.name, 60).replace(/\s+/g, ' '), email = mail.addr(cl(b.email, 120)), text = cl(b.body, 2000);
        if (name.length < 2) return json(res, 422, { error: 'name_required' });
        if (!email) return json(res, 422, { error: 'bad_email' });
        if (text.length < 10) return json(res, 422, { error: 'message_too_short' });
        if (!msgLim.hit(ipHash(req)) || !msgDay.hit('all')) return json(res, 429, { error: 'rate_limited' });
        run('INSERT INTO messages(ts,name,email,body) VALUES(?,?,?,?)', now(), name, email, text);
        notify(`NOVA · yeni mesaj: ${name}`, `${name} <${email}>\n\n${text}\n\n— ${(cfg.origin || '').replace(/\/$/, '')}/admin/  →  Mesajlar`, email);
        return json(res, 202, { ok: true });
      }
      if (p === '/api/admin/messages' && m === 'GET') {
        const s = guard(req, res, 'content'); if (!s) return;
        run('DELETE FROM messages WHERE ts<?', now() - 365 * 864e5);   // kept one year at most
        return json(res, 200, q('SELECT id,ts,name,email,body,read FROM messages ORDER BY id DESC LIMIT 500'));
      }
      const mg = /^\/api\/admin\/messages\/(\d{1,9})(?:\/(read|unread))?$/.exec(p);
      if (mg) {
        const s = guard(req, res, 'content', true); if (!s) return;
        const id = +mg[1]; if (!one('SELECT id FROM messages WHERE id=?', id)) return json(res, 404, { error: 'not_found' });
        if (m === 'POST' && mg[2]) { run('UPDATE messages SET read=? WHERE id=?', mg[2] === 'read' ? 1 : 0, id); return json(res, 200, { ok: true }); }
        if (m === 'DELETE' && !mg[2]) { run('DELETE FROM messages WHERE id=?', id); audit(s.username, 'message_delete', 'message:' + id, 'success'); return json(res, 200, { ok: true }); }
        return json(res, 405, { error: 'method_not_allowed' });
      }
      if (p === '/api/admin/badges' && m === 'GET') {
        const s = guard(req, res); if (!s) return;
        if (!allow(s, 'content')) return json(res, 200, { stars: 0, messages: 0, mail: MAIL.ok });
        return json(res, 200, { stars: one("SELECT COUNT(*) n FROM stars WHERE status='pending'").n, messages: one('SELECT COUNT(*) n FROM messages WHERE read=0').n, mail: MAIL.ok });
      }
      if (p === '/api/admin/login' && m === 'POST') {
        if (!sameOrigin(req)) return json(res, 403, { error: 'bad_origin' });
        const b = await body(req, 2048), name = String(b.username || '').toLowerCase().slice(0, 64), pw = String(b.password || '').slice(0, 256), ih = ipHash(req);
        if (byUser.blocked('u:' + name) || byIp.blocked('i:' + ih)) { audit(name, 'login', 'session', 'blocked'); return json(res, 429, { error: 'too_many_attempts' }, { 'retry-after': '900' }); }
        const user = one('SELECT * FROM users WHERE username=?', name);
        let ok = S.verifyPw(pw, user ? user.pw : S.dummyHash()) && !!user && !user.disabled, needCode = false;
        if (ok && user.totp_on) { const code = String(b.code || '').trim(); if (!code) needCode = true; else ok = totpOk(user, code); }
        run('INSERT INTO login_events(ts,username,ok,ip_hash,ua) VALUES(?,?,?,?,?)', now(), name.slice(0, 64), ok && !needCode ? 1 : 0, ih, String(req.headers['user-agent'] || '').slice(0, 200));
        if (needCode) return json(res, 401, { error: 'totp_required' });
        if (!ok) { byUser.add('u:' + name); byIp.add('i:' + ih); audit(name, 'login', 'session', 'failure'); return json(res, 401, { error: 'invalid_credentials' }); }
        byUser.reset('u:' + name);
        const { tok, csrf } = newSession(user, req); audit(user.username, 'login', 'session', 'success');
        return json(res, 200, { user: { username: user.username, role: user.role }, csrf }, { 'set-cookie': setCookie(tok, cfg.sessionHours * 3600) });
      }
      if (p === '/api/admin/logout' && m === 'POST') {
        const s = guard(req, res, null, true); if (!s) return;
        run('DELETE FROM sessions WHERE id=?', s.id); audit(s.username, 'logout', 'session', 'success');
        return json(res, 200, { ok: true }, { 'set-cookie': setCookie('', 0) });
      }
      if (p === '/api/admin/me' && m === 'GET') { const s = guard(req, res); if (s) json(res, 200, { user: { username: s.username, role: s.role }, csrf: s.csrf, permissions: PERM[s.role], totp: !!one('SELECT totp_on t FROM users WHERE id=?', s.uid).t }); return; }
      if (p === '/api/admin/password' && m === 'POST') {
        const s = guard(req, res, null, true); if (!s) return;
        const b = await body(req, 2048), user = one('SELECT * FROM users WHERE id=?', s.uid);
        if (!S.verifyPw(String(b.current || ''), user.pw)) { audit(s.username, 'password_change', 'user', 'failure'); return json(res, 403, { error: 'wrong_password' }); }
        const nw = String(b.next || ''); if (nw.length < 12 || nw.length > 256 || nw === b.current) return json(res, 422, { error: 'weak_password', rule: 'min 12 chars, different from current' });
        run('UPDATE users SET pw=? WHERE id=?', S.hashPw(nw), s.uid); run('DELETE FROM sessions WHERE user_id=? AND id<>?', s.uid, s.id);
        audit(s.username, 'password_change', 'user', 'success'); return json(res, 200, { ok: true });
      }
      if (p === '/api/admin/sessions' && m === 'GET') {
        const s = guard(req, res); if (!s) return;
        return json(res, 200, q('SELECT substr(id,1,10) handle, created_at, last_seen, ua, id=? AS current FROM sessions WHERE user_id=? ORDER BY last_seen DESC', s.id, s.uid));
      }
      if (p === '/api/admin/sessions/revoke-others' && m === 'POST') {
        const s = guard(req, res, null, true); if (!s) return;
        const r = run('DELETE FROM sessions WHERE user_id=? AND id<>?', s.uid, s.id); audit(s.username, 'sessions_revoke', 'session', 'success', { n: Number(r.changes) });
        return json(res, 200, { revoked: Number(r.changes) });
      }
      if (p === '/api/admin/logins' && m === 'GET') { const s = guard(req, res, 'security'); if (s) json(res, 200, q('SELECT ts,username,ok,ip_hash,ua FROM login_events ORDER BY id DESC LIMIT 100')); return; }
      if (p === '/api/admin/audit' && m === 'GET') { const s = guard(req, res, 'audit'); if (s) json(res, 200, q('SELECT id,ts,actor,action,resource,outcome,detail FROM audit ORDER BY id DESC LIMIT 200')); return; }
      if (p === '/api/admin/audit/verify' && m === 'GET') { const s = guard(req, res, 'audit'); if (s) json(res, 200, S.verifyAudit(db)); return; }
      if (p === '/api/admin/setup-status' && m === 'GET') return json(res, 200, { needed: needSetup() });
      if (p === '/api/admin/setup' && m === 'POST') {
        if (!sameOrigin(req)) return json(res, 403, { error: 'bad_origin' });
        if (!needSetup()) return json(res, 409, { error: 'already_configured' });
        const ih = ipHash(req); if (byIp.blocked('s:' + ih)) return json(res, 429, { error: 'too_many_attempts' });
        const b = await body(req, 2048), name = String(b.username || '').toLowerCase(), pw = String(b.password || '');
        if (!S.safeEq(String(b.token || ''), setupToken || '')) { byIp.add('s:' + ih); audit(null, 'setup', 'owner', 'failure'); return json(res, 403, { error: 'bad_setup_token' }); }
        if (!/^[a-z0-9_.-]{3,32}$/.test(name)) return json(res, 422, { error: 'bad_username' });
        if (pw.length < 12 || pw.length > 256) return json(res, 422, { error: 'weak_password' });
        run('INSERT INTO users(username,pw,role,created_at) VALUES(?,?,?,?)', name, S.hashPw(pw), 'owner', now());
        const user = one('SELECT * FROM users WHERE username=?', name); setupToken = null; audit(name, 'setup', 'owner', 'success');
        const { tok, csrf } = newSession(user, req);
        return json(res, 200, { user: { username: name, role: 'owner' }, csrf }, { 'set-cookie': setCookie(tok, cfg.sessionHours * 3600) });
      }
      if (p === '/api/admin/defaults' && m === 'GET') { const s = guard(req, res, 'content'); if (s) json(res, 200, DEFAULTS); return; }
      if (p === '/api/admin/preview' && m === 'GET') { const s = guard(req, res, 'content'); if (!s) return; const o = {}; for (const r of q('SELECT key,draft FROM content')) o[r.key] = JSON.parse(r.draft); return json(res, 200, o); }
      if (p === '/api/admin/media' && m === 'GET') {
        const s = guard(req, res, 'content'); if (!s) return;
        const blob = q('SELECT draft,published FROM content').map(r => r.draft + (r.published || '')).join('\n');
        return json(res, 200, q('SELECT id,name,file,mime,size,w,h,alt,created_at FROM media ORDER BY id DESC').map(r => ({ ...r, used: blob.includes('/media/' + r.file) })));
      }
      if (p === '/api/admin/media' && m === 'POST') {
        const s = guard(req, res, 'content', true); if (!s) return;
        const buf = await raw(req, cfg.maxUpload), info = sniff(buf);
        if (!info) return json(res, 415, { error: 'unsupported_file' });
        if (!info.pdf && (!info.w || !info.h || info.w > 12000 || info.h > 12000)) return json(res, 422, { error: 'bad_dimensions' });
        let name; try { name = decodeURIComponent(String(req.headers['x-filename'] || 'image')); } catch { name = 'image'; }
        name = name.replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 80) || 'image';
        const file = S.rand(12) + '.' + info.ext; fs.writeFileSync(path.join(MEDIA, file), buf, { flag: 'wx', mode: 0o600 });
        const r = run('INSERT INTO media(name,file,mime,size,w,h,alt,created_at,author) VALUES(?,?,?,?,?,?,?,?,?)', name, file, info.mime, buf.length, info.w ?? null, info.h ?? null, '', now(), s.username);
        audit(s.username, 'media_upload', file, 'success', { size: buf.length });
        return json(res, 201, { id: Number(r.lastInsertRowid), name, file, mime: info.mime, size: buf.length, w: info.w ?? null, h: info.h ?? null, alt: '' });
      }
      const mm = /^\/api\/admin\/media\/(\d{1,9})$/.exec(p);
      if (mm && (m === 'PATCH' || m === 'DELETE')) {
        const s = guard(req, res, 'content', true); if (!s) return;
        const row = one('SELECT * FROM media WHERE id=?', +mm[1]); if (!row) return json(res, 404, { error: 'not_found' });
        if (m === 'PATCH') {
          const b = await body(req, 2048), alt = String(b.alt ?? row.alt).slice(0, 300), name = String(b.name ?? row.name).replace(/[\u0000-\u001f<>]/g, '').slice(0, 80) || row.name;
          run('UPDATE media SET alt=?,name=? WHERE id=?', alt, name, row.id); audit(s.username, 'media_update', row.file, 'success'); return json(res, 200, { ok: true });
        }
        const used = q('SELECT draft,published FROM content').some(r => (r.draft + (r.published || '')).includes('/media/' + row.file));
        if (used && u.searchParams.get('force') !== '1') return json(res, 409, { error: 'in_use' });
        run('DELETE FROM media WHERE id=?', row.id); try { fs.unlinkSync(path.join(MEDIA, row.file)); } catch {}
        audit(s.username, 'media_delete', row.file, 'success', { force: used }); return json(res, 200, { ok: true });
      }
      if (p === '/api/admin/analytics/summary' && m === 'GET') {
        const s = guard(req, res, 'analytics'); if (!s) return;
        const dv = u.searchParams.get('device'); return json(res, 200, summary(Math.min(365, Math.max(1, parseInt(u.searchParams.get('days')) || 7)), ['desktop', 'tablet', 'mobile'].includes(dv) ? dv : null));
      }
      if (p === '/api/admin/analytics/funnel' && m === 'GET') {
        const s = guard(req, res, 'analytics'); if (!s) return; const dv = u.searchParams.get('device');
        return json(res, 200, funnel(Math.min(365, Math.max(1, parseInt(u.searchParams.get('days')) || 30)), ['desktop', 'tablet', 'mobile'].includes(dv) ? dv : null));
      }
      if (p === '/api/admin/analytics/funnel' && m === 'PUT') {
        const s = guard(req, res, 'content', true); if (!s) return; const b = await body(req, 8192), steps = cleanFunnel(b.steps);
        setSet('funnel', steps); audit(s.username, 'funnel_update', 'funnel', 'success', { steps: steps.length }); return json(res, 200, { ok: true, steps });
      }
      if (p === '/api/admin/analytics/heatmap' && m === 'GET') {
        const s = guard(req, res, 'analytics'); if (!s) return; const dv = u.searchParams.get('device'), bk = u.searchParams.get('bucket');
        return json(res, 200, heat(Math.min(365, Math.max(1, parseInt(u.searchParams.get('days')) || 30)), ['desktop', 'tablet', 'mobile'].includes(dv) ? dv : null, bk !== null && /^[0-9]$/.test(bk) ? +bk : null));
      }
      if (p === '/api/admin/export/events.csv' && m === 'GET') {
        const s = guard(req, res, 'analytics'); if (!s) return; audit(s.username, 'export_events', 'events', 'success');
        const days = Math.min(365, Math.max(1, parseInt(u.searchParams.get('days')) || 30)), cols = ['ts', 'name', 'section', 'el', 'cat', 'ref', 'rhost', 'device', 'br', 'os', 'lang', 'country', 'meta'];
        const rows = q(`SELECT ${cols.join(',')} FROM events WHERE ts>=? ORDER BY id LIMIT 500000`, now() - days * 864e5);
        const csv = [cols.join(','), ...rows.map(r => cols.map(c => csvCell(c === 'ts' ? new Date(r.ts).toISOString() : r[c])).join(','))].join('\r\n');
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="nova-events.csv"', 'cache-control': 'no-store' }); return res.end('\ufeff' + csv);
      }
      if (p === '/api/admin/export/content.json' && m === 'GET') {
        const s = guard(req, res, 'content'); if (!s) return; audit(s.username, 'export_content', 'content', 'success');
        const out = { exportedAt: new Date().toISOString(), content: {}, media: q('SELECT name,file,mime,size,w,h,alt FROM media') };
        for (const r of q('SELECT key,draft,published,version,pubver FROM content')) out.content[r.key] = { version: r.version, publishedVersion: r.pubver, draft: JSON.parse(r.draft), published: r.published ? JSON.parse(r.published) : null };
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="nova-content.json"', 'cache-control': 'no-store' }); return res.end(JSON.stringify(out, null, 2));
      }
      if (p === '/api/admin/alerts' && m === 'GET') { const s = guard(req, res, 'analytics'); if (s) json(res, 200, alerts()); return; }
      if (p === '/api/admin/seo/check' && m === 'GET') { const s = guard(req, res, 'content'); if (s) json(res, 200, seoCheck()); return; }
      if (p === '/api/admin/settings' && m === 'GET') { const s = guard(req, res, 'security'); if (s) json(res, 200, { ops: OPS(), origin: cfg.origin || null }); return; }
      if (p === '/api/admin/settings' && m === 'PUT') {
        const s = guard(req, res, 'security', true); if (!s) return; const b = await body(req, 2048), n = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : d));
        const ops = { retentionDays: Math.round(n(b.retentionDays, 7, 730, 90)), analytics: b.analytics !== false, lcp: Math.round(n(b.lcp, 500, 10000, 2500)), cls: n(b.cls, 0.01, 1, 0.1), errors: Math.round(n(b.errors, 1, 1000, 5)) };
        setSet('ops', ops); audit(s.username, 'settings_update', 'ops', 'success', ops); return json(res, 200, { ops });
      }
      if (p === '/api/admin/backups' && m === 'GET') { const s = guard(req, res, 'security'); if (s) json(res, 200, listBackups(cfg.dir)); return; }
      if (p === '/api/admin/backups' && m === 'POST') { const s = guard(req, res, 'security', true); if (!s) return; const name = makeBackup(db, cfg.dir); audit(s.username, 'backup_create', name, 'success'); return json(res, 201, { name }); }
      if (p === '/api/admin/linkcheck' && m === 'GET') { const s = guard(req, res, 'content'); if (s) json(res, 200, getSet('linkcheck', null) || { ts: null, results: [] }); return; }
      if (p === '/api/admin/linkcheck' && m === 'POST') {
        const s = guard(req, res, 'content', true); if (!s) return; if (linkRunning) return json(res, 409, { error: 'already_running' }); linkRunning = true;
        try {
          const urls = new Set(), walk = v => { if (typeof v === 'string') { if (/^https?:\/\//i.test(v)) urls.add(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
          for (const r of q('SELECT draft,published FROM content')) { walk(JSON.parse(r.draft)); if (r.published) walk(JSON.parse(r.published)); }
          const list = [...urls].slice(0, 60), results = []; let i = 0;
          await Promise.all(Array.from({ length: 4 }, async () => { while (i < list.length) results.push(await netguard.check(list[i++])); }));
          const rec = { ts: now(), results }; setSet('linkcheck', rec); audit(s.username, 'linkcheck', 'links', 'success', { n: results.length, broken: results.filter(r => !r.ok).length }); return json(res, 200, rec);
        } finally { linkRunning = false; }
      }
      if (p === '/api/admin/users' && m === 'GET') { const s = guard(req, res, 'security'); if (s) json(res, 200, q('SELECT id,username,role,disabled,created_at,totp_on FROM users ORDER BY id')); return; }
      if (p === '/api/admin/users' && m === 'POST') {
        const s = guard(req, res, 'security', true); if (!s) return; const b = await body(req, 2048), name = String(b.username || '').toLowerCase(), pw = String(b.password || '');
        if (!/^[a-z0-9_.-]{3,32}$/.test(name)) return json(res, 422, { error: 'bad_username' }); if (!['owner', 'editor', 'viewer'].includes(b.role)) return json(res, 422, { error: 'bad_role' });
        if (pw.length < 12 || pw.length > 256) return json(res, 422, { error: 'weak_password' }); if (one('SELECT 1 x FROM users WHERE username=?', name)) return json(res, 409, { error: 'user_exists' });
        run('INSERT INTO users(username,pw,role,created_at) VALUES(?,?,?,?)', name, S.hashPw(pw), b.role, now()); audit(s.username, 'user_create', name, 'success', { role: b.role }); return json(res, 201, { ok: true });
      }
      const um = /^\/api\/admin\/users\/(\d{1,9})$/.exec(p);
      if (um && m === 'PATCH') {
        const s = guard(req, res, 'security', true); if (!s) return; const t = one('SELECT * FROM users WHERE id=?', +um[1]); if (!t) return json(res, 404, { error: 'not_found' });
        const b = await body(req, 2048), role = b.role === undefined ? t.role : b.role, dis = b.disabled === undefined ? t.disabled : (b.disabled ? 1 : 0);
        if (!['owner', 'editor', 'viewer'].includes(role)) return json(res, 422, { error: 'bad_role' });
        if (t.id === s.uid && (role !== 'owner' || dis)) return json(res, 409, { error: 'cannot_modify_self' });
        if ((t.role === 'owner' && !t.disabled) && (role !== 'owner' || dis) && one("SELECT COUNT(*) n FROM users WHERE role='owner' AND disabled=0 AND id<>?", t.id).n === 0) return json(res, 409, { error: 'last_owner' });
        if (b.password !== undefined) { const pw = String(b.password); if (pw.length < 12 || pw.length > 256) return json(res, 422, { error: 'weak_password' }); run('UPDATE users SET pw=? WHERE id=?', S.hashPw(pw), t.id); }
        if (b.reset2fa === true) run('UPDATE users SET totp=NULL,totp_on=0,totp_last=0,recovery=NULL WHERE id=?', t.id);
        run('UPDATE users SET role=?,disabled=? WHERE id=?', role, dis, t.id); run('DELETE FROM sessions WHERE user_id=?', t.id);
        audit(s.username, 'user_update', t.username, 'success', { role, disabled: !!dis, password: b.password !== undefined, reset2fa: b.reset2fa === true }); return json(res, 200, { ok: true });
      }
      if (p === '/api/admin/2fa/start' && m === 'POST') {
        const s = guard(req, res, null, true); if (!s) return; if (one('SELECT totp_on t FROM users WHERE id=?', s.uid).t) return json(res, 409, { error: 'already_enabled' });
        const sec = totp.newSecret(); run('UPDATE users SET totp=?,totp_on=0 WHERE id=?', totp.seal(sec, secret), s.uid); return json(res, 200, { secret: sec, uri: totp.uri(sec, s.username) });
      }
      if (p === '/api/admin/2fa/enable' && m === 'POST') {
        const s = guard(req, res, null, true); if (!s) return; if (byUser.blocked('t:' + s.username)) return json(res, 429, { error: 'too_many_attempts' });
        const b = await body(req, 512), u2 = one('SELECT * FROM users WHERE id=?', s.uid); if (!u2.totp || u2.totp_on) return json(res, 409, { error: 'not_started' });
        const step = totp.verify(totp.unseal(u2.totp, secret), String(b.code || '').trim(), 0); if (!step) { byUser.add('t:' + s.username); return json(res, 422, { error: 'bad_code' }); }
        const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
        run('UPDATE users SET totp_on=1,totp_last=?,recovery=? WHERE id=?', step, JSON.stringify(codes.map(c => S.sha(c))), s.uid); audit(s.username, '2fa_enable', 'user', 'success'); return json(res, 200, { recoveryCodes: codes });
      }
      if (p === '/api/admin/2fa/disable' && m === 'POST') {
        const s = guard(req, res, null, true); if (!s) return; if (byUser.blocked('t:' + s.username)) return json(res, 429, { error: 'too_many_attempts' });
        const b = await body(req, 512), u2 = one('SELECT * FROM users WHERE id=?', s.uid);
        if (!S.verifyPw(String(b.password || ''), u2.pw) || !totpOk(u2, String(b.code || '').trim())) { byUser.add('t:' + s.username); audit(s.username, '2fa_disable', 'user', 'failure'); return json(res, 403, { error: 'wrong_password_or_code' }); }
        run('UPDATE users SET totp=NULL,totp_on=0,totp_last=0,recovery=NULL WHERE id=?', s.uid); audit(s.username, '2fa_disable', 'user', 'success'); return json(res, 200, { ok: true });
      }
      if (p === '/api/admin/content' && m === 'GET') {
        const s = guard(req, res, 'content'); if (s) json(res, 200, q('SELECT key,version,pubver,updated_at,published IS NOT NULL AS live FROM content ORDER BY key')); return;
      }
      const c = /^\/api\/admin\/content\/([a-z]{2,24})(?:\/(publish|unpublish|rollback|revisions))?$/.exec(p);
      if (c && KEYS.has(c[1])) {
        const key = c[1], sub = c[2], write = m !== 'GET', s = guard(req, res, 'content', write); if (!s) return;
        const row = one('SELECT * FROM content WHERE key=?', key);
        if (!sub && m === 'GET') return json(res, 200, { key, version: row ? row.version : 0, pubver: row ? row.pubver : null, draft: row ? JSON.parse(row.draft) : null, published: row && row.published ? JSON.parse(row.published) : null });
        if (sub === 'revisions' && m === 'GET') return json(res, 200, q('SELECT id,ts,author,kind,length(body) size FROM revisions WHERE key=? ORDER BY id DESC LIMIT 50', key));
        if (!sub && m === 'PUT') {
          const b = await body(req, 262144); validate(key, b.body); if (key === 'theme') b.body = cleanTheme(b.body); if (key === 'seo') b.body = cleanSeo(b.body);
          if (b.base != null && (row ? row.version : 0) !== b.base) return json(res, 409, { error: 'conflict', version: row ? row.version : 0 });
          const text = JSON.stringify(b.body), v = (row ? row.version : 0) + 1;
          run('INSERT INTO content(key,draft,version,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET draft=excluded.draft,version=excluded.version,updated_at=excluded.updated_at', key, text, v, now());
          revision(key, text, s.username, 'save'); audit(s.username, 'content_save', key, 'success', { version: v });
          return json(res, 200, { version: v });
        }
        if (m === 'POST' && row && sub === 'publish') {
          run('UPDATE content SET published=draft,pubver=version WHERE key=?', key); revision(key, row.draft, s.username, 'publish');
          audit(s.username, 'content_publish', key, 'success', { version: row.version }); return json(res, 200, { published: row.version });
        }
        if (m === 'POST' && row && sub === 'unpublish') { run('UPDATE content SET published=NULL,pubver=NULL WHERE key=?', key); audit(s.username, 'content_unpublish', key, 'success'); return json(res, 200, { ok: true }); }
        if (m === 'POST' && row && sub === 'rollback') {
          const b = await body(req, 1024), rev = one('SELECT body FROM revisions WHERE id=? AND key=?', +b.revisionId || 0, key);
          if (!rev) return json(res, 404, { error: 'revision_not_found' });
          const v = row.version + 1;
          run('UPDATE content SET draft=?,version=?,updated_at=? WHERE key=?', rev.body, v, now(), key);
          if (b.publish === true) run('UPDATE content SET published=draft,pubver=version WHERE key=?', key);
          revision(key, rev.body, s.username, 'rollback'); audit(s.username, 'content_rollback', key, 'success', { revisionId: +b.revisionId, published: b.publish === true });
          return json(res, 200, { version: v });
        }
        return json(res, row ? 405 : 404, { error: row ? 'method_not_allowed' : 'not_found' });
      }
      return json(res, 404, { error: 'not_found' });
    }
    if (m !== 'GET' && m !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' });
    const mf = /^\/media\/([A-Za-z0-9_-]{16}\.(?:png|jpg|webp|pdf))$/.exec(p);
    if (mf) {
      const f = path.join(MEDIA, mf[1]);
      return fs.stat(f, (e, st) => {
        if (e || !st.isFile()) return json(res, 404, { error: 'not_found' });
        const ext = mf[1].split('.')[1], hd = { 'content-type': MIME['.' + ext], 'content-length': st.size, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" };
        if (ext === 'pdf') {   // CV: always a download with a friendly file name
          const row = one('SELECT name FROM media WHERE file=?', mf[1]); let nm = (row && row.name) || 'cv'; if (!/\.pdf$/i.test(nm)) nm += '.pdf';
          hd['content-disposition'] = `attachment; filename="${nm.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(nm)}`;
        }
        res.writeHead(200, hd);
        req.method === 'HEAD' ? res.end() : fs.createReadStream(f).pipe(res);
      });
    }
    if (p === '/admin') { res.writeHead(301, { location: '/admin/' }); return res.end(); }
    if (p.startsWith('/admin/')) return serve(req, res, path.join(__dirname, 'admin'), p.slice(6), CSP_ADMIN, true);   // login page only; every API it calls is authenticated
    if (p === '/en' || p === '/en/' || p === '/tr' || p === '/tr/') { if (p !== '/en') { res.writeHead(301, { location: p.startsWith('/tr') ? '/' : '/en' }); return res.end(); } }
    if (p === '/' || p === '/index.html' || p === '/en') {
      const preview = u.searchParams.get('nova_preview') === '1' && !!getSession(req), g = k => getRow(k, preview);   // drafts only for a logged-in admin
      let html; try { html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'); } catch { return json(res, 500, { error: 'internal_error' }); }
      headers(res, CSP_SITE); res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
      for (const [f, cdn] of VENDOR) if (fs.existsSync(path.join(__dirname, 'public', 'assets', 'vendor', f))) html = html.replace(cdn, '/assets/vendor/' + f);   // self-hosted copies, if the build fetched them
      const content = {}; for (const k of ['site', 'projects', 'skills', 'experience']) { const v = g(k); if (v) content[k] = v; }
      return res.end(req.method === 'HEAD' ? undefined : injectIndex(html, { theme: g('theme'), site: g('site'), seo: g('seo'), analytics: OPS().analytics, origin: cfg.origin.replace(/\/$/, ''), content, lang: p === '/en' ? 'en' : 'tr' }));
    }
    if (p === '/robots.txt') {
      const seo = getRow('seo', false), body = seo && seo.robots === 'noindex' ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n${cfg.origin ? 'Sitemap: ' + cfg.origin.replace(/\/$/, '') + '/sitemap.xml\n' : ''}`;
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' }); return res.end(body);
    }
    if (p === '/sitemap.xml') {
      if (!cfg.origin) return json(res, 404, { error: 'not_found' });
      const last = one('SELECT MAX(updated_at) t FROM content WHERE published IS NOT NULL').t || now(), base = cfg.origin.replace(/\/$/, '');
      res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${['/', '/en'].map(u => `<url><loc>${base}${u}</loc><lastmod>${new Date(last).toISOString().slice(0, 10)}</lastmod><xhtml:link rel="alternate" hreflang="tr" href="${base}/"/><xhtml:link rel="alternate" hreflang="en" href="${base}/en"/></url>`).join('')}</urlset>\n`);
    }
    return serve(req, res, path.join(__dirname, 'public'), p, CSP_SITE);
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch(e => {
      const code = Number.isInteger(e.code) && e.code < 500 ? e.code : 500;
      if (code === 500) console.error('[nova] internal error:', e.message);
      if (!res.headersSent) json(res, code, { error: code === 500 ? 'internal_error' : e.message });
    });
  });
  return { server, db, cfg, close() { clearInterval(timer); server.close(); server.closeAllConnections?.(); db.close(); } };
}

module.exports = { createApp };

// Startup. Hosts such as Hostinger/Passenger may LOAD this file instead of running it as the main script, so we start whenever it is loaded
// (tests set NOVA_EMBEDDED=1 and call createApp themselves). If startup fails we still listen and show WHY instead of an opaque 503.
function failurePage(port, e) {
  console.error('[nova] STARTUP FAILED:', (e && e.stack) || e);
  const code = String((e && (e.code || e.name)) || 'ERROR').replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 40);
  const dirHint = 'Veri klasörü oluşturulamıyor ya da yazılamıyor. DATA_DIR ortam değişkenine ana dizininizin altında yazılabilir, gerçek bir yol verin (örn. /home/u123456789/nova-data; "KULLANICI" yer tutucusunu değiştirmeyi unutmayın).';
  const hints = { NOVA_NODE_VERSION: `Node.js sürümü yetersiz (şu an ${process.version}). Hosting panelinde Node.js sürümünü 22 (en yeni) veya 24 yapıp yeniden dağıtın.`, EACCES: dirHint, EPERM: dirHint, EROFS: dirHint, ENOENT: dirHint, ENOTDIR: dirHint };
  const body = `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>PROJECT NOVA — kurulum hatası</title><body style="font:16px system-ui;background:#02040A;color:#F4FBFF;max-width:640px;margin:10vh auto;padding:0 1rem"><h1 style="font-size:1.2rem">Sunucu başlatılamadı</h1><p>Hata kodu: <code>${code}</code></p><p>${hints[code] || 'Ayrıntı için hosting panelindeki Runtime Logs / günlük ekranına bakın.'}</p><p style="color:#91A4BC">Node ${process.version} · DATA_DIR ayarlı: ${process.env.DATA_DIR ? 'evet' : 'hayır'} · SETUP_TOKEN ayarlı: ${process.env.SETUP_TOKEN ? 'evet' : 'hayır'}</p>`;
  http.createServer((req, res) => { res.writeHead(500, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body); }).listen(port, '0.0.0.0');
}
if (!process.env.NOVA_EMBEDDED && !process.env.NODE_TEST_CONTEXT) {
  const port = +process.env.PORT || 3000;
  process.on('uncaughtException', e => console.error('[nova] uncaught:', e));
  process.on('unhandledRejection', e => console.error('[nova] unhandled rejection:', e));
  let app; try { app = createApp(); } catch (e) { failurePage(port, e); }
  if (app) app.server.listen(port, '0.0.0.0', () => console.log(`[nova] listening on :${port}  (site: /  admin: /admin/)`));
}
