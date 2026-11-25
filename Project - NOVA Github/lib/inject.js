'use strict';
// Server-side <head> injection for the public page: theme/3D settings, SEO tags, structured data. Crawlers do not run JS, so SEO must be in the HTML.
const clampN = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
function cleanTheme(t = {}) {
  t = t && typeof t === 'object' ? t : {};
  return { accent: hex(t.accent, '#00D9FF'), accent2: hex(t.accent2, '#0088FF'), quality: ['auto', 'low', 'medium', 'high'].includes(t.quality) ? t.quality : 'auto',
    particles: clampN(t.particles, .25, 2, 1), stars: clampN(t.stars, .25, 2, 1), glow: clampN(t.glow, .5, 1.5, 1), coreScale: clampN(t.coreScale, .7, 1.4, 1),
    journeyVh: Math.round(clampN(t.journeyVh, 400, 900, 650)), smooth: clampN(t.smooth, 3, 10, 6), shooting: clampN(t.shooting, 0, 2, 1), trail: t.trail !== false,
    skyCity: (typeof t.skyCity === 'string' ? t.skyCity.replace(/[\u0000-\u001f<>"'`]/g, '').trim().slice(0, 40) : '') || 'İstanbul', skyLat: clampN(t.skyLat, -89.9, 89.9, 41.01), skyLon: clampN(t.skyLon, -180, 180, 28.98), skyTz: typeof t.skyTz === 'string' && /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(t.skyTz) ? t.skyTz : 'Europe/Istanbul', visitorStars: t.visitorStars !== false,
    spacing: clampN(t.spacing, .6, 1.6, 1), radius: Math.round(clampN(t.radius, 0, 16, 2)), grain: clampN(t.grain, 0, .2, .07), vignette: clampN(t.vignette, 0, 1, 1) };
}
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '');
function cleanSeo(s = {}) {
  s = s && typeof s === 'object' ? s : {};
  const url = v => (/^https:\/\/[^\s"'<>]+$/i.test(str(v, 300)) ? str(v, 300) : '');
  return { canonical: url(s.canonical), ogImage: /^\/media\/[A-Za-z0-9_-]{16}\.(png|jpg|webp)$/.test(str(s.ogImage, 100)) ? str(s.ogImage, 100) : url(s.ogImage), robots: s.robots === 'noindex' ? 'noindex' : 'index', twitter: /^@?[A-Za-z0-9_]{1,15}$/.test(str(s.twitter, 20)) ? str(s.twitter, 20).replace(/^@?/, '@') : '', siteName: str(s.siteName, 60) };
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonSafe = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Published content is embedded in the page: no placeholder flash for visitors, and crawlers / link previews see real text without running JS.
const L2 = (o, lang) => (o && typeof o === 'object' && !Array.isArray(o) ? str(o[lang] || o.en || o.tr || '', 5000) : str(o, 5000));
const real = v => v && !/^\s*\[/.test(v);
function prerender(html, c, lang) {
  const e = v => esc(v), p = (c.site && c.site.profile) || {}, put = (re, inner) => { html = html.replace(re, (m, a, b) => a + inner + b); };
  const bio = L2(p.bio, lang), ints = (p.interests && (p.interests[lang] || p.interests.en)) || [];
  if (p.name || bio) put(/(<div class="about reveal" id="aboutBody">)(<\/div>)/, `<div><h2>${e(str(p.name, 80))}</h2>${real(bio) ? `<p>${e(bio)}</p>` : ''}</div>${ints.filter(real).length ? `<ul>${ints.filter(real).slice(0, 20).map(i => `<li>${e(str(i, 120))}</li>`).join('')}</ul>` : ''}`);
  if (Array.isArray(c.projects)) put(/(<div class="gallery" id="gallery"[^>]*>)(<\/div>)/, c.projects.filter(x => x && !x.hidden).slice(0, 40).map((x, i) => `<article class="card" id="${lang === 'en' ? 'project' : 'proje'}-${i + 1}"><div class="tx"><h3>${e(L2(x.title, lang))}</h3><p>${e(L2(x.desc, lang))}</p>${['problem', 'approach', 'result'].map(k => L2(x[k], lang)).filter(Boolean).map(t => `<p>${e(t)}</p>`).join('')}<div class="tags">${(x.tech || []).filter(real).slice(0, 20).map(t => `<span>${e(str(t, 60))}</span>`).join('')}</div></div></article>`).join(''));
  if (Array.isArray(c.skills)) put(/(<div class="sk reveal" id="skBody">)(<\/div>)/, c.skills.slice(0, 30).map(g => `<div><h3>${e(L2(g.cat, lang))}</h3><ul>${(g.items || []).filter(real).slice(0, 60).map(s => `<li>${e(str(s, 80))}</li>`).join('')}</ul></div>`).join(''));
  if (Array.isArray(c.experience)) put(/(<ul class="tl reveal" id="expBody">)(<\/ul>)/, c.experience.slice(0, 40).map(x => `<li><span class="meta">${e(str(x.period, 40))}</span><div><b>${e(L2(x.role, lang))}</b><p>${e(str(x.org, 100))}</p><p>${e(L2(x.desc, lang))}</p></div></li>`).join(''));
  return html;
}

function injectIndex(html, { theme, site, seo, analytics = true, origin = '', content = null, lang = 'tr', path = '/' }) {
  let out = html.replace('<html lang="en">', `<html lang="${lang === 'en' ? 'en' : 'tr'}">`); const head = [];
  if (content && Object.keys(content).length) {
    out = prerender(out, content, lang === 'en' ? 'en' : 'tr');
    head.push(`<script>window.NOVA_CONTENT=${jsonSafe(content)}</script>`);
  }
  head.push(`<script>window.NOVA_LANG=${jsonSafe(lang === 'en' ? 'en' : 'tr')}</script>`);
  if (site && site.title) out = out.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(str(site.title, 120))}</title>`);
  if (site && site.description) out = out.replace(/(<meta name="description" content=")[^"]*(")/, (_, a, b) => a + esc(str(site.description, 300)) + b);
  const settings = {};
  if (theme) {
    const t = cleanTheme(theme); Object.assign(settings, t);
    head.push(`<style id="nova-theme">:root{--cyan:${t.accent};--blue:${t.accent2}}section{padding:calc(clamp(4rem,10vw,8rem)*${t.spacing}) 0}#journey{height:${t.journeyVh}vh}#grain{opacity:${t.grain}}body::before{opacity:${t.vignette}}.card,dialog,.cl a,.cn,.about,.sk>div,.tl li{border-radius:${t.radius}px}</style>`);
  }
  if (analytics === false) settings.analytics = false;
  if (Object.keys(settings).length) head.push(`<script>window.NOVA_SETTINGS=${jsonSafe(settings)}</script>`);
  const s = seo ? cleanSeo(seo) : null, title = (site && site.title) || 'PROJECT NOVA', desc = (site && site.description) || '';
  const root = ((s && s.canonical) || (origin ? origin + '/' : '')).replace(/\/$/, ''), canon = root ? root + (lang === 'en' ? '/en' : '/') : '';
  if (root) head.push(`<link rel="alternate" hreflang="tr" href="${esc(root)}/"><link rel="alternate" hreflang="en" href="${esc(root)}/en"><link rel="alternate" hreflang="x-default" href="${esc(root)}/">`);
  if (s) head.push(`<meta name="robots" content="${s.robots === 'noindex' ? 'noindex,nofollow' : 'index,follow'}">`);
  if (canon) head.push(`<link rel="canonical" href="${esc(canon)}">`);
  if (s || canon) {
    const img = s && s.ogImage ? (s.ogImage.startsWith('/') ? origin + s.ogImage : s.ogImage) : '';
    head.push(`<meta property="og:type" content="website"><meta property="og:title" content="${esc(str(title, 120))}">${desc ? `<meta property="og:description" content="${esc(str(desc, 300))}">` : ''}${canon ? `<meta property="og:url" content="${esc(canon)}">` : ''}${img ? `<meta property="og:image" content="${esc(img)}">` : ''}${s && s.siteName ? `<meta property="og:site_name" content="${esc(s.siteName)}">` : ''}`);
    head.push(`<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">${s && s.twitter ? `<meta name="twitter:site" content="${esc(s.twitter)}">` : ''}`);
    const p = (site && site.profile) || {}, c = (site && site.contact) || {};
    const ld = { '@context': 'https://schema.org', '@type': 'Person', name: str(p.name, 80) || 'Çağrı Samet Ulusoy', jobTitle: 'M. Sc. Computer Engineer', ...(canon ? { url: canon } : {}), sameAs: [c.github, c.linkedin].filter(u => /^https:\/\//.test(u || '')) };
    head.push(`<script type="application/ld+json">${jsonSafe(ld)}</script>`);
  }
  return out.replace('<!--NOVA_HEAD-->', head.join('\n'));
}
module.exports = { cleanTheme, cleanSeo, injectIndex };
