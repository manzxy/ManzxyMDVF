#!/usr/bin/env node
/**
 * MIGRASI SESI Baileys -> zapo-js (tanpa pairing ulang).
 *
 * PEMAKAIAN:
 *   node scripts/migrate-session-zapo.js                 # sesi utama
 *   node scripts/migrate-session-zapo.js <authDir> <dbPath> <sessionId>
 *
 * PERINGATAN:
 *   - Jalankan saat bot PM2 dalam keadaan STOP.
 *   - Skrip ini TIDAK menghapus sesi lama; backup otomatis dibuat.
 *   - Setelah migrasi, aktifkan dengan WA_ENGINE=zapo di ecosystem.config.js
 *     (atau `WA_ENGINE=zapo pm2 restart ManzxyMD`).
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { migrateBaileysSessionToZapo } = require('../lib/wa/zapoCompat');

const config = require('../config');
require('../lib/core/configDefaults').apply(config);

const authDir = path.resolve(process.argv[2] || path.join(__dirname, '..', config.sessionName));
const dbDir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'session_zapo'));
const sessionId = process.argv[4] || config.sessionName || 'main';
const dbPath = path.join(dbDir, `${sessionId}.sqlite`);

async function main() {
    if (!fs.existsSync(path.join(authDir, 'creds.json'))) {
        throw new Error('creds.json tidak ditemukan di ' + authDir);
    }
    if (fs.existsSync(dbPath)) {
        const backup = `${dbPath}.bak-${Date.now()}`;
        fs.copyFileSync(dbPath, backup);
        console.log('DB lama dibackup ke:', backup);
    }
    fs.mkdirSync(dbDir, { recursive: true });

    console.log('Migrasi sesi:');
    console.log('  dari :', authDir);
    console.log('  ke   :', dbPath);
    console.log('  id   :', sessionId);

    const result = await migrateBaileysSessionToZapo({ authDir, dbPath, sessionId });
    console.log('\n✔ Migrasi berhasil');
    console.log('  key types :', result.keyTypes.join(', '));
    console.log('  losses    :', result.losses?.length || 0);
    if (result.losses?.length) console.log('  detail    :', JSON.stringify(result.losses, null, 2));
    console.log('\nAktifkan dengan: WA_ENGINE=zapo pm2 restart ManzxyMD');
}

main().catch((err) => {
    console.error('\n✘ Migrasi gagal:', err.message);
    console.error(err.stack);
    process.exit(1);
});
