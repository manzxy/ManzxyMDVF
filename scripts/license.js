#!/usr/bin/env node
/**
 * CLI lisensi ManzxyMD Free (CLIENT / user).
 *
 * Key HANYA bisa dibuat oleh owner lewat bot ManzxyBase (.createkey).
 * Di sini hanya bisa memasang dan mengecek key.
 *
 *   node scripts/license.js fingerprint         lihat fingerprint mesin (kirim ke owner)
 *   node scripts/license.js install <key>       simpan key dari owner ke .license-key
 *   node scripts/license.js verify <key>        cek kevalidan key
 *   node scripts/license.js status              cek status lisensi saat ini
 */
const fs = require('fs');
const lic = require('../lib/core/license');

const [cmd, ...args] = process.argv.slice(2);
const fmt = (e) => (e ? new Date(e).toISOString() : 'SELAYAMNYA (lifetime)');

function showResult(r) {
    console.log(r.ok ? '✅ LISENSI AKTIF' : `❌ LISENSI TIDAK AKTIF [${r.reason}]`);
    console.log('   ' + r.message);
    if (r.payload) {
        console.log('   ID       :', r.payload.j);
        console.log('   Customer :', r.payload.c);
        console.log('   Tier     :', r.payload.t);
        console.log('   Berlaku  :', fmt(r.payload.e));
    }
}

switch (cmd) {
    case 'fingerprint':
        console.log('Fingerprint mesin ini:');
        console.log('  ' + lic.displayFingerprint());
        console.log('\nKirim kode ini ke owner untuk dibuatkan license key.');
        break;
    case 'install': {
        const key = args[0];
        if (!key) { console.error('Usage: node scripts/license.js install <key>'); process.exit(1); }
        const r = lic.verifyKey(key);
        if (!r.ok) {
            console.error(`❌ Key ditolak [${r.reason}]: ${r.message}`);
            process.exit(1);
        }
        lic.saveKey(key);
        console.log('✅ Key tersimpan di', lic.KEY_FILE);
        console.log('   Customer :', r.payload.c, '| Tier:', r.payload.t, '| Expiry:', fmt(r.payload.e));
        break;
    }
    case 'verify': {
        const key = args[0];
        if (!key) { console.error('Usage: node scripts/license.js verify <key>'); process.exit(1); }
        showResult(lic.verifyKey(key));
        break;
    }
    case 'status':
        showResult(lic.check());
        console.log('   Fingerprint mesin:', lic.displayFingerprint());
        break;
    case 'revoke-list':
        console.log('Daftar ID key yang dicabut:', lic.loadRevoked().join(', ') || '(kosong)');
        break;
    default:
        console.log('ManzxyMD Free — License Client\n');
        console.log('Perintah:');
        console.log('  fingerprint              lihat fingerprint mesin (kirim ke owner)');
        console.log('  install <key>            pasang key dari owner');
        console.log('  verify <key>             cek kevalidan key');
        console.log('  status                   cek status lisensi saat ini');
        console.log('  revoke-list              lihat daftar key yang dicabut');
        console.log('\nAtau pakai command WA: .setkey / .delkey / .license / .fingerprint');
        console.log('\nKey dibuat oleh owner lewat .createkey di bot ManzxyBase.');
        break;
}
