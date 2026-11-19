/**
 * Plugin: Play Music (YouTube)
 * Scraper: Kadokun / API theresav.eu
 * Fungsi: Mencari dan memutar lagu dari YouTube berupa audio (MP3).
 */
const axios = require('axios');

// Konfigurasi API
const DEFAULT_API_KEY = "3eV67"; 
const BASE_URL = "https://api.theresav.eu/api";

// ───────────────────────── HELPER FUNCTIONS ─────────────────────────

function extractVideoId(input) {
    const str = String(input || "").trim();
    if (!str) return null;
    const m = str.match(
        /(?:youtu\.be\/|(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/|live\/))([a-zA-Z0-9_-]{11})/i
    );
    return m ? m[1] : null;
}

function toSeconds(dur) {
    if (typeof dur === "number") return dur;
    const parts = String(dur || "").trim().split(/[.:]/).map(Number);
    if (parts.some(Number.isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtSize(bytes) {
    const b = Number(bytes) || 0;
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${b} B`;
}

// ───────────────────────── SCRAPER CORE ─────────────────────────

async function searchYoutube(query) {
    try {
        const res = await axios.get(`${BASE_URL}/search/youtube`, {
            params: { query },
            headers: { "x-apikey": DEFAULT_API_KEY },
            timeout: 15000
        });
        
        const search = res.data;
        if (!search?.status || !Array.isArray(search?.data) || !search.data.length) {
            throw new Error(search?.message || `Hasil pencarian tidak ditemukan.`);
        }
        
        return search.data
            .filter(item => item?.videoId || item?.url)
            .map(item => {
                const id = item.videoId || extractVideoId(item.url);
                return {
                    id,
                    url: item.url || `https://www.youtube.com/watch?v=${id}`,
                    title: item.title || null,
                    channel: item.channel || null,
                    duration: item.duration || null,
                    seconds: toSeconds(item.duration),
                    thumbnail: item.thumbnail || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null)
                };
            });
    } catch (err) {
        throw new Error(err.response?.data?.message || err.message || "Gagal melakukan pencarian YouTube");
    }
}

async function resolveAudio(candidateUrl) {
    try {
        const res = await axios.get(`${BASE_URL}/download/ytmp3`, {
            params: { url: candidateUrl, format: "mp3", bitrate: "128k" },
            headers: { "x-apikey": DEFAULT_API_KEY },
            timeout: 20000
        });

        const dl = res.data;
        if (!dl?.status || !dl?.download_url) {
            throw new Error(dl?.message || `Gagal mengambil URL download audio.`);
        }
        return dl;
    } catch (err) {
        throw new Error(err.response?.data?.message || err.message || "Gagal mendapatkan link unduhan audio");
    }
}

// ───────────────────────── PLUGIN EXECUTION ─────────────────────────

module.exports = {
    name: 'Play Music (YouTube)',
    command: ['play', 'lagu', 'musik', 'ytplay'],
    category: 'downloader',
    description: 'Mencari dan memutar lagu (Audio) dari YouTube',
    usage: '.play <judul lagu atau link youtube>',
    
    async execute(sock, m, { args, reply, prefix, command }) {
        if (!args.length) {
            return reply(`*🎵 PANDUAN PLAY MUSIC*\nKetik \`${prefix}${command} <judul lagu atau link>\`\n\nContoh:\n\`${prefix}${command} Hindia Evaluasi\``);
        }

        const query = args.join(' ');
        const isUrl = extractVideoId(query) !== null;
        
        await reply(`⏳ Sedang mencari dan memproses audio *"${query}"*...`);

        try {
            // 1. Cari atau identifikasi lagu
            let targetVideo;
            
            if (isUrl) {
                const id = extractVideoId(query);
                targetVideo = {
                    id,
                    url: `https://www.youtube.com/watch?v=${id}`,
                    title: "YouTube Video",
                    channel: "-",
                    seconds: 0,
                    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
                };
            } else {
                const searchResults = await searchYoutube(query);
                targetVideo = searchResults[0]; // Ambil hasil pertama
            }

            // 2. Resolve Audio URL dari API
            const audioData = await resolveAudio(targetVideo.url);
            
            // Perbaiki data menggunakan metadata dari API jika tidak tersedia dari search
            const finalTitle = audioData.title || targetVideo.title;
            const finalChannel = audioData.channel || targetVideo.channel;
            const finalDuration = audioData.duration_sec || targetVideo.seconds;
            const finalThumbnail = audioData.thumbnail || targetVideo.thumbnail;
            const finalSize = fmtSize(audioData.filesize);

            // 3. Download Buffer Audio
            const audioRes = await axios.get(audioData.download_url, { 
                responseType: 'arraybuffer',
                timeout: 60000 
            });
            const audioBuffer = Buffer.from(audioRes.data);

            // 4. Susun Pesan Informasi
            let caption = `🎧 *YOUTUBE MUSIC PLAYER* 🎧\n\n`;
            caption += `🎵 *Judul:* ${finalTitle}\n`;
            caption += `👤 *Channel:* ${finalChannel}\n`;
            caption += `⏱️ *Durasi:* ${formatDuration(finalDuration)}\n`;
            caption += `💾 *Ukuran:* ${finalSize}\n`;
            caption += `🔗 *Link:* ${targetVideo.url}\n\n`;
            caption += `_Sedang mengirim audio, mohon tunggu..._`;

            // 5. Kirim Gambar Sampul (Thumbnail)
            await sock.sendMessage(m.key.remoteJid, { 
                image: { url: finalThumbnail }, 
                caption: caption 
            }, { quoted: m });

            // 6. Kirim Audio MP3
            await sock.sendMessage(m.key.remoteJid, { 
                audio: audioBuffer, 
                mimetype: 'audio/mpeg',
                ptt: false 
            }, { quoted: m });

        } catch (err) {
            await reply(`❌ *Gagal memutar lagu!*\nAlasan: ${err.message}`);
        }
    }
};
