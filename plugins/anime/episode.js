/**
 * Plugin: ANIME EPISODE (.animeep, .animestream, .animedetail)
 *
 *   .animedetail <judul|id|nomor>  → detail lengkap + karakter + relasi + unduhan
 *   .animeep <judul|id|nomor>      → daftar episode (berhalaman)
 *   .animeep <judul> 12            → link streaming episode 12
 *   .animestream <episode-id>      → link streaming dari ID episode
 *
 * Catatan: link stream mengarah ke file MP4 utuh (ratusan MB), jadi bot
 * mengirim LINK, bukan file video. Itu batas WhatsApp, bukan batas API.
 */
const anime = require('../../lib/services/anime');
const fmt = require('../../lib/services/animeFormat');
const { button } = require('../../lib/wa/rich');

const EPS_PER_PAGE = 30;

/**
 * Ubah input user jadi ID anime.
 * - angka → ambil dari cache hasil pencarian chat
 * - ID asli (mengandung '-' atau '/') dipakai langsung
 * - teks → cari, ambil hasil teratas
 */
async function resolveAnimeId(input, from) {
    const raw = String(input || '').trim();
    if (!raw) return null;

    if (/^\d{1,2}$/.test(raw)) {
        const list = anime.recall(from);
        if (!list) return { error: 'Belum ada hasil pencarian. Cari dulu: `.anime <judul>`' };
        const n = parseInt(raw, 10);
        if (n < 1 || n > list.length) return { error: `Pilih nomor 1–${list.length}.` };
        return { id: list[n - 1].id };
    }

    // ID dari API bisa mengandung tanda hubung dan garis miring,
    // contoh: film/attack-on-titan-the-movie-the-last-attack-2024
    if (/^[a-z0-9][a-z0-9/-]{2,}$/i.test(raw) && /[-/]/.test(raw) && !/\s/.test(raw)) return { id: raw };

    const best = await anime.findBest(raw);
    if (!best) return { error: `Tidak ada anime yang cocok dengan *${raw}*.` };
    return { id: best.id, title: best.title };
}

