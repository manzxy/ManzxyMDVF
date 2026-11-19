/**
 * Tampilan bersama plugin anime.
 *
 * Dipisah dari `lib/services/anime.js` supaya klien API tetap murni data, dan
 * dipisah dari plugin supaya keempat plugin memakai format yang sama.
 *
 * Semua field yang dipakai di sini berasal dari respons API yang sudah
 * diverifikasi lewat probe langsung, bukan dari asumsi.
 */
const anime = require('./anime');
const { formatDateTime } = require('../core/utils');

/* ───────────────────────────── util ───────────────────────────── */

/** Tanggal aman → teks lokal bot. */
function fmtDate(date) {
    if (!date) return '-';
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '-';
    try {
        return formatDateTime(d);
    } catch {
        return d.toISOString().slice(0, 16).replace('T', ' ');
    }
}

function failText(err) {
    if (err?.name === 'AnimeError') return `❌ ${err.message}`;
    return `❌ Gagal mengambil data anime.\n_${String(err?.message || err).slice(0, 160)}_`;
}

/** Baris ringkas satu anime untuk daftar bernomor. */
function listLine(item, i) {
    const bits = [item.type, item.status].filter((x) => x && x !== '-');
    if (item.currentEpisode) bits.push(`Ep ${item.currentEpisode}`);
    if (item.rating && item.rating !== '-') bits.push(`⭐ ${item.rating}`);
    if (item.views) bits.push(`👁️ ${anime.fmtCount(item.views)}`);
    return `*${i + 1}.* ${item.title}\n     ${bits.join(' • ') || '-'}`;
}

/** Grid genre 3 kolom, berhalaman (API mengembalikan ~100 genre). */
function genreGrid(genres, page = 1, perPage = 30) {
    const total = Math.max(1, Math.ceil(genres.length / perPage));
    const now = Math.min(Math.max(1, page), total);
    const slice = genres.slice((now - 1) * perPage, now * perPage);
    const col = Math.ceil(slice.length / 3);
    const rows = [];
    for (let i = 0; i < col; i++) {
        rows.push([slice[i], slice[i + col], slice[i + col * 2]]
            .filter(Boolean).map((s) => String(s).padEnd(18)).join('').trimEnd());
    }
    return { text: rows.join('\n'), page: now, total };
}

/* ───────────────────────────── pengiriman ───────────────────────────── */

/**
 * Kirim kaya dengan tiga tingkat fallback: gambar+tombol → tombol tanpa gambar
 * → gambar saja → teks. Satu upload poster yang gagal tidak boleh membuat
 * seluruh jawaban hilang.
 */
async function sendRich(sock, m, reply, { image, body, buttons = [], footer = 'OmnifyAnime API' }) {
    const from = m.key.remoteJid;
    const mediaDown = Boolean(sock.mediaOk && !sock.mediaOk());

    if (typeof sock.sendUniversalButton === 'function' && buttons.length) {
        if (image && !mediaDown) {
            try {
                return await sock.sendUniversalButton(from, { body, footer, image: { url: image } }, buttons, m);
            } catch { /* lanjut ke tingkat berikutnya */ }
        }
        try {
            return await sock.sendUniversalButton(from, { body, footer }, buttons, m);
        } catch { /* lanjut */ }
    }

    if (image && !mediaDown) {
        try {
            return await sock.sendMessage(from, { image: { url: image }, caption: body }, { quoted: m });
        } catch { /* lanjut */ }
    }

    return reply(body);
}

/* ───────────────────────────── detail ───────────────────────────── */

/**
 * Teks detail lengkap. Semua field yang dikirim API ditampilkan bila ada:
 * judul alternatif, durasi, studio, asal, genre, views, favorit, update,
 * jadwal tayang berikutnya, sinopsis, karakter + pengisi suara, judul terkait,
 * dan ringkasan unduhan.
 */
function detailText(d, prefix) {
    const sub = [d.type, d.season, d.status].filter((x) => x && x !== '-').join(' • ');
    const out = [`*${d.title.toUpperCase()}*`];
    if (sub) out.push(`_${sub}_`);
    if (d.altTitles.length) out.push(`_${d.altTitles.slice(0, 2).join(' / ')}_`);

    const info = [];
    if (d.rating && d.rating !== '-') info.push(`⭐ *Rating:* ${d.rating}`);
    info.push(`📺 *Episode:* ${d.episodes.length}`);
    if (d.duration && d.duration !== '-') info.push(`⏱️ *Durasi:* ${d.duration}`);
    if (d.studio && d.studio !== '-') info.push(`🏢 *Studio:* ${d.studio}`);
    if (d.origin && d.origin !== '-') info.push(`🌏 *Asal:* ${d.origin}`);
    if (d.genres.length) info.push(`🎭 *Genre:* ${d.genres.join(', ')}`);
    info.push(`👁️ *Views:* ${anime.fmtCount(d.views)}${d.favorites ? ` • ❤️ ${anime.fmtCount(d.favorites)}` : ''}`);
    if (d.uploadedAgo || d.updatedAt) info.push(`🗓️ *Update:* ${d.uploadedAgo || fmtDate(d.updatedAt)}`);
    if (d.nextAiring?.at) {
        info.push(`⏭️ *Tayang berikutnya:* Ep ${d.nextAiring.episode} — ${fmtDate(d.nextAiring.at)}`);
    }
    out.push('', info.join('\n'));

    if (d.synopsis) out.push('', `*Sinopsis*`, anime.truncate(d.synopsis, 700));

    if (d.characters.length) {
        const rows = d.characters.slice(0, 10).map((c) => {
            const role = c.role ? ` _(${c.role})_` : '';
            const va = c.voiceActor ? ` — VA: ${c.voiceActor}` : '';
            return `• ${c.name}${role}${va}`;
        });
        out.push('', `*Karakter (${d.characters.length})*`, rows.join('\n'));
    }

    if (d.relations.length) {
        const rows = d.relations.slice(0, 8).map((r) => {
            const rate = r.rating && r.rating !== '-' ? ` ⭐${r.rating}` : '';
            return `• ${r.title} — ${r.type || r.kind || '-'}${rate}`;
        });
        out.push('', `*Judul Terkait (${d.relations.length})*`, rows.join('\n'));
        const first = d.relations.find((r) => r.animeId);
        if (first) out.push(`_Buka terkait: \`${prefix}animedetail ${first.animeId}\`_`);
    }

    if (d.downloads.length) {
        out.push('', `📥 *Unduhan:* ${d.downloads.length} entri tersedia — lihat di \`${prefix}animeep ${d.id}\``);
    }

    if (d.trailerUrl) out.push('', `▶️ *Trailer:* ${d.trailerUrl}`);

    out.push('', `_Ketik \`${prefix}animeep ${d.id}\` untuk episode & link streaming._`);
    return out.join('\n');
}

