const promotions = require('../../lib/billing/promotions');

module.exports = {
    name: 'Promo Jadibot Gratis',
    command: ['freejadibot'],
    category: 'owner',
    rootOwner: true,
    limit: 0,
    description: 'Buka/tutup promo jadibot gratis terbatas',
    usage: '.freejadibot on|off',
    async execute(sock, m, { args, prefix, reply }) {
        if (sock.isJadibot) return reply('❌ Hanya tersedia di bot utama.');
        const option = String(args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(option))
            return reply(`Format: *${prefix}freejadibot on|off*\nAtur kuota lebih dulu: *${prefix}setslotjadibot 2*.`);
        promotions.setFreeJadibot(option === 'on');
        return reply(`✅ Promo jadibot gratis *${option.toUpperCase()}*. Slot terpakai: *${promotions.freeUsage()}/${promotions.freeSlots()}*. Sesi yang sudah ada tetap aktif; Owner/Premium mengikuti pengaturan terpisah.`);
    }
};
