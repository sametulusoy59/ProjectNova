'use strict';
// Tiny .env loader (no dependency) for hosts where you cannot set environment variables in a panel.
// Real environment variables always win. Format: KEY=value  (# comments, optional quotes).
const fs = require('node:fs');
function parse(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('='); if (i < 1) continue;
    const key = line.slice(0, i).trim(); if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    let v = line.slice(i + 1).trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '').trim();
    out[key] = v;
  }
  return out;
}
function load(file) { try { for (const [k, v] of Object.entries(parse(fs.readFileSync(file, 'utf8')))) if (process.env[k] === undefined) process.env[k] = v; } catch { /* no .env: fine */ } }
module.exports = { load, parse };
