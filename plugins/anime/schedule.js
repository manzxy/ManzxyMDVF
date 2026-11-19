/**
 * Plugin: ANIME JADWAL, ACAK, TRAILER, BANTUAN
 *
 *   .animejadwal [hari]   → jadwal rilis (default: hari ini)
 *   .animeacak [jumlah]   → anime acak
 *   .animetrailer <judul> → trailer (link proxy + YouTube)
 *   .animehelp            → daftar semua perintah anime
 */
const anime = require('../../lib/services/anime');
const fmt = require('../../lib/services/animeFormat');
const { button } = require('../../lib/wa/rich');

const HARI = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];

/** Baris jadwal: judul + jam tayang + genre. */
function scheduleLine(item, i) {
    const bits = [];
    if (item.airTime) bits.push(`🕐 ${item.airTime}`);
    if (item.genres?.length) bits.push(item.genres.slice(0, 3).join(', '));
    if (item.views) bits.push(`👁️ ${anime.fmtCount(item.views)}`);
    return `*${i + 1}.* ${item.title}\n     ${bits.join(' • ') || '-'}`;
}

module.exports = {
    name: 'Anime Jadwal',
    command: ['animejadwal', 'animeschedule', 'animeacak', 'animerandom', 'animetrailer', 'animehelp'],
    category: 'anime',
    description: 'Jadwal rilis anime, rekomendasi acak, dan link trailer',
    usage: '.animejadwal rabu  •  .animeacak 5  •  .animetrailer naruto',
    limit: 1,

    async execute(sock, m, { args, reply, prefix, command }) {
        const from = m.key.remoteJid;
        const input = args.join(' ').trim();

        try {
            /* ── bantuan ── */
            if (command === 'animehelp') {
                return reply(
                    `*🎌 FITUR ANIME — SUB INDO*\n` +
                    `_OmnifyAnime API v1.3.0 • seluruh endpoint aktif_\n\n` +
                    `*Pencarian*\n` +
                    `• \`${prefix}anime <judul>\` — cari anime\n` +
                    `• \`${prefix}anime <nomor>\` — buka hasil nomor N\n` +
                    `• \`${prefix}animedetail <judul>\` — detail + karakter + relasi\n\n` +
                    `*Daftar*\n` +
                    `• \`${prefix}animeongoing\` — sedang tayang\n` +
                    `• \`${prefix}animelatest\` — baru diunggah\n` +
                    `• \`${prefix}animecompleted\` — sudah tamat\n` +
                    `• \`${prefix}animepopuler [today|weekly|monthly|all]\`\n` +
                    `• \`${prefix}animemovie\` — film anime\n` +
                    `• \`${prefix}animedonghua\` — donghua\n` +
                    `• \`${prefix}animerekomendasi\` — rekomendasi\n` +
                    `• \`${prefix}animekatalog\` — seluruh database\n` +
                    `• \`${prefix}animegenre [genre]\` — per genre\n` +
                    `• \`${prefix}animefilter [genre] [status] [tipe]\`\n` +
                    `• \`${prefix}animeacak [jumlah]\` — acak\n` +
                    `• \`${prefix}animeadult\` — 18+ (Owner/Premium)\n\n` +
                    `*Tonton*\n` +
                    `• \`${prefix}animeep <judul>\` — daftar episode\n` +
                    `• \`${prefix}animeep <judul> 12\` — link episode 12\n` +
                    `• \`${prefix}animeep <judul> 12 -all\` — semua server\n` +
                    `• \`${prefix}animestream <episode-id>\` — link langsung\n` +
                    `• \`${prefix}animetrailer <judul>\` — trailer\n\n` +
                    `*Jadwal*\n` +
                    `• \`${prefix}animejadwal\` — hari ini\n` +
                    `• \`${prefix}animejadwal rabu\` — hari tertentu\n\n` +
                    `_Semua daftar berhalaman: tambah \`--page N\`._`
                );
            }

            /* ── trailer ── */
            if (command === 'animetrailer') {
                if (!input) return reply(`Pakai: \`${prefix}animetrailer <judul>\``);

                const best = await anime.findBest(input);
                if (!best) return reply(`❌ Anime *${input}* tidak ditemukan.`);

                const tr = await anime.trailer(best.id);
                if (!tr.url && !tr.youtubeId) {
                    return reply(`❌ Trailer untuk *${tr.title || best.title}* belum tersedia.`);
                }

                const yt = tr.youtubeId ? `https://youtu.be/${tr.youtubeId}` : '';
                const lines = [`*🎬 TRAILER*`, '', `*${tr.title || best.title}*`, ''];
                if (yt) lines.push(`▶️ YouTube: ${yt}`);
                if (tr.url) lines.push(`📥 Proxy: ${tr.url}`);

                return fmt.sendRich(sock, m, reply, {
                    image: best.poster,
                    body: lines.join('\n'),
                    buttons: [
                        ...(yt ? [button.url('▶️ YouTube', yt)] : []),
                        button.quick('📄 Detail', `${prefix}animedetail ${best.id}`),
                    ],
                });
            }

            /* ── acak ── */
            if (command === 'animeacak' || command === 'animerandom') {
                const n = Math.min(Math.max(parseInt(input, 10) || 5, 1), 10);
                const items = await anime.random({ limit: n });
                if (!items.length) return reply('❌ Tidak ada anime acak yang bisa ditampilkan.');

                anime.remember(from, items);
                const body =
                    `*🎲 ANIME ACAK*\n\n${items.map(fmt.listLine).join('\n\n')}\n\n` +
                    `Ketik \`${prefix}anime <nomor>\` untuk lihat detail.`;

                return fmt.sendRich(sock, m, reply, {
                    image: items[0].poster,
                    body,
                    buttons: [button.quick('🎲 Acak Lagi', `${prefix}animeacak ${n}`)],
                });
            }

            /* ── jadwal ── */
            const hari = HARI.includes(input.toLowerCase()) ? input.toLowerCase() : anime.todayName();
            const items = await anime.schedule(hari);

            if (!items.length) {
                return reply(
                    `📭 Tidak ada anime yang dijadwalkan rilis hari *${hari}*.\n` +
                    `_Hari lain: ${HARI.filter((h) => h !== hari).join(' • ')}_`
                );
            }

            anime.remember(from, items);
            const judulHari = items[0]?.day || hari;
            const body =
                `*🗓️ JADWAL RILIS — ${String(judulHari).toUpperCase()}*\n` +
                `_${items.length} judul • jam WIB_\n\n${items.map(scheduleLine).join('\n\n')}\n\n` +
                `Ketik \`${prefix}anime <nomor>\` untuk lihat detail.\n` +
                `_Hari lain: ${HARI.filter((h) => h !== hari).join(' • ')}_`;

            return fmt.sendRich(sock, m, reply, {
                image: items[0].poster,
                body,
                buttons: [
                    button.quick('🕐 Besok', `${prefix}animejadwal ${HARI[(HARI.indexOf(hari) + 1) % 7]}`),
                    button.quick('📺 Ongoing', `${prefix}animeongoing`),
                ],
            });
        } catch (err) {
            return reply(fmt.failText(err));
        }
    },
};

module.exports.scheduleLine = scheduleLine;
module.exports.HARI = HARI;
