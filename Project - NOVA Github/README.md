# PROJECT NOVA — site + NOVA COMMAND CENTER (audit, secure foundation, analytics core)

Zero npm dependencies. Requires **Node >= 22.13** (built-in `node:sqlite`, `node:crypto`, `node:http`).

## Architecture
```
public/index.html       your existing site, byte-identical except 2 added <script> tags (a test verifies this)
public/nova-track.js    consent-gated, privacy-first analytics client
public/nova-content.js  applies PUBLISHED content over the site's built-in DATA (silent fallback if the API is down)
server.js               static hosting + JSON API (auth, content, analytics ingest, audit)
lib/db.js               SQLite schema: users, sessions, content, revisions, events, audit, login_events
lib/security.js         scrypt hashing, rate limiter, tamper-evident audit chain
admin/                  NOVA COMMAND CENTER shell (strict CSP: no inline scripts or styles)
scripts/create-admin.js, test/*.test.js
```
A static host or a single HTML file cannot provide secure authentication, persistent content or server-side
analytics. This needs a running server with a persistent disk (VPS, Fly.io, Railway, Render with a disk, ...).

## Setup
```bash
cp .env.example .env                      # export these variables in your process manager
node scripts/create-admin.js you owner    # prompts for a password (min 12 chars) or set ADMIN_PASSWORD
npm start                                 # site: http://localhost:3000/   admin: http://localhost:3000/admin/
npm test                                  # 36 tests
```
**Deploy:** run behind an HTTPS reverse proxy (Caddy/nginx). Set `NODE_ENV=production` (Secure `__Host-` cookie, HSTS).
Set `TRUST_PROXY=true` only if the proxy is yours. Keep `DATA_DIR` on persistent storage **outside** the web root and
back it up (`sqlite3 nova.db ".backup out.db"`; managed backups are planned for a later phase).

## Security implemented
- scrypt (N=32768) password hashing; opaque 256-bit session tokens stored only as SHA-256.
- HttpOnly + SameSite=Strict (+ Secure in production) cookies; absolute and idle session expiry; revocation on logout,
  password change and "revoke others".
- Per-session CSRF token plus Origin check on every mutation.
- Login throttling per user (5) and per IP (20) per 15 minutes; unknown-user path is timing-equalised.
- Server-side role checks (owner / editor / viewer) on every protected endpoint.
- JSON validation (size, depth, forbidden keys, `javascript:` URL rejection); parameterised SQL only.
- Strict CSP on the admin; CSP, nosniff and frame denial on the site; traversal-safe static server.
- IP addresses are never stored (only a salted short hash for login forensics).
- Audit log is hash-chained and append-only (SQL triggers + verify endpoint). A database-level attacker is
  *detected*, not prevented.

## Analytics: what is tracked
Nothing is sent before the visitor clicks **Allow**. DNT / Global Privacy Control = decline. The server also refuses
events without `consent:true`. No cookies, no IP, no input values or keystrokes. The session id is random and lives in
`sessionStorage` only; the server re-hashes it with a **daily-rotating salt**, so people cannot be linked across days.
Consequence: "visitors" are per day. Retention: `ANALYTICS_RETENTION_DAYS` (default 90), purged hourly.
Disable entirely by removing the `nova-track.js` tag. Visitors can withdraw via the "Privacy / Gizlilik" footer button.

| Event | When | Fields |
|---|---|---|
| session_start, page_view | after consent | referrer reduced to category (direct/search/social/internal/other) + domain |
| section_view | section >= 40% visible, once per session | section |
| nav_click, project_click, link_click, contact_click, cv_download, cta_click | clicks (delegated) | `el`, e.g. `project:example-project-a`, `contact:email` |
| lang_switch | language toggle | `lang:tr` or `lang:en` |
| scroll_depth | 25 / 50 / 75 / 100 % | meta.pct |
| scene_transition | HUD scene change | meta.scene 1-5 |
| engagement, perf | tab hidden / pagehide | meta.sec; meta.lcp, cls, webgl |
| js_error | window error (max 5 per session) | message <= 80 chars, line; no stack |

The server adds a timestamp, device / browser / OS class (from the UA string, which is not stored), language, and
country only if your CDN sends `CF-IPCountry` or `x-vercel-ip-country` (otherwise geography is unavailable).

## Content model (the Command Center writes it; the site reads published content only)
`site` {profile:{name,bio:{en,tr},interests}, contact:{email,github,linkedin,cv}, title, description},
`projects[]` (same shape as DATA.projects), `skills[]`, `experience[]`, `theme` (reserved).
Draft, publish and rollback with 100 revisions per key and optimistic concurrency (`base` version, 409 on conflict).
Unpublished keys fall back to the site's built-in content.

## API
Public: `GET /api/public/content`, `POST /api/collect`, `GET /api/health`.
Admin (cookie + `X-CSRF-Token`): `/api/admin/{login, logout, me, password, sessions, sessions/revoke-others, logins,
audit, audit/verify, analytics/summary?days=N, content, content/:key[/publish|unpublish|rollback|revisions]}`.

## Status
Done and tested (36 tests incl. a fake-DOM run of every admin view against the real server):
- Secure foundation: scrypt, sessions, CSRF, rate limits, roles, hash-chained audit log, optional **TOTP 2FA** (+ single-use recovery codes),
  **user management** (owner only; no self-lockout, last-owner protection), password change/reset script.
- **First-run setup** in the browser, **content editor** (site / projects / skills / experience; bilingual; autosave; preview; publish;
  history + rollback), **media library**, project cover images.
- **Theme & 3D settings** that the site really honours (accent colours, particle/star density, glow, core size, quality preset, shooting
  stars, cursor trail, intro length, scroll smoothness, spacing, radius, grain, vignette) - injected server-side, previewable, resettable.
- **SEO**: title/description, canonical, Open Graph/Twitter, JSON-LD (Person), robots.txt, sitemap.xml, SEO check, SSRF-guarded link checker.
- **Analytics**: consent-gated tracker, overview, funnel (configurable), click map, exit sections, scroll depth, device/browser/language/
  country, traffic-source quality, per-device filter, CSV/JSON export, alerts (errors, LCP/CLS, failed logins, traffic spikes, missing backups).
- **Ops**: in-panel backups, retention + analytics kill switch, Docker + automatic HTTPS kit. See **DEPLOY-TR.md**.

**Honest limits:** no real-browser/visual testing was possible where this was built (the UI test checks wiring, not looks); Docker files were not
built there; e-mail notifications and e-mail password reset need an SMTP provider (not built - alerts show in the panel instead); passkeys,
light admin theme and drag-and-drop ordering are not implemented (buttons are used); geography needs a CDN country header; the 3D core's
colour palette is fixed in the shaders (the accent colour recolours the UI, not the core); the click map shows screen positions, not an
overlay on a page screenshot, because the site is a fixed 3D scene; "visitors" are per-day anonymous IDs by design.
