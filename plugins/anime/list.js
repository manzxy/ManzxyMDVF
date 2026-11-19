/**
 * Plugin: ANIME LIST — semua perintah daftar
 *
 *   .animeongoing      .animelatest       .animerekomendasi
 *   .animepopuler [today|weekly|monthly|all]
 *   .animemovie        .animedonghua       .animecompleted
 *   .animekatalog      → seluruh isi database (/anime/list, ~136 judul)
 *   .animegenre [slug] → daftar genre berhalaman, atau isi satu genre
 *   .animefilter [genre] [status] [tipe]
 *   .animeadult        → khusus owner/premium, konten 18+
 *
 * Semua bentuknya sama: ambil satu halaman, tampilkan bernomor, user memilih
 * nomor untuk lihat detail.
 */
const anime = require('../../lib/services/anime');
const fmt = require('../../lib/services/animeFormat');
const { button } = require('../../lib/wa/rich');

const PER_PAGE = 8;
const GENRE_PER_PAGE = 30;

/** Tampilkan daftar bernomor + simpan ke cache chat. */
async function showList(sock, m, reply, { title, items, prefix, hint, pagination, image }) {
    if (!items.length) return reply(`❌ Tidak ada data untuk *${title}*.`);

    anime.remember(m.key.remoteJid, items);

    const body = items.map(fmt.listLine).join('\n\n');
    const p = pagination;
    const nav = p && (p.has_next_page || p.has_prev_page)
        ? `\n\n_Hal. ${p.page}${p.total_pages ? `/${p.total_pages}` : ''}` +
          `${p.has_next_page ? ` • \`${prefix}${hint.cmd} --page ${p.next_page}\`` : ''}` +
          `${p.has_prev_page ? ` • \`${prefix}${hint.cmd} --page ${p.prev_page}\`` : ''}_`
        : '';

    const teks =
        `*${title}*\n` +
        (p?.total_items ? `_${p.total_items} judul_\n` : '') +
        `\n${body}\n\n` +
        `Ketik \`${prefix}anime <nomor>\` untuk lihat detail.${nav}` +
        (hint?.note ? `\n_${hint.note}_` : '');

    return fmt.sendRich(sock, m, reply, {
        image: image || items[0]?.poster,
        body: teks,
        buttons: [
            button.quick('🔥 Populer', `${prefix}animepopuler`),
            button.quick('📺 Ongoing', `${prefix}animeongoing`),
        ],
    });
}

/** Ambil nomor halaman dari argumen `--page N` atau `N`. */
function parsePage(args) {
    const i = args.findIndex((a) => /^--?page$/i.test(a));
    if (i >= 0) {
        const n = parseInt(args[i + 1], 10);
        return Number.isFinite(n) && n > 0 ? n : 1;
    }
    const bare = args.find((a) => /^\d{1,3}$/.test(a));
    return bare ? parseInt(bare, 10) : 1;
}

/** Daftar sederhana: satu endpoint, satu judul. */
const SIMPLE = {
    animeongoing: { path: 'ongoing', title: '📺 ANIME ONGOING' },
    animelatest: { path: 'latest', title: '🆕 ANIME TERBARU' },
    animerekomendasi: { path: 'recommendations', title: '✨ REKOMENDASI ANIME' },
    animemovie: { path: 'movies', title: '🎬 FILM ANIME' },
    animedonghua: { path: 'donghua', title: '🐉 DONGHUA' },
    animecompleted: { path: 'completed', title: '✅ ANIME TAMAT' },
};

