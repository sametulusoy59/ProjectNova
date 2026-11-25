'use strict';
// Downloads the exact library versions the site uses into public/assets/vendor/, so the page can load them from its own server
// (faster first paint, no third-party dependency at runtime). Runs during "build"; any failure is harmless: the page then keeps
// using the cdnjs copies. Usage: node scripts/fetch-vendor.js
const fs = require('node:fs'), path = require('node:path');
const DIR = path.join(__dirname, '..', 'public', 'assets', 'vendor');
const LIBS = [
  { file: 'three.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', ok: t => /REVISION\s*=\s*["']128["']/.test(t) || t.includes('"128"') },
  { file: 'gsap.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js', ok: t => t.includes('3.12.2') },
  { file: 'ScrollTrigger.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js', ok: t => t.includes('3.12.2') && t.includes('ScrollTrigger') },
];
async function main() {
  fs.mkdirSync(DIR, { recursive: true }); let got = 0;
  for (const l of LIBS) {
    const dst = path.join(DIR, l.file);
    try {
      if (fs.existsSync(dst) && l.ok(fs.readFileSync(dst, 'utf8'))) { got++; continue; }
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 20000);
      const r = await fetch(l.url, { signal: ac.signal }); clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text(); if (!l.ok(txt) || txt.length < 20000) throw new Error('unexpected content');
      fs.writeFileSync(dst + '.tmp', txt); fs.renameSync(dst + '.tmp', dst); got++;
    } catch (e) { console.warn(`[vendor] ${l.file}: ${e.message} — the site will use the CDN copy.`); try { fs.rmSync(dst + '.tmp', { force: true }); } catch {} }
  }
  console.log(`[vendor] ${got}/${LIBS.length} libraries self-hosted.`);
}
if (require.main === module) main(); else module.exports = main;
