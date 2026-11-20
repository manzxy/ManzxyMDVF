const promotions = require('../../lib/billing/promotions');

module.exports = {
    name: 'Status Promo',
    command: ['promo'],
    category: 'owner',
    rootOwner: true,
    limit: 0,
    description: 'Lihat status slot gratis dan diskon per produk',
    usage: '.promo',
    async execute(sock, m, { prefix, reply }) {
        if (sock.isJadibot) return reply('❌ Hanya tersedia di bot utama.');
        return reply(`*🏷️ PENGATURAN PROMO*\n\n🤖 Jadibot gratis: *${promotions.freeJadibot() ? 'ON' : 'OFF'}*\nSlot: *${promotions.freeUsage()}/${promotions.freeSlots()}* terpakai\n• Jadibot: ${promotions.discount('jadibot')}%\n• Premium: ${promotions.discount('prem')}%\n\n*Perintah Root Owner:*\n${prefix}setslotjadibot <jumlah>\n${prefix}freejadibot on|off\n${prefix}diskon jadibot|premium 0-99\n\nDiskon per produk, hanya untuk tagihan baru. Promo gratis hanya menerima pengguna selama slot tersedia; Owner/Premium diatur terpisah.`);
    }
};
