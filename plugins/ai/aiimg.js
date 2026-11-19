/**
 * Plugin: AI Text2Image (Dezgo)
 * Sumber: gist ayashiiiyo — endpoint api.dezgo.com
 * Perintah: .aiimg <prompt>  → generate gambar dari teks
 */
const { text2image, uploadImage } = require('../../lib/services/dezgo');
const rich = require('../../lib/wa/rich');
const config = require('../../config');

// Model populer yang bisa dipakai user (dicek dinamis terhadap /info Dezgo)
const FAVORIT = ['dreamshaper', 'deliberate', 'realistic_vision_1_3', 'anything_4_0', 'flux_1_schnell', 'sdxl_1024px', 'stablediffusion_1_5'];

module.exports = {
    name: 'AI Text2Image',
    command: ['aiimg', 'txt2img', 'text2image'],
    category: 'ai',
    description: 'Buat gambar dari teks (AI Dezgo)',
    usage: '.aiimg <prompt> [model]\nContoh: .aiimg kucing ninja di atap rumah | dreamshaper',
    limit: 2,

    async execute(sock, m, { args, text, reply, prefix, command }) {
        if (!text) {
            return reply(
                `🎨 *AI TEXT TO IMAGE*\n\n` +
                `Format: \`${prefix}${command} <prompt> [model]\`\n\n` +
                `Contoh:\n• \`${prefix}${command} kucing ninja di atap\`\n` +
                `• \`${prefix}${command} kastil di awan | flux_1_schnell\`\n\n` +
                `Model populer: ${FAVORIT.join(', ')}\n` +
                `_(tanpa model → default stablediffusion_1_5)_`
            );
        }

        // prompt | model (opsional)
        let prompt = text, model = '';
        if (text.includes('|')) {
            const [p, ...rest] = text.split('|');
            prompt = p.trim();
            model = rest.join('|').trim().replace(/\s+/g, '_').toLowerCase();
        }

        await reply(`⏳ *Membuat gambar...*\n📝 Prompt: ${prompt}${model ? `\n🤖 Model: ${model}` : ''}\n\n_Gambar AI biasanya butuh 30–120 detik, mohon tunggu._`);

        try {
            const result = await text2image(prompt, {
                model: model || 'stablediffusion_1_5',
                guidance: 7,
                maxAttempts: 60,
                intervalMs: 3000
            });

            if (!result?.buffer?.length) throw new Error('Hasil gambar kosong dari server.');

            // Kirim sebagai AI Rich Response (ala Meta AI): teks + tabel info + gambar inline.
            // Butuh URL publik → upload hasilnya dulu. Gagal upload/rich → jatuh ke kirim gambar biasa.
            const captionFallback =
                `✨ *AI TEXT TO IMAGE* ✨\n\n📝 Prompt: ${prompt}\n🤖 Model: ${model || 'stablediffusion_1_5'}\n📦 Ukuran: ${(result.size / 1024).toFixed(1)} KB`;
            try {
                const url = await uploadImage(result.buffer, 'aiimg.jpg');
                await rich.send(sock, m.key.remoteJid, [
                    rich.text(`✨ *AI TEXT TO IMAGE*\n\n📝 Prompt: _${prompt}_`),
                    rich.table([
                        ['Item', 'Detail'],
                        ['Model', model || 'stablediffusion_1_5'],
                        ['Ukuran', `${(result.size / 1024).toFixed(1)} KB`],
                        ['Status', '✅ Selesai']
                    ], { title: 'Info Generate' }),
                    rich.image(url, { alignment: 'center', caption: prompt })
                ], { quoted: m });
            } catch {
                await sock.sendMessage(m.key.remoteJid, { image: result.buffer, caption: captionFallback }, { quoted: m });
            }
        } catch (err) {
            await reply(`❌ *GAGAL MEMBUAT GAMBAR*\n\nAlasan: ${err.message}\n\n_Tips: coba prompt lebih pendek atau model lain._`);
        }
    }
};
