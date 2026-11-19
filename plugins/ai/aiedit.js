/**
 * Plugin: AI Image2Image (Dezgo)
 * Sumber: gist ayashiiiyo — endpoint api.dezgo.com
 * Perintah: reply gambar dengan .aiedit <prompt> → gambar diubah sesuai prompt
 */
const { image2image, uploadImage } = require('../../lib/services/dezgo');
const rich = require('../../lib/wa/rich');
const { downloadContentFromMessage } = require('../../lib/wa/mediaDownload');
const config = require('../../config');

async function ambilMedia(msg, mtype) {
    const stream = await downloadContentFromMessage(msg[mtype], mtype === 'imageMessage' ? 'image' : 'document');
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
}

module.exports = {
    name: 'AI Image2Image',
    command: ['aiedit', 'img2img', 'image2image'],
    category: 'ai',
    description: 'Ubah gambar sesuai prompt (AI Dezgo)',
    usage: 'Reply gambar dengan: .aiedit <prompt> [strength 1-100]',
    limit: 2,

    async execute(sock, m, { text, reply, prefix, command, quoted, mtype }) {
        const isQuoted = !!quoted;
        const msg = isQuoted ? quoted.message : m.message;
        const type = isQuoted ? quoted.mtype : mtype;
        const mediaType = type === 'imageMessage' ? 'imageMessage' : (type === 'documentMessage' && msg?.documentMessage?.mimetype?.startsWith('image/') ? 'documentMessage' : null);

        if (!mediaType) {
            return reply(
                `🖼️ *AI IMAGE TO IMAGE*\n\n` +
                `Kirim/reply sebuah gambar dengan caption:\n\`${prefix}${command} <prompt> [strength]\`\n\n` +
                `Contoh:\n• \`${prefix}${command} ubah jadi cyberpunk neon\`\n` +
                `• \`${prefix}${command} jadikan anime | 90\`\n\n` +
                `_strength (1–100) mengatur seberapa kuat AI mengubah gambarmu. Default 70._`
            );
        }
        if (!text) return reply(`❌ Prompt-nya mana?\nContoh: \`${prefix}${command} ubah jadi lukisan minyak\``);

        // prompt | strength (opsional)
        let prompt = text, strength = 0.7;
        if (text.includes('|')) {
            const [p, s] = text.split('|');
            prompt = p.trim();
            const n = parseFloat(s);
            if (!isNaN(n)) strength = Math.min(1, Math.max(0.01, n > 1 ? n / 100 : n));
        }

        await reply(`⏳ *Mengubah gambar...*\n📝 Prompt: ${prompt}\n💪 Strength: ${Math.round(strength * 100)}%\n\n_Mohon tunggu 30–120 detik._`);

        try {
            const buffer = await ambilMedia(msg, mediaType);
            const result = await image2image(buffer, prompt, {
                model: 'stablediffusion_1_5',
                strength,
                maxAttempts: 60,
                intervalMs: 3000
            });

            if (!result?.buffer?.length) throw new Error('Hasil gambar kosong dari server.');

            // Rich response ala Meta AI: teks + tabel info + gambar hasil edit.
            const captionFallback =
                `✨ *AI IMAGE TO IMAGE* ✨\n\n📝 Prompt: ${prompt}\n💪 Strength: ${Math.round(strength * 100)}%\n📦 Ukuran: ${(result.size / 1024).toFixed(1)} KB`;
            try {
                const url = await uploadImage(result.buffer, 'aiedit.jpg');
                await rich.send(sock, m.key.remoteJid, [
                    rich.text(`✨ *AI IMAGE TO IMAGE*\n\n📝 Prompt: _${prompt}_`),
                    rich.table([
                        ['Item', 'Detail'],
                        ['Strength', `${Math.round(strength * 100)}%`],
                        ['Ukuran', `${(result.size / 1024).toFixed(1)} KB`],
                        ['Status', '✅ Selesai']
                    ], { title: 'Info Edit' }),
                    rich.image(url, { alignment: 'center', caption: prompt })
                ], { quoted: m });
            } catch {
                await sock.sendMessage(m.key.remoteJid, { image: result.buffer, caption: captionFallback }, { quoted: m });
            }
        } catch (err) {
            await reply(`❌ *GAGAL MENGUBAH GAMBAR*\n\nAlasan: ${err.message}`);
        }
    }
};
