const { truncate } = require('../../lib/core/utils');

module.exports = {
    name: 'Info Grup',
    command: ['infogrup', 'groupinfo', 'linkgc'],
    category: 'group',
    description: 'Info grup & link undangan',
    usage: '.infogrup • .linkgc',
    group: true,
    limit: 0,
    async execute(sock, m, { from, command, group, groupMetadata, isAdmin, isOwner, isBotAdmin, reply }) {
        if (command === 'linkgc') {
            if (!(isAdmin || isOwner)) return await reply('Hanya admin yang boleh meminta link grup.');
            if (!isBotAdmin) return await reply('Jadikan bot admin dulu untuk mengambil link grup.');
            return await reply(`https://chat.whatsapp.com/${await sock.groupInviteCode(from)}`);
        }
        const meta = groupMetadata || (await sock.groupMetadata(from));
        const parts = meta?.participants || [];
        const s = group?.settings || {};
        const on = (v) => (v ? 'ON' : 'OFF');
        await reply([
            `*${meta.subject}*`,
            `Anggota : ${parts.length} (admin ${parts.filter((p) => p.admin).length})`,
            `Dibuat  : ${meta.creation ? new Date(meta.creation * 1000).toLocaleDateString('id-ID', { dateStyle: 'long' }) : '-'}`,
            `Welcome ${on(s.welcome)} • Bye ${on(s.bye)} • Detect ${on(s.detect)} • Anti link ${on(s.antilink?.enabled)}`,
            meta.desc ? `\n${truncate(meta.desc, 300)}` : ''
        ].filter(Boolean).join('\n'));
    }
};
