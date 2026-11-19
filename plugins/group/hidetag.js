const { participantJid } = require('../../lib/core/jid');

module.exports = {
    name: 'Hidetag',
    command: ['hidetag', 'ht', 'pengumuman'],
    category: 'group',
    description: 'Tag semua member secara tersembunyi (teks atau reply pesan)',
    usage: '.hidetag [pesan] / reply pesan',
    admin: true,
    group: true,
    limit: 0,
    async execute(sock, m, { from, text, quoted, groupMetadata, reply }) {
        try {
            const meta = groupMetadata || (await sock.groupMetadata(from));
            const mentions = (meta?.participants || []).map(participantJid);      // LID → JID nomor
            // Prioritas: teks perintah → isi pesan yang di-reply → karakter tak kasat mata
            const body = text || quoted?.text || '\u3164';
            await sock.sendMessage(from, { text: body, mentions }, { quoted: m });
        } catch (err) {
            await reply(`Gagal mengambil data grup: ${err.message}`);
        }
    }
};
