const crypto = require('crypto');
const ALGO = ['md5', 'sha1', 'sha256', 'sha512'];

module.exports = {
    name: 'Encode & Hash',
    command: ['base64', 'b64', 'hash'],
    category: 'tools',
    description: 'Base64 encode/decode dan hash teks',
    usage: '.base64 enc|dec <teks> • .hash <md5|sha1|sha256|sha512> <teks>',
    limit: 0,
    async execute(sock, m, { command, args, quoted, reply, prefix }) {
        const mode = (args[0] || '').toLowerCase();
        const rest = args.slice(1).join(' ') || quoted?.text || '';
        if (command === 'hash') {
            if (!ALGO.includes(mode) || !rest) return await reply(`Contoh: *${prefix}hash sha256 halo*\nAlgoritma: ${ALGO.join(', ')}`);
            return await reply(crypto.createHash(mode).update(rest).digest('hex'));
        }
        if (!['enc', 'dec', 'encode', 'decode'].includes(mode) || !rest) return await reply(`Contoh:\n*${prefix}base64 enc halo*\n*${prefix}base64 dec aGFsbw==*`);
        if (mode.startsWith('enc')) return await reply(Buffer.from(rest).toString('base64'));
        const out = Buffer.from(rest, 'base64').toString('utf8');
        await reply(out || 'Base64 tidak valid.');
    }
};
