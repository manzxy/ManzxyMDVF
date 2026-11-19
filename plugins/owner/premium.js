const { numberOf, parseDuration, formatDuration, formatDateTime, normalizePhone } = require('../../lib/core/utils');

module.exports = {
    name: 'Kelola Premium',
    command: ['addprem', 'delprem', 'listprem'],
    category: 'owner',
    description: 'Kelola user Premium (jadibot gratis): .addprem <nomor> [durasi]',
    usage: '.addprem <nomor> [durasi]',
    rootOwner: true,
    async execute(sock, m, { command, args, quoted, db, reply, prefix }) {
        if (command === 'listprem') {
            const list = Object.values(db.data.users).filter((u) => u.premium.active);
            if (!list.length) return await reply('Belum ada user premium.');
            return await reply('*⭐ USER PREMIUM*\n\n' + list.map((u, i) => `${i + 1}. +${u.number} — ${u.premium.expire ? `s/d ${formatDateTime(new Date(u.premium.expire))}` : 'Permanen'}`).join('\n'));
        }
        const target = normalizePhone(args[0]) || numberOf(quoted?.sender);
        if (target.length < 8) return await reply(`Format: *${prefix}${command} 628xxx${command === 'addprem' ? ' [durasi mis. 30d]' : ''}* atau reply pesan target.`);
        const user = db.getUser(target);

        if (command === 'addprem') {
            const ms = parseDuration(args[1]);
            if (args[1] && !ms) return await reply('❌ Durasi tidak valid (contoh: 7d, 30d, 1mo).');
            user.premium = { active: true, expire: ms ? Date.now() + ms : 0, since: Date.now() };
            user.role = 'premium';
            db.markDirty();
            return await reply(`⭐ *+${target}* sekarang Premium (${ms ? formatDuration(ms) : 'Permanen'}).`);
        }
        user.premium = { active: false, expire: 0, since: 0 };
        if (user.role === 'premium') user.role = 'user';
        db.markDirty();
        await reply(`✅ Premium *+${target}* dicabut.`);
    }
};
