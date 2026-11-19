const rental = require('../../lib/billing/rental');
const { button } = require('../../lib/wa/rich');
const { formatDateTime } = require('../../lib/core/utils');

module.exports = {
    name: 'Daftar Penyewa',
    command: ['listsewa', 'delsewa'],
    category: 'sewa',
    description: 'Daftar grup penyewa + tombol hentikan (keluar grup)',
    usage: '.listsewa',
    rootOwner: true,
    async execute(sock, m, { from, command, args, db, prefix, config, reply }) {
        if (command === 'delsewa') {
            const jid = args[0];
            if (!jid || !db.data.groups[jid]) return await reply(`Format: *${prefix}delsewa <jid grup>* (atau pakai tombol di ${prefix}listsewa).`);
            await rental.revoke(sock, jid, { leave: true, notice: '⛔ Masa sewa bot di grup ini dihentikan oleh owner.' });
            return await reply(`✅ Sewa *${db.data.groups[jid].name || jid}* dihentikan & bot keluar dari grup.`);
        }
        const list = Object.values(db.data.groups).filter((g) => rental.isActive(g)).sort((a, b) => (a.rent.expire || Infinity) - (b.rent.expire || Infinity));
        if (!list.length) return await reply('Belum ada grup yang menyewa bot.');
        const body = `*🏷️ GRUP PENYEWA* (${list.length})\n\n` + list.map((g, i) => `${i + 1}. *${g.name || g.id}*\n   • Penyewa: +${g.rent.by}\n   • Habis: ${g.rent.expire ? formatDateTime(new Date(g.rent.expire)) : 'Permanen'}`).join('\n\n');
        await sock.sendUniversalButton(from, { title: '🏷️ SEWA BOT', body, footer: config.footerText },
            [button.list('⛔ Hentikan Sewa', [{ title: 'Hentikan & keluar grup', rows: list.slice(0, 10).map((g) => ({ header: 'STOP', title: (g.name || g.id).slice(0, 24), description: `s/d ${g.rent.expire ? formatDateTime(new Date(g.rent.expire)) : 'permanen'}`, id: `${prefix}delsewa ${g.id}` })) }])], m);
    }
};
