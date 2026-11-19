const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { formatBytes, numberOf } = require('../../lib/core/utils');

module.exports = {
    name: 'Info Database',
    command: ['dbinfo', 'database'],
    category: 'owner',
    description: 'Statistik database, atau lihat data user/grup',
    usage: '.dbinfo [user <nomor> | group]',
    rootOwner: true,
    async execute(sock, m, { from, args, db, isGroup, group, reply }) {
        const mode = (args[0] || '').toLowerCase();
        if (mode === 'user') {
            const n = numberOf(args[1]);
            const u = db.data.users[n];
            return await reply(u ? '```' + JSON.stringify(u, null, 1) + '```' : '❌ User tidak ada di database.');
        }
        if (mode === 'group') {
            if (!isGroup) return await reply('❌ Jalankan di dalam grup.');
            return await reply('```' + JSON.stringify(group, null, 1) + '```');
        }
        const s = db.summary();
        const file = path.resolve(__dirname, '..', '..', config.database.path);
        const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
        const top = Object.entries(db.data.stats.commandUsage).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, k], i) => `${i + 1}. ${c} (${k}x)`).join('\n') || '-';
        await reply(
            `*DATABASE*\n\n• User: ${s.users}\n• Grup: ${s.groups}\n• Jadibot: ${s.jadibots}\n• Pesan diproses: ${s.messages}\n• Command dijalankan: ${s.commands}\n• Ukuran file: ${formatBytes(size)}\n• Schema: v${db.data.meta.schemaVersion}\n\n*Top command:*\n${top}`
        );
    }
};
