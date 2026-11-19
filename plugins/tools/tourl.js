/**
 * Plugin: Upload to URL (tourl)
 * Fungsi: Mengunggah media (Gambar, Video, Stiker, Dokumen, Audio) ke lunara.softbotz.my.id
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const FormData = require('form-data');
const { downloadContentFromMessage } = require('../../lib/wa/mediaDownload');

module.exports = {
    name: 'To URL',
    command: ['tourl', 'upload'],
    category: 'tools',
    description: 'Mengunggah file/media ke server dan menghasilkan URL',
    usage: 'Balas (reply) media dengan caption .tourl',
    
    async execute(sock, m, { command, prefix, quoted, mtype, reply }) {
        // Tentukan pesan mana yang mengandung media (pesan yang di-reply atau pesan itu sendiri)
        const isQuoted = !!quoted;
        const msg = isQuoted ? quoted.message : m.message;
        const type = isQuoted ? quoted.mtype : mtype;

        if (!msg) {
            return reply(`❌ Reply media (Gambar/Video/Dokumen/Audio) dengan perintah *${prefix}${command}*`);
        }

        // Ambil objek media berdasarkan tipe pesannya
        let mediaMessage;
        let mediaType;
        
        if (type === 'imageMessage') {
            mediaMessage = msg.imageMessage;
            mediaType = 'image';
        } else if (type === 'videoMessage') {
            mediaMessage = msg.videoMessage;
            mediaType = 'video';
        } else if (type === 'documentMessage') {
            mediaMessage = msg.documentMessage;
            mediaType = 'document';
        } else if (type === 'audioMessage') {
            mediaMessage = msg.audioMessage;
            mediaType = 'audio';
        } else if (type === 'stickerMessage') {
            mediaMessage = msg.stickerMessage;
            mediaType = 'sticker';
        }

        if (!mediaMessage) {
            return reply(`❌ Tipe pesan tidak didukung! Reply Gambar, Video, Dokumen, Audio, atau Stiker dengan perintah *${prefix}${command}*`);
        }

        await reply('⏳ Sedang mengunduh dan mengunggah file... Mohon tunggu.');

        let tmpFile = '';

        try {
            // 1. Ekstrak ekstensi dari mimetype (misal: image/jpeg -> jpeg)
            const mime = mediaMessage.mimetype || '';
            let ext = 'bin';
            if (mime) {
                ext = mime.split('/')[1].split(';')[0];
                if (ext === 'vnd.openxmlformats-officedocument.wordprocessingml.document') ext = 'docx';
                if (ext === 'vnd.openxmlformats-officedocument.spreadsheetml.sheet') ext = 'xlsx';
            }
            
            // Nama file khusus untuk dokumen jika tersedia
            let fileName = mediaMessage.fileName || `media_${Date.now()}.${ext}`;
            tmpFile = path.join(os.tmpdir(), fileName);

            // 2. Download media dari server WhatsApp
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            // 3. Simpan sementara ke memori lokal VPS
            fs.writeFileSync(tmpFile, buffer);

            // 4. Proses Upload via API Lunara
            const form = new FormData();
            form.append("file", fs.createReadStream(tmpFile));
            form.append("filename", fileName);

            const { data } = await axios.post(
                "https://lunara.softbotz.my.id/upload",
                form,
                {
                    headers: form.getHeaders(),
                    maxBodyLength: Infinity,
                    timeout: 300000, // 5 Menit timeout (aman untuk video/dokumen)
                }
            );

            if (!data || !data.file_url) {
                throw new Error('Server mengembalikan respons kosong atau struktur URL tidak valid.');
            }

            // 5. Hitung ukuran file untuk ditampilkan
            const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(2);

            // 6. Kirim hasil
            let caption = `✅ *UPLOAD BERHASIL*\n\n`;
            caption += `📁 *Nama File:* ${fileName}\n`;
            caption += `📊 *Ukuran:* ${fileSizeMB} MB\n`;
            caption += `🔗 *Link URL:*\n${data.file_url}\n\n`;
            caption += `_Link ini sekarang bisa diakses secara publik._`;

            await reply(caption);

        } catch (err) {
            const errorMsg = err.response?.data?.message || err.message || 'Unknown error';
            await reply(`❌ *GAGAL MENGUNGGAH*\n\nAlasan: ${errorMsg}\n\n_Pastikan file tidak terlalu besar dan server API sedang online._`);
        } finally {
            // 7. Bersihkan file sampah (wajib agar disk VPS tidak penuh)
            if (tmpFile && fs.existsSync(tmpFile)) {
                fs.unlinkSync(tmpFile);
            }
        }
    }
};