module.exports = {
    name: 'Anime List',
    command: [
        'animeongoing', 'animepopuler', 'animemovie', 'animedonghua',
        'animelatest', 'animerekomendasi', 'animegenre', 'animefilter',
        'animecompleted', 'animekatalog', 'animeadult',
    ],
    category: 'anime',
    description: 'Daftar anime: ongoing, populer, film, donghua, tamat, katalog, per genre',
    usage: '.animeongoing  •  .animepopuler weekly  •  .animegenre action  •  .animefilter action completed',
    limit: 1,

    async execute(sock, m, { args, reply, prefix, command, isOwner, isRootOwner, isPremium }) {
        const page = parsePage(args);
        const rest = args.filter((a) => !/^--?page$/i.test(a) && !/^\d{1,3}$/.test(a));
        const first = (rest[0] || '').toLowerCase();

        try {
            /* ── daftar sederhana ── */
            if (SIMPLE[command]) {
                const { path, title } = SIMPLE[command];
                const r = await anime.list(path, { page, perPage: PER_PAGE });
                return await showList(sock, m, reply, {
                    title, items: r.items, prefix,
                    pagination: r.pagination,
                    hint: { cmd: command },
                });
            }

            /* ── katalog penuh ── */
            if (command === 'animekatalog') {
                const r = await anime.catalog({ page, perPage: PER_PAGE });
                return await showList(sock, m, reply, {
                    title: '📚 KATALOG ANIME',
                    items: r.items, prefix,
                    pagination: r.pagination,
                    hint: { cmd: command, note: 'Seluruh isi database, bukan hanya yang terbaru.' },
                });
            }

            /* ── populer ── */
            if (command === 'animepopuler') {
                const period = ['today', 'weekly', 'monthly', 'all'].includes(first) ? first : 'all';
                const label = { today: 'HARI INI', weekly: 'MINGGU INI', monthly: 'BULAN INI', all: 'SEPANJANG MASA' }[period];
                const r = await anime.popular({ period, page, perPage: PER_PAGE });
                return await showList(sock, m, reply, {
                    title: `🔥 ANIME POPULER — ${label}`,
                    items: r.items, prefix,
                    pagination: r.pagination,
                    hint: { cmd: command, note: 'Periode: today • weekly • monthly • all' },
                });
            }

            /* ── konten dewasa: hanya owner & premium ── */
            if (command === 'animeadult') {
                if (!isOwner && !isRootOwner && !isPremium) {
                    return reply(
                        `🔞 *KHUSUS 18+*\n\n` +
                        `Perintah ini hanya untuk Owner dan pengguna Premium.\n` +
                        `_Tidak untuk konten dewasa di grup._`
                    );
                }
                const r = await anime.list('adult', { page, perPage: PER_PAGE });
                return await showList(sock, m, reply, {
                    title: '🔞 ANIME DEWASA (18+)',
                    items: r.items, prefix,
                    pagination: r.pagination,
                    hint: { cmd: command, note: 'Konten 18+. Gunakan dengan bijak.' },
                });
            }

            /* ── genre ── */
            if (command === 'animegenre') {
                if (!first) {
                    const genres = await anime.genres();
                    const slugs = genres.map((g) => g.slug).filter(Boolean);
                    const grid = fmt.genreGrid(slugs, page, GENRE_PER_PAGE);
                    const nav = grid.total > 1
                        ? `\n\n_Hal. ${grid.page}/${grid.total} • \`${prefix}animegenre --page ${grid.page < grid.total ? grid.page + 1 : 1}\`_`
                        : '';
                    return reply(
                        `*🎭 DAFTAR GENRE (${slugs.length})*\n\n` +
                        `\`\`\`\n${grid.text}\`\`\`\n\n` +
                        `Pakai: \`${prefix}animegenre action\`${nav}`
                    );
                }
                const r = await anime.byGenre(first, { page, perPage: PER_PAGE });
                return await showList(sock, m, reply, {
                    title: `🎭 GENRE: ${first.toUpperCase()}`,
                    items: r.items, prefix,
                    pagination: r.pagination,
                    hint: { cmd: `animegenre ${first}` },
                });
            }

            /* ── filter ── */
            if (command === 'animefilter') {
                const [genre, status, type] = rest;
                if (!genre && !status && !type) {
                    return reply(
                        `*🔎 FILTER ANIME*\n\n` +
                        `\`${prefix}animefilter [genre] [status] [tipe]\`\n\n` +
                        `*Contoh*\n` +
                        `• \`${prefix}animefilter action\`\n` +
                        `• \`${prefix}animefilter action completed\`\n` +
                        `• \`${prefix}animefilter romance ongoing tv\`\n\n` +
                        `*Status:* ongoing • completed\n` +
                        `*Tipe:* tv • movie • ova • ona • special`
                    );
                }
                const label = [genre, status, type].filter(Boolean).join(' • ').toUpperCase();
                const r = await anime.filter({ genre, status, type, page, perPage: PER_PAGE });
                return await showList(sock, m, reply, {
                    title: `🔎 FILTER: ${label}`,
                    items: r.items, prefix,
                    pagination: r.pagination,
                    hint: { cmd: command },
                });
            }

            return reply(`❌ Perintah \`${command}\` belum dikenali.`);
        } catch (err) {
            return reply(fmt.failText(err));
        }
    },
};

module.exports.showList = showList;
module.exports.parsePage = parsePage;
