#!/usr/bin/env node
/**
 * CLI pembersih sampah ManzxyMD.
 *
 *   node scripts/cleanup.js                 # scan (default, aman)
 *   node scripts/cleanup.js --scan          # scan + kandidat kode mati
 *   node scripts/cleanup.js --apply         # pindahkan sampah ke trash
 *   node scripts/cleanup.js --aggressive    # abaikan umur minimal (tetap trash)
 *   node scripts/cleanup.js --dead          # apply + pindahkan kode mati
 *   node scripts/cleanup.js --restore       # kembalikan trash terakhir
 *   node scripts/cleanup.js --list          # daftar trash tersedia
 *
 * Semua penghapusan bersifat reversible (dipindah ke .cleanup-trash/<id>/).
 */
const janitor = require('../lib/bot/janitor');

const args = new Set(process.argv.slice(2));
const has = (f) => args.has(f);
const aggressive = has('--aggressive') || has('--dead');

function main() {
    if (has('--restore')) {
        const id = process.argv[process.argv.indexOf('--restore') + 1];
        const r = janitor.restore(id && !id.startsWith('--') ? id : undefined);
        console.log(r.ok
            ? `✅ Dipulihkan ${r.restored} item (${r.skipped} dilewati) dari trash ${r.trashId}`
            : `⚠️ ${r.message}`);
        return;
    }

    if (has('--list')) {
        const list = janitor.listTrash();
        if (!list.length) { console.log('Belum ada trash.'); return; }
        console.log('Trash tersedia:');
        for (const t of list) console.log(`  ${t.id} — ${t.moved} item, ${(t.bytes / 1024 / 1024).toFixed(2)} MB`);
        return;
    }

    if (has('--apply') || has('--dead')) {
        const r = janitor.run({ apply: true, aggressive, removeDeadCode: has('--dead') });
        console.log(janitor.formatReport(r));
        return;
    }

    // Default: scan
    const r = janitor.scan({ aggressive, includeDeadCode: has('--scan') || has('--dead') });
    console.log(janitor.formatReport(r));
    console.log('\nJalankan dengan --apply untuk memindahkan ke trash (bisa di-restore).');
}

try { main(); }
catch (err) { console.error('Cleanup gagal:', err); process.exit(1); }
