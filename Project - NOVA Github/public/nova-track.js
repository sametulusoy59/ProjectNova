/* PROJECT NOVA privacy-first analytics. Nothing is sent before explicit consent. No cookies, no IP, no keystrokes/inputs, no fingerprinting.
   Session id lives in sessionStorage only (dies with the tab). DNT / Global Privacy Control are treated as "decline". */
(() => {
  'use strict';
  if (typeof location !== 'undefined' && /[?&]nova_preview=1/.test(location.search)) return;
  if (typeof NOVA_SETTINGS !== 'undefined' && NOVA_SETTINGS.analytics === false) return;
  const K = 'nova-consent', EP = '/api/collect';
  const TXT = { en: { d: 'Allow anonymous analytics? We count page views and clicks to improve this site. No cookies, no IP address stored, nothing personal; data is deleted after 90 days.', y: 'Allow', n: 'Decline', p: 'Privacy' },
    tr: { d: 'Anonim analitiğe izin verir misiniz? Siteyi geliştirmek için sayfa görüntülemelerini ve tıklamaları sayıyoruz. Çerez yok, IP adresi saklanmaz, kişisel veri yok; veriler 90 gün sonra silinir.', y: 'İzin ver', n: 'Reddet', p: 'Gizlilik' } };
  const L = () => (document.documentElement.lang === 'tr' ? 'tr' : 'en');
  let consent = null; try { consent = localStorage.getItem(K); } catch {}
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) consent = 'denied';
  const rnd = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c])); };
  let sid = null; try { sid = sessionStorage.getItem('nova-sid'); } catch {}
  if (!sid) { sid = rnd(); try { sessionStorage.setItem('nova-sid', sid); } catch {} }
  const q = []; let started = false, visMs = 0, visSince = document.visibilityState === 'visible' ? performance.now() : 0, errs = 0, lcp = null, cls = 0;
  const dev = () => (matchMedia('(max-width:767px)').matches ? 'mobile' : matchMedia('(max-width:1100px)').matches && 'ontouchstart' in window ? 'tablet' : 'desktop');
  const ev = (name, o = {}) => { if (consent === 'granted') q.push({ name, ...o }); };
  function flush() {
    while (q.length && consent === 'granted') {
      const body = JSON.stringify({ consent: true, sid, dev: dev(), lang: L(), events: q.splice(0, 20) });
      try { if (navigator.sendBeacon && navigator.sendBeacon(EP, new Blob([body], { type: 'text/plain' }))) continue; } catch {}
      fetch(EP, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'omit' }).catch(() => {});
    }
  }
  const slug = i => { try { return String(DATA.projects[+i].title.en || 'p' + i).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40); } catch { return 'p' + i; } };

  function start() {
    if (started) return; started = true;
    let ret = 0; try { ret = localStorage.getItem('nova-seen') ? 1 : 0; localStorage.setItem('nova-seen', '1'); } catch {}
    ev('session_start', { ref: document.referrer || '', meta: { ret } }); ev('page_view', { section: 'hero', ref: document.referrer || '' });
    let cp = 0;
    document.addEventListener('click', e => {   // position only (permille of viewport + scroll tenth): no content, no element text
      if (cp++ < 200 && innerWidth && innerHeight) ev('click_pos', { meta: { x: Math.min(999, Math.round(e.clientX / innerWidth * 999)), y: Math.min(999, Math.round(e.clientY / innerHeight * 999)), b: Math.min(9, Math.floor(scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight) * 10)) } });
    }, true);
    document.addEventListener('click', e => {
      const t = e.target, a = t.closest('a'), b = t.closest('button'), card = t.closest('.card'), cn = t.closest('.cn');
      if (card) return ev('project_click', { el: 'project:' + slug(card.dataset.p), cat: 'project' });
      if (cn) return ev('nav_click', { el: 'world:' + (cn.getAttribute('href') || '').slice(1), cat: 'world' });
      if (a && a.closest('nav,#idx')) return ev('nav_click', { el: 'nav:' + (a.getAttribute('href') || '').slice(1), cat: 'nav' });
      if (a && a.closest('.cl')) { const i = [...a.parentNode.children].indexOf(a); return ev(i === 3 ? 'cv_download' : 'contact_click', { el: 'contact:' + ['email', 'github', 'linkedin', 'cv'][i], cat: 'contact' }); }
      if (a && a.closest('dialog')) return ev('link_click', { el: 'project-link:' + (/Source|Kaynak/.test(a.textContent) ? 'code' : 'live'), cat: 'project' });
      if (a && a.target === '_blank') return ev('link_click', { el: 'ext:' + a.hostname, cat: 'external' });
      if (b) { if (b.id === 'lang') setTimeout(() => ev('lang_switch', { el: 'lang:' + L(), cat: 'cta' }), 0); else if (['skip', 'topBtn', 'snd', 'dN', 'dP', 'dX'].includes(b.id)) ev('cta_click', { el: 'cta:' + b.id, cat: 'cta' }); }
    }, true);
    const seen = new Set(), io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting && !seen.has(x.target.id)) { seen.add(x.target.id); ev('section_view', { section: x.target.id }); } }), { threshold: 0.4 });
    ['about', 'projects', 'skills', 'experience', 'contact'].forEach(id => { const s = document.getElementById(id); if (s) io.observe(s); });
    const marks = [25, 50, 75, 100], hit = new Set(); let raf = 0;
    addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const max = document.documentElement.scrollHeight - innerHeight; if (max <= 0) return; const p = scrollY / max * 100; for (const m of marks) if (p >= m - 0.5 && !hit.has(m)) { hit.add(m); ev('scroll_depth', { meta: { pct: m } }); } }); }, { passive: true });
    const hud = document.getElementById('hud'); let scene = 0;
    if (hud) new MutationObserver(() => { const m = /(?:SCENE|SAHNE) 0(\d)/.exec(hud.textContent); if (m && +m[1] !== scene) { scene = +m[1]; ev('scene_transition', { meta: { scene } }); } }).observe(hud, { childList: true, characterData: true, subtree: true });
    addEventListener('error', e => { if (errs++ < 5) ev('js_error', { meta: { msg: String(e.message || 'error').slice(0, 80), line: e.lineno | 0 } }); });
    addEventListener('unhandledrejection', () => { if (errs++ < 5) ev('js_error', { meta: { msg: 'unhandled_rejection' } }); });
    try {
      new PerformanceObserver(l => { const e = l.getEntries(); lcp = e[e.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
    setInterval(flush, 5000);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (visSince) visMs += performance.now() - visSince; visSince = 0; fin(); } else visSince = performance.now();
  });
  addEventListener('pagehide', () => fin());
  let finSent = 0;
  function fin() {
    if (consent !== 'granted' || !started) return;
    const sec = Math.round((visMs + (visSince ? performance.now() - visSince : 0)) / 1000);
    if (sec > finSent) { finSent = sec; ev('engagement', { meta: { sec } }); }
    if (lcp != null) ev('perf', { meta: { lcp: Math.round(lcp), cls: +cls.toFixed(4), webgl: document.body.classList.contains('nogl') ? 0 : 1 } });
    flush();
  }

  function banner() {
    document.getElementById('nova-consent')?.remove();
    const t = TXT[L()], d = document.createElement('div'); d.id = 'nova-consent'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', t.p);
    d.style.cssText = 'position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:200;max-width:560px;width:calc(100% - 2rem);padding:1rem 1.2rem;background:rgba(5,11,22,.92);border:1px solid rgba(0,217,255,.4);color:#F4FBFF;font:14px/1.5 Outfit,system-ui,sans-serif;backdrop-filter:blur(12px)';
    const p = document.createElement('p'); p.textContent = t.d; p.style.margin = '0 0 .8rem';
    const mk = (txt, v) => { const b = document.createElement('button'); b.textContent = txt; b.style.cssText = 'margin-right:.6rem;padding:.45rem 1rem;background:transparent;color:#00D9FF;border:1px solid #00D9FF;cursor:pointer;font:inherit'; b.onclick = () => choose(v); return b; };
    d.append(p, mk(t.y, 'granted'), mk(t.n, 'denied')); document.body.append(d); d.querySelector('button').focus();
  }
  function choose(v) {
    consent = v; try { localStorage.setItem(K, v); if (v === 'denied') localStorage.removeItem('nova-seen'); } catch {}
    document.getElementById('nova-consent')?.remove();
    if (v === 'granted') start(); else q.length = 0;
  }
  function privacyLink() {
    const w = document.querySelector('#contact .wrap'); if (!w) return;
    const b = document.createElement('button'); b.textContent = TXT[L()].p; b.className = 'top'; b.onclick = banner; w.append(b);
  }
  window.NovaTrack = { consent: () => consent, optIn: () => choose('granted'), optOut: () => choose('denied'), open: banner };
  const go = () => { privacyLink(); if (consent === 'granted') start(); else if (consent === null) banner(); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', go) : go();
})();
