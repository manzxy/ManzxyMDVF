/**
 * CONTOH STRUKTUR PLUGIN PREMIUM
 * ─────────────────────────────────────────────────────────────
 * Cukup tambahkan `premium: true`. Handler (handler.js) otomatis:
 *   • menolak user non-premium dengan teks TEXT.premiumBody + tombol "Beli Premium"
 *   • tetap mengizinkan Owner
 * Properti lain yang bisa dipadukan:
 *   register: true   → wajib .daftar dulu (dicek sebelum premium)
 *   limit: 0         → tidak memakai limit (premium memang sudah unlimited)
 *   owner / group / private / admin / botAdmin → aturan akses biasa
 * Teks penolakan bisa diubah di handler.js (objek TEXT). Plugin menerima `texts`, `isPremium`, `isRegistered` di ctx.
 * Salin file ini sebagai kerangka plugin premium barumu (atau pakai .svplug).
 */
module.exports = {
    name: 'Zona VIP',
    command: ['vip', 'vipzone'],
    category: 'premium',
    description: 'Contoh fitur khusus Premium (kerangka plugin premium)',
    usage: '.vip',
    premium: true,          // ← inti struktur plugin premium
    limit: 0,
    async execute(sock, m, { isOwner, user, texts, prefix, reply }) {
        const status = isOwner ? '👑 Owner — akses penuh.' : texts.premiumActive(user);
        await reply(`*💎 ZONA VIP*\n\nSelamat datang di fitur khusus Premium.\n\n${status}\n\nTambahkan fitur premium barumu dengan menyalin kerangka *plugins/premium/vip.js*.\nPerpanjang durasi: *${prefix}perpanjang*`);
    }
};
