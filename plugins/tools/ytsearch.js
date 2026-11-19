/**
 * YouTube Search — pencarian + info video (tanpa unduhan). Semua kode fitur ini ada di file ini.
 * Memakai paket npm "yt-search".
 */
const { button } = require('../../lib/wa/rich');

const fmtViews = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0));
const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

function videoIdOf(input) {
    const t = String(input || '').trim();
    if (/^[\w-]{11}$/.test(t)) return t;
    const m = t.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
    return m ? m[1] : '';
}

function yts() {
    try { return require('yt-search'); }
    catch { throw new Error('Modul "yt-search" belum terpasang di server. Jalankan: npm i yt-search'); }
}

async function search(query, limit) {
    const r = await yts()({ query: String(query), hl: 'id', gl: 'ID' });
    return (r.videos || []).filter((v) => v.videoId).slice(0, limit).map((v) => ({
        id: v.videoId, title: v.title, seconds: v.seconds ?? 0, duration: v.timestamp || '-',
        views: v.views || 0, ago: v.ago || '', author: v.author?.name || '', thumbnail: v.thumbnail || v.image || ''
    }));
}

async function details(id) {
    const v = await yts()({ videoId: id });
    if (!v || !(v.title || v.videoId)) throw new Error('Video tidak ditemukan.');
    return {
        id, title: v.title, author: v.author?.name || '', duration: v.timestamp || '-', views: v.views || 0, ago: v.ago || '',
        thumbnail: v.thumbnail || v.image || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    };
}

module.exports = {
    name: 'Cari YouTube',
    command: ['ytsearch', 'yts', 'youtube', 'ytinfo'],
    category: 'tools',
    description: 'Cari video YouTube (button list) dan lihat infonya',
    usage: '.ytsearch <kata kunci> • .ytinfo <link|id>',
    limit: 0,
    async execute(sock, m, ctx) {
        const { from, command, text, prefix, config, reply } = ctx;
        const isInfo = command === 'ytinfo';

        if (!text) return await reply(isInfo
            ? `Format: *${prefix}ytinfo <link / id video>*`
            : `*🔎 CARI YOUTUBE*\nFormat: *${prefix}ytsearch <kata kunci>*\nContoh: ${prefix}ytsearch lofi hip hop\n\nPilih hasilnya dari daftar untuk melihat info & membuka videonya.`);

        try {
            /* ── info satu video ── */
            if (isInfo) {
                const id = videoIdOf(text);
                if (!id) return await reply('❌ Link / ID YouTube tidak dikenali.');
                const v = await details(id);
                return await sock.sendUniversalButton(from, {
                    title: '📺 YOUTUBE',
                    body: `*${v.title}*\n\n👤 ${v.author}\n⏱️ ${v.duration}${v.views ? ` • 👁️ ${fmtViews(v.views)}` : ''}${v.ago ? ` • ${v.ago}` : ''}\n🔗 ${watchUrl(id)}`,
                    footer: config.footerText, image: v.thumbnail ? { url: v.thumbnail } : undefined
                }, [button.url('▶️ Buka di YouTube', watchUrl(id)), button.copy('📋 Salin Link', watchUrl(id))], m);
            }

            /* ── pencarian ── */
            const list = await search(text, config.yt.searchLimit);
            if (!list.length) return await reply(`❌ Tidak ada hasil untuk *${text}*.`);
            const body = `*🔎 HASIL: ${text}*\n\n` + list.map((v, i) => `*${i + 1}. ${v.title}*\n   👤 ${v.author} • ⏱️ ${v.duration} • 👁️ ${fmtViews(v.views)}${v.ago ? ' • ' + v.ago : ''}`).join('\n\n') + `\n\nPilih video di daftar bawah untuk melihat infonya.`;
            const rows = list.map((v, i) => ({ title: `${i + 1}. ${v.title}`.slice(0, 24), description: `${v.duration} • ${v.author} • ${fmtViews(v.views)}`.slice(0, 72), id: `${prefix}ytinfo ${v.id}` }));
            await sock.sendUniversalButton(from, {
                title: '🔎 YOUTUBE SEARCH', body, footer: config.footerText, image: list[0].thumbnail ? { url: list[0].thumbnail } : undefined
            }, [button.list('📺 Pilih Video', [{ title: 'Hasil pencarian', rows }])], m);
        } catch (err) { await reply(`❌ ${err.message}`); }
    },
    _videoIdOf: videoIdOf
};
