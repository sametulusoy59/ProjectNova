'use strict';
// "build" step for hosts that insist on one (e.g. Hostinger's Node.js Web Apps): there is nothing to compile, so this only verifies the runtime.
const [maj, min] = process.versions.node.split('.').map(Number);
let sqlite = true; try { require('node:sqlite'); } catch { sqlite = false; }
if (maj < 22 || (maj === 22 && min < 13) || !sqlite) {
  console.error(`PROJECT NOVA needs Node.js 22.13 or newer (found ${process.version}; node:sqlite ${sqlite ? 'available' : 'MISSING'}). Choose Node 22.x (latest) or 24.x in the host's Node.js settings.`);
  process.exit(1);
}
console.log(`Runtime OK: Node ${process.version}. Nothing to build.`);
