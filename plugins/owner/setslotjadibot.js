const promotions = require('../../lib/billing/promotions');

module.exports = {
    name: 'Atur Slot Jadibot',
    command: ['setslotjadibot'],
    category: 'owner',
    rootOwner: true,
    limit: 0,
    description: 'Atur kuota sesi promo jadibot gratis',
    usage: '.setslotjadibot <jumlah>',
    async execute(sock, m, { args, prefix, reply }) {
        if (sock.isJadibot) return reply('❌ Hanya tersedia di bot utama.');
        const raw = String(args[0] || '');
        if (!/^(?:0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw)))
            return reply(`Format: *${prefix}setslotjadibot <jumlah>* (0 = tutup slot gratis).`);
        promotions.setFreeSlots(Number(raw));
        return reply(`✅ Kuota slot jadibot gratis: *${promotions.freeSlots()}*. Terpakai: *${promotions.freeUsage()}*.${promotions.freeUsage() > promotions.freeSlots() ? '\nSesi lama tidak dimatikan; slot baru dibuka saat pemakaian turun.' : ''}`);
    }
};
