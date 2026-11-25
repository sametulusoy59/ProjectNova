'use strict';
// Visitor stars: every submission waits here; only approved ones appear in the public sky.
VIEWS['Yıldızlar'] = async el => {
  const rows = await api('/stars'), pend = rows.filter(r => r.status === 'pending');
  const lab = { pending: ['BEKLİYOR', 'warn'], approved: ['YAYINDA', 'on'], rejected: ['REDDEDİLDİ', ''] };
  const act = (r, what) => h('button', { class: 'sm' + (what === 'delete' || what === 'reject' ? ' danger' : ''), onclick: async () => {
    if (what === 'delete' && !confirm(`"${r.name}" kalıcı olarak silinsin mi?`)) return;
    try { await api(`/stars/${r.id}${what === 'delete' ? '' : '/' + what}`, { method: what === 'delete' ? 'DELETE' : 'POST', body: what === 'delete' ? undefined : {} }); toast(what === 'approve' ? 'Yıldız gökyüzünde.' : what === 'reject' ? 'Reddedildi.' : 'Silindi.'); show('Yıldızlar'); } catch (e) { toast(msg(e), true); }
  } }, { approve: 'ONAYLA', reject: 'REDDET', delete: 'SİL' }[what]);
  el.append(h('h2', {}, 'Ziyaretçi yıldızları'),
    h('p', { class: 'mut' }, `Ziyaretçiler kapanış sahnesindeki gökyüzüne bir isim ve kısa bir not bırakabilir. Onaylamadığınız hiçbir şey sitede görünmez. ${pend.length} kayıt onay bekliyor. Yıldızla birlikte IP, çerez veya e-posta saklanmaz; reddedilenler 30 gün sonra kendiliğinden silinir. Özelliği "İçerik → Tema & 3D" bölümünden kapatabilirsiniz.`),
    table(['Tarih', 'Renk', 'İsim', 'Not', 'Durum', ''], rows.map(r => [fmt(r.ts), h('span', { class: 'chip', style: `border-color:hsl(${r.hue} 100% 65%);color:hsl(${r.hue} 100% 70%)` }, '★'), r.name, r.msg || '—',
      h('span', { class: 'chip ' + lab[r.status][1] }, lab[r.status][0]),
      h('span', { class: 'row', style: 'margin:0;gap:.4rem' }, r.status !== 'approved' ? act(r, 'approve') : '', r.status === 'pending' ? act(r, 'reject') : '', act(r, 'delete'))])));
};
