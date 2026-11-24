'use strict';
process.env.NOVA_EMBEDDED = '1';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createApp } = require('../server');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 16, 0, 32, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
let app, base, jar = '', csrf = '';
const call = async (m, p, body, o = {}) => {
  const cookie = 'cookie' in o ? o.cookie : jar, token = 'token' in o ? o.token : csrf, raw = Buffer.isBuffer(body);
  const r = await fetch(base + p, { method: m, redirect: 'manual', headers: { ...(body !== undefined ? { 'content-type': raw ? 'application/octet-stream' : 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(token ? { 'x-csrf-token': token } : {}), ...(o.headers || {}) }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch {}
  return { status: r.status, json, headers: r.headers, buf };
};
test.before(async () => {
  app = createApp({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'nova-p4-')), quiet: true, setupToken: 'tok-123456789', maxUpload: 200 * 1024 });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + app.server.address().port;
});
test.after(() => app.close());

test('first-run setup: needs the token, creates the owner once, then locks itself', async () => {
  assert.equal((await call('GET', '/api/admin/setup-status')).json.needed, true);
  assert.equal((await call('POST', '/api/admin/setup', { token: 'wrong', username: 'owner', password: 'a very long password' })).status, 403);
  assert.equal((await call('POST', '/api/admin/setup', { token: 'tok-123456789', username: 'owner', password: 'short' })).status, 422);
  const r = await call('POST', '/api/admin/setup', { token: 'tok-123456789', username: 'Owner', password: 'a very long password' });
  assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /HttpOnly/); jar = r.headers.get('set-cookie').split(';')[0]; csrf = r.json.csrf;
  assert.equal((await call('GET', '/api/admin/setup-status')).json.needed, false);
  assert.equal((await call('POST', '/api/admin/setup', { token: 'tok-123456789', username: 'second', password: 'another long password' }, { cookie: '' })).status, 409, 'setup is single-use');
  assert.equal((await call('GET', '/api/admin/me')).json.permissions.includes('audit'), true);
});
test('editor starts from the site\'s real built-in content (nothing to retype)', async () => {
  const d = (await call('GET', '/api/admin/defaults')).json;
  assert.equal(d.site.profile.name, 'Çağrı Samet ULUSOY'); assert.ok(d.projects.length >= 3 && d.projects[0].title.tr); assert.ok(d.skills.length >= 4 && d.experience.length >= 1);
  assert.equal((await call('GET', '/api/admin/defaults', undefined, { cookie: '' })).status, 401);
});
test('URL and e-mail fields are validated server-side (no javascript: links)', async () => {
  for (const bad of [{ contact: { github: 'javascript:alert(1)' } }, { contact: { linkedin: 'data:text/html,x' } }, { contact: { email: 'x"onmouseover=' } }, { contact: { cv: '//evil.example/x' } }])
    assert.equal((await call('PUT', '/api/admin/content/site', { body: bad })).status, 422, JSON.stringify(bad));
  assert.equal((await call('PUT', '/api/admin/content/site', { body: { title: 'T', contact: { email: 'me@example.com', github: 'https://github.com/x', cv: '/media/abc' } } })).status, 200);
  assert.equal((await call('PUT', '/api/admin/content/skills', { body: { not: 'array' } })).status, 422);
});
test('preview serves drafts only to an authenticated admin', async () => {
  assert.equal((await call('GET', '/api/admin/preview')).json.site.title, 'T');
  assert.equal((await call('GET', '/api/admin/preview', undefined, { cookie: '' })).status, 401);
  assert.deepEqual((await call('GET', '/api/public/content', undefined, { cookie: '' })).json, {}, 'draft is not public');
});
test('media: magic-byte validation, safe names, limits, auth, alt text, usage protection', async () => {
  assert.equal((await call('POST', '/api/admin/media', PNG, { cookie: '', token: '' })).status, 401);
  assert.equal((await call('POST', '/api/admin/media', PNG, { token: '' })).status, 403, 'CSRF');
  for (const bad of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), Buffer.from('<html><script>alert(1)</script>'), Buffer.from('GIF89a....'), Buffer.alloc(10)])
    assert.equal((await call('POST', '/api/admin/media', bad, { headers: { 'x-filename': 'evil.png' } })).status, 415);
  assert.equal((await call('POST', '/api/admin/media', Buffer.concat([PNG, Buffer.alloc(300 * 1024)]))).status, 413);
  const up = await call('POST', '/api/admin/media', PNG, { headers: { 'x-filename': encodeURIComponent('../../etc/pa<ss>wd.png') } });
  assert.equal(up.status, 201); assert.equal(up.json.w, 1); assert.ok(!/[/<>\\]/.test(up.json.name), up.json.name); assert.match(up.json.file, /^[A-Za-z0-9_-]{16}\.png$/);
  const jp = await call('POST', '/api/admin/media', JPG); assert.equal(jp.status, 201); assert.equal(jp.json.w, 32); assert.equal(jp.json.h, 16);
  const served = await call('GET', '/media/' + up.json.file, undefined, { cookie: '' });
  assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/png'); assert.equal(served.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(served.buf, PNG);
  assert.equal((await call('GET', '/media/..%2f..%2fnova.db', undefined, { cookie: '' })).status, 404);
  assert.equal((await call('PATCH', '/api/admin/media/' + up.json.id, { alt: 'Küçük test görseli' })).status, 200);
  const list = (await call('GET', '/api/admin/media')).json; assert.equal(list.find(x => x.id === up.json.id).alt, 'Küçük test görseli'); assert.equal(list[0].used, false);
  // reference it from content -> deletion is refused unless forced
  await call('PUT', '/api/admin/content/projects', { body: [{ title: { en: 'P', tr: 'P' }, image: '/media/' + up.json.file }] });
  assert.equal((await call('GET', '/api/admin/media')).json.find(x => x.id === up.json.id).used, true);
  assert.equal((await call('DELETE', '/api/admin/media/' + up.json.id)).status, 409);
  assert.equal((await call('DELETE', '/api/admin/media/' + up.json.id + '?force=1')).status, 200);
  assert.equal((await call('GET', '/media/' + up.json.file, undefined, { cookie: '' })).status, 404);
  assert.equal((await call('DELETE', '/api/admin/media/' + jp.json.id)).status, 200);
});
test('admin shell serves every script from self and none inline', async () => {
  const html = (await call('GET', '/admin/', undefined, { cookie: '' })).buf.toString();
  for (const f of ['admin.js', 'editor.js', 'media.js', 'analytics.js', 'settings.js', 'boot.js']) { assert.match(html, new RegExp(f)); assert.equal((await call('GET', '/admin/' + f, undefined, { cookie: '' })).status, 200); }
  assert.ok(!/<script>[^<]/.test(html));
});

test('CV: PDF uploads are accepted, served as a download with a friendly name; fake PDFs are rejected', async () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const up = await call('POST', '/api/admin/media', pdf, { headers: { 'x-filename': encodeURIComponent('Çağrı CV.pdf') } });
  assert.equal(up.status, 201); assert.match(up.json.file, /\.pdf$/); assert.equal(up.json.w, null);
  const r = await call('GET', '/media/' + up.json.file, undefined, { cookie: '' });
  assert.equal(r.headers.get('content-type'), 'application/pdf'); assert.match(r.headers.get('content-disposition'), /^attachment; filename=".*\.pdf"; filename\*=UTF-8''%C3%87a%C4%9Fr%C4%B1%20CV\.pdf$/);
  assert.equal((await call('POST', '/api/admin/media', Buffer.from('<html>%PDF-1.4</html>'))).status, 415);
  assert.equal((await call('DELETE', '/api/admin/media/' + up.json.id)).status, 200);
});
