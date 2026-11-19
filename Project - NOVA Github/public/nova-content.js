/* Applies PUBLISHED content from the Command Center over the site's built-in DATA. If the API is unreachable or nothing is published,
   the site keeps its built-in content untouched. ?nova_preview=1 (requires an admin session) previews DRAFTS instead.
   Mapping: site.{profile,contact,title,description}, projects[] (hidden:true is skipped), skills[], experience[] -> DATA.exp */
(async () => {
  try {
    /* NOVA visual enhancements: isolated from the 3D scene, pointer effects and admin content model. */
    const polish = document.createElement('style');
    polish.id = 'nova-polish-style';
    polish.textContent = `
      .nova-carousel{position:relative;width:100%;min-width:0}
      .nova-carousel .gallery{
        display:flex;flex-direction:row;gap:1.15rem;overflow-x:auto;overflow-y:hidden;
        padding:.85rem .35rem 1.5rem;scroll-snap-type:x mandatory;scroll-padding:0 .35rem;
        scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;
      }
      .nova-carousel .gallery::-webkit-scrollbar{display:none}
      .nova-carousel .card{
        flex:0 0 clamp(280px,37%,390px);width:auto;min-width:0;scroll-snap-align:center;
        border-radius:8px;border-color:rgba(0,217,255,.2);
        background:linear-gradient(155deg,rgba(10,25,48,.88),rgba(3,8,18,.94));
        box-shadow:0 12px 35px -24px rgba(0,136,255,.6);
        transform:scale(.975);opacity:.82;
      }
      .nova-carousel .card.is-active{
        transform:translateY(-3px) scale(1);opacity:1;
        border-color:rgba(0,217,255,.72);
        box-shadow:0 0 0 1px rgba(0,217,255,.08),0 18px 48px -22px rgba(0,136,255,.8),inset 0 1px rgba(255,255,255,.06);
      }
      .nova-carousel .card .orb{border-bottom:1px solid rgba(0,217,255,.14)}
      .nova-carousel .card .tx{min-height:190px;display:flex;flex-direction:column;align-items:flex-start}
      .nova-carousel .card .tags{margin-top:auto;padding-top:.7rem}
      .nova-carousel-ui{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:.1rem .2rem 0}
      .nova-carousel-dots{display:flex;align-items:center;justify-content:center;gap:.48rem;flex:1;flex-wrap:wrap}
      .nova-carousel-dot{width:7px;height:7px;padding:0;border:0;border-radius:50%;background:rgba(145,164,188,.4);cursor:pointer;transition:width .25s,background .25s,box-shadow .25s}
      .nova-carousel-dot[aria-current=true]{width:24px;border-radius:8px;background:var(--cyan);box-shadow:0 0 12px rgba(0,217,255,.65)}
      .nova-carousel-arrow{width:42px;height:42px;flex:0 0 42px;display:grid;place-items:center;border:1px solid rgba(0,217,255,.38);border-radius:50%;background:rgba(4,15,30,.78);color:var(--cyan);font:400 1.15rem var(--mono);cursor:pointer;transition:background .2s,border-color .2s,transform .2s,opacity .2s}
      .nova-carousel-arrow:hover:not(:disabled){background:rgba(0,217,255,.14);border-color:var(--cyan);transform:translateY(-2px);box-shadow:0 0 20px -8px var(--cyan)}
      .nova-carousel-arrow:disabled{opacity:.28;cursor:default}
      .cv-feature{position:relative;display:flex;align-items:center;justify-content:space-between;gap:1.5rem;
        max-width:760px;margin:0 auto 2rem;padding:clamp(1.2rem,3vw,1.8rem);
        border:1px solid rgba(0,217,255,.35);border-radius:9px;overflow:hidden;
        background:radial-gradient(ellipse at 0 50%,rgba(0,136,255,.17),transparent 58%),linear-gradient(120deg,rgba(8,24,46,.88),rgba(3,9,20,.9));
        box-shadow:inset 0 1px rgba(255,255,255,.05),0 16px 55px -35px rgba(0,136,255,.9);
      }
      .cv-feature:before{content:"";position:absolute;left:0;top:12%;bottom:12%;width:2px;background:linear-gradient(transparent,var(--cyan),transparent);box-shadow:0 0 16px var(--cyan)}
      .cv-feature-copy{display:flex;align-items:center;gap:1rem;min-width:0}
      .cv-feature-icon{width:52px;height:58px;flex:0 0 52px;display:grid;place-items:center;border:1px solid rgba(0,217,255,.35);border-radius:7px;background:rgba(0,217,255,.08);color:var(--cyan);box-shadow:inset 0 0 20px rgba(0,217,255,.06)}
      .cv-feature-icon svg{width:27px;height:27px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
      .cv-feature-kicker{display:block;margin-bottom:.2rem;color:var(--cyan);font:400 .65rem var(--mono);letter-spacing:.16em}
      .cv-feature-title{margin:0;color:var(--ice);font:600 clamp(1rem,2vw,1.2rem) var(--disp)}
      .cv-feature-desc{margin:.25rem 0 0;color:var(--mut);font-size:.85rem;line-height:1.5}
      .cv-feature-link{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:.65rem;padding:.78rem 1.05rem;border:1px solid rgba(0,217,255,.6);border-radius:5px;background:linear-gradient(110deg,rgba(0,136,255,.2),rgba(0,217,255,.08));color:var(--ice);text-decoration:none;font:400 .72rem var(--mono);letter-spacing:.06em;transition:transform .25s,box-shadow .25s,background .25s}
      .cv-feature-link:hover{transform:translateY(-2px);background:rgba(0,217,255,.17);box-shadow:0 0 26px -8px var(--cyan)}
      .cv-feature-link svg{width:16px;height:16px;stroke:var(--cyan);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      @media(max-width:767px){
        .nova-carousel .card{flex-basis:84%;transform:none;opacity:1}
        .nova-carousel .card.is-active{transform:translateY(-2px)}
        .nova-carousel-ui{gap:.65rem}
        .nova-carousel-arrow{width:38px;height:38px;flex-basis:38px}
        .cv-feature{align-items:flex-start;flex-direction:column;gap:1rem}
        .cv-feature-link{width:100%}
      }
      @media(prefers-reduced-motion:reduce){
        .nova-carousel .gallery{scroll-behavior:auto}
        .nova-carousel .card,.nova-carousel-arrow,.nova-carousel-dot,.cv-feature-link{transition:none}
      }
    `;
    document.head.appendChild(polish);

    function enhanceCarousel() {
      const gallery = document.getElementById('gallery');
      if (!gallery || !gallery.children.length) return;
      let shell = gallery.closest('.nova-carousel');
      if (!shell) {
        shell = document.createElement('div');
        shell.className = 'nova-carousel';
        gallery.parentNode.insertBefore(shell, gallery);
        shell.appendChild(gallery);
      }
      let ui = shell.querySelector('.nova-carousel-ui');
      if (!ui) {
        ui = document.createElement('div');
        ui.className = 'nova-carousel-ui';
        ui.innerHTML = '<button class="nova-carousel-arrow" type="button" data-dir="-1" aria-label="Önceki proje">‹</button><div class="nova-carousel-dots" aria-label="Proje seçimi"></div><button class="nova-carousel-arrow" type="button" data-dir="1" aria-label="Sonraki proje">›</button>';
        shell.appendChild(ui);
      }
      const cards = [...gallery.querySelectorAll('.card')];
      const dots = ui.querySelector('.nova-carousel-dots');
      if (dots.dataset.count !== String(cards.length)) {
        dots.innerHTML = '';
        cards.forEach((card, i) => {
          const dot = document.createElement('button');
          dot.type = 'button'; dot.className = 'nova-carousel-dot';
          dot.setAttribute('aria-label', (lang === 'tr' ? 'Proje ' : 'Project ') + (i + 1));
          dot.addEventListener('click', () => cards[i].scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'nearest', inline:'center'}));
          dots.appendChild(dot);
        });
        dots.dataset.count = String(cards.length);
      }
      const prev = ui.querySelector('[data-dir="-1"]'), next = ui.querySelector('[data-dir="1"]');
      const update = () => {
        const center = gallery.scrollLeft + gallery.clientWidth / 2;
        let active = 0, best = Infinity;
        cards.forEach((card, i) => {
          const mid = card.offsetLeft + card.offsetWidth / 2;
          const dist = Math.abs(mid - center);
          if (dist < best) { best = dist; active = i; }
          card.classList.toggle('is-active', dist < best + 1);
        });
        cards.forEach((card, i) => card.classList.toggle('is-active', i === active));
        [...dots.children].forEach((dot, i) => dot.setAttribute('aria-current', i === active ? 'true' : 'false'));
        prev.disabled = gallery.scrollLeft <= 3;
        next.disabled = gallery.scrollLeft + gallery.clientWidth >= gallery.scrollWidth - 3;
      };
      if (!gallery.dataset.carouselBound) {
        gallery.addEventListener('scroll', () => requestAnimationFrame(update), {passive:true});
        ui.addEventListener('click', e => {
          const btn = e.target.closest('[data-dir]');
          if (!btn || btn.disabled) return;
          const first = cards[0];
          const gap = parseFloat(getComputedStyle(gallery).gap) || 18;
          gallery.scrollBy({left: (first.getBoundingClientRect().width + gap) * Number(btn.dataset.dir), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
        });
        gallery.dataset.carouselBound = '1';
      }
      update();
    }

    function enhanceCv() {
      const links = document.getElementById('cl');
      if (!links || typeof DATA === 'undefined') return;
      const cv = String(DATA.contact && DATA.contact.cv || '').trim();
      let panel = document.getElementById('cvFeature');
      const cvLabel = (I18N[lang] && I18N[lang].cv) || (lang === 'tr' ? 'CV indir' : 'Download CV');
      const existing = [...links.querySelectorAll('a')].find(a => a.textContent.toLowerCase().includes(cvLabel.toLowerCase()));
      if (!cv) { if (panel) panel.remove(); return; }
      if (existing) existing.remove();
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'cvFeature';
        panel.className = 'cv-feature reveal in';
        links.parentNode.insertBefore(panel, links);
      }
      panel.innerHTML = '';
      const copy = document.createElement('div'); copy.className = 'cv-feature-copy';
      const icon = document.createElement('span'); icon.className = 'cv-feature-icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M10 12h5M10 15.5h5"/></svg>';
      const words = document.createElement('div');
      const kicker = document.createElement('span'); kicker.className = 'cv-feature-kicker'; kicker.textContent = 'PROFILE / DOCUMENT';
      const title = document.createElement('h3'); title.className = 'cv-feature-title'; title.textContent = lang === 'tr' ? 'Özgeçmişim' : 'Curriculum Vitae';
      const desc = document.createElement('p'); desc.className = 'cv-feature-desc'; desc.textContent = lang === 'tr' ? 'Deneyimimi, eğitimimi ve teknik yetkinliklerimi inceleyin.' : 'Explore my experience, education and technical skills.';
      words.append(kicker, title, desc); copy.append(icon, words);
      const action = document.createElement('a'); action.className = 'cv-feature-link'; action.href = cv;
      action.target = '_blank'; action.rel = 'noopener noreferrer'; action.setAttribute('aria-label', cvLabel);
      action.innerHTML = '<span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14"/></svg>';
      action.querySelector('span').textContent = cvLabel.toUpperCase();
      panel.append(copy, action);
    }

    /* Keep enhancements active when the language toggle or the Command Center rerenders content. */
    if (typeof window.render === 'function' && !window.render.__novaPolished) {
      const baseRender = window.render;
      const wrappedRender = function(...args) {
        const result = baseRender.apply(this, args);
        enhanceCarousel();
        enhanceCv();
        return result;
      };
      wrappedRender.__novaPolished = true;
      window.render = wrappedRender;
    }

    const preview = typeof location !== 'undefined' && /[?&]nova_preview=1/.test(location.search);
    let r = preview ? await fetch('/api/admin/preview', { credentials: 'same-origin' }) : null;
    if (!r || !r.ok) r = await fetch('/api/public/content', { credentials: 'omit' });
    if (!r.ok || typeof DATA === 'undefined') { enhanceCarousel(); enhanceCv(); return; }
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
    enhanceCarousel();
    enhanceCv();
  } catch (e) { /* keep built-in content */ }
})();
