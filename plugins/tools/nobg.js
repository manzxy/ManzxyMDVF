/**
 * Plugin: Remove Background (Dezgo)
 * Sumber: gist ayashiiiyo — endpoint api.dezgo.com/remove-background
 * Perintah: reply gambar dengan .nobg → background dihapus (PNG transparan)
 */
const { removeBg, uploadImage } = require('../../lib/services/dezgo');
const rich = require('../../lib/wa/rich');
const { downloadContentFromMessage } = require('../../lib/wa/mediaDownload');
const config = require('../../config');

const MODES = {
    transparent: 'Transparan (PNG)',
    mono: 'Latar monokrom',
    linear: 'Latar gradasi',
    blur: 'Latar blur'
};

async function ambilGambar(msg, mtype) {
    const stream = await downloadContentFromMessage(msg[mtype], 'image');
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
}

module.exports = {
    name: 'Remove Background',
    command: ['nobg', 'removebg', 'removebackground', 'stikertransparan'],
    category: 'tools',
    description: 'Hapus background gambar (jadi PNG transparan)',
    usage: 'Reply gambar dengan: .nobg [transparent|mono|linear|blur]',
    limit: 1,

    async execute(sock, m, { args, text, reply, prefix, command, quoted, mtype }) {
        const isQuoted = !!quoted;
        const msg = isQuoted ? quoted.message : m.message;
        const type = isQuoted ? quoted.mtype : mtype;
        const mediaType = type === 'imageMessage' ? 'imageMessage'
            : (type === 'stickerMessage' ? 'stickerMessage'
            : (type === 'documentMessage' && msg?.documentMessage?.mimetype?.startsWith('image/') ? 'documentMessage' : null));

        if (!mediaType) {
            return reply(
                `🪄 *REMOVE BACKGROUND*\n\n` +
                `Kirim/reply gambar (bisa juga stiker) dengan caption:\n\`${prefix}${command} [mode]\`\n\n` +
                `Mode:\n${Object.entries(MODES).map(([k, v]) => `• ${k} — ${v}`).join('\n')}\n\n` +
                `Contoh: \`${prefix}${command} transparent\` (default: transparent)`
            );
        }

        const mode = (text || 'transparent').trim().toLowerCase();
        if (!MODES[mode]) return reply(`❌ Mode *"${mode}"* tidak dikenal.\nPilih: ${Object.keys(MODES).join(', ')}`);

        await reply(`⏳ *Menghapus background...*\n🪄 Mode: ${MODES[mode]}\n\n_Mohon tunggu 10–60 detik._`);

        try {
            const buffer = await ambilGambar(msg, mediaType);
            const result = await removeBg(buffer, { mode, maxAttempts: 40, intervalMs: 3000 });

            if (!result?.buffer?.length) throw new Error('Hasil kosong dari server.');

            const isTransparent = result.contentType?.includes('png');
            const captionFallback =
                `✅ *BACKGROUND DIHAPUS*\n\n🪄 Mode: ${MODES[mode]}\n📦 Ukuran: ${(result.size / 1024).toFixed(1)} KB\n🖼️ Format: ${isTransparent ? 'PNG transparan' : result.contentType}`;
            try {
                // Rich response ala Meta AI: teks + tabel + hasil PNG transparan inline.
                const url = await uploadImage(result.buffer, 'nobg.png');
                await rich.send(sock, m.key.remoteJid, [
                    rich.text(`✅ *BACKGROUND DIHAPUS*\n\n🪄 Mode: *${MODES[mode]}*`),
                    rich.table([
                        ['Item', 'Detail'],
                        ['Format', isTransparent ? 'PNG transparan' : (result.contentType || 'image')],
                        ['Ukuran', `${(result.size / 1024).toFixed(1)} KB`],
                        ['Status', '✅ Selesai']
                    ], { title: 'Info Remove BG' }),
                    rich.image(url, { alignment: 'center', caption: 'Hasil tanpa background' })
                ], { quoted: m });
            } catch {
                await sock.sendMessage(m.key.remoteJid, {
                    image: result.buffer,
                    mimetype: isTransparent ? 'image/png' : result.contentType,
                    caption: captionFallback
                }, { quoted: m });
            }
        } catch (err) {
            await reply(`❌ *GAGAL MENGHAPUS BACKGROUND*\n\nAlasan: ${err.message}\n\n_Tips: pakai foto dengan objek utama yang jelas._`);
        }
    }
};
