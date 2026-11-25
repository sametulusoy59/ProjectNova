'use strict';
// Minimal SMTP client (no dependencies) for owner notifications. Configure with SMTP_HOST, SMTP_PORT (465 = TLS), SMTP_USER, SMTP_PASS,
// SMTP_FROM (defaults to SMTP_USER) and NOTIFY_TO. Without them, notifications are simply skipped.
const tls = require('node:tls'), net = require('node:net');
const clean = v => String(v == null ? '' : v).replace(/[\r\n\u0000]/g, ' ').trim();
const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const encWord = s => `=?UTF-8?B?${b64(clean(s))}?=`;
const addr = v => (/^[^\s@<>"'`,;]+@[^\s@<>"'`,;]+\.[^\s@<>"'`,;]+$/.test(clean(v)) ? clean(v) : '');
function config(env = process.env) {
  const c = { host: env.SMTP_HOST || '', port: +env.SMTP_PORT || 465, user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', from: addr(env.SMTP_FROM || env.SMTP_USER), to: addr(env.NOTIFY_TO), secure: env.SMTP_SECURE !== 'false' };
  c.ok = !!(c.host && c.from && c.to); return c;
}
function send(cfg, { subject, text, replyTo }, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const sock = cfg.secure ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : net.connect({ host: cfg.host, port: cfg.port });
    let buf = '', step = 0, done = false; const fail = e => { if (done) return; done = true; sock.destroy(); reject(e instanceof Error ? e : new Error(String(e))); };
    const t = setTimeout(() => fail(new Error('smtp_timeout')), timeoutMs);
    const body = [`From: ${encWord('NOVA')} <${cfg.from}>`, `To: <${cfg.to}>`, `Subject: ${encWord(subject)}`, ...(addr(replyTo) ? [`Reply-To: <${addr(replyTo)}>`] : []),
      `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', ...b64(text).match(/.{1,76}/g)].join('\r\n');
    const seq = [['EHLO nova', 250], ...(cfg.user ? [['AUTH LOGIN', 334], [b64(cfg.user), 334], [b64(cfg.pass), 235]] : []), [`MAIL FROM:<${cfg.from}>`, 250], [`RCPT TO:<${cfg.to}>`, 250], ['DATA', 354], [body + '\r\n.', 250], ['QUIT', 221]];
    sock.setEncoding('utf8'); sock.on('error', fail);
    sock.on('data', d => {
      buf += d; let m;
      while ((m = /^(\d{3})([ -])[^\r\n]*\r?\n/.exec(buf))) {
        buf = buf.slice(m[0].length); if (m[2] === '-') continue;   // multi-line reply: wait for the last line
        const code = +m[1], want = step === 0 ? 220 : seq[step - 1][1];
        if (code !== want) return fail(new Error('smtp_' + code));
        if (step === seq.length) { done = true; clearTimeout(t); sock.end(); return resolve(true); }
        sock.write(seq[step][0] + '\r\n'); step++;
      }
    });
  });
}
module.exports = { config, send, clean, addr };
