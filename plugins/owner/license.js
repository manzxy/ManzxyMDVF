/**
 * Manajemen lisensi ManzxyMD Free lewat WhatsApp (khusus Root Owner).
 *
 *   .setkey <key>   → pasang license key (disimpan ke .license-key)
 *   .delkey         → hapus key yang tersimpan
 *   .license        → lihat status lisensi saat ini
 *
 * Cukup key — tidak ada fingerprint. Key didapat dari owner.
 */
const lic = require('../../lib/core/license');

const fmt = (e) => (e ? new Date(e).toLocaleString('id-ID') : 'selamanya (lifetime)');

module.exports = {
    name: 'Kelola Lisensi',
    command: ['setkey', 'delkey', 'license'],
    category: 'owner',
    description: 'Atur & cek lisensi bot: .setkey <key> • .license • .delkey',
    usage: '.setkey <MZF-...> • .delkey • .license',
    rootOwner: true,
    limit: 0,

    async execute(sock, m, { command, args, text, prefix, reply }) {
        if (command === 'license') {
            const r = lic.check();
            const lines = [
                '*STATUS LISENSI*',
                '',
                r.ok ? '✅ Aktif' : `⛔ Tidak aktif — ${r.reason}`,
                r.message
            ];
            if (r.payload) {
                lines.push('', 'Customer : ' + r.payload.c, 'Tier     : ' + r.payload.t,
                    'Jenis    : ' + (r.payload.k === 'individual' ? 'Individual (1 bot)' : 'Shared (rame-rame)'),
                    'Berlaku  : ' + fmt(r.payload.e));
            }
            const cd = lic.cooldownRemaining();
            if (cd > 0) lines.push('', '⏳ Jeda aktif: ' + Math.ceil(cd / 1000) + ' detik lagi.');
            return await reply(lines.join('\n'));
        }

        if (command === 'delkey') {
            const prev = lic.check();
            lic.clearKey();
            let released = false;
            if (prev.payload?.k === 'individual' && prev.payload?.j) released = lic.releaseLock(prev.payload.j);
            lic.clearCooldown();
            return await reply('✅ License key dihapus' + (released ? ' (lock individual dilepas)' : '') +
                '. Bot akan berhenti saat restart sampai key dipasang lagi.');
        }

        // setkey
        const key = String(text || '').trim();
        if (!key) {
            return await reply(`Cara pakai:\n*${prefix}setkey <MZF-...>*\n\nDapatkan key dari owner, lalu tempel di console saat start bot.`);
        }
        const r = lic.verifyKey(key);
        if (!r.ok) {
            return await reply(`❌ Key ditolak [${r.reason}]\n${r.message}\n\nCek kembali key yang diberikan owner.`);
        }
        try {
            lic.saveKey(key);
        } catch (e) {
            return await reply('❌ Gagal menyimpan key: ' + e.message);
        }
        return await reply(
            '✅ *Lisensi berhasil dipasang.*\n\n' +
            'Customer : ' + r.payload.c + '\n' +
            'Tier     : ' + r.payload.t + '\n' +
            'Jenis    : ' + (r.payload.k === 'individual' ? 'Individual (1 bot)' : 'Shared (rame-rame)') + '\n' +
            'Berlaku  : ' + fmt(r.payload.e) + '\n\n' +
            'Key tersimpan di `.license-key`. Berlaku setelah bot di-restart.'
        );
    }
};
