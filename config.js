/* Muat .env bila ada (tanpa dependency tambahan) supaya WEB_PANEL_URL, PAIRING_NUMBER, dll terbaca juga via `npm start`. */
(function loadDotEnv() {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '.env');
    try {
        if (!fs.existsSync(file)) return;
        for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const eq = line.indexOf('=');
            if (eq < 0) continue;
            const key = line.slice(0, eq).trim();
            let val = line.slice(eq + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
            // Timpa juga bila env berisi string kosong (mis. pm2 menyimpan KIPAY_API_KEY='')
            if (process.env[key] === undefined || process.env[key] === '') process.env[key] = val;
        }
    } catch { /* abaikan: env opsional */ }
})();

module.exports = {
    /* Identitas */
    botName: 'ManzxyMD',
    ownerName: 'Manzxy',
    ownerNumber: ['6281234567890'],       // Root Owner: nomor tanpa + / spasi (GANTI sebelum pakai)
    prefix: '.',
    prefixes: ['.', '!', '#', '/', '~'],  // dipakai bila multiPrefix aktif (bawaan: aktif)

    /* Login & mode */
    selfMode: false,                       // true = hanya owner, false = publik
    usePairingCode: false,                 // false = pakai QR
    pairingNumber: process.env.PAIRING_NUMBER || '6281234567890',

    /* Pembayaran QRIS (KiPay). WAJIB lewat env KIPAY_API_KEY — jangan menaruh API key di source code. */
    kipay: { api_key: process.env.KIPAY_API_KEY || '', pollIntervalSec: 5 },

    /* Panel web */
    webPanelUrl: process.env.WEB_PANEL_URL || 'https://panel.manzxy.biz.id',

    /* Harga & limit */
    limit: { daily: 0 },                                                   // EDISI GRATIS: tanpa limit harian
    premium: { price: { perDay: 2000, perHour: 1000 } },
    jadibot: { max: 10, price: { perDay: 1000, packages: { '7d': 5000, '30d': 15000, '90d': 35000 } } },

    /* Tampilan */
    footerText: 'ManzxyMD',
    logoUrl: '',
    thumbnailUrl: 'https://lunara.softbotz.my.id/f/NfVzyYdyvwQ5.jpeg',
    sourceUrl: 'https://github.com/WhiskeySockets/Baileys', // TODO: ganti ke repo edisi gratis ini
    replyStyle: 'forward',                // forward = kartu dokumen + saluran | ad = externalAdReply | plain = teks
    channel: { jid: '', name: 'ManzxyMD' }, // atau cukup ketik .setch <link saluran>
    menu: { useButtons: true }            // true = menu bertombol, false = menu teks
};
