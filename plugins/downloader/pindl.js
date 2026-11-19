/**
 * Plugin: Pinterest DOWNLOAD (.pindl)
 *
 * Unduh SATU gambar Pinterest kualitas penuh (originals).
 *
 * Input:
 *   - nomor hasil  : 3          → hasil ke-3 dari .pinsearch terakhir di chat ini
 *   - URL pin      : https://id.pinterest.com/pin/123.../
 *   - URL pendek   : https://pin.it/xxxx
 *
 * Opsi:
 *   -doc    → kirim sebagai dokumen (tanpa kompres WhatsApp)
 *
 * Kenapa hanya lewat hasil pencarian:
 * Pin Pinterest sekarang punya dua jenis ID. Yang numerik bisa dibaca
 * PinResource, yang opaque (e1_Afq...) tidak bisa dibaca server sama sekali —
 * halaman pin-nya pun kosong dari data. Yang selalu tersedia adalah URL
 * `originals` di hasil pencarian, jadi itulah sumber unduhan utama.
 */
const { search, extractPinId, downloadMedia, cacheRecall, isOpaqueId } = require('../../lib/services/pinterest');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const extOf = (url) => {
    if (/\.png(\?|$)/i.test(url)) return 'png';
    if (/\.gif(\?|$)/i.test(url)) return 'gif';
    if (/\.webp(\?|$)/i.test(url)) return 'webp';
    return 'jpg';
};
const mimeOf = (ext) => ({ png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] || 'image/jpeg');
const kb = (buf) => Math.round(buf.length / 1024);

function captionOf({ title, id, buf, note }) {
    const lines = ['📌 *PIN*'];
    if (title) lines.push(`💬 ${title.slice(0, 120)}`);
    lines.push(`📦 ${kb(buf)} KB • originals`);
    if (note) lines.push(`_${note}_`);
    return lines.join('\n');
}

async function deliver(sock, from, m, { buf, url, title, id, asDoc, note }) {
    const ext = extOf(url);
    const caption = captionOf({ title, id, buf, note });
    const fileName = `pinterest-${String(id || Date.now()).slice(0, 24)}.${ext}`;

    if (asDoc) {
        return sock.sendMessage(from, {
            document: buf, mimetype: mimeOf(ext), fileName, caption
        }, { quoted: m });
    }

    try {
        return await sock.sendMessage(from, { image: buf, caption }, { quoted: m });
    } catch {
        // WhatsApp menolak sebagian gambar besar/aneh → kirim sebagai file
        return sock.sendMessage(from, {
            document: buf, mimetype: mimeOf(ext), fileName, caption
        }, { quoted: m });
    }
}

