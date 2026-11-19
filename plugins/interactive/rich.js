module.exports = {
    name: 'Rich Media',
    command: ['rich', 'adreply'],
    category: 'interactive',
    description: 'Pesan rich media dengan thumbnail besar (ExternalAdReply)',
    async execute(sock, m, { from, config }) {
        const text = `*${config.botName} RICH MEDIA*\n\n• *Brand:* ${config.pairingPrefix}\n• *Tombol:* WA Biasa + Bisnis + Clone\n• *Balasan:* externalAdReply (kartu thumbnail)`;
        await sock.sendRichText(from, text, {
            title: `${config.botName} • Rich Engine`,
            body: 'Buka halaman resmi',
            thumbnailUrl: config.thumbnailUrl,
            sourceUrl: config.sourceUrl
        }, m);
    }
};
