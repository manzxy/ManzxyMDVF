const promotions = require('../../lib/billing/promotions');

const ALIASES = { jadibot: 'jadibot', jb: 'jadibot', sewa: 'rent', rent: 'rent', premium: 'prem', prem: 'prem' };

module.exports = {
    name: 'Diskon Produk',
    command: ['diskon'],
    category: 'owner',
    rootOwner: true,
    limit: 0,
    description: 'Diskon per produk, masing-masing independen',
    usage: '.diskon jadibot|sewa|premium 0-99',
    async execute(sock, m, { args, prefix, reply }) {
        if (sock.isJadibot) return reply('❌ Hanya tersedia di bot utama.');
        const kind = ALIASES[String(args[0] || '').toLowerCase()];
        const raw = String(args[1] || '');
        if (!kind || !/^(?:0|[1-9]\d?)$/.test(raw))
            return reply(`Format: *${prefix}diskon jadibot|sewa|premium 0-99*\nContoh: *${prefix}diskon jadibot 20*; angka 0 = hapus diskon.`);
        const percent = Number(raw);
        promotions.setDiscount(kind, percent);
        return reply(`✅ Diskon *${promotions.LABELS[kind]}* ${percent ? `diatur ke *${percent}%*` : 'dimatikan'}. Produk lain tidak berubah. Hanya berlaku untuk tagihan baru, termasuk perpanjangan.`);
    }
};
