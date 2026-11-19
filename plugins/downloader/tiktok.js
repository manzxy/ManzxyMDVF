/**
 * Plugin: TikTok Downloader (Omdown Engine + TikWM Fallback)
 * Support: Video (No Watermark) dan Carousel (Slide Foto + Audio)
 * Output: Super bersih (Langsung media + caption asli)
 */
const axios = require('axios');

// ============================================================================
// ENGINE 1: OMDOWN SCRAPER
// ============================================================================

const BASE_URL = "https://www.omdown.site";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const SUPPORTED_PLATFORMS = [
    [/(?:^|\.)tiktok\.com$/i, "TikTok"],
    [/(?:^|\.)(?:douyin\.com|iesdouyin\.com)$/i, "Douyin"],
    [/(?:^|\.)(?:kuaishou\.com|kwai\.com)$/i, "Kuaishou"]
];

function detectPlatform(url) {
    if (!url || typeof url !== "string") return null;
    try {
        const raw = url.trim();
        const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        const parsed = new URL(withProto);
        const match = SUPPORTED_PLATFORMS.find(([regex]) => regex.test(parsed.hostname));
        return match ? match[1] : "TikTok";
    } catch {
        return "TikTok";
    }
}

let cachedSession = { cookie: null, expiresAt: 0 };

async function getSession(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedSession.cookie && cachedSession.expiresAt > now) {
        return cachedSession.cookie;
    }

    try {
        const res = await axios.get(`${BASE_URL}/en`, {
            headers: {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Upgrade-Insecure-Requests": "1"
            },
            timeout: 10000,
            validateStatus: () => true
        });

        const setCookies = res.headers["set-cookie"] || [];
        let cookies = setCookies.map(c => c.split(";")[0].trim()).join("; ");
        if (!cookies) cookies = "om_sec=default";

        cachedSession = {
            cookie: cookies,
            expiresAt: now + 4 * 60 * 60 * 1000
        };

        return cookies;
    } catch (err) {
        return "om_sec=default";
    }
}

async function resolveOmdown(targetUrl, forceRefresh = false) {
    const cleanUrl = String(targetUrl || "").trim();
    if (!cleanUrl) throw new Error("URL tidak boleh kosong");

    const detected = detectPlatform(cleanUrl);
    let cookie = await getSession(forceRefresh);

    const sendRequest = async (sessCookie) => {
        return await axios.post(`${BASE_URL}/api/media/resolve`, {
            url: cleanUrl,
            platform: detected,
            locale: "id"
        }, {
            headers: {
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Origin": BASE_URL,
                "Referer": `${BASE_URL}/en`,
                "Cookie": sessCookie
            },
            validateStatus: () => true,
            timeout: 15000
        });
    };

    let res = await sendRequest(cookie);

    if (res.status === 401 || res.status === 403) {
        cookie = await getSession(true);
        res = await sendRequest(cookie);
    }

    const data = res.data || {};

    if (!data.success) {
        throw new Error(data.error || `Omdown gagal (HTTP ${res.status})`);
    }

    const formats = Array.isArray(data.data.formats) ? data.data.formats : [];
    const cleanFormats = formats.map(f => {
        let streamUrl = f.downloadUrl || "";
        if (streamUrl && streamUrl.startsWith("/")) {
            streamUrl = `${BASE_URL}${streamUrl}${streamUrl.includes("?") ? "&" : "?"}download=1`;
        }
        return {
            kind: f.kind || "video",
            hasWatermark: Boolean(f.hasWatermark),
            downloadUrl: streamUrl
        };
    });

    return {
        title: data.data.title || "",
        isCarousel: Boolean(data.data.isCarousel),
        formats: cleanFormats
    };
}

// ============================================================================
// ENGINE 2: TIKWM FALLBACK (Jika Omdown Error/Diblock)
// ============================================================================

