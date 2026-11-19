const { button } = require('../../lib/wa/rich');

module.exports = {
    name: 'Carousel',
    command: ['carousel', 'slide'],
    category: 'interactive',
    description: 'Pesan carousel (kartu geser dengan gambar & tombol)',
    async execute(sock, m, { from, pushname, prefix, config }) {
        const cards = [
            {
                title: 'SLIDE 1 • BRAND',
                body: `Pairing code custom ${config.pairingPrefix} untuk semua sesi bot & jadibot.`,
                footer: `${config.botName} • 1/3`,
                image: { url: 'https://picsum.photos/600/400?random=101' },
                buttons: [button.quick('Buka Menu', `${prefix}menu`)]
            },
            {
                title: 'SLIDE 2 • JADIBOT',
                body: 'Ketik .jadibot <nomor> → kode pairing langsung dikirim.',
                footer: `${config.botName} • 2/3`,
                image: { url: 'https://picsum.photos/600/400?random=202' },
                buttons: [button.quick('Daftar Jadibot', `${prefix}listjadibot`)]
            },
            {
                title: 'SLIDE 3 • AD REPLY',
                body: 'Balasan externalAdReply tampil di WA biasa, Bisnis, dan Clone.',
                footer: `${config.botName} • 3/3`,
                image: { url: 'https://picsum.photos/600/400?random=303' },
                buttons: [button.quick('Ad Reply', `${prefix}rich`), button.url('Website', config.sourceUrl)]
            }
        ];
        await sock.sendCarousel(from, { body: `Halo *${pushname}*, geser kartu *Carousel* ${config.botName}:`, footer: config.footerText }, cards, m);
    }
};
