'use strict';
(async () => {
  try {
    if ((await api('/setup-status')).needed) return setup();
    const r = await api('/me'); S.perms = r.permissions || []; S.csrf = r.csrf; S.me = r.user; shell();
  } catch { login(); }
})();