async function fallbackTikWM(url) {
    const res = await axios.post('https://www.tikwm.com/api/', `url=${encodeURIComponent(url)}&hd=1`, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT
        },
        timeout: 15000
    });

    const data = res.data?.data;
    if (!data) throw new Error("Server cadangan (TikWM) juga gagal mengambil data.");

    const isCarousel = Array.isArray(data.images) && data.images.length > 0;
    const formats = [];
    const parseUrl = (u) => u?.startsWith('/') ? `https://www.tikwm.com${u}` : u;

    if (isCarousel) {
        data.images.forEach(img => {
            formats.push({ kind: 'image', downloadUrl: parseUrl(img) });
        });
        if (data.music) formats.push({ kind: 'audio', downloadUrl: parseUrl(data.music) });
    } else {
        formats.push({ kind: 'video', hasWatermark: false, downloadUrl: parseUrl(data.hdplay || data.play) });
    }

    return {
        title: data.title || '',
        isCarousel: isCarousel,
        formats: formats
    };
}

// ============================================================================
// HELPER BUFFER
// ============================================================================

async function fetchBuffer(url) {
    if (!url) return null;
    try {
        const isOmdown = url.includes(BASE_URL);
        const targetUrl = url.startsWith("http") ? url : `${BASE_URL}${url}`;
        
        const headers = { "User-Agent": USER_AGENT };
        if (isOmdown) {
            headers["Referer"] = `${BASE_URL}/en`;
            headers["Cookie"] = await getSession();
        }

        const res = await axios.get(targetUrl, {
            headers,
            responseType: 'arraybuffer',
            timeout: 60000
        });
        return Buffer.from(res.data);
    } catch {
        return null;
    }
}

// ============================================================================
// PLUGIN EXECUTION
// ============================================================================

module.exports = {
    name: 'TikTok Downloader',
    command: ['tiktok', 'tt', 'ttdl'],
    category: 'downloader',
    description: 'Download TikTok bersih dan langsung',
    usage: '.tiktok <url>',
    
    async execute(sock, m, { args, reply, prefix, command }) {
        if (!args[0]) {
            return reply(`*Panduan TikTok*\nKetik: \`${prefix}${command} <link>\``);
        }

        const inputUrl = args[0];

        try {
            await reply('⏳ Mengunduh...');
            
            // 1. Ekstrak data TikTok (Coba Omdown, jika gagal pakai TikWM)
            let data;
            try {
                data = await resolveOmdown(inputUrl);
            } catch (omdownErr) {
                data = await fallbackTikWM(inputUrl);
            }

            const caption = data.title || '';

            // 2. Jika konten berupa Carousel (Slide Foto)
            if (data.isCarousel) {
                const imageFormats = data.formats.filter(f => f.kind === 'image');
                if (imageFormats.length === 0) throw new Error('Tidak ada foto yang ditemukan.');

                // Kirim semua gambar
                for (let i = 0; i < imageFormats.length; i++) {
                    const imgBuffer = await fetchBuffer(imageFormats[i].downloadUrl);
                    if (imgBuffer) {
                        await sock.sendMessage(m.key.remoteJid, { 
                            image: imgBuffer, 
                            caption: i === 0 ? caption : undefined // Caption cuma di foto pertama
                        }, { quoted: m });
                    }
                }

                // Kirim lagunya
                const audioFormat = data.formats.find(f => f.kind === 'audio');
                if (audioFormat && audioFormat.downloadUrl) {
                    const audioBuffer = await fetchBuffer(audioFormat.downloadUrl);
                    if (audioBuffer) {
                        await sock.sendMessage(m.key.remoteJid, {
                            audio: audioBuffer,
                            mimetype: 'audio/mp4',
                            ptt: false
                        }, { quoted: m });
                    }
                }
            } 
            // 3. Jika konten berupa Video Normal (Langsung dikirim)
            else {
                const videoFormat = data.formats.find(f => f.kind === 'video' && !f.hasWatermark) || data.formats.find(f => f.kind === 'video');
                if (!videoFormat || !videoFormat.downloadUrl) {
                    throw new Error('Tidak ditemukan video yang bisa diunduh.');
                }

                const videoBuffer = await fetchBuffer(videoFormat.downloadUrl);
                if (!videoBuffer) throw new Error('Gagal mengunduh media dari server.');

                await sock.sendMessage(m.key.remoteJid, { 
                    video: videoBuffer, 
                    caption: caption 
                }, { quoted: m });
            }

        } catch (err) {
            await reply(`❌ *Gagal:*\n${err.message}`);
        }
    }
};
