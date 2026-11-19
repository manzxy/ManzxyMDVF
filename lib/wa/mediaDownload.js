/**
 * MEDIA DOWNLOAD — satu titik masuk unduh media untuk semua plugin.
 *
 * Memakai downloader native zapo-js yang dirancang untuk proto zapo. Plugin
 * mengoper sub-message (msg.imageMessage, dst.), jadi toZapoSources()
 * membungkusnya jadi pesan penuh sebelum diteruskan ke downloadMediaMessage.
 */
'use strict';

const { downloadMediaMessage } = require('zapo-js');

/** Petakan tipe media (dipakai plugin) ke field proto Message. */
const MEDIA_FIELD = {
    image: 'imageMessage',
    video: 'videoMessage',
    gif: 'videoMessage',
    audio: 'audioMessage',
    ptt: 'audioMessage',
    document: 'documentMessage',
    sticker: 'stickerMessage',
    ptv: 'ptvMessage',
};

/**
 * zapo downloadMediaMessage menerima full message / event, bukan sub-message.
 * Plugin biasanya mengoper msg.imageMessage (sub-message), jadi kita bungkus.
 */
function toZapoSources(node, type) {
    if (!node) return null;
    // Sudah full WAMessage / event?
    if (node.message || node.rawNode) return node;
    const field = MEDIA_FIELD[String(type || '').toLowerCase()] || 'documentMessage';
    return { [field]: node };
}

/**
 * Unduh media pesan → Readable stream byte plaintext.
 * Kompatibel dengan pemakaian lama: `for await (const chunk of stream)`.
 */
async function downloadContentFromMessage(node, type, opts = {}) {
    const source = toZapoSources(node, type);
    if (!source) throw new Error('Tidak ada media untuk diunduh');
    return downloadMediaMessage(source, opts);
}

/**
 * Unduh media pesan penuh → Buffer (dipakai waWrapper.downloadMedia).
 * zapo downloadMediaMessage mengembalikan Readable stream.
 */
async function downloadMessageBuffer(msg, options = {}) {
    const stream = await downloadMediaMessage(msg, options);
    const chunks = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
}

module.exports = { downloadContentFromMessage, downloadMessageBuffer, toZapoSources, MEDIA_FIELD };
