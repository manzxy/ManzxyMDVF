/**
 * Manajemen lisensi ManzxyMD Free lewat WhatsApp (khusus Root Owner).
 *
 *   .setkey <key>   → pasang license key (disimpan ke .license-key)
 *   .delkey         → hapus key yang tersimpan
 *   .license        → lihat status lisensi saat ini
 *   .fingerprint    → lihat fingerprint mesin (kirim ke penyedia untuk dibuatkan key)
 */
const lic = require('../../lib/core/license');

const fmt = (e) => (e ? new Date(e).toISOString() : 'selamanya (lifetime)');

module.exports = {
    name: 'Kelola Lisensi',
    command: ['setkey', 'delkey', 'license', 'fingerprint'],
    category: 'owner',
    description: 'Atur & cek lisensi bot: .setkey <key> • .license • .fingerprint',
    usage: '.setkey <MZF-...> • .delkey • .license • .fingerprint',
    rootOwner: true,
    limit: 0,

    async execute(sock, m, { command, args, text, prefix, reply }) {
        if (command === 'fingerprint') {
            return await reply(
                '*FINGERPRINT MESIN*\n\n' +
                '`' + lic.displayFingerprint() + '`\n\n' +
                'Kirim kode ini ke penyedia lisensi untuk dibuatkan key yang terikat pada mesin ini.'
            );
        }

        if (command === 'license') {
            const r = lic.check();
            const lines = [
                '*STATUS LISENSI*',
                '',
                r.ok ? '✅ Aktif' : `⚠️  Tidak aktif — ${r.reason}`,
                r.message
            ];
            if (r.payload) {
                lines.push('', 'Customer : ' + r.payload.c, 'Tier     : ' + r.payload.t, 'Berlaku  : ' + fmt(r.payload.e));
            }
            lines.push('', 'Fingerprint: `' + lic.displayFingerprint() + '`');
            lines.push('Mode wajib : ' + (/^(1|true|yes)$/i.test(process.env.MZ_LICENSE_REQUIRED || '') ? 'HARD (bot berhenti tanpa key)' : 'SOFT (bot jalan + warning)'));
            return await reply(lines.join('\n'));
        }

        if (command === 'delkey') {
            lic.clearKey();
            return await reply('✅ License key dihapus. Bot akan berjalan tanpa lisensi (mode soft) sampai key dipasang lagi.');
        }

        // setkey
        const key = String(text || '').trim();
        if (!key) {
            return await reply(`Cara pakai:\n*${prefix}setkey <MZF-...>*\n\nDapatkan key dari penyedia lisensi. Untuk melihat fingerprint: *${prefix}fingerprint*`);
        }
        const r = lic.verifyKey(key);
        if (!r.ok) {
            return await reply(`❌ Key ditolak [${r.reason}]\n${r.message}\n\nCek kembali key-nya. Fingerprint mesin ini: \`${lic.displayFingerprint()}\``);
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
            'Berlaku  : ' + fmt(r.payload.e) + '\n\n' +
            'Key tersimpan di `.license-key`. Berlaku setelah bot di-restart.'
        );
    }
};
