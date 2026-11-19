const { button } = require('../../lib/wa/rich');

module.exports = {
    name: 'Kontak Owner',
    command: ['owner', 'creator'],
    category: 'main',
    description: 'Kontak owner bot',
    async execute(sock, m, { from, prefix, config }) {
        const num = config.ownerNumber[0] || '6281234567890';
        await sock.sendUniversalButton(from, {
            title: `👑 OWNER ${config.botName.toUpperCase()}`,
            body: `Informasi pengembang *${config.botName}*:\n\n• *Nama:* ${config.ownerName}\n• *Nomor:* +${num}\n• *Brand:* ${config.pairingPrefix}`,
            footer: config.footerText
        }, [
            button.url('Chat WhatsApp Owner', `https://wa.me/${num}`),
            button.copy('Salin Nomor Owner', num),
            button.quick('Kembali ke Menu', `${prefix}menu`)
        ], m);
    }
};
