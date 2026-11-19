const payment = require('../../lib/billing/payment');
const { button } = require('../../lib/wa/rich');

module.exports = {
    name: 'Tagihan Pembayaran',
    command: ['batalbayar', 'batal', 'cekbayar', 'tagihan'],
    category: 'main',
    order: 4,
    description: 'Batalkan / cek tagihan pembayaran (sewa, premium, jadibot)',
    usage: '.batalbayar [id]',
    async execute(sock, m, ctx) {
        const { from, command, args, senderNumber, isRootOwner, prefix, config, reply } = ctx;
        const id = (args[0] || '').trim();
        const check = command === 'cekbayar' || command === 'tagihan';

        /* ───── dengan ID ───── */
        if (id) {
            if (!check) {
                const r = payment.cancelOrder(id, senderNumber, isRootOwner);
                if (!r.ok) return await reply(`❌ ${r.error}`);
                return await sock.sendUniversalButton(from, {
                    title: '❌ TAGIHAN DIBATALKAN',
                    body: `${payment.describeOrder(r.order)}\n\nTagihan sudah dibatalkan. *Jangan membayar QR yang lama.* Kamu bisa membuat tagihan baru kapan saja.`,
                    footer: config.footerText
                }, [button.quick('⭐ Beli Premium', `${prefix}buyprem`), button.quick('🏷️ Sewa Bot', `${prefix}sewabot`)], m);
            }
            const o = payment.ownOrders(senderNumber).find((x) => x.trxId === id) || (isRootOwner ? Object.values(ctx.db.data.orders).find((x) => x.trxId === id) : null);
            if (!o) return await reply('❌ Tagihan tidak ditemukan.');
            const btns = o.status === 'pending' ? [button.quick('❌ Batalkan Tagihan', `${prefix}batalbayar ${o.trxId}`), button.quick('🔄 Cek Lagi', `${prefix}cekbayar ${o.trxId}`)] : [button.quick('📜 Menu', `${prefix}menu`)];
            return await sock.sendUniversalButton(from, { title: '🧾 STATUS TAGIHAN', body: payment.describeOrder(o), footer: config.footerText }, btns, m);
        }

        /* ───── tanpa ID ───── */
        if (check) {
            const list = payment.ownOrders(senderNumber).slice(0, 5);
            if (!list.length) return await reply('Kamu belum punya tagihan.');
            return await reply('*🧾 TAGIHAN TERAKHIR*\n\n' + list.map((o, i) => `${i + 1}. ${payment.describeOrder(o)}`).join('\n\n') + `\n\nBatalkan yang menunggu: *${prefix}batalbayar*`);
        }
        const pending = payment.ownOrders(senderNumber, ['pending']);
        if (!pending.length) return await reply('Tidak ada tagihan yang menunggu pembayaran.');
        if (pending.length === 1) {
            const r = payment.cancelOrder(pending[0].trxId, senderNumber, isRootOwner);
            return await reply(r.ok ? `❌ Tagihan dibatalkan.\n\n${payment.describeOrder(r.order)}\n\n*Jangan membayar QR yang lama.*` : `❌ ${r.error}`);
        }
        // beberapa tagihan → button list untuk memilih
        const rows = pending.slice(0, 10).map((o) => ({ header: 'BATALKAN', title: `${payment.describeOrder(o).split('\n')[0].replace(/\*/g, '').slice(0, 24)}`, description: `${o.trxId}`.slice(0, 72), id: `${prefix}batalbayar ${o.trxId}` }));
        await sock.sendUniversalButton(from, { title: '❌ BATALKAN TAGIHAN', body: `Kamu punya ${pending.length} tagihan menunggu pembayaran.\n\n` + pending.map((o, i) => `${i + 1}. ${payment.describeOrder(o)}`).join('\n\n') + '\n\nPilih yang ingin dibatalkan:', footer: config.footerText },
            [button.list('Pilih Tagihan', [{ title: 'Tagihan menunggu', rows }])], m);
    }
};
