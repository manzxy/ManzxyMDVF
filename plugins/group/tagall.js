const { participantJid } = require('../../lib/core/jid');
const { numberOf } = require('../../lib/core/utils');

module.exports = {
    name: 'Tag All',
    command: ['tagall', 'everyone'],
    category: 'group',
    description: 'Mention semua anggota dengan daftar',
    usage: '.tagall <pesan>',
    group: true,
    admin: true,
    limit: 0,
    async execute(sock, m, { from, text, groupMetadata }) {
        const meta = groupMetadata || (await sock.groupMetadata(from));
        const jids = (meta?.participants || []).map(participantJid);
        const list = jids.map((j) => `› @${numberOf(j)}`).join('\n');
        await sock.sendMessage(from, { text: `*TAG ALL* (${jids.length})\n${text ? `\n${text}\n` : ''}\n${list}`, mentions: jids }, { quoted: m });
    }
};
