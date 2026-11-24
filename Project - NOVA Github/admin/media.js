'use strict';
VIEWS['Medya'] = async el => {
  const list = h('div', { class: 'grid' }), input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,application/pdf', multiple: '', 'aria-label': 'Görsel yükle' });
  const zone = h('div', { class: 'drop' }, 'Görselleri veya CV PDF\'inizi buraya sürükleyin ya da seçin (PNG, JPG, WEBP, PDF · en fazla 5 MB)', h('br'), input);
  async function upload(files) {
    for (const file of files) {
      try { if (file.size > 5 * 1048576) throw new Error('too_large'); await api('/media', { raw: file, headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) } }); toast(file.name + ' yüklendi.'); }
      catch (e) { toast(file.name + ': ' + msg(e), true); }
    }
    draw();
  }
  input.addEventListener('change', () => upload([...input.files]));
  ['dragover', 'dragenter'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', e => upload([...e.dataTransfer.files]));
  async function draw() {
    const rows = await api('/media'), kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
    list.replaceChildren(...(rows.length ? rows.map(r => {
      const alt = h('input', { type: 'text', value: r.alt, placeholder: 'Alt metin (erişilebilirlik)', 'aria-label': 'Alt metin', maxlength: 300 });
      alt.addEventListener('change', async () => { try { await api('/media/' + r.id, { method: 'PATCH', body: { alt: alt.value } }); toast('Alt metin kaydedildi.'); } catch (e) { toast(msg(e), true); } });
      return h('div', { class: 'mcard' }, (r.mime === 'application/pdf' ? h('div', { class: 'pdfbox' }, 'PDF') : h('img', { src: '/media/' + r.file, alt: r.alt || r.name, loading: 'lazy' })), h('small', {}, `${r.name}${r.w ? ` · ${r.w}×${r.h}` : ''} · ${kb(r.size)}`), h('div', {}, h('span', { class: 'chip ' + (r.used ? 'on' : '') }, r.used ? 'kullanımda' : 'kullanılmıyor')), alt,
        h('div', { class: 'row' }, h('button', { class: 'sm', onclick: async () => { try { await navigator.clipboard.writeText(location.origin + '/media/' + r.file); toast('Bağlantı kopyalandı.'); } catch { toast('/media/' + r.file); } } }, 'URL kopyala'),
          h('button', { class: 'sm danger', onclick: async () => {
            if (!confirm('Bu görsel silinsin mi?')) return;
            try { await api('/media/' + r.id, { method: 'DELETE' }); } catch (e) { if (e.status === 409 && confirm('Bu görsel içerikte KULLANILIYOR. Yine de silinirse sitede kırık görsel olur. Silinsin mi?')) await api('/media/' + r.id + '?force=1', { method: 'DELETE' }); else if (e.status !== 409) return toast(msg(e), true); else return; }
            draw();
          } }, 'Sil')));
    }) : [h('div', { class: 'empty' }, 'Henüz görsel yok.')]));
  }
  el.append(h('h2', {}, 'Medya kütüphanesi'), zone, list); await draw();
};