module.exports = {
    name: 'Pinterest Download',
    command: ['pindl'],
    category: 'downloader',
    description: 'Unduh satu gambar Pinterest HD',
    usage: '.pindl <nomor|url> [-doc]',
    order: 1,

    async execute(sock, m, { args, reply, prefix, command }) {
        const from = m.key.remoteJid;

        let asDoc = false;
        const rest = [];
        for (const raw of args) {
            const a = String(raw).toLowerCase();
            if (a === '-doc' || a === '--doc' || a === '-file') { asDoc = true; continue; }
            rest.push(raw);
        }
        const target = rest.join(' ').trim();

        if (!target) {
            return reply(
                `*📌 PINTEREST DOWNLOAD*\n\n` +
                `• \`${prefix}${command} 3\` — hasil ke-3 dari \`${prefix}pinsearch\`\n` +
                `• \`${prefix}${command} https://pin.it/xxxx\`\n` +
                `• \`${prefix}${command} https://id.pinterest.com/pin/123.../\`\n\n` +
                `*Opsi:* \`-doc\` — kirim sebagai file\n` +
                `_Kualitas: originals (penuh, tanpa kompres)_`
            );
        }

        /* ═══ jalur 1: nomor hasil pencarian ═══ */
        if (/^\d{1,2}$/.test(target)) {
            const list = cacheRecall(from);
            if (!list) {
                return reply(
                    `❌ Belum ada hasil \`${prefix}pinsearch\` di chat ini.\n` +
                    `Cari dulu: \`${prefix}pinsearch <kata kunci>\``
                );
            }

            const n = parseInt(target, 10);
            if (n < 1 || n > list.length) return reply(`❌ Nomor harus 1–${list.length}.`);

            const item = list[n - 1];
            const imgUrl = item.image || item.thumbnail;
            if (!imgUrl) return reply(`❌ Hasil #${n} tidak punya gambar.`);

            await reply('⏳ Mengunduh...');
            try {
                const buf = await downloadMedia(imgUrl);
                return await deliver(sock, from, m, {
                    buf, url: imgUrl, title: item.title, id: item.id, asDoc
                });
            } catch (err) {
                return reply(`❌ Gagal mengunduh: ${err.message}`);
            }
        }

        /* ═══ jalur 2: URL / ID pin ═══ */
        let pinId;
        try {
            pinId = await extractPinId(target);
        } catch {
            return reply(
                `❌ Input tidak dikenali.\n\n` +
                `Gunakan nomor hasil \`${prefix}pinsearch\`, URL Pinterest, atau \`https://pin.it/...\`.`
            );
        }

        await reply('⏳ Mengunduh...');

        // Sumber utama: cache hasil pencarian (satu-satunya yang selalu lengkap).
        const cached = (cacheRecall(from) || []).find((r) => r.id === pinId);
        if (cached?.image) {
            try {
                const buf = await downloadMedia(cached.image);
                return await deliver(sock, from, m, {
                    buf, url: cached.image, title: cached.title, id: cached.id, asDoc
                });
            } catch { /* lanjut ke pencarian ulang */ }
        }

        // Belum ada di cache → cari pin itu lewat pencarian, lalu cocokkan ID-nya.
        try {
            const found = await findBySearch(pinId, target);
            if (found?.image) {
                const buf = await downloadMedia(found.image);
                return await deliver(sock, from, m, {
                    buf, url: found.image, title: found.title, id: found.id, asDoc,
                    note: 'dicocokkan lewat pencarian'
                });
            }
        } catch { /* jatuh ke pesan di bawah */ }

        if (isOpaqueId(pinId)) {
            return reply(
                `❌ Pin ini memakai ID model baru yang tidak bisa dibaca langsung oleh server Pinterest.\n\n` +
                `*Solusinya:* cari dulu lewat \`${prefix}pinsearch <kata kunci>\`, lalu unduh dengan nomornya:\n` +
                `\`${prefix}${command} 3\``
            );
        }

        return reply(`❌ Pin \`${pinId}\` tidak ditemukan. Mungkin sudah dihapus atau dijadikan privat.`);
    }
};

/**
 * Cari pin berdasarkan ID-nya lewat pencarian biasa.
 * Dipakai saat user menempel URL pin yang belum ada di cache.
 */
async function findBySearch(pinId, rawInput) {
    // Kata kunci dari slug URL, mis. /pin/judul-pin-keren-123/ → "judul pin keren"
    const slug = String(rawInput).match(/\/pin\/([^/]+)/)?.[1] || '';
    const words = slug.replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/-/g, ' ').trim();
    const query = words.length > 2 ? words.slice(0, 60) : 'aesthetic';

    const data = await search(query, { pageSize: 10 });
    const hit = data.results.find((r) => r.id === pinId);
    if (hit) return hit;

    // Tidak ketemu di halaman pertama → coba halaman kedua sebelum menyerah.
    if (data.hasMore) {
        await sleep(250);
        const more = await search(query, { pageSize: 10, bookmarks: data.bookmarks });
        return more.results.find((r) => r.id === pinId) || null;
    }
    return null;
}
