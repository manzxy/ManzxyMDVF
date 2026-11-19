const { numberOf } = require('../../lib/core/utils');

module.exports = {
    name: 'Ban & Mute',
    command: ['ban', 'unban', 'mute', 'unmute'],
    category: 'owner',
    description: 'Ban/unban user (nomor / reply) & mute/unmute bot di grup',
    usage: '.ban <nomor> [alasan] | .mute',
    owner: true,
    async execute(sock, m, { from, command, args, text, quoted, db, isGroup, group, senderNumber, reply }) {
        if (command === 'mute' || command === 'unmute') {
            if (!isGroup) return await reply('❌ Hanya bisa di dalam grup.');
            group.settings.mute = command === 'mute';
            db.markDirty();
            return await reply(group.settings.mute ? '🔇 Bot di-*mute* di grup ini (hanya owner/admin yang bisa command).' : '🔊 Bot aktif kembali di grup ini.');
        }

        const target = numberOf(args[0]) || numberOf(quoted?.sender);
        if (target.length < 8) return await reply(`Format: *.${command} 628xxx [alasan]* atau reply pesan target.`);
        const rootOwners = require('../../config').ownerNumber;
        if (rootOwners.includes(target)) return await reply('❌ Root owner tidak bisa di-ban.');

        const user = db.getUser(target);
        if (command === 'ban') {
            const reason = text.replace(args[0] || '', '').trim() || '-';
            user.banned = { active: true, reason, by: senderNumber, time: Date.now() };
            user.role = 'banned';
            db.markDirty();
            return await reply(`⛔ *+${target}* di-ban.\nAlasan: ${reason}`);
        }
        user.banned = { active: false, reason: '', by: '', time: 0 };
        if (user.role === 'banned') user.role = 'user';
        db.markDirty();
        await reply(`✅ *+${target}* sudah di-unban.`);
    }
};
