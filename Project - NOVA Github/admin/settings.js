'use strict';
(() => {
  const kb = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const num = (v, a = {}) => h('input', { type: 'number', value: v, ...a, style: 'width:140px' });

  VIEWS['Kullanıcılar'] = async el => {
    const rows = await api('/users'), roles = [['owner', 'owner — her şey'], ['editor', 'editor — içerik + analitik'], ['viewer', 'viewer — yalnızca analitik']];
    const act = (fn, ok) => async () => { try { await fn(); toast(ok); show('Kullanıcılar'); } catch (e) { toast(msg(e), true); } };
    const un = h('input', { placeholder: 'kullanıcı.adı', 'aria-label': 'Kullanıcı adı' }), pw = h('input', { type: 'password', placeholder: 'parola (en az 12)', 'aria-label': 'Parola', autocomplete: 'new-password' }), rl = h('select', { 'aria-label': 'Rol' }, roles.map(([v, l]) => h('option', { value: v }, l)));
    rl.value = 'editor';
    el.append(h('h2', {}, 'Kullanıcılar'), h('p', { class: 'mut' }, 'Hesaplar silinmez, devre dışı bırakılır (denetim kayıtları korunur). Rol, devre dışı bırakma ve parola değişikliği o kullanıcının açık oturumlarını kapatır.'),
      table(['Kullanıcı', 'Rol', '2FA', 'Durum', ''], rows.map(u => [u.username, (() => { const s = h('select', { 'aria-label': 'Rol' }, roles.map(([v, l]) => h('option', { value: v }, l))); s.value = u.role; s.addEventListener('change', act(() => api('/users/' + u.id, { method: 'PATCH', body: { role: s.value } }), 'Rol güncellendi.')); return s; })(), u.totp_on ? 'açık' : '—', u.disabled ? 'devre dışı' : 'aktif',
        h('span', { class: 'row' }, h('button', { class: 'sm', onclick: act(() => api('/users/' + u.id, { method: 'PATCH', body: { disabled: !u.disabled } }), u.disabled ? 'Etkinleştirildi.' : 'Devre dışı bırakıldı.') }, u.disabled ? 'Etkinleştir' : 'Devre dışı bırak'),
          h('button', { class: 'sm', onclick: async () => { const p = prompt('Yeni parola (en az 12 karakter):'); if (p) await act(() => api('/users/' + u.id, { method: 'PATCH', body: { password: p } }), 'Parola değişti.')(); } }, 'Parola sıfırla'),
          u.totp_on ? h('button', { class: 'sm', onclick: () => confirm('Bu kullanıcının 2FA ayarı sıfırlansın mı?') && act(() => api('/users/' + u.id, { method: 'PATCH', body: { reset2fa: true } }), '2FA sıfırlandı.')() }, '2FA sıfırla') : '')])),
      h('h3', {}, 'Yeni kullanıcı'), h('div', { class: 'row' }, un, rl, pw, h('button', { onclick: act(() => api('/users', { body: { username: un.value, role: rl.value, password: pw.value } }), 'Kullanıcı oluşturuldu.') }, 'OLUŞTUR')));
  };

  VIEWS['Ayarlar'] = async el => {
    const [st, bk] = await Promise.all([api('/settings'), api('/backups')]), o = st.ops;
    const ret = num(o.retentionDays, { min: 7, max: 730 }), lcp = num(o.lcp, { min: 500, max: 10000 }), cls = num(o.cls, { min: 0.01, max: 1, step: 0.01 }), err = num(o.errors, { min: 1, max: 1000 }), on = h('input', { type: 'checkbox' }); on.checked = o.analytics !== false;
    const bkBox = h('div');
    const drawBk = list => bkBox.replaceChildren(table(['Yedek', 'Boyut', 'Zaman'], list.map(b => [b.name, kb(b.size), fmt(b.ts)])));
    drawBk(bk);
    el.append(h('h2', {}, 'Ayarlar'),
      h('h3', {}, 'Analitik ve gizlilik'), h('label', { class: 'f' }, h('span', {}, 'Ziyaretçi analitiği açık (kapatırsanız sunucu hiçbir olay kaydetmez, onay balonu da gösterilmez)'), on),
      h('label', { class: 'f' }, h('span', {}, 'Veri saklama süresi (gün, 7–730) — süresi dolan olaylar saatlik silinir'), ret),
      h('h3', {}, 'Uyarı eşikleri'), h('div', { class: 'row' }, h('label', { class: 'f' }, h('span', {}, 'LCP (ms)'), lcp), h('label', { class: 'f' }, h('span', {}, 'CLS'), cls), h('label', { class: 'f' }, h('span', {}, 'Günlük JS hatası'), err)),
      h('button', { onclick: async () => { try { await api('/settings', { method: 'PUT', body: { analytics: on.checked, retentionDays: +ret.value, lcp: +lcp.value, cls: +cls.value, errors: +err.value } }); toast('Ayarlar kaydedildi.'); } catch (e) { toast(msg(e), true); } } }, 'KAYDET'),
      h('p', { class: 'mut' }, 'E-posta bildirimi için bir e-posta sağlayıcısı (SMTP) gerekir; şimdilik uyarılar Genel Bakış sayfasında gösterilir.'),
      h('h3', {}, 'Yedekler'), h('button', { onclick: async () => { try { const r = await api('/backups', { body: {} }); toast('Yedek alındı: ' + r.name); drawBk(await api('/backups')); } catch (e) { toast(msg(e), true); } } }, 'ŞİMDİ YEDEK AL'),
      h('p', { class: 'mut' }, 'Yedekler sunucudaki veri klasörünün backups/ dizinine yazılır (son 14 tutulur). Sunucu dışına kopyalamayı unutmayın — DEPLOY-TR.md, bölüm 7.'), bkBox,
      h('h3', {}, 'Dışa aktar'), h('div', { class: 'row' }, h('a', { href: '/api/admin/export/content.json', download: '' }, 'İçeriği JSON indir ↓'), h('a', { href: '/api/admin/export/events.csv?days=365', download: '' }, 'Analitik olaylarını CSV indir ↓')),
      h('p', { class: 'mut' }, 'Sunucu: ' + (st.origin || 'PUBLIC_ORIGIN ayarlanmamış (SEO için ayarlayın)')));
  };

  const baseSec = VIEWS['Güvenlik'];
  VIEWS['Güvenlik'] = async el => {
    await baseSec(el);
    const me = await api('/me'), box = h('div'), done = () => show('Güvenlik');
    if (me.totp) {
      const pw = h('input', { type: 'password', placeholder: 'parola', 'aria-label': 'Parola', autocomplete: 'current-password' }), cd = h('input', { placeholder: '6 haneli kod veya kurtarma kodu', 'aria-label': 'Kod', autocomplete: 'one-time-code' });
      box.append(h('p', { class: 'up' }, 'İki adımlı doğrulama AÇIK.'), h('div', { class: 'row' }, pw, cd, h('button', { class: 'danger', onclick: async () => { try { await api('/2fa/disable', { body: { password: pw.value, code: cd.value } }); toast('2FA kapatıldı.'); done(); } catch (e) { toast(msg(e), true); } } }, '2FA\'YI KAPAT')));
    } else {
      box.append(h('p', { class: 'mut' }, 'Giriş sırasında parolaya ek olarak telefondaki doğrulama uygulamasından (Google Authenticator, Authy, 1Password…) 6 haneli kod istenir.'), h('button', { onclick: async () => {
        try {
          const r = await api('/2fa/start', { body: {} }), cd = h('input', { placeholder: '6 haneli kod', 'aria-label': 'Kod', autocomplete: 'one-time-code', inputmode: 'numeric' });
          box.replaceChildren(h('p', {}, 'Uygulamada "Anahtar gir / Enter a setup key" seçeneğini kullanın (hesap: ' + me.user.username + ', tür: zamana dayalı):'), h('code', { class: 'key' }, r.secret), h('p', { class: 'mut' }, 'Ya da bu bağlantıyı destekleyen bir uygulamada açın: '), h('code', { class: 'key' }, r.uri), h('div', { class: 'row' }, cd,
            h('button', { onclick: async () => { try { const e = await api('/2fa/enable', { body: { code: cd.value } }); box.replaceChildren(h('p', { class: 'up' }, '2FA etkinleştirildi.'), h('p', { class: 'dn' }, 'KURTARMA KODLARI — şimdi güvenli bir yere kaydedin, bir daha gösterilmez. Her biri bir kez kullanılır:'), h('code', { class: 'key' }, e.recoveryCodes.join('   ')), h('button', { onclick: done }, 'KAYDETTİM')); } catch (x) { toast(msg(x), true); } } }, 'DOĞRULA VE AÇ')));
        } catch (e) { toast(msg(e), true); }
      } }, '2FA\'YI ETKİNLEŞTİR'));
    }
    el.append(h('h3', {}, 'İki adımlı doğrulama (TOTP)'), box);
  };
})();
