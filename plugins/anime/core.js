/**
 * Plugin: ANIME (.anime) — pencarian utama
 *
 * Sumber: https://anime.omnifylabs.sbs (OmnifyAnime API v1.3.0)
 *
 *   .anime <judul>   → cari, tampilkan hasil bernomor
 *   .anime <nomor>   → buka detail hasil nomor N dari pencarian terakhir
 *   .anime           → panduan + tombol pintasan
 *
 * Perintah lain ada di file sebelah:
 *   list.js     → daftar (ongoing, populer, movie, donghua, completed, katalog, genre, filter)
 *   episode.js  → episode, link streaming, detail lengkap
 *   schedule.js → jadwal, acak, trailer, bantuan
 */
const anime = require('../../lib/services/anime');
const fmt = require('../../lib/services/animeFormat');
const { button } = require('../../lib/wa/rich');
const { detailText, detailButtons, sendRich } = fmt;

const PER_PAGE = 8;

module.exports = {
    name: 'Anime',
    command: ['anime', 'animesearch', 'animecari'],
    category: 'anime',
    description: 'Cari anime sub Indo, lihat detail, episode, dan link streaming',
    usage: '.anime <judul>  •  .anime <nomor>  •  .animehelp',
    limit: 1,

    async execute(sock, m, { args, reply, prefix, command }) {
        const from = m.key.remoteJid;

        /* Pisahkan flag --page N dari kata kunci pencarian. */
        const rawArgs = [...args];
        const pi = rawArgs.findIndex((a) => /^--?page$/i.test(a));
        const page = pi >= 0 ? Math.max(parseInt(rawArgs[pi + 1], 10) || 1, 1) : 1;
        if (pi >= 0) rawArgs.splice(pi, 2);
        const query = rawArgs.join(' ').trim();

        /* ── tanpa argumen: panduan ── */
        if (!query) {
            return sendRich(sock, m, reply, {
                body:
                    `*🎌 ANIME — SUB INDO*\n\n` +
                    `Cari judul, lalu pilih nomornya untuk lihat detail.\n\n` +
                    `• \`${prefix}${command} naruto\` — cari anime\n` +
                    `• \`${prefix}${command} 2\` — buka hasil nomor 2\n` +
                    `• \`${prefix}animehelp\` — semua perintah\n\n` +
                    `_Data: OmnifyAnime API v1.3.0_`,
                buttons: [
                    button.quick('🔥 Populer', `${prefix}animepopuler`),
                    button.quick('📺 Ongoing', `${prefix}animeongoing`),
                    button.quick('🗓️ Jadwal', `${prefix}animejadwal`),
                ],
            });
        }

        /* ── pilih nomor dari hasil terakhir ── */
        if (/^\d{1,2}$/.test(query)) {
            const list = anime.recall(from);
            if (!list) {
                return reply(
                    `❌ Belum ada hasil pencarian di chat ini.\n` +
                    `Cari dulu: \`${prefix}${command} <judul>\``
                );
            }
            const n = parseInt(query, 10);
            if (n < 1 || n > list.length) return reply(`❌ Pilih nomor 1–${list.length}.`);
            return openDetail(sock, m, reply, prefix, list[n - 1].id);
        }

        /* ── pencarian judul ── */
        await reply(`🔎 Mencari *${query}*…`);

        let hasil;
        try {
            hasil = await anime.search(query, { page, perPage: PER_PAGE });
        } catch (err) {
            return reply(fmt.failText(err));
        }

        if (!hasil.items.length) {
            let saran = [];
            try { saran = await anime.suggest(query); } catch { /* opsional */ }
            const hint = saran.length
                ? `\n\n*Mungkin maksudmu:*\n${saran.slice(0, 5).map((s) => `• ${s.title}`).join('\n')}`
                : '';
            return reply(`❌ Tidak ada hasil untuk *${query}*.${hint}`);
        }

        anime.remember(from, hasil.items);

        const daftar = hasil.items.map(fmt.listLine).join('\n\n');
        const nav = [];
        if (hasil.pagination?.has_next_page) {
            nav.push(`\`${prefix}${command} ${query} --page ${hasil.pagination.next_page}\``);
        }
        if (page > 1) {
            nav.push(`\`${prefix}${command} ${query} --page ${page - 1}\``);
        }
        const next = nav.length ? `\n\n_Halaman lain: ${nav.join(' • ')}_` : '';
        const total = hasil.pagination?.total_items;

        const body =
            `*🎌 HASIL PENCARIAN: ${query.toUpperCase()}*${page > 1 ? ` (hal. ${page})` : ''}\n` +
            `${total ? `_${total} judul ditemukan_\n` : ''}\n` +
            `${daftar}\n\n` +
            `Ketik \`${prefix}${command} <nomor>\` untuk lihat detail.${next}`;

        return sendRich(sock, m, reply, {
            image: hasil.items[0]?.poster,
            body,
            buttons: [
                button.quick('📺 Ongoing', `${prefix}animeongoing`),
                button.quick('🔥 Populer', `${prefix}animepopuler`),
            ],
        });
    },
};

/** Buka detail satu anime (dipakai juga oleh plugin lain). */
async function openDetail(sock, m, reply, prefix, id) {
    let d;
    try {
        d = await anime.detail(id);
    } catch (err) {
        return reply(fmt.failText(err));
    }

    return sendRich(sock, m, reply, {
        image: d.poster,
        body: detailText(d, prefix),
        buttons: detailButtons(d, prefix, button),
    });
}

module.exports.openDetail = openDetail;
