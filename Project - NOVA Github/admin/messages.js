'use strict';
// Contact form inbox + nav badges (pending stars, unread messages).
VIEWS['Mesajlar'] = async el => {
  const rows = await api('/messages'), b = await api('/badges').catch(() => ({}));
  el.append(h('h2', {}, 'Mesajlar'),
    h('p', { class: 'mut' }, `Sitedeki iletişim formundan gelenler. Mesajlar en fazla 1 yıl saklanır; IP veya çerez kaydedilmez. ${b.mail ? 'Yeni mesajlarda size e-posta bildirimi gidiyor.' : 'E-posta bildirimi kapalı: açmak için sunucu ortam değişkenlerine SMTP_HOST, SMTP_USER, SMTP_PASS ve NOTIFY_TO ekleyin (Hostinger e-posta hesabınızla çalışır).'}`),
    rows.length ? h('div', {}, rows.map(r => h('div', { class: 'alert' + (r.read ? '' : ' warn'), style: 'margin-bottom:.8rem' },
      h('b', {}, `${r.name} · ${r.email}`), h('small', { class: 'mut' }, fmt(r.ts) + (r.read ? '' : ' · YENİ')),
      h('p', { style: 'white-space:pre-wrap;margin:.5rem 0' }, r.body),
      h('div', { class: 'row', style: 'margin:0;gap:.4rem' },
        h('a', { class: 'chip on', href: `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent('Re: cagrisametulusoy.com')}` }, 'YANITLA ↗'),
        h('button', { class: 'sm', onclick: async () => { try { await api(`/messages/${r.id}/${r.read ? 'unread' : 'read'}`, { body: {} }); show('Mesajlar'); badges(); } catch (e) { toast(msg(e), true); } } }, r.read ? 'OKUNMADI YAP' : 'OKUNDU'),
        h('button', { class: 'sm danger', onclick: async () => { if (!confirm('Bu mesaj kalıcı olarak silinsin mi?')) return; try { await api(`/messages/${r.id}`, { method: 'DELETE' }); show('Mesajlar'); badges(); } catch (e) { toast(msg(e), true); } } }, 'SİL'))))) : h('div', { class: 'empty' }, 'Henüz mesaj yok.'));
  if (rows.some(r => !r.read)) { /* opening the inbox does not auto-mark; the owner decides */ }
};
async function badges() {
  try {
    const b = await api('/badges'), set = (name, n) => { const btn = document.querySelector(`nav button[data-v="${name}"]`); if (!btn) return; let i = btn.querySelector('.badge'); if (!n) { i && i.remove(); return; } if (!i) { i = h('i', { class: 'badge' }); btn.append(i); } i.textContent = n > 99 ? '99+' : n; };
    set('Yıldızlar', b.stars); set('Mesajlar', b.messages); document.title = (b.stars + b.messages ? `(${b.stars + b.messages}) ` : '') + 'NOVA COMMAND CENTER';
  } catch {}
}
setInterval(() => { if (document.querySelector('nav button[data-v]')) badges(); }, 60000);
