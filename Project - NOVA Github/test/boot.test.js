'use strict';
// How hosts start the app: as the main script, LOADED by another script (Passenger-style), and with a broken environment.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'); const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const run = (args, env) => { const e = { ...process.env, ...env }; delete e.NOVA_EMBEDDED; delete e.NODE_TEST_CONTEXT; const c = spawn(process.execPath, ['--no-warnings', ...args], { cwd: root, env: e, stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; c.stdout.on('data', d => (out += d)); c.stderr.on('data', d => (out += d)); return { c, log: () => out }; };
const get = async (port, p) => { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${port}${p}`); return { status: r.status, text: await r.text() }; } catch { await new Promise(r => setTimeout(r, 100)); } } throw new Error('server never answered'); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nova-boot-'));

test('started as the main script: listens on PORT', async () => {
  const { c } = run(['server.js'], { PORT: '3971', DATA_DIR: tmp() }); try { assert.equal((await get(3971, '/api/health')).status, 200); } finally { c.kill(); }
});
test('LOADED by another script (Passenger/loader style): still listens', async () => {
  const { c } = run(['-e', "require('./server.js')"], { PORT: '3972', DATA_DIR: tmp() }); try { assert.equal((await get(3972, '/api/health')).status, 200); } finally { c.kill(); }
});
test('unusable DATA_DIR: a diagnostic page (500) explains the cause instead of an opaque 503', async () => {
  const f = path.join(tmp(), 'a-file'); fs.writeFileSync(f, 'x');            // a FILE where a directory is expected -> ENOTDIR/EEXIST
  const { c, log } = run(['server.js'], { PORT: '3973', DATA_DIR: path.join(f, 'data') }); try {
    const r = await get(3973, '/'); assert.equal(r.status, 500); assert.match(r.text, /Sunucu başlatılamadı/); assert.ok(!r.text.includes(f), 'must not leak the path'); assert.match(log(), /STARTUP FAILED/);
  } finally { c.kill(); }
});
