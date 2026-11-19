'use strict';
(() => {
  const EVENTS = ['session_start', 'page_view', 'section_view', 'nav_click', 'project_click', 'project_open', 'link_click', 'contact_click', 'cv_download', 'lang_switch', 'cta_click', 'scroll_depth', 'scene_transition', 'engagement'];
  const pick = (opts, val, on, label) => { const x = h('select', { 'aria-label': label }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) ? '' : null }, l))); x.addEventListener('change', () => on(x.value)); return x; };

  // alerts on the overview
  const baseOverview = VIEWS['Genel Bakış'];
  VIEWS['Genel Bakış'] = async el => {
    const al = await api('/alerts').catch(() => []);
    if (al.length) el.append(h('h3', {}, 'Uyarılar'), ...al.map(a => h('div', { class: 'alert ' + a.level }, h('b', {}, a.title), a.detail)));
    await baseOverview(el);
  };

  VIEWS['Analitik'] = async el => {
    let days = 30, device = '', bucket = '';
    const box = h('div');
    async function draw() {
      const q = `days=${days}${device ? '&device=' + device : ''}`;
      const [s, f, hm] = await Promise.all([api('/analytics/summary?' + q), api('/analytics/funnel?' + q), api(`/analytics/heatmap?${q}${bucket !== '' ? '&bucket=' + bucket : ''}`)]);
      const cv = h('canvas', { class: 'heat', width: 640, height: 360, 'aria-label': 'Tıklama haritası' }), g = cv.getContext('2d'), max = Math.max(1, ...hm.cells.map(c => c[2]));
      g.strokeStyle = 'rgba(145,164,188,.15)'; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * 160, 0); g.lineTo(i * 160, 360); g.moveTo(0, i * 90); g.lineTo(640, i * 90); g.stroke(); }
      g.globalCompositeOperation = 'lighter';
      for (const [gx, gy, n] of hm.cells) { const x = (gx + .5) * 16, y = (gy + .5) * 15, r = 34, a = Math.min(1, .25 + n / max), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,${Math.round(220 - 180 * n / max)},60,${a})`); gr.addColorStop(1, 'rgba(0,136,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
      const steps = f.config.map(c => ({ label: c.label, events: (c.names || [c.name]).join(','), section: c.section || '', el: c.el || '' }));
      const fe = h('div');
      const drawFe = () => fe.replaceChildren(...steps.map((st, i) => h('div', { class: 'row' }, h('input', { value: st.label, 'aria-label': 'Etiket', style: 'width:150px', oninput: e => st.label = e.target.value }), h('input', { value: st.events, 'aria-label': 'Olaylar (virgülle)', style: 'width:230px', oninput: e => st.events = e.target.value }),
        h('input', { value: st.section, placeholder: 'bölüm', 'aria-label': 'Bölüm', style: 'width:100px', oninput: e => st.section = e.target.value }), h('input', { value: st.el, placeholder: 'öğe (opsiyonel)', 'aria-label': 'Öğe', style: 'width:160px', oninput: e => st.el = e.target.value }),
        h('button', { class: 'sm danger', onclick: () => { steps.splice(i, 1); drawFe(); } }, 'Sil'))));
      drawFe();
      box.replaceChildren(
        h('div', { class: 'row' }, pick([[7, 'Son 7 gün'], [30, 'Son 30 gün'], [90, 'Son 90 gün'], [365, 'Son 1 yıl']], days, v => { days = +v; draw(); }, 'Dönem'), pick([['', 'Tüm cihazlar'], ['desktop', 'Masaüstü'], ['tablet', 'Tablet'], ['mobile', 'Mobil']], device, v => { device = v; draw(); }, 'Cihaz'),
          h('a', { href: `/api/admin/export/events.csv?days=${days}`, download: '' }, 'Olayları CSV indir ↓')),
        h('p', { class: 'mut' }, s.note + ' Yalnızca onay veren ziyaretçiler dahildir.'),
        h('h3', {}, 'Ziyaretçi yolculuğu (huni)'), ...f.steps.map(st => h('div', { class: 'fun' }, h('span', {}, st.label), h('div', { class: 'bar', style: `width:${Math.max(1, st.fromStart)}%` }), h('span', { class: 'mut' }, `${st.count} · adımdan %${st.fromPrev} · baştan %${st.fromStart}`))), h('p', { class: 'mut' }, f.note),
        h('details', {}, h('summary', {}, 'Huni adımlarını düzenle'), fe, h('div', { class: 'row' }, h('button', { class: 'sm', onclick: () => { steps.push({ label: 'Yeni adım', events: 'page_view', section: '', el: '' }); drawFe(); } }, '+ Adım ekle'),
          h('button', { onclick: async () => { try { await api('/analytics/funnel', { method: 'PUT', body: { steps: steps.map(x => ({ label: x.label, names: x.events.split(',').map(t => t.trim()).filter(Boolean), section: x.section.trim() || undefined, el: x.el.trim() || undefined })) } }); toast('Huni kaydedildi.'); draw(); } catch (e) { toast(msg(e), true); } } }, 'Kaydet'), h('small', { class: 'mut' }, 'Geçerli olaylar: ' + EVENTS.join(', ')))),
        h('h3', {}, 'Tıklama haritası'), h('div', { class: 'row' }, pick([['', 'Tüm sayfa'], ...Array.from({ length: 10 }, (_, i) => [String(i), `Kaydırma %${i * 10}–${i * 10 + 10}`])], bucket, v => { bucket = v; draw(); }, 'Kaydırma aralığı'), h('span', { class: 'mut' }, `${hm.total} tıklama`)), cv,
        h('p', { class: 'mut' }, 'Ekranın görünür alanına göre konum (sol-üst = sol-üst köşe). Site sabit 3D sahne üzerine kurulu olduğu için harita sayfa içeriğinin değil, ekran konumunun toplamıdır; sıcak = çok tıklanan.'),
        h('h3', {}, 'Ziyaretçiler nerede ayrılıyor?'), table(['Son görülen bölüm', 'Ziyaretçi'], s.exits.map(r => [r.section, r.n])), h('h3', {}, 'Kaydırma derinliği'), table(['Derinlik %', 'Ziyaretçi olayı'], s.scroll.map(r => [r.pct, r.n])),
        h('div', { class: 'row' }, h('div', {}, h('h3', {}, 'En çok tıklanan'), table(['Öğe', 'Tık'], s.elements.slice(0, 10).map(r => [r.el, r.n]))), h('div', {}, h('h3', {}, 'En az kullanılan'), table(['Öğe', 'Tık'], s.elements.slice(-10).reverse().map(r => [r.el, r.n])))),
        h('h3', {}, 'Trafik kaynağı kalitesi'), table(['Kaynak', 'Ziyaretçi', 'Ort. süre (sn)', 'İletişime geçen'], s.sourceEngagement.map(r => [r.cat, r.visitors, r.avgSec == null ? '—' : Math.round(r.avgSec), `${r.contacted} (%${r.visitors ? Math.round(r.contacted / r.visitors * 100) : 0})`])),
        h('div', { class: 'row' }, h('div', {}, h('h3', {}, 'Tarayıcılar'), table(['Tarayıcı', 'Ziyaretçi'], s.browsers.map(r => [r.k, r.n]))), h('div', {}, h('h3', {}, 'Diller'), table(['Dil', 'Ziyaretçi'], s.languages.map(r => [r.k, r.n]))), h('div', {}, h('h3', {}, 'Ülkeler (CDN başlığı varsa)'), table(['Ülke', 'Ziyaretçi'], s.countries.map(r => [r.k, r.n])))));
    }
    el.append(h('h2', {}, 'Analitik'), box); await draw();
  };
})();
