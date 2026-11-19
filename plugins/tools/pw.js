const { randomInt } = require('crypto');
const SET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';

module.exports = {
    name: 'Generator Password',
    command: ['pw', 'password', 'genpass'],
    category: 'tools',
    description: 'Buat password acak kuat (dikirim ke chat pribadi)',
    usage: '.pw [panjang 8-64]',
    limit: 0,
    async execute(sock, m, { args, from, sender, isGroup, reply }) {
        const len = Math.min(64, Math.max(8, parseInt(args[0], 10) || 16));
        let pass = '';
        for (let i = 0; i < len; i++) pass += SET[randomInt(SET.length)];
        if (isGroup) {
            await sock.sendMessage(sender, { text: `Password (${len} karakter):\n\n\`${pass}\`` });
            return await reply('Password dikirim ke chat pribadimu.');
        }
        await reply(`Password (${len} karakter):\n\n\`${pass}\``);
    }
};
