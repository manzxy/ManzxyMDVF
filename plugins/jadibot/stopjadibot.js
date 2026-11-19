const { stopJadibot, getJadibotOwner } = require('../../lib/bot/jadibotManager');

module.exports = {
    name: 'Matikan Jadibot',
    command: ['stopjadibot', 'deljadibot'],
    category: 'jadibot',
    description: 'Matikan jadibot milikmu (deljadibot = hapus sesi permanen)',
    usage: '.stopjadibot <nomor>',
    async execute(sock, m, { args, senderNumber, command, isRootOwner, prefix, reply }) {
        const raw = args[0] || (sock.isJadibot ? sock.jadibotNumber : '');
        const target = String(raw).replace(/[^0-9]/g, '');
        if (!target) return await reply(`Format: *${prefix}${command} <nomor>*\nAtau pakai tombol di *${prefix}listjadibot*.`);

        const owner = getJadibotOwner(target);
        if (!owner) return await reply(`❌ Tidak ada jadibot untuk *+${target}*.`);
        // Hanya pemilik jadibot (yang dulu mengetik .jadibot) atau Root Owner yang boleh mematikan
        if (!isRootOwner && owner !== senderNumber) return await reply('❌ Itu bukan jadibot milikmu.');

        const del = command === 'deljadibot';
        const ok = await stopJadibot(target, del);
        if (!ok) return await reply(`❌ Tidak ada sesi aktif/tersimpan untuk *+${target}*.`);
        await reply(`✅ Jadibot *+${target}* ${del ? 'dihapus permanen (sesi dihapus)' : 'dimatikan. Nyalakan lagi lewat *' + prefix + 'listjadibot*'}.`);
    }
};
