module.exports = {
    name: 'QR Code',
    command: ['qr', 'qrcode'],
    category: 'tools',
    description: 'Buat QR code dari teks / link',
    usage: '.qr <teks>',
    limit: 0,
    async execute(sock, m, { from, text, quoted, reply, prefix, command }) {
        const data = (text || quoted?.text || '').trim();
        if (!data) return await reply(`Contoh: *${prefix}${command} https://contoh.com*`);
        if (data.length > 1000) return await reply('Teks terlalu panjang (maks 1000 karakter).');
        if (sock.mediaOk && !sock.mediaOk()) return await reply('Koneksi media sedang disambung ulang, coba lagi sebentar.');
        const buf = await require('qrcode').toBuffer(data, { margin: 2, width: 512 });
        await sock.sendMessage(from, { image: buf, caption: data.length > 200 ? data.slice(0, 200) + '…' : data }, { quoted: m });
    }
};
