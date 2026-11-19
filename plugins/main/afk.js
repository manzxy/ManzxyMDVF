const { getMentions } = require('../../lib/core/mentions');
const { numberOf, runtime } = require('../../lib/core/utils');

const since = (ms) => runtime(Math.max(1, Math.floor((Date.now() - ms) / 1000)));

module.exports = {
    name: 'AFK',
    command: ['afk'],
    category: 'main',
    description: 'Tandai dirimu sedang tidak aktif',
    usage: '.afk <alasan>',
    limit: 0,
    async execute(sock, m, { user, text, db, reply }) {
        user.afk = { active: true, since: Date.now(), reason: (text || 'tanpa alasan').slice(0, 100) };
        db.markDirty();
        await reply(`*${user.regName || user.name || 'Kamu'}* sekarang AFK.\nAlasan: ${user.afk.reason}\n\n_Kirim pesan apa saja untuk kembali aktif._`);
    },

    // Hook: kembali aktif saat mengirim pesan; beri tahu bila yang di-mention / di-reply sedang AFK
    async before(m, { sock, from, user, body, quoted, toJid, db }) {
        if (!user) return false;
        if (user.afk?.active && !/^\W?afk(\s|$)/i.test(body || '') && Date.now() - user.afk.since > 8000) {
            const lama = since(user.afk.since);
            user.afk = { active: false, since: 0, reason: '' };
            db.markDirty();
            await sock.reply(from, `Selamat datang kembali, *${user.regName || user.name || 'kamu'}*! AFK selama ${lama}.`, m);
        }
        const ids = getMentions(m, quoted).slice(0, 5);
        for (const id of ids) {
            const number = numberOf(await toJid(id));
            const target = db.data.users[number];
            if (target?.afk?.active && number !== user.number) {
                await sock.reply(from, `*${target.regName || target.name || number}* sedang AFK sejak ${since(target.afk.since)} lalu.\nAlasan: ${target.afk.reason}`, m);
            }
        }
        return false;
    }
};
