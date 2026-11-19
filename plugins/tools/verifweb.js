/**
 * VERIFWEB — verifikasi kepemilikan nomor WhatsApp untuk panel web.
 *
 * Alur (anti pembajakan akun/role owner panel):
 *   1. Di panel web: Profil → isi Nomor WhatsApp → SIMPAN → panel menampilkan kode 6 digit.
 *   2. Dari nomor WhatsApp yang mau ditautkan, kirim: `.verifweb <kode>` ke bot.
 *   3. Bot mencocokkan kode + nomor pengirim → nomor terverifikasi di panel.
 *      Bila nomornya root owner (config.ownerNumber), akun panel otomatis dapat role OWNER.
 *
 * Karena kode hanya bisa dikonfirmasi dari WhatsApp nomor itu sendiri, orang lain tidak bisa
 * menautkan (dan membatrol akses owner panel) nomor yang bukan miliknya.
 */
const auth = require('../../lib/web/auth');

module.exports = {
    name: 'Verifikasi Panel Web',
    command: ['verifweb', 'verifpanel'],
    category: 'tools',
    description: 'Verifikasi nomor WhatsApp untuk panel web (.verifweb <kode>)',
    usage: '.verifweb <kode6digit>',
    register: false,
    limit: 0,

    async execute(sock, m, { text, senderNumber, reply }) {
        const code = String(text || '').trim().split(/\s+/)[0];
        if (!code || !/^\d{4,8}$/.test(code)) {
            return await reply(
                `🔐 *VERIFIKASI PANEL WEB*\n\n` +
                `Ambil kode di panel web → *Profil* → isi *Nomor WhatsApp* → simpan,\n` +
                `lalu kirim kodenya dari nomor tersebut:\n\n` +
                `• *.verifweb 123456*\n\n` +
                `_Kode berlaku 10 menit dan hanya valid dari nomor yang didaftarkan._`
            );
        }
        try {
            const acc = auth.confirmWaLink(senderNumber, code);
            const ownerNote = acc.role === 'owner'
                ? `\n\n👑 Nomor root owner terdeteksi — akun panel ini sekarang *OWNER* (akses penuh panel web).`
                : '';
            await reply(`✅ Nomor *+${senderNumber}* berhasil diverifikasi & ditautkan ke akun panel webmu.${ownerNote}`);
        } catch (err) {
            await reply(`❌ ${err.message}`);
        }
    }
};
