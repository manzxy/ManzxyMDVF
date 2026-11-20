#!/usr/bin/env node
/**
 * CLI pengelola lisensi ManzxyMD Free.
 *
 *   node scripts/license.js secret                  → buat .license-secret (secret penandatangan)
 *   node scripts/license.js fingerprint             → tampilkan fingerprint mesin ini
 *   node scripts/license.js issue <nama> <hari> [fingerprint] [tier]
 *   node scripts/license.js verify <key>
 *   node scripts/license.js install <key>           → simpan key ke .license-key
 *   node scripts/license.js status                  → cek status lisensi saat ini
 *
 * Contoh:
 *   node scripts/license.js secret
 *   node scripts/license.js fingerprint
 *   node scripts/license.js issue "Toko A" 30 abc123def4567890
 *   node scripts/license.js issue "Toko B" 0 abc123def4567890 lifetime
 *   node scripts/license.js install MZF-xxx.yyy
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lic = require('../lib/core/license');

const ROOT = path.join(__dirname, '..');
const SECRET_FILE = path.join(ROOT, '.license-secret');
const [cmd, ...args] = process.argv.slice(2);

function ensureSecret() {
    if (lic.loadSecret()) return lic.loadSecret();
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret + '\n', { mode: 0o600 });
    console.log('✅ Secret dibuat:', SECRET_FILE);
    console.log('   JANGAN pernah bagikan / commit file ini ke repo mana pun.');
    return secret;
}

function fmtExpiry(e) {
    return e ? new Date(e).toISOString() : 'SELAYAMNYA (lifetime)';
}

switch (cmd) {
    case 'secret': {
        if (fs.existsSync(SECRET_FILE)) {
            console.log('⚠️  .license-secret sudah ada. Tidak ditimpa.');
        } else ensureSecret();
        console.log('   Secret saat ini:', lic.loadSecret() ? '✅ tersedia' : '❌ tidak ada');
        break;
    }
    case 'fingerprint': {
        console.log('Fingerprint mesin ini:');
        console.log('  ' + lic.displayFingerprint());
        console.log('\nBerikan ke penyedia lisensi, lalu mereka kirim balik key untuk mesin ini.');
        break;
    }
    case 'issue': {
        const [customer, daysRaw, fingerprint, tier] = args;
        if (!customer || !daysRaw || !fingerprint) {
            console.error('Usage: node scripts/license.js issue <nama> <hari> <fingerprint> [tier]');
            console.error('   hari = 0 berarti lifetime (tidak kedaluwarsa).');
            process.exit(1);
        }
        const secret = ensureSecret();
        const days = Number(daysRaw);
        const { key, payload } = lic.issueKey({ customer, days, fingerprint, tier: tier || 'free', secret });
        console.log('\n=== LICENSE KEY ===');
        console.log(key);
        console.log('\n=== DETAIL ===');
        console.log('Customer    :', payload.c);
        console.log('Fingerprint :', payload.f.toUpperCase());
        console.log('Tier        :', payload.t);
        console.log('Berlaku s/d :', fmtExpiry(payload.e));
        console.log('\nKirim key ini ke user. Mereka pasang lewat .setkey <key> di bot atau');
        console.log('node scripts/license.js install <key>.');
        break;
    }
    case 'verify': {
        const key = args[0];
        if (!key) { console.error('Usage: node scripts/license.js verify <key>'); process.exit(1); }
        const r = lic.verifyKey(key);
        console.log(r.ok ? '✅ LISENSI VALID' : `❌ LISENSI TIDAK VALID [${r.reason}]`);
        console.log('   ' + r.message);
        if (r.payload) {
            console.log('   Customer :', r.payload.c);
            console.log('   Tier     :', r.payload.t);
            console.log('   Expiry   :', fmtExpiry(r.payload.e));
        }
        process.exit(r.ok ? 0 : 1);
        break;
    }
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
        console.log('   Customer :', r.payload.c, '| Tier:', r.payload.t, '| Expiry:', fmtExpiry(r.payload.e));
        break;
    }
    case 'status': {
        const r = lic.check();
        console.log(r.ok ? '✅ LISENSI AKTIF' : `⚠️  LISENSI TIDAK AKTIF [${r.reason}]`);
        console.log('   ' + r.message);
        if (r.payload) {
            console.log('   Customer :', r.payload.c);
            console.log('   Tier     :', r.payload.t);
            console.log('   Expiry   :', fmtExpiry(r.payload.e));
        }
        console.log('   Fingerprint mesin:', lic.displayFingerprint());
        break;
    }
    default:
        console.log('ManzxyMD Free — License Manager\n');
        console.log('Perintah:');
        console.log('  secret                                  buat .license-secret');
        console.log('  fingerprint                             lihat fingerprint mesin');
        console.log('  issue <nama> <hari> [fingerprint] [tier]  terbitkan key (0 = lifetime)');
        console.log('  verify <key>                            cek kevalidan key');
        console.log('  install <key>                           simpan key ke .license-key');
        console.log('  status                                  cek status lisensi saat ini');
        break;
}