/** Tombol untuk halaman detail. */
function detailButtons(d, prefix, button) {
    const btns = [];
    if (d.episodes.length) btns.push(button.quick('📺 Episode', `${prefix}animeep ${d.id}`));
    if (d.trailerUrl) btns.push(button.url('▶️ Trailer', d.trailerUrl));
    btns.push(button.quick('🔥 Populer', `${prefix}animepopuler`));
    return btns.slice(0, 3);
}

/* ───────────────────────────── episode ───────────────────────────── */

/** Daftar episode berhalaman, satu baris per episode. */
function episodeText(d, page, perPage, prefix) {
    const total = d.episodes.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const now = Math.min(Math.max(1, page), pages);
    const slice = d.episodes.slice((now - 1) * perPage, now * perPage);

    const rows = slice.map((e) => {
        const when = e.uploadedAgo || (e.releasedAt ? fmtDate(e.releasedAt) : '');
        // Judul generik "Episode N" tidak perlu diulang.
        const nama = e.title && !/^Episode\s+\d*$/i.test(e.title) ? ` — ${e.title}` : '';
        return `• *Ep ${e.number}*${nama}${when ? ` _(${when})_` : ''}`;
    });

    const nav = pages > 1
        ? `\n\n_Halaman ${now}/${pages} • \`${prefix}animeep ${d.id} --page ${now < pages ? now + 1 : 1}\`_`
        : '';

    return `*${d.title.toUpperCase()}*\n_${total} episode • ${d.status}_\n\n${rows.join('\n')}${nav}\n\n` +
        `Ketik \`${prefix}animeep ${d.id} <nomor>\` untuk link streaming.`;
}

/** Kelompokkan stream per kualitas (satu kualitas bisa punya banyak server). */
function streamGroups(ep) {
    const map = new Map();
    for (const s of ep.streams) {
        if (!map.has(s.quality)) map.set(s.quality, []);
        map.get(s.quality).push(s);
    }
    return [...map.entries()];
}

/**
 * Teks link streaming. `showAll` menampilkan semua server; tanpa itu satu
 * server per kualitas supaya pesan tidak menembus batas panjang WhatsApp.
 */
function streamText(ep, title, { showAll = false, prefix = '.' } = {}) {
    const groups = streamGroups(ep);
    const blocks = groups.map(([quality, servers]) => {
        const use = showAll ? servers : servers.slice(0, 1);
        const links = use.map((s) => `     ${s.server}${s.format ? ` (${s.format})` : ''}: ${s.url}`).join('\n');
        return `*${quality}*\n${links}`;
    });

    const hidden = showAll ? 0 : groups.reduce((n, [, s]) => n + Math.max(0, s.length - 1), 0);
    const hint = hidden
        ? `\n\n_${hidden} server lain disembunyikan. \`${prefix}animeep ${ep.animeId} ${ep.number} -all\` untuk semua._`
        : '';

    return `*🎬 ${String(title || ep.animeId).toUpperCase()}*\n*Episode ${ep.number}*\n\n` +
        `${blocks.join('\n\n')}${hint}`;
}

/** Blok unduhan untuk satu nomor episode. */
function downloadBlock(detail, episodeNumber) {
    if (!detail || !Array.isArray(detail.downloads) || !detail.downloads.length) return '';
    const target = detail.downloads.find((d) => {
        const m = String(d.title || '').match(/(\d+)/);
        return m && parseInt(m[1], 10) === Number(episodeNumber);
    }) || (detail.downloads.length === 1 ? detail.downloads[0] : null);
    if (!target) return '';

    const rows = target.qualities.map((q) => {
        const links = q.links.map((l) => `     ${l.server}: ${l.url}`).join('\n');
        return `*${q.quality}*\n${links}`;
    });
    return rows.join('\n\n');
}

/** Tombol navigasi episode (sebelumnya / berikutnya). */
function episodeButtons(ep, title, prefix, button) {
    const btns = [];
    if (ep.prevEpisodeId) btns.push(button.quick('⏮️ Sebelumnya', `${prefix}animestream ${ep.prevEpisodeId}`));
    if (ep.nextEpisodeId) btns.push(button.quick('⏭️ Berikutnya', `${prefix}animestream ${ep.nextEpisodeId}`));
    if (ep.streams[0]) btns.push(button.url(`▶️ Tonton ${ep.streams[0].quality}`, ep.streams[0].url));
    return btns.slice(0, 3);
}

module.exports = {
    fmtDate, failText, listLine, genreGrid, sendRich,
    detailText, detailButtons,
    episodeText, streamGroups, streamText, downloadBlock, episodeButtons,
};
