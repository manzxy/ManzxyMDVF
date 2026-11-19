/**
 * Plugin: Imagine Me (AI Avatar & Image Transformer)
 * Fungsi: Mengubah foto wajah menjadi berbagai style (Cyberpunk, Anime, dll)
 * Menggunakan API dari imagine-ai-dot-calaiproject
 */
const axios = require('axios');
const FormData = require('form-data');
const { downloadContentFromMessage } = require('../../lib/wa/mediaDownload');

const BASE_URL = 'https://imagine-ai-dot-calaiproject-471016.uc.r.appspot.com';
const STYLES = [
    'None', 'Classic', 'Cyberpunk', 'Anime', 'Model Shoot', 'AI Avatar',
    'Royal Portrait', 'Superhero', 'Comic Book', 'Warrior', 'Disney',
    'GTA Style', 'AI Selfie', 'Action Figure', 'Lego Portrait', 'Cartoon',
    'AI Cosplay', 'Military', 'Tattoo Look', 'Pet Portrait', 'AI Haircut'
];

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    name: 'Imagine Me',
    command: ['imagine', 'imagineme', 'avatar'],
    category: 'ai',
    description: 'Ubah foto wajahmu menjadi berbagai style (Anime, Cyberpunk, dll)',
    usage: '.imagine <Style> | <Prompt>\nBalas (reply) gambar dengan perintah ini.',
    
    async execute(sock, m, { args, reply, prefix, command, quoted, mtype, text }) {
        // 1. Validasi Media
        const isQuoted = !!quoted;
        const msg = isQuoted ? quoted.message : m.message;
        const type = isQuoted ? quoted.mtype : mtype;

        if (type !== 'imageMessage' || !msg?.imageMessage) {
            let helpMsg = `❌ *PANDUAN IMAGINE ME*\n\n`;
            helpMsg += `Kamu harus membalas (reply) sebuah foto wajah dengan format:\n`;
            helpMsg += `\`${prefix}${command} <Style> | <Prompt>\`\n\n`;
            helpMsg += `🎨 *Daftar Style Tersedia:*\n`;
            helpMsg += STYLES.map(s => `• ${s}`).join('\n');
            helpMsg += `\n\nContoh:\n\`${prefix}${command} Cyberpunk | hacker keren di kota neon\``;
            return reply(helpMsg);
        }

        // 2. Validasi Input Teks
        if (!text || !text.includes('|')) {
            return reply(`❌ Format salah!\nGunakan pemisah garis lurus \`|\` antara Style dan Prompt.\n\nContoh: \`${prefix}${command} Anime | anak sekolah tampan\``);
        }

        let [inputStyle, ...inputPromptArr] = text.split('|');
        inputStyle = inputStyle.trim();
        const userPrompt = inputPromptArr.join('|').trim();

        // Pencocokan Style (Case-insensitive)
        const matchedStyle = STYLES.find(s => s.toLowerCase() === inputStyle.toLowerCase());
        if (!matchedStyle) {
            return reply(`❌ Style *"${inputStyle}"* tidak ditemukan!\nSilakan ketik \`${prefix}${command}\` saja untuk melihat daftar style.`);
        }

        if (!userPrompt) {
            return reply(`❌ Prompt (deskripsi) tidak boleh kosong!`);
        }

        await reply(`⏳ *Sedang memproses...*\n🎨 Style: ${matchedStyle}\n📝 Prompt: ${userPrompt}\n\n_Proses AI membutuhkan waktu sekitar 1-2 menit. Mohon bersabar._`);

        try {
            // 3. Download Gambar
            const stream = await downloadContentFromMessage(msg.imageMessage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            // 4. Upload Images (API butuh 2-10 gambar, kita duplikat buffer-nya untuk bypass)
            const form = new FormData();
            form.append('files', buffer, { filename: 'image1.jpg', contentType: 'image/jpeg' });
            form.append('files', buffer, { filename: 'image2.jpg', contentType: 'image/jpeg' });

            const uploadRes = await axios.post(`${BASE_URL}/upload/images`, form, {
                headers: form.getHeaders(),
                timeout: 180000 // 3 menit
            });

            if (!uploadRes.data?.session_id) {
                throw new Error('Gagal mendapatkan Session ID dari server AI.');
            }
            const sessionId = uploadRes.data.session_id;

            // 5. Request Generation
            const genRes = await axios.post(`${BASE_URL}/generate/request`, {
                session_id: sessionId,
                style_id: matchedStyle,
                user_prompt: userPrompt
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 60000
            });

            if (!genRes.data?.job_id) {
                throw new Error('Gagal mendapatkan Job ID dari server AI.');
            }
            const jobId = genRes.data.job_id;

            // 6. Polling Hasil (Tunggu sampai selesai)
            let resultUrl = null;
            let attempts = 0;
            const maxAttempts = 40;

            while (attempts < maxAttempts) {
                const pollRes = await axios.get(`${BASE_URL}/generate/result/${encodeURIComponent(jobId)}`, {
                    validateStatus: () => true
                });

                const status = pollRes.data?.status;

                if (status === 'completed' && pollRes.data?.result_url) {
                    resultUrl = pollRes.data.result_url;
                    break;
                } else if (status === 'failed' || status === 'error') {
                    const errDetail = pollRes.data?.detail || 'Generation failed on server';
                    throw new Error(`AI Server Error: ${JSON.stringify(errDetail)}`);
                }

                await sleep(3000); // Tunggu 3 detik sebelum cek lagi
                attempts++;
            }

            if (!resultUrl) {
                throw new Error('Waktu tunggu habis (Timeout). Server AI merespon terlalu lama.');
            }

            // 7. Kirim Hasil ke WhatsApp
            let caption = `✨ *IMAGINE ME RESULT* ✨\n\n`;
            caption += `🎨 *Style:* ${matchedStyle}\n`;
            caption += `📝 *Prompt:* ${userPrompt}\n`;

            await sock.sendMessage(m.key.remoteJid, {
                image: { url: resultUrl },
                caption: caption
            }, { quoted: m });

        } catch (err) {
            const errorMsg = err.response?.data?.detail || err.response?.data?.message || err.message || 'Unknown error';
            await reply(`❌ *GAGAL MEMBUAT AVATAR*\n\nAlasan: ${errorMsg}\n\n_Pastikan foto yang dikirim menampilkan wajah dengan jelas._`);
        }
    }
};
