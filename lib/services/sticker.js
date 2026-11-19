/**
 * STIKER TANPA FFMPEG — murni `sharp` + penulis metadata EXIF sendiri (nama pack & pembuat).
 *
 *   makeSticker(buffer, { pack, author })  gambar (jpg/png/webp/gif, termasuk animasi) → stiker webp 512x512
 *   rewriteExif(webp, { pack, author })    ganti nama pack / pembuat pada stiker yang sudah ada
 *   toImage(webp)                          stiker diam → png
 *
 * Catatan: video MP4 butuh decoder video (ffmpeg) sehingga TIDAK didukung di sini. GIF / WebP animasi (dikirim sebagai file)
 * dan semua gambar didukung penuh.
 */
const crypto = require('crypto');

const MAX_BYTES = 900 * 1024;                 // batas aman stiker WhatsApp (±1 MB)

/* ───────────── EXIF stiker WhatsApp ───────────── */
function buildExif(pack, author) {
    const json = Buffer.from(JSON.stringify({
        'sticker-pack-id': crypto.randomBytes(16).toString('hex'),
        'sticker-pack-name': String(pack || '').slice(0, 60),
        'sticker-pack-publisher': String(author || '').slice(0, 60),
        emojis: ['']
    }), 'utf8');
    const head = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    head.writeUInt32LE(json.length, 14);
    return Buffer.concat([head, json]);
}

/** Pecah RIFF webp menjadi daftar chunk { id, data }. */
function readChunks(webp) {
    if (webp.length < 20 || webp.toString('ascii', 0, 4) !== 'RIFF' || webp.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Bukan file WebP yang valid');
    const chunks = [];
    for (let off = 12; off + 8 <= webp.length;) {
        const id = webp.toString('ascii', off, off + 4);
        const size = webp.readUInt32LE(off + 4);
        chunks.push({ id, data: webp.subarray(off + 8, off + 8 + size) });
        off += 8 + size + (size & 1);
    }
    return chunks;
}

function writeChunks(chunks) {
    const parts = [Buffer.from('WEBP')];
    for (const { id, data } of chunks) {
        const h = Buffer.alloc(8);
        h.write(id, 0, 'ascii');
        h.writeUInt32LE(data.length, 4);
        parts.push(h, data, ...(data.length & 1 ? [Buffer.alloc(1)] : []));
    }
    const body = Buffer.concat(parts);
    const riff = Buffer.alloc(8);
    riff.write('RIFF', 0, 'ascii');
    riff.writeUInt32LE(body.length, 4);
    return Buffer.concat([riff, body]);
}

/** Ukuran kanvas dari chunk VP8 / VP8L (untuk membuat VP8X bila belum ada). */
function dimensions(chunk) {
    const d = chunk.data;
    if (chunk.id === 'VP8L') { const b = d.readUInt32LE(1); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, alpha: Boolean((b >> 28) & 1) }; }
    if (chunk.id === 'VP8 ') return { w: d.readUInt16LE(6) & 0x3fff, h: d.readUInt16LE(8) & 0x3fff, alpha: false };
    throw new Error('Format WebP tidak dikenali');
}

/** Tulis / ganti EXIF pada webp (mendukung stiker diam & animasi). */
function withExif(webp, exif) {
    let chunks = readChunks(webp).filter((c) => c.id !== 'EXIF');
    if (chunks[0].id !== 'VP8X') {
        const { w, h, alpha } = dimensions(chunks[0]);
        const vp8x = Buffer.alloc(10);
        vp8x[0] = alpha ? 0x10 : 0;
        vp8x.writeUIntLE(w - 1, 4, 3);
        vp8x.writeUIntLE(h - 1, 7, 3);
        chunks = [{ id: 'VP8X', data: vp8x }, ...chunks];
    }
    chunks[0].data = Buffer.from(chunks[0].data);
    chunks[0].data[0] |= 0x08;                               // bendera EXIF
    chunks.push({ id: 'EXIF', data: exif });
    return writeChunks(chunks);
}

/* ───────────── API ───────────── */
function loadSharp() {
    try { return require('sharp'); }
    catch { const e = new Error('Fitur ini butuh `sharp`. Jalankan: npm i sharp'); e.code = 'NO_SHARP'; throw e; }
}

async function makeSticker(buffer, { pack = '', author = '' } = {}) {
    const sharp = loadSharp();
    const bg = { r: 0, g: 0, b: 0, alpha: 0 };
    let out;
    // kualitas diturunkan bertahap sampai ukuran aman
    for (const quality of [80, 60, 40, 25]) {
        out = await sharp(buffer, { animated: true, limitInputPixels: 64e6 })
            .resize(512, 512, { fit: 'contain', background: bg })
            .webp({ quality, effort: 4, loop: 0 })
            .toBuffer();
        if (out.length <= MAX_BYTES) break;
    }
    return withExif(out, buildExif(pack, author));
}

function rewriteExif(webp, { pack = '', author = '' } = {}) {
    return withExif(webp, buildExif(pack, author));
}

async function toImage(webp) {
    return await loadSharp()(webp).png().toBuffer();
}

module.exports = { makeSticker, rewriteExif, toImage, buildExif, withExif, readChunks };
