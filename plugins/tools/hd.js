/**
 * Plugin: Image Enhancer / Upscaler
 * Fungsi: Memperjelas, memperbesar, atau memperbaiki gambar (seperti Remini).
 * Adaptasi dari API imageenlarger.app
 */
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');
const { downloadContentFromMessage } = require('../../lib/wa/mediaDownload');

const LOGIN_HASH = 'ab5d684a5cac66c6a7c902dda743fb642827b01b8bd4d9514d46834e4c425ff2';
const API_BASE = 'https://www.imageenlarger.app/api';

/**
 * Mendapatkan token otorisasi dengan generate Device ID acak
 */
async function getToken() {
    const deviceId = crypto.randomBytes(8).toString('hex');
    const res = await axios.post(`${API_BASE}/v2/login`, {
        device_name: 'Pixel 7',
        id: deviceId,
        referral: null
    }, {
        headers: {
            'Content-Type': 'application/json',
            'hash': LOGIN_HASH,
            'User-Agent': 'Mozilla/5.0'
        }
    });

    if (!res.data?.success || !res.data?.data?.token) {
        throw new Error('Gagal mendapatkan token otorisasi dari server.');
    }

    return res.data.data.token;
}

/**
 * Memproses gambar ke API
 */
async function processImage(imageBuffer, type, config = {}) {
    const token = await getToken();

    const form = new FormData();
    // Gunakan filename 'image.jpg' agar server menerimanya dengan baik
    form.append('image', imageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
    form.append('type', type);
    form.append('input', JSON.stringify(config));

    const res = await axios.post(`${API_BASE}/v2/process`, form, {
        headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });

    const json = res.data;
    if (!json?.success || !json?.data?.output) {
        throw new Error(json?.message || json?.error_code || 'Gagal memproses gambar (Server Error).');
    }

    return {
        output: json.data.output,
        width: json.data.width,
        height: json.data.height,
        size: json.data.size
    };
}

module.exports = {
    name: 'Image Enhancer',
    command: ['hd', 'enhance', 'enlarge', 'restore', 'remini'],
    category: 'tools',
    description: 'Memperjelas (HD), memperbesar, atau memperbaiki gambar',
    usage: 'Kirim/Reply gambar dengan caption .hd',
    
    async execute(sock, m, { command, prefix, quoted, mtype, reply }) {
        // Deteksi apakah ada pesan bergambar
        const isQuoted = !!quoted;
        const msg = isQuoted ? quoted.message : m.message;
        const type = isQuoted ? quoted.mtype : mtype;

        if (type !== 'imageMessage' || !msg?.imageMessage) {
            return reply(`❌ *Panduan Penggunaan:*\nKirim atau balas (reply) sebuah *gambar* dengan perintah:\n\n` +
                `• \`${prefix}hd\` atau \`${prefix}enhance\` (Untuk memperjelas foto umum/wajah)\n` +
                `• \`${prefix}enlarge\` (Untuk memperbesar resolusi gambar)\n` +
                `• \`${prefix}restore\` (Untuk memperbaiki foto lama/rusak)`);
        }

        // Tentukan mode berdasarkan command yang dipanggil
        let modeType = 'Enhancer';
        let config = { upscale: 2, isBackgroundEnabled: true };
        let modeName = 'Memperjelas Gambar (HD)';

        if (command === 'enlarge') {
            modeType = 'Enlarger';
            config = { upscale: 2, isFaceEnhanceEnabled: true };
            modeName = 'Memperbesar Resolusi (Enlarge)';
        } else if (command === 'restore') {
            modeType = 'Restore';
            config = { upscale: 2 };
            modeName = 'Memperbaiki Foto (Restore)';
        }

        await reply(`⏳ *Sedang memproses...*\nMode: ${modeName}\n_Proses ini biasanya memakan waktu beberapa detik._`);

        try {
            // 1. Download buffer gambar dari WhatsApp
            const stream = await downloadContentFromMessage(msg.imageMessage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            // 2. Proses ke server AI Image Enlarger
            const result = await processImage(buffer, modeType, config);

            // 3. Susun Teks Hasil
            let caption = `✨ *GAMBAR BERHASIL DIPROSES* ✨\n\n`;
            caption += `🔧 *Mode:* ${modeType}\n`;
            if (result.width && result.height) {
                caption += `📏 *Resolusi Baru:* ${result.width} x ${result.height} px\n`;
            }
            if (result.size) {
                caption += `💾 *Ukuran Baru:* ${(result.size / 1024 / 1024).toFixed(2)} MB\n`;
            }

            // 4. Kirim kembali gambar hasilnya
            await sock.sendMessage(m.key.remoteJid, { 
                image: { url: result.output }, 
                caption: caption 
            }, { quoted: m });

        } catch (err) {
            const errorMsg = err.response?.data?.message || err.message || 'Unknown error';
            await reply(`❌ *GAGAL MEMPROSES GAMBAR*\n\nAlasan: ${errorMsg}\n\n_Pastikan gambarnya tidak terlalu besar atau coba lagi nanti._`);
        }
    }
};