module.exports = {
    name: 'Anime Episode',
    command: ['animeep', 'animeepisode', 'animestream', 'animedetail'],
    category: 'anime',
    description: 'Daftar episode anime dan link streaming per kualitas',
    usage: '.animeep <judul>  •  .animeep <judul> 12  •  .animestream <episode-id>',
    limit: 1,

    async execute(sock, m, { args, reply, prefix, command }) {
        const from = m.key.remoteJid;

        /* Flag -all: tampilkan semua server, bukan satu per kualitas. */
        const rawArgs = [...args];
        const showAll = rawArgs.some((a) => /^-(-)?all$/i.test(a));
        const input = rawArgs.filter((a) => !/^-(-)?all$/i.test(a)).join(' ').trim();

        if (!input) {
            return reply(
                `*📺 EPISODE & STREAMING*\n\n` +
                `• \`${prefix}animeep <judul>\` — daftar episode\n` +
                `• \`${prefix}animeep <judul> 12\` — link episode 12\n` +
                `• \`${prefix}animedetail <judul>\` — detail + karakter + unduhan\n\n` +
                `_Bisa juga pakai nomor hasil \`${prefix}anime\` terakhir._`
            );
        }

        try {
            /* ── .animestream <episode-id> ── */
            if (command === 'animestream') {
                let ep;
                try {
                    ep = await anime.episode(input);
                } catch (err) {
                    // 404 di sini hampir selalu berarti ID episode salah ketik
                    // atau episode itu belum punya sumber stream di API.
                    if (err?.status === 404) {
                        return reply(
                            `❌ Episode \`${input}\` tidak punya sumber stream di API.\n\n` +
                            `_ID episode harus persis seperti yang ada di daftar episode._\n` +
                            `Coba: \`${prefix}animeep <judul>\` lalu pilih nomornya.`
                        );
                    }
                    throw err;
                }
                // Detail dipakai untuk judul dan link unduhan cadangan.
                let detail = null;
                const animeId = ep.animeId || input.replace(/-ep-\d+$/, '');
                if (animeId) {
                    try { detail = await anime.detail(animeId); } catch { /* opsional */ }
                }
                return await sendStream(sock, m, reply, ep, detail?.title || animeId || input, detail, showAll, prefix);
            }

            /* ── pisahkan nomor episode di akhir argumen ── */
            const tokens = input.split(/\s+/);
            let epNumber = null;
            if (tokens.length > 1 && /^\d{1,4}$/.test(tokens[tokens.length - 1])) {
                epNumber = parseInt(tokens.pop(), 10);
            }
            const judul = tokens.join(' ').trim();

            const resolved = await resolveAnimeId(judul, from);
            if (resolved?.error) return reply(`❌ ${resolved.error}`);

            const d = await anime.detail(resolved.id);

            /* ── .animedetail ── */
            if (command === 'animedetail') {
                return await fmt.sendRich(sock, m, reply, {
                    image: d.poster,
                    body: fmt.detailText(d, prefix),
                    buttons: fmt.detailButtons(d, prefix, button),
                });
            }

            if (!d.episodes.length) {
                return reply(`❌ *${d.title}* belum punya episode yang bisa ditonton.`);
            }

            /* ── nomor episode langsung → link ── */
            if (epNumber !== null) {
                const target = d.episodes.find((e) => e.number === epNumber);
                if (!target) {
                    const tersedia = d.episodes.slice(0, 5).map((e) => e.number).join(', ');
                    return reply(
                        `❌ Episode ${epNumber} tidak ada di *${d.title}*.\n` +
                        `Tersedia mulai: ${tersedia}${d.episodes.length > 5 ? ', …' : ''}`
                    );
                }
                const ep = await anime.episode(target.id);
                return await sendStream(sock, m, reply, ep, d.title, d, showAll, prefix);
            }

            /* ── daftar episode ── */
            // Halaman hanya dari flag `--page N`, supaya `.animeep 3` tetap
            // dibaca sebagai "hasil nomor 3", bukan "halaman 3".
            const pi = args.findIndex((a) => /^--?page$/i.test(a));
            const page = parseInt(args[pi + 1], 10) || 1;

            return await fmt.sendRich(sock, m, reply, {
                image: d.poster,
                body: fmt.episodeText(d, page, EPS_PER_PAGE, prefix),
                buttons: [
                    button.quick('📄 Detail', `${prefix}animedetail ${d.id}`),
                    button.quick('🔥 Populer', `${prefix}animepopuler`),
                ],
            });
        } catch (err) {
            return reply(fmt.failText(err));
        }
    },
};

/** Kirim link streaming satu episode. */
async function sendStream(sock, m, reply, ep, title, detail, showAll = false, prefix = '.') {
    /* ── tidak ada stream: coba link unduhan dari detail ── */
    if (!ep.streams.length) {
        const dl = fmt.downloadBlock(detail, ep.number);
        if (dl) {
            return reply(
                `*🎬 ${String(title || ep.animeId).toUpperCase()}*\n` +
                `*Episode ${ep.number}*\n\n` +
                `_Link streaming belum tersedia, tapi unduhan ada:_\n\n${dl}`
            );
        }
        return reply(
            `❌ *${String(title || ep.animeId)}* episode ${ep.number} belum punya link tonton.\n\n` +
            `_Coba judul lain, atau lihat \`.animehelp\`._`
        );
    }

    const body = fmt.streamText(ep, title, { showAll, prefix });
    const btns = fmt.episodeButtons(ep, title, prefix, button);

    return fmt.sendRich(sock, m, reply, {
        body,
        buttons: btns,
        footer: 'OmnifyAnime API',
    });
}

module.exports.resolveAnimeId = resolveAnimeId;
module.exports.sendStream = sendStream;
