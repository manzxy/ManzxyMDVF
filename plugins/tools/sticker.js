/**
 * .sticker / .s [pack | pembuat] — gambar (atau GIF/WebP animasi berupa file) → stiker
 * .s pada reply STIKER → ganti nama pack/pembuat • .toimg — stiker diam → gambar
 * Tanpa ffmpeg (lib/sticker.js, murni sharp). Video MP4 tidak didukung.
 */
const { downloadContentFromMessage } = require('../../lib/wa/mediaDownload');
const { unwrapMessage } = require('../../handler/parser');
const config = require('../../config');
const { makeSticker, rewriteExif, toImage } = require('../../lib/services/sticker');

async function download(node, type) {
    const chunks = [];
    for await (const c of await downloadContentFromMessage(node, type)) chunks.push(c);
    return Buffer.concat(chunks);
}

const isImageDoc = (d) => d && /^image\/(gif|webp|png|jpe?g)/i.test(d.mimetype || '');

module.exports = {
    name: 'Sticker',
    command: ['sticker', 'stiker', 's', 'toimg'],
    category: 'tools',
    order: 1,
    description: 'Gambar jadi stiker (tanpa ffmpeg), ganti pack stiker, stiker jadi gambar',
    usage: '.s (kirim/reply gambar) • .s pack | pembuat • .toimg (reply stiker)',

    async execute(sock, m, { from, command, text, quoted, pushname, prefix, reply }) {
        if (sock.mediaOk && !sock.mediaOk()) return await reply('Koneksi media sedang disambung ulang otomatis. Coba lagi sebentar.');
        const own = unwrapMessage(m.message) || {};
        const q = quoted?.message || {};

        try {
            /* ── stiker → gambar ── */
            if (command === 'toimg') {
                const st = q.stickerMessage || own.stickerMessage;
                if (!st) return await reply(`Reply stiker dengan *${prefix}toimg*.`);
                if (st.isAnimated) return await reply('Stiker animasi belum didukung (hanya stiker diam).');
                return void await sock.sendMessage(from, { image: await toImage(await download(st, 'sticker')) }, { quoted: m });
            }

            // nama pack: ".s Pack | Pembuat" (kosong = bawaan bot)
            const [packIn, authorIn] = (text || '').split('|').map((s) => s.trim());
            const meta = { pack: packIn || config.botName, author: authorIn || pushname || config.ownerName };

            /* ── reply stiker → ganti pack/pembuat ── */
            if (q.stickerMessage && !own.imageMessage) {
                const webp = rewriteExif(await download(q.stickerMessage, 'sticker'), meta);
                return void await sock.sendMessage(from, { sticker: webp }, { quoted: m });
            }

            /* ── gambar / dokumen gambar → stiker ── */
            const img = own.imageMessage || q.imageMessage;
            const doc = isImageDoc(own.documentMessage) ? own.documentMessage : (isImageDoc(q.documentMessage) ? q.documentMessage : null);
            if (!img && !doc) {
                if (own.videoMessage || q.videoMessage) return await reply('Video belum didukung karena bot berjalan tanpa ffmpeg. Kirim *gambar* atau *GIF/WebP sebagai file*.');
                return await reply(`Kirim atau reply *gambar* dengan *${prefix}s*.\nGanti pack: *${prefix}s Pack | Pembuat*`);
            }
            const buffer = await download(img || doc, img ? 'image' : 'document');
            await sock.sendMessage(from, { sticker: await makeSticker(buffer, meta) }, { quoted: m });
        } catch (err) {
            if (err.code === 'NO_SHARP' || err.code === 'MODULE_NOT_FOUND') return await reply('Fitur ini butuh `sharp`. Jalankan: npm i sharp');
            sock.reportMediaFailure?.(err);
            await reply(`Gagal memproses: ${err.message}`);
        }
    }
};
