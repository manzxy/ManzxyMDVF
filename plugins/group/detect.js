/**
 * Deteksi perubahan grup — .detect on|off (admin grup)
 * Bila aktif, bot memberi tahu di grup saat: nama / deskripsi / foto diubah, pengaturan kirim pesan & edit info,
 * pesan sementara, link undangan direset, persetujuan bergabung, penambahan anggota, admin ditambah/dicopot,
 * serta member masuk / keluar / dikeluarkan (bila Welcome/Bye mati, supaya tidak dobel).
 * Logika deteksi ada di handler.js (bindEvents); teks di TEXT.detect*.
 */
const { button } = require('../../lib/wa/rich');

module.exports = {
    name: 'Deteksi Perubahan Grup',
    command: ['detect', 'deteksi', 'groupdetect'],
    category: 'group',
    description: 'Beri tahu otomatis bila ada perubahan di grup (nama, deskripsi, admin, pengaturan)',
    usage: '.detect on|off',
    group: true,
    admin: true,
    limit: 0,
    async execute(sock, m, { from, args, prefix, group, db, config, texts, reply }) {
        const arg = String(args[0] || '').toLowerCase();
        const s = group.settings;

        if (arg === 'on' || arg === 'off') {
            s.detect = arg === 'on';
            db.markDirty();
            return await reply((s.detect ? texts.detectOn : texts.detectOff) + (config.groupDetect?.enabled === false ? '\n\n⚠️ Fitur dimatikan global di config.js (groupDetect.enabled).' : ''));
        }
        await sock.sendUniversalButton(from, {
            title: '🔎 DETEKSI PERUBAHAN GRUP',
            body: `Status: ${s.detect ? '🟢 ON' : '🔴 OFF'}\n\nBot akan melapor bila ada perubahan nama, deskripsi, foto, pengaturan grup, admin, serta member masuk/keluar.\n\nKetik *${prefix}detect on* / *${prefix}detect off*.`,
            footer: config.footerText
        }, [button.quick('🟢 Aktifkan', `${prefix}detect on`), button.quick('🔴 Matikan', `${prefix}detect off`)], m);
    }
};
