/**
 * Plugin: GitHub Gist Reader
 * Fungsi: Membaca dan mengekstrak kode/teks dari URL GitHub Gist (Full Teks Tanpa Limit)
 */
const axios = require('axios');

module.exports = {
    name: 'Gist Reader',
    command: ['gist', 'readgist'],
    category: 'tools',
    description: 'Membaca kode/teks dari tautan GitHub Gist',
    usage: '.gist <url_gist>',
    
    async execute(sock, m, { args, reply, prefix, command }) {
        if (!args[0]) {
            return reply(`*📂 PANDUAN GIST READER*\nKetik \`${prefix}${command} <url_gist>\`\n\nContoh:\n\`${prefix}${command} https://gist.github.com/username/0a1b2c3d4e5f6g7h8i9j\``);
        }

        const url = args[0];
        await reply('⏳ Sedang mengambil data dari GitHub Gist...');

        try {
            let filesData = [];

            // Skenario 1: Tautan Raw Gist (gist.githubusercontent.com)
            if (url.includes('gist.githubusercontent.com')) {
                const res = await axios.get(url);
                filesData.push({
                    filename: 'raw_code.txt',
                    content: typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2)
                });
            } 
            // Skenario 2: Tautan Gist Standar (Mendukung Gist multi-file via API)
            else if (url.includes('gist.github.com')) {
                const match = url.match(/gist\.github\.com\/[^\/]+\/([a-f0-9]+)/i);
                
                if (!match) {
                    return reply('❌ Format URL Gist tidak valid.\nPastikan tautan memiliki ID Gist yang benar.');
                }
                
                const gistId = match[1];
                const res = await axios.get(`https://api.github.com/gists/${gistId}`);
                
                const files = res.data.files;
                for (const key in files) {
                    filesData.push({
                        filename: files[key].filename,
                        content: files[key].content || '(File kosong)'
                    });
                }
            } 
            else {
                return reply('❌ URL tidak dikenali sebagai tautan GitHub Gist.');
            }

            if (filesData.length === 0) {
                return reply('❌ Tidak ada file teks yang ditemukan dalam Gist tersebut.');
            }

            // Loop untuk mengirim setiap file yang ada di dalam Gist secara full/utuh
            for (let i = 0; i < filesData.length; i++) {
                const file = filesData[i];
                let caption = `*📄 File:* ${file.filename}\n\n\`\`\`${file.content}\`\`\``;
                
                await reply(caption);
            }

        } catch (err) {
            const errorMsg = err.response?.data?.message || err.message || 'Unknown error';
            await reply(`❌ *Gagal mengambil Gist:*\n${errorMsg}\n\n_Pastikan URL Gist bersifat publik dan tersedia._`);
        }
    }
};
