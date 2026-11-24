/* Applies PUBLISHED content from the Command Center over the site's built-in DATA. If the API is unreachable or nothing is published,
   the site keeps its built-in content untouched. ?nova_preview=1 (requires an admin session) previews DRAFTS instead.
   Mapping: site.{profile,contact,title,description}, projects[] (hidden:true is skipped), skills[], experience[] -> DATA.exp */
(async () => {
  try {
    const preview = typeof location !== 'undefined' && /[?&]nova_preview=1/.test(location.search);
    let r = preview ? await fetch('/api/admin/preview', { credentials: 'same-origin' }) : null;
    if (!r || !r.ok) r = await fetch('/api/public/content', { credentials: 'omit' });
    if (!r.ok || typeof DATA === 'undefined') return;
    const c = await r.json(); let changed = false;
    if (c.site) {
      if (c.site.profile) Object.assign(DATA.profile, c.site.profile);
      if (c.site.contact) Object.assign(DATA.contact, c.site.contact);
      if (c.site.title) document.title = String(c.site.title);
      const m = document.querySelector('meta[name=description]'); if (m && c.site.description) m.setAttribute('content', String(c.site.description));
      changed = true;
    }
    if (Array.isArray(c.projects)) { DATA.projects = c.projects.filter(p => !p.hidden); changed = true; }
    if (Array.isArray(c.skills)) { DATA.skills = c.skills; changed = true; }
    if (Array.isArray(c.experience)) { DATA.exp = c.experience; changed = true; }
    if (changed && typeof render === 'function') render();
    if (preview && r.url.includes('/preview')) { const b = document.createElement('div'); b.textContent = 'ÖNİZLEME — yayınlanmamış taslak'; b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:300;background:#ffb454;color:#02040A;text-align:center;font:600 12px monospace;padding:4px'; document.body.append(b); }
  } catch (e) { /* keep built-in content */ }
})();
