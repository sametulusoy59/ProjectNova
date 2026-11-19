'use strict';
// docker compose exec app node scripts/backup.js   (the admin panel's Settings page can also create backups)
const path = require('node:path'); const { open } = require('../lib/db'); const { makeBackup } = require('../lib/backup');
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), db = open(dir);
console.log('Backup written to', path.join(dir, 'backups', makeBackup(db, dir))); db.close();
