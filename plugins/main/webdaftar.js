/**
 * Plugin: Info panel web  (.webdaftar)
 *
 * Akun panel web sekarang dibuat di WEBSITE (email+password, atau Google/GitHub).
 * Perintah ini hanya menampilkan tautan + info, dan bisa menautkan nomor WhatsApp
 * ke akun yang sudah ada supaya jadibot & saldo muncul di panel.
 */
const config = require('../../config');
const web = require('../../lib/web/server');

const panelUrl = () => process.env.WEB_PANEL_URL || `http://<host-bot>:${config.port}/panel`;

module.exports = {
    name: 'Panel Web',
    command: ['webdaftar', 'daftarweb', 'panel', 'webpanel'],
    category: 'main',
    description: 'Info & tautan panel web (daftar lewat website: email, Google, atau GitHub)',
    usage: '.panel',

    async execute(sock, m, { reply, senderNumber, prefix, command }) {
        if (sock.isJadibot) return reply('❌ Jadibot tidak bisa membuka panel web. Gunakan bot utama.');

        let acc = null;
        try { acc = web.store.getAccountByWa(senderNumber); } catch {}

        if (acc) {
            const providers = web.store.listOauth(acc.id).map((o) => o.provider).join(', ') || '-';
            return reply(
                `*🌐 PANEL WEB KAMU*\n\n` +
                `╭───「 *AKUN* 」\n` +
                `│ 📧 Email    : ${acc.email || '-'}\n` +
                `│ 📱 Nomor    : +${senderNumber}\n` +
                `│ 🔑 Login    : ${acc.password_hash ? 'email + password' : 'OAuth'}\n` +
                `│ 🔗 Tertaut  : ${providers}\n` +
                `╰────────────────────────\n\n` +
                `Buka: ${panelUrl()}\n\n` +
                `_Kelola jadibot, cek monitor, topup saldo, dan lihat riwayat transaksi di sana._`
            );
        }

        await reply(
            `*🌐 PANEL WEB ${config.botName.toUpperCase()}*\n\n` +
            `Buka: *${panelUrl()}*\n\n` +
            `*Cara daftar (pilih salah satu):*\n` +
            `1. *Email + password* — isi form "DAFTAR" di website\n` +
            `2. *Google* — klik tombol Google\n` +
            `3. *GitHub* — klik tombol GitHub\n\n` +
            `*Penting:* isi *nomor WhatsApp* kamu (+${senderNumber}) saat daftar\n` +
            `atau di halaman *Profil* setelah login. Tanpa nomor itu, jadibot dan\n` +
            `saldo milikmu tidak akan muncul di panel.\n\n` +
            `*Fitur panel:*\n` +
            `• Dashboard & monitor jadibot real-time\n` +
            `• Buat / matikan / hapus / ubah mode jadibot\n` +
            `• Topup saldo via QRIS\n` +
            `• Beli jadibot langsung dari saldo\n` +
            `• Profil, ganti password, kelola akun tertaut\n` +
            `• Riwayat transaksi & log aktivitas`
        );
    }
};