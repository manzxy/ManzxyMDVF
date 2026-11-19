const axios = require('axios');

/* ───────────────────────── SCRAPER BING ───────────────────────── */
const SEARCH_APPID = "8B3803673894068AC59BD9DA9BC2B4D382C6227E";
const BING_APIS_BASE = "https://www.bingapis.com/api/v7";
const EDGE_AI_BASE = "https://edge.microsoft.com/edgecontextualchat/api/ctxsis";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const EDGE_USER_AGENT = "Mozilla/5.0 (Linux; Android 14; SM-G988N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.0.0";

function decodeBingUrl(url) {
    const match = url.match(/(?:[?&]|&amp;)u=a1([a-zA-Z0-9_\-]+)/);
    if (!match) return url;
    try {
        let b64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
        b64 += "=".repeat((4 - (b64.length % 4)) % 4);
        return Buffer.from(b64, "base64").toString("utf-8");
    } catch {
        return url;
    }
}

async function searchBing(query, count = 5, offset = 0) {
    try {
        const params = new URLSearchParams({
            appid: SEARCH_APPID, q: query, cc: 'ID', setlang: 'id',
            responseFilter: "Webpages", count: String(count), offset: String(offset)
        });
        const res = await axios.get(`${BING_APIS_BASE}/search?${params.toString()}`, {
            headers: { "User-Agent": USER_AGENT },
            timeout: 20000,
            validateStatus: () => true
        });
        
        if (res.status === 200 && res.data?.webPages?.value) {
            return res.data.webPages.value.slice(0, count).map(item => ({
                title: item.name || "", url: item.url || "", snippet: item.snippet || ""
            }));
        }
    } catch (e) {}

    // Fallback HTML Scraper
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=id&cc=ID&first=${offset + 1}`;
    const res = await axios.get(url, { headers: { "User-Agent": USER_AGENT }, timeout: 20000 });
    const html = res.data;
    const blocks = html.match(/<li class="b_algo"[^>]*>[\s\S]*?<\/li>/g) || [];

    return blocks.slice(0, count).map(b => {
        const h2Match = b.match(/<h2><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/);
        const link = h2Match ? decodeBingUrl(h2Match[1]) : "";
        const title = h2Match ? h2Match[2].replace(/<[^>]+>/g, "").trim() : "";
        const pMatch = b.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        const snippet = pMatch ? pMatch[1].replace(/<[^>]+>/g, "").trim() : "";
        return { title, url: link, snippet };
    });
}

async function searchImages(query, count = 5) {
    const url = `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=1&count=${count}&mmasync=1`;
    const res = await axios.get(url, { headers: { "User-Agent": USER_AGENT }, timeout: 20000 });
    const html = res.data;
    const rawMatches = html.match(/m="({[^"]+})"/g) || [];

    const results = [];
    for (const m of rawMatches) {
        if (results.length >= count) break;
        try {
            const clean = m.slice(3, -1).replace(/&quot;/g, '"');
            const j = JSON.parse(clean);
            results.push({ title: j.t || "", url: j.murl || "", sourceUrl: j.purl || "" });
        } catch {}
    }
    return results;
}

async function askAi(prompt) {
    let content = `Pertanyaan Pengguna:\n${prompt}\n\nInstruksi dan Konteks Diskusi:\nMohon berikan jawaban yang komprehensif, tepat sasaran, faktual, dan tersusun rapi menggunakan poin-poin utama yang mudah dipahami oleh pembaca. Pastikan uraian menjelaskan aspek terpenting dari topik yang ditanyakan dengan jelas, objektif, dan berbobot tanpa ada informasi yang terlewat.`;
    if (content.length < 350) content += " ".repeat(350 - content.length);

    const res = await axios.post(`${EDGE_AI_BASE}/sisgenerationstream`, {
        Url: "https://example.com/context",
        ClientName: "SA", Lang: "id", Market: "id-ID", PageContent: content,
        TriggerStatus: 0, QcScore: 70
    }, {
        headers: { "Content-Type": "application/json", "User-Agent": EDGE_USER_AGENT },
        responseType: 'text',
        timeout: 45000
    });
    return res.data;
}

/* ───────────────────────── PLUGIN HANDLER ───────────────────────── */
module.exports = {
    name: 'Bing Suite',
    command: ['bing', 'bingimg', 'bingai', 'edge', 'copilot'],
    category: 'tools',
    order: 3,
    description: 'Pencarian web, gambar, dan chat AI menggunakan mesin Bing',
    usage: '.bing <teks> | .bingimg <teks> | .bingai <tanya>',

    async execute(sock, m, ctx) {
        const { from, args, command, reply, prefix } = ctx;
        const text = args.join(' ');

        if (!text) {
            return await reply(`╭─「 *BING SUITE* 」\n│ ⬡ *${prefix}bing <kueri>* (Cari Web)\n│ ⬡ *${prefix}bingimg <kueri>* (Cari Gambar)\n│ ⬡ *${prefix}bingai <tanya>* (Tanya Edge AI)\n╰──────────────`);
        }

        await reply('⏳ _Sedang memproses dari server Bing..._');

        try {
            // 1. BING SEARCH (WEB)
            if (command === 'bing') {
                const results = await searchBing(text, 5);
                if (!results.length) return await reply('❌ Tidak ada hasil yang ditemukan.');

                const formatRes = results.map((r, i) => `│ ⬡ *${i + 1}. ${r.title}*\n│   └ ${r.url}`).join('\n│\n');
                return await reply(`╭─「 *BING SEARCH* 」\n│ ⬡ *Kueri:* ${text}\n├──────────────\n${formatRes}\n╰──────────────`);
            }

            // 2. BING IMAGE SEARCH — coba beberapa hasil (sebagian situs memblokir unduhan)
            if (command === 'bingimg') {
                const results = await searchImages(text, 6);
                if (!results.length) return await reply('❌ Gambar tidak ditemukan.');
                if (sock.mediaOk && !sock.mediaOk()) return await reply('Koneksi media sedang disambung ulang otomatis. Coba lagi sebentar.');

                for (const img of results) {
                    try {
                        const res = await axios.get(img.url, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 8 * 1024 * 1024, headers: { 'User-Agent': USER_AGENT } });
                        if (!String(res.headers['content-type'] || '').startsWith('image/')) continue;
                        return await sock.sendMessage(from, {
                            image: Buffer.from(res.data),
                            caption: `╭─「 *BING IMAGE* 」\n│ ⬡ *Kueri:* ${text}\n│ ⬡ *Judul:* ${img.title}\n╰──────────────`
                        }, { quoted: m });
                    } catch { /* coba hasil berikutnya */ }
                }
                return await reply('❌ Semua gambar gagal diunduh. Coba kueri lain.');
            }

            // 3. BING AI / EDGE COPILOT
            if (['bingai', 'edge', 'copilot'].includes(command)) {
                let aiResponse = await askAi(text);
                
                // Membersihkan metadata sampah atau sisa JSON jika format stream belum rapi
                aiResponse = aiResponse.replace(/\[\/?.*?\]/g, '').trim(); 
                if (!aiResponse) return await reply('❌ AI gagal memproses jawaban.');

                return await reply(`╭─「 *EDGE COPILOT* 」\n│ ${aiResponse.split('\n').join('\n│ ')}\n╰──────────────`);
            }

        } catch (error) {
            console.error(error);
            await reply('❌ Terjadi kesalahan pada API Bing. Silakan coba beberapa saat lagi.');
        }
    }
};
