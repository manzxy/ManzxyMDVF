/**
 * Plugin: Pinterest SEARCH (.pinsearch)
 *
 * Cari gambar di Pinterest lalu kirim hasilnya.
 *
 * Mode:
 *   .pinsearch <query>            → 5 gambar
 *   .pinsearch <query> -n 10      → sampai 10 gambar
 *   .pinsearch <query> -list      → daftar teks + link
 *   .pinsearch <query> -more      → halaman berikutnya
 *
 * Catatan engine: zapo-js TIDAK mendukung shortcut `{ album: ... }` maupun
 * `albumParentKey` (itu hanya ada di Baileys). Semua gambar dikirim satuan;
 * mencoba album akan ditolak engine dan seluruh command gagal.
 */
const { search, downloadMedia, cacheRemember, cacheMeta } = require('../../lib/services/pinterest');

const MAX_SEND = 10;
const DEFAULT_COUNT = 5;
const SEND_GAP_MS = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── unduh paralel terbatas supaya tidak membanjiri Pinterest ── */
async function fetchAll(results, concurrency = 3) {
    const out = new Array(results.length).fill(null);
    let cursor = 0;

    const worker = async () => {
        while (cursor < results.length) {
            const i = cursor++;
            const r = results[i];
            const url = r.image || r.thumbnail;
            if (!url) continue;
            try {
                const buf = await downloadMedia(url, { retries: 1 });
                if (buf?.length) out[i] = { buf, result: r };
            } catch { /* lewati yang gagal */ }
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, results.length) }, worker));
    return out.filter(Boolean);
}

/* ── kirim gambar satu per satu, beri jeda agar tidak ditolak server ── */
async function sendImages(sock, from, items, caption, quoted) {
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
        try {
            await sock.sendMessage(from, {
                image: items[i].buf,
                caption: i === 0 ? caption : undefined
            }, { quoted: i === 0 ? quoted : undefined });
            ok++;
        } catch { /* satu gagal, lanjut */ }
        if (i < items.length - 1) await sleep(SEND_GAP_MS);
    }
    return ok;
}

module.exports = {
    name: 'Pinterest Search',
    command: ['pinsearch'],
    category: 'downloader',
    description: 'Cari gambar di Pinterest',
    usage: '.pinsearch <kata kunci> [-n jumlah] [-list] [-more]',
    order: 2,

    async execute(sock, m, { args, reply, prefix, command }) {
        const from = m.key.remoteJid;

        let count = DEFAULT_COUNT;
        let listOnly = false;
        let more = false;
        const words = [];

        for (let i = 0; i < args.length; i++) {
            const a = String(args[i]).toLowerCase();
            if (a === '-list' || a === '--list' || a === '-l') { listOnly = true; continue; }
            if (a === '-more' || a === '--more' || a === '-next') { more = true; continue; }
            if (a === '-n' || a === '--n') {
                const n = parseInt(args[i + 1], 10);
                if (Number.isFinite(n) && n > 0) count = Math.min(n, MAX_SEND);
                i++;
                continue;
            }
            words.push(args[i]);
        }

        let query = words.join(' ').trim();
        const prev = cacheMeta(from);

        // `-more` tanpa query → lanjutkan pencarian terakhir di chat ini
        if (more && !query) {
            if (!prev?.query) {
                return reply(`❌ Belum ada pencarian sebelumnya di chat ini.\nCari dulu: \`${prefix}${command} <kata kunci>\``);
            }
            query = prev.query;
        }

        if (!query) {
            return reply(
                `*📌 PINTEREST SEARCH*\n\n` +
                `• \`${prefix}${command} anime aesthetic\` — ${DEFAULT_COUNT} gambar\n` +
                `• \`${prefix}${command} kucing lucu -n 10\` — sampai ${MAX_SEND} gambar\n` +
                `• \`${prefix}${command} wallpaper -list\` — daftar link saja\n` +
                `• \`${prefix}${command} -more\` — halaman berikutnya\n\n` +
                `_Unduh HD: \`${prefix}pindl <nomor>\` atau \`${prefix}pindl <link pin>\`_`
            );
        }

        const sameQuery = Boolean(prev?.query) && prev.query === query;
        const bookmarks = more && sameQuery ? (prev.bookmarks || []) : [];
        if (more && prev?.query && !sameQuery) {
            await reply('ℹ️ Query berubah, jadi mulai dari halaman pertama.');
        }

        await reply(`🔍 Mencari *${query}* di Pinterest...`);

        let data;
        try {
            data = await search(query, { pageSize: count, bookmarks });
        } catch (err) {
            return reply(`❌ Gagal mencari.\n_${err.message}_`);
        }

        if (!data.results.length) {
            return reply(
                `❌ Tidak ada hasil untuk *${query}*.\n` +
                `_Coba kata kunci lain — bahasa Inggris biasanya memberi hasil lebih banyak._`
            );
        }

        // Pinterest kadang mengabaikan page_size di halaman lanjutan dan
        // mengembalikan jauh lebih banyak dari yang diminta.
        const results = data.results.slice(0, count);
        cacheRemember(from, results, { query, bookmarks: data.bookmarks || [], at: Date.now() });

        /* ── mode daftar teks ── */
        if (listOnly) {
            const lines = results.map((r, i) => {
                const t = (r.title || 'Tanpa judul').slice(0, 60);
                return `${i + 1}. *${t}*\n   ${r.url}`;
            }).join('\n');

            const next = data.hasMore ? `\n\n_Lanjut: \`${prefix}${command} ${query} -more\`_` : '';
            return reply(`📌 *PINTEREST — ${query}*\n\n${lines}\n\n_Unduh: \`${prefix}pindl <nomor>\` • ${results.length} hasil._${next}`);
        }

        /* ── unduh lalu kirim ── */
        const items = await fetchAll(results);
        if (!items.length) {
            return reply('❌ Hasil ketemu tapi gambarnya gagal diunduh semua. Coba lagi sebentar.');
        }

        const nextHint = data.hasMore ? ` • \`${prefix}${command} ${query} -more\` untuk lanjut` : '';
        const caption = `📌 *Pinterest — ${query}*\n${items.length} gambar • \`${prefix}pindl <nomor>\` untuk HD${nextHint}`;

        const sent = await sendImages(sock, from, items, caption, m);

        if (sent === 0) return reply('❌ Gambar gagal dikirim.');
        if (sent < items.length) await reply(`ℹ️ ${sent}/${items.length} gambar terkirim.`);
    }
};
