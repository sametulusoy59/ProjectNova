'use strict';
/* Content editor: forms for site / projects / skills / experience. Draft autosave, preview, publish, unpublish, revision history + rollback. */
(() => {
  const LABELS = { site: 'Site & Hakkında', projects: 'Projeler', skills: 'Yetenekler', experience: 'Deneyim', theme: 'Tema & 3D', seo: 'SEO' };
  const clone = o => JSON.parse(JSON.stringify(o ?? null));
  let ctx = null;   // current editor: { key, model, version, timer, onChange }
  const lab = (t, c, hint) => h('label', { class: 'f' }, h('span', {}, t), c, hint ? h('small', { class: 'mut' }, hint) : '');
  function inp(o, k, opt = {}) {
    let c;
    if (opt.type === 'checkbox') { c = h('input', { type: 'checkbox' }); c.checked = !!o[k]; c.addEventListener('change', () => { o[k] = c.checked; ctx.dirty(); }); return c; }
    c = h(opt.area ? 'textarea' : 'input', opt.area ? { rows: opt.rows || 3 } : { type: opt.type || 'text' });
    if (opt.max) c.setAttribute('maxlength', opt.max); if (opt.min != null) { c.setAttribute('min', opt.min); c.setAttribute('max', opt.maxv); }
    const toStr = v => opt.list === 'lines' ? (v || []).join('\n') : opt.list === 'csv' ? (v || []).join(', ') : (v ?? '');
    c.value = toStr(o[k]);
    c.addEventListener('input', () => { const v = c.value; o[k] = opt.list === 'lines' ? v.split('\n').map(x => x.trim()).filter(Boolean) : opt.list === 'csv' ? v.split(',').map(x => x.trim()).filter(Boolean) : opt.type === 'number' ? +v : v; ctx.dirty(); });
    return c;
  }
  const f = (t, o, k, opt, hint) => lab(t, inp(o, k, opt), hint);
  const bi = (t, o, k, opt, hint) => { o[k] = (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? o[k] : { en: '', tr: '' }; return h('div', { class: 'bi' }, f('TR · ' + t, o[k], 'tr', opt, hint), f('EN · ' + t, o[k], 'en', opt)); };
  const biList = (t, o, k) => { o[k] = o[k] || { en: [], tr: [] }; return h('div', { class: 'bi' }, f('TR · ' + t + ' (satır başına bir)', o[k], 'tr', { area: 1, list: 'lines' }), f('EN · ' + t, o[k], 'en', { area: 1, list: 'lines' })); };

  const rng = (t, o, k, min, max, step, unit = '') => { const out = h('output', { class: 'mut' }, ' ' + (o[k] ?? '') + unit), c = h('input', { type: 'range', min, max, step }); c.value = o[k] ?? min; c.addEventListener('input', () => { o[k] = +c.value; out.textContent = ' ' + c.value + unit; ctx.dirty(); }); return h('label', { class: 'f' }, h('span', {}, t, out), c); };
  const sel = (t, o, k, opts) => { const c = h('select', {}, opts.map(([v, l]) => h('option', { value: v }, l))); c.value = o[k]; c.addEventListener('change', () => { o[k] = c.value; ctx.dirty(); }); return lab(t, c); };
  const col = (t, o, k) => { const c = h('input', { type: 'color' }); c.value = o[k] || '#00d9ff'; c.addEventListener('input', () => { o[k] = c.value; ctx.dirty(); }); return lab(t, c); };
  function listEditor(arr, mk, title, render, newItem, noun) {   // reorderable list with add / remove
    const box = h('div');
    const draw = () => {
      box.replaceChildren(...arr.map((it, i) => h('fieldset', {}, h('legend', {}, `${i + 1}. ${title(it) || 'Yeni ' + noun}`),
        render(it, draw),
        h('div', { class: 'row' }, h('button', { class: 'sm', disabled: i ? null : '', onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; ctx.dirty(); draw(); } }, '↑ Yukarı'),
          h('button', { class: 'sm', onclick: () => { if (i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; ctx.dirty(); draw(); } } }, '↓ Aşağı'),
          h('button', { class: 'sm danger', onclick: () => { if (confirm(`Bu ${noun} silinsin mi? (Geçmişten geri alınabilir.)`)) { arr.splice(i, 1); ctx.dirty(); draw(); } } }, 'Sil')))),
        h('button', { onclick: () => { arr.push(newItem()); ctx.dirty(); draw(); } }, `+ ${noun[0].toUpperCase() + noun.slice(1)} ekle`));
    };
    draw(); return box;
  }

  const FORMS = {
    site: (m, el, media = []) => {
      m.profile ||= {}; m.contact ||= {};
      const pdfs = media.filter(x => x.mime === 'application/pdf'), pickCv = h('select', { onchange: ev => { if (ev.target.value) { m.contact.cv = '/media/' + ev.target.value; ctx.dirty(); ctx.reopen(); } } }, h('option', { value: '' }, pdfs.length ? 'Medya kütüphanesinden PDF seç…' : 'Kütüphanede PDF yok (Medya sayfasından yükleyin)'), pdfs.map(r => h('option', { value: r.file }, r.name)));
      el.append(h('h3', {}, 'Site bilgileri'), f('Sayfa başlığı (SEO)', m, 'title', { max: 120 }, 'Boşsa yerleşik başlık kullanılır'), f('Arama sonucu açıklaması (SEO)', m, 'description', { area: 1, max: 300 }),
        h('h3', {}, 'Hakkında'), f('Ad Soyad', m.profile, 'name', { max: 80 }), bi('Biyografi', m.profile, 'bio', { area: 1, rows: 5 }), biList('İlgi alanları', m.profile, 'interests'),
        h('h3', {}, 'İletişim'), f('E-posta', m.contact, 'email', {}, 'Boş bırakırsanız düğme sitede gösterilmez'), f('GitHub bağlantısı (https://…)', m.contact, 'github'), f('LinkedIn bağlantısı (https://…)', m.contact, 'linkedin'), f('CV bağlantısı (https://… veya /media/…)', m.contact, 'cv', {}, 'Boş bırakırsanız CV düğmesi sitede gösterilmez'), lab('CV dosyası (PDF)', pickCv));
    },
    projects: (m, el, media) => el.append(listEditor(m, null, p => p.title && (p.title.tr || p.title.en), (p, redraw) => {
      const pick = h('select', { onchange: e => { const r = media.find(x => x.file === e.target.value); if (r) { p.image = '/media/' + r.file; p.imageAlt = r.alt || r.name; ctx.dirty(); redraw(); } } }, h('option', { value: '' }, 'Medya kütüphanesinden seç…'), media.map(r => h('option', { value: r.file }, r.name + ` (${r.w}×${r.h})`)));
      return h('div', {}, bi('Başlık', p, 'title', { max: 120 }), bi('Kategori', p, 'cat', { max: 60 }), bi('Açıklama', p, 'desc', { area: 1, rows: 4 }), f('Teknolojiler (virgülle ayırın)', p, 'tech', { list: 'csv' }),
        h('div', { class: 'bi' }, f('Canlı demo bağlantısı', p, 'live'), f('Kaynak kod bağlantısı', p, 'code')), h('div', { class: 'bi' }, f('Kapak görseli', p, 'image', {}, 'Boşsa otomatik çizim kullanılır'), lab('Kütüphane', pick)),
        f('Görsel alt metni (erişilebilirlik)', p, 'imageAlt', { max: 200 }), f('Renk tonu (0–360)', p, 'hue', { type: 'number', min: 0, maxv: 360 }),
        h('div', { class: 'row' }, lab('Örnek proje etiketi', inp(p, 'example', { type: 'checkbox' })), lab('Sitede gizle (taslak)', inp(p, 'hidden', { type: 'checkbox' }))));
    }, () => ({ example: false, hidden: false, hue: 200, cat: { en: '', tr: '' }, title: { en: '', tr: '' }, desc: { en: '', tr: '' }, tech: [], live: '', code: '', image: '', imageAlt: '' }), 'proje')),
    skills: m => 0,
    experience: m => 0,
  };
  FORMS.skills = (m, el) => el.append(listEditor(m, null, g => g.cat && (g.cat.tr || g.cat.en), g => h('div', {}, bi('Kategori adı', g, 'cat', { max: 60 }), f('Yetenekler (satır başına bir)', g, 'items', { area: 1, rows: 5, list: 'lines' })), () => ({ cat: { en: '', tr: '' }, items: [] }), 'kategori'));
  FORMS.experience = (m, el) => el.append(listEditor(m, null, e => e.role && (e.role.tr || e.role.en), e => h('div', {}, bi('Görev', e, 'role', { max: 100 }), f('Kurum', e, 'org', { max: 100 }), f('Dönem (ör. 2022 — 2024)', e, 'period', { max: 40 }), bi('Açıklama', e, 'desc', { area: 1, rows: 4 })), () => ({ role: { en: '', tr: '' }, org: '', period: '', desc: { en: '', tr: '' } }), 'kayıt'));

  const THEME_DEF = { accent: '#00D9FF', accent2: '#0088FF', quality: 'auto', particles: 1, stars: 1, glow: 1, coreScale: 1, journeyVh: 650, smooth: 6, shooting: 1, trail: true, spacing: 1, radius: 2, grain: 0.07, vignette: 1 };
  FORMS.theme = (m, el) => {
    for (const k in THEME_DEF) if (m[k] === undefined) m[k] = THEME_DEF[k];
    el.append(h('p', { class: 'mut' }, 'Yalnızca sitede gerçekten desteklenen ayarlar. "Önizle" ile yayınlamadan önce kendiniz görün. Vurgu renkleri arayüz öğelerini (metin vurguları, çizgiler, düğmeler) etkiler; 3D çekirdeğin renk paleti shader içinde sabittir.'),
      h('h3', {}, 'Renkler'), h('div', { class: 'bi' }, col('Vurgu rengi', m, 'accent'), col('İkincil renk', m, 'accent2')),
      h('h3', {}, '3D sahne'), sel('Kalite ön ayarı (piksel yoğunluğu sınırı)', m, 'quality', [['auto', 'Otomatik'], ['low', 'Düşük (en hızlı)'], ['medium', 'Orta'], ['high', 'Yüksek']]),
      rng('Süpernova parçacık yoğunluğu', m, 'particles', 0.25, 2, 0.05, '×'), rng('Yıldız yoğunluğu', m, 'stars', 0.25, 2, 0.05, '×'), rng('Parıltı yoğunluğu', m, 'glow', 0.5, 1.5, 0.05, '×'), rng('Enerji çekirdeği boyutu', m, 'coreScale', 0.7, 1.4, 0.05, '×'),
      rng('Kayan yıldız sıklığı (0 = kapalı)', m, 'shooting', 0, 2, 0.1, '×'), h('label', { class: 'f' }, h('span', {}, 'İmleç parıltı izi'), inp(m, 'trail', { type: 'checkbox' })),
      h('h3', {}, 'Kaydırma ve geçişler'), rng('Giriş animasyonunun uzunluğu', m, 'journeyVh', 400, 900, 10, ' vh'), rng('Kaydırma yumuşaklığı (yüksek = daha seri)', m, 'smooth', 3, 10, 0.5),
      h('h3', {}, 'Görünüm'), rng('Bölüm boşlukları', m, 'spacing', 0.6, 1.6, 0.05, '×'), rng('Köşe yuvarlaklığı', m, 'radius', 0, 16, 1, ' px'), rng('Film greni', m, 'grain', 0, 0.2, 0.01), rng('Kenar karartması', m, 'vignette', 0, 1, 0.05),
      h('button', { class: 'danger', onclick: async () => { if (!confirm('Tüm tema ayarları varsayılana dönsün mü? (Yayınlamadan sitede değişmez.)')) return; Object.assign(m, THEME_DEF); try { await ctx.save(); ctx.reopen(); } catch {} } }, 'Varsayılana sıfırla'));
  };
  FORMS.seo = (m, el, media) => {
    for (const k of ['canonical', 'ogImage', 'twitter', 'siteName']) m[k] ??= ''; m.robots ||= 'index';
    const pickImg = h('select', { onchange: e => { const r = media.find(x => x.file === e.target.value); if (r) { m.ogImage = '/media/' + r.file; ctx.dirty(); ctx.reopen(); } } }, h('option', { value: '' }, 'Medya kütüphanesinden seç…'), media.map(r => h('option', { value: r.file }, r.name)));
    const out = h('div'), lk = h('div');
    const showLinks = r => lk.replaceChildren(r.ts ? h('p', { class: 'mut' }, 'Son kontrol: ' + fmt(r.ts)) : '', table(['Bağlantı', 'Sonuç'], (r.results || []).map(x => [x.url, h('span', { class: x.ok ? 'up' : 'dn' }, x.ok ? 'OK ' + (x.status || '') : (x.note === 'blocked' ? 'engellendi (özel/yerel adres)' : x.note || 'HTTP ' + x.status))])));
    el.append(h('p', { class: 'mut' }, 'Başlık ve açıklama "Site & Hakkında" sekmesindedir. Bu ayarlar HTML içine sunucuda yazılır, böylece arama motorları ve sosyal ağlar JavaScript çalıştırmadan görür.'),
      f('Kanonik adres (https://alanadi.com/)', m, 'canonical', {}, 'Boşsa PUBLIC_ORIGIN kullanılır'), f('Sosyal paylaşım görseli (og:image)', m, 'ogImage'), lab('Kütüphane', pickImg), f('Site adı (og:site_name)', m, 'siteName', { max: 60 }), f('X/Twitter kullanıcı adı', m, 'twitter', { max: 16 }),
      sel('Arama motorları', m, 'robots', [['index', 'İndeksle (önerilir)'], ['noindex', 'İndeksleme (noindex)']]),
      h('h3', {}, 'SEO kontrolü'), h('button', { onclick: async () => { try { await flush(); await ctx.save(); const r = await api('/seo/check'); out.replaceChildren(...r.map(x => h('div', { class: 'alert ' + (x.level === 'warn' ? 'warn' : '') }, x.msg))); } catch (e) { toast(msg(e), true); } } }, 'KONTROL ET'), out,
      h('h3', {}, 'Bağlantı kontrolü'), h('p', { class: 'mut' }, 'İçerikteki dış bağlantılara sunucudan istek atar (özel/yerel adresler engellenir).'), h('button', { onclick: async () => { lk.replaceChildren(h('p', { class: 'mut' }, 'Kontrol ediliyor…')); try { showLinks(await api('/linkcheck', { body: {} })); } catch (e) { lk.replaceChildren(); toast(msg(e), true); } } }, 'BAĞLANTILARI KONTROL ET'), lk);
    api('/linkcheck').then(showLinks).catch(() => {});
  };
  async function flush() { if (ctx && ctx.timer) { clearTimeout(ctx.timer); ctx.timer = 0; await ctx.save(); } }
  VIEWS._leave = flush;

  async function open(key, el) {
    await flush(); VIEWS._leave = flush;
    const [doc, defs, media] = await Promise.all([api('/content/' + key), api('/defaults'), ['projects', 'seo', 'site'].includes(key) ? api('/media').catch(() => []) : []]);
    const model = doc.draft ?? clone(defs[key]), status = h('span', { class: 'st' }), chip = h('span', {});
    ctx = { key, model, version: doc.version, timer: 0, reopen: () => open(key, el) };
    const setChip = (live, pubver, ver) => { chip.className = 'chip ' + (live ? (pubver === ver ? 'on' : 'warn') : ''); chip.textContent = live ? (pubver === ver ? `Yayında (v${pubver})` : `Yayında v${pubver} · taslakta yayınlanmamış değişiklik var`) : 'Yayında değil — site yerleşik içeriği gösteriyor'; };
    let pub = doc.published != null ? doc.pubver : null; setChip(pub != null, pub, ctx.version);
    ctx.save = async () => { try { const r = await api('/content/' + key, { method: 'PUT', body: { body: ctx.model, base: ctx.version } }); ctx.version = r.version; status.textContent = 'Taslak kaydedildi · ' + new Date().toLocaleTimeString('tr-TR'); setChip(pub != null, pub, ctx.version); } catch (e) { status.textContent = 'Kaydedilemedi: ' + msg(e); toast(msg(e), true); throw e; } };
    ctx.dirty = () => { status.textContent = 'Kaydedilmemiş değişiklikler…'; clearTimeout(ctx.timer); ctx.timer = setTimeout(() => { ctx.timer = 0; ctx.save().catch(() => {}); }, 2000); };
    const act = fn => async () => { try { await flush(); await ctx.save(); await fn(); } catch (e) { toast(msg(e), true); } };
    const hist = h('div');
    const body = h('div'); FORMS[key](ctx.model, body, media);
    el.replaceChildren(h('h2', {}, 'İçerik'), h('div', { class: 'tabs' }, Object.entries(LABELS).map(([k, l]) => h('button', { 'aria-current': k === key ? 'page' : null, onclick: () => open(k, el).catch(e => toast(msg(e), true)) }, l))), chip,
      h('div', { class: 'bar2' }, h('button', { onclick: act(async () => toast('Taslak kaydedildi.')) }, 'Taslağı kaydet'),
        h('button', { onclick: act(async () => { window.open('/?nova_preview=1', '_blank', 'noopener'); }) }, 'Önizle ↗'),
        h('button', { class: 'primary', style: 'margin:0;width:auto', onclick: act(async () => { const r = await api('/content/' + key + '/publish', { body: {} }); pub = r.published; setChip(true, pub, ctx.version); toast('Yayınlandı — site güncel.'); }) }, 'YAYINLA'),
        h('button', { class: 'danger', onclick: async () => { if (!confirm('Yayından kaldırılsın mı? Site yerleşik içeriğe döner.')) return; try { await api('/content/' + key + '/unpublish', { body: {} }); pub = null; setChip(false, null, ctx.version); toast('Yayından kaldırıldı.'); } catch (e) { toast(msg(e), true); } } }, 'Yayından kaldır'),
        h('button', { onclick: async () => { const revs = await api('/content/' + key + '/revisions'); hist.replaceChildren(h('h3', {}, 'Revizyon geçmişi'), table(['Zaman', 'Yazan', 'Tür', ''], revs.map(r => [fmt(r.ts), r.author, r.kind, h('span', {}, h('button', { class: 'sm', onclick: () => rb(r.id, false) }, 'Taslağa geri al'), ' ', h('button', { class: 'sm', onclick: () => rb(r.id, true) }, 'Geri al + yayınla'))]))); } }, 'Geçmiş'), status),
      body, hist);
    async function rb(id, publish) { if (!confirm(publish ? 'Bu sürüm geri alınıp YAYINLANSIN mı?' : 'Taslak bu sürüme geri alınsın mı?')) return; try { await flush(); await api('/content/' + key + '/rollback', { body: { revisionId: id, publish } }); toast('Geri alındı.'); open(key, el); } catch (e) { toast(msg(e), true); } }
  }
  VIEWS['İçerik'] = el => open('site', el);
})();
