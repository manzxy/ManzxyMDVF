/**
 * WA COMPAT — pengganti LENGKAP @whiskeysockets/baileys berbasis zapo-js.
 *
 * Semua helper statis yang dipakai project (proto, jid, builder pesan, media,
 * poll, konstanta) disediakan di sini dari zapo-js. Tidak ada require ke
 * @whiskeysockets/baileys lagi di seluruh codebase.
 *
 * Catatan wire: proto Message zapo-js dan Baileys byte-identik (terverifikasi),
 * sehingga encode/decode proto bisa dipakai langsung untuk payload kaya.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const z = require('zapo-js');

/* ───────────────────────────── JID ───────────────────────────── */

function jidNormalizedUser(jid) {
    if (!jid) return '';
    const s = String(jid).split(':')[0];
    if (s.endsWith('@g.us') || s.endsWith('@broadcast') || s.endsWith('@newsletter') || s.endsWith('@lid')) return s;
    try { return z.toUserJid(s); } catch { return s; }
}

const areJidsSameUser = (a, b) => jidNormalizedUser(a) === jidNormalizedUser(b);
const jidDecode = (jid) => {
    const s = String(jid || '');
    const at = s.indexOf('@');
    const user = at === -1 ? s : s.slice(0, at);
    const server = at === -1 ? 's.whatsapp.net' : s.slice(at + 1);
    const sep = user.indexOf(':');
    return { user: sep === -1 ? user : user.slice(0, sep), device: sep === -1 ? undefined : Number(user.slice(sep + 1)), server };
};
const isJidGroup = (jid) => String(jid || '').endsWith('@g.us');
const isJidNewsletter = (jid) => String(jid || '').endsWith('@newsletter');
const isJidBroadcast = (jid) => String(jid || '').endsWith('@broadcast');
const isJidStatusBroadcast = (jid) => String(jid || '') === 'status@broadcast';
const isJidBot = (jid) => String(jid || '').endsWith('@bot');
const isLidUser = (jid) => String(jid || '').endsWith('@lid');
const getDevice = (jid) => jidDecode(jid).device || 0;

/* ───────────────────────────── PROTO ───────────────────────────── */

const proto = z.proto;

// zapo proto adalah class encode/decode tanpa .create()/.fromObject().
// Baileys memakai keduanya; kita tambahkan sebagai plain-object passthrough
// (encode zapo menerima plain object, terverifikasi).
const asPlain = (o) => (o && typeof o === 'object' ? { ...o } : (o || {}));
function augmentProtoType(type) {
    if (!type || typeof type !== 'function') return type;
    if (!type.create) type.create = asPlain;
    if (!type.fromObject) type.fromObject = asPlain;
    return type;
}
if (proto && proto.Message) {
    augmentProtoType(proto.Message);
    // Sub-message types yang dipakai rich.js
    for (const key of ['DocumentMessage', 'ContactMessage', 'InteractiveMessage', 'ExtendedTextMessage', 'ImageMessage', 'VideoMessage']) {
        if (proto.Message[key]) augmentProtoType(proto.Message[key]);
    }
    const IM = proto.Message.InteractiveMessage;
    if (IM) for (const key of ['Header', 'Body', 'Footer', 'NativeFlowMessage', 'CarouselMessage']) {
        if (IM[key]) augmentProtoType(IM[key]);
    }
    if (proto.Message.fromObject) proto.Message.fromObject = (o) => new proto.Message(o || {});
    if (proto.Message.create) proto.Message.create = (o) => new proto.Message(o || {});
}

/* ───────────────────────────── CONTENT ───────────────────────────── */

const getContentType = z.getContentType;
const unwrapMessage = z.unwrapMessage;
const normalizeMessageContent = (c) => (c ? z.unwrapMessage(c) : c);
const extractMessageContent = (c) => (c ? z.unwrapMessage(c) : c);
const getContextInfo = z.getContextInfo;
const resolveMessageTarget = z.resolveMessageTarget;

/* ───────────────────────────── ID / VERSION ───────────────────────────── */

const generateMessageID = () => '3EB0' + crypto.randomBytes(8).toString('hex').toUpperCase();
// Kode numerik status disconnect (dipakai jadibotManager.js untuk mapping reconnect).
const DisconnectReason = {
    connectionClosed: 428,
    connectionLost: 408,
    connectionReplaced: 440,
    timedOut: 408,
    loggedOut: 401,
    badSession: 500,
    restartRequired: 515,
    multideviceMismatch: 411,
    forbidden: 403,
};
// zapo tidak mengekspor helper ini; sediakan pengganti lokal untuk waWrapper.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isJidMetaAI = (jid) => /@(?:meta\.ai|ai\.whatsapp\.com)$/i.test(String(jid || ''));
const extractImageThumb = async (buffer) => {
    // thumbnail opsional: kembalikan buffer asli bila sharp tidak terpasang.
    try {
        const sharp = require('sharp');
        return await sharp(buffer).resize(128, 128, { fit: 'inside' }).jpeg({ quality: 60 }).toBuffer();
    } catch { return Buffer.isBuffer(buffer) ? buffer : undefined; }
};

/* ───────────────────────────── MESSAGE BUILDER ───────────────────────────── */

/**
 * Bangun WAMessage ala Baileys dari content. rich.js hanya memakai
 * `message` dan `key.id`, jadi bentuk minimal ini cukup.
 */
function generateWAMessageFromContent(jid, content, opts = {}) {
    const key = {
        remoteJid: jid,
        fromMe: true,
        id: opts.messageId || generateMessageID(),
        ...(opts.userJid ? { participant: jidNormalizedUser(opts.userJid) } : {}),
    };
    const message = { ...(content || {}) };
    if (opts.quoted) {
        const q = opts.quoted;
        const ctx = {
            stanzaId: q.key?.id || q.id,
            participant: q.key?.participant || q.key?.remoteJid,
            quotedMessage: q.message,
        };
        // Telusuri pembungkus (viewOnceMessage / ephemeralMessage / ...) sampai
        // ke submessage nyata. Baileys menaruh contextInfo reply di submessage
        // dalam, bukan di pembungkusnya — zapo membaca pola yang sama.
        const WRAPPERS = ['viewOnceMessage', 'viewOnceMessageV2', 'ephemeralMessage', 'deviceSentMessage'];
        let target = message;
        while (true) {
            const wrap = WRAPPERS.find((k) => target[k]?.message && typeof target[k].message === 'object');
            if (!wrap) break;
            target = target[wrap].message;
        }
        const first = Object.keys(target).find((k) => target[k] && typeof target[k] === 'object');
        if (first) {
            target[first] = {
                ...target[first],
                contextInfo: { ...(target[first].contextInfo || {}), ...ctx },
            };
        }
    }
    return { key, message, messageTimestamp: Math.floor(Date.now() / 1000) };
}

const generateForwardMessageContent = (message, forceForward = false) => ({
    ...message,
    contextInfo: { ...(message?.contextInfo || {}), forwardingScore: forceForward ? 5 : 1, isForwarded: true },
});

/**
 * Shim prepareWAMessageMedia: unggah media lewat `opts.upload`
 * (sock.waUploadToServer dari zapoCompat) lalu susun descriptor proto.
 */
async function prepareWAMessageMedia(content = {}, opts = {}) {
    const type = Object.keys(content).find((k) => content[k] && k !== 'caption');
    if (!type) return {};
    const raw = content[type];
    const mediaType = opts.mediaTypeOverride || (type === 'ptv' ? 'video' : type);
    let bytes;
    if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
        bytes = Buffer.from(raw);
    } else if (typeof raw === 'string') {
        if (/^data:/.test(raw)) {
            bytes = Buffer.from(raw.replace(/^data:[^;]+;base64,/, ''), 'base64');
        } else if (/^https?:\/\//.test(raw)) {
            const res = await fetch(raw);
            if (!res.ok) throw new Error(`Gagal unduh media: HTTP ${res.status}`);
            bytes = Buffer.from(await res.arrayBuffer());
        } else {
            bytes = await fs.readFile(raw);
        }
    } else if (raw?.url) {
        const res = await fetch(raw.url);
        bytes = Buffer.from(await res.arrayBuffer());
    } else {
        throw new Error('prepareWAMessageMedia: sumber media tidak dikenal');
    }

    const upload = opts.upload;
    if (typeof upload !== 'function') throw new Error('prepareWAMessageMedia: upload function wajib ada');
    const result = await upload(bytes, { mediaType, mimetype: opts.mimetype });
    if (!result || !result.mediaUrl) throw new Error('prepareWAMessageMedia: upload gagal');

    const mimetypes = {
        image: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg',
        document: 'application/octet-stream', sticker: 'image/webp',
    };
    const field = mediaType === 'ptv' ? 'ptvMessage' : `${mediaType}Message`;
    const desc = {
        url: result.mediaUrl,
        directPath: result.directPath,
        mediaKey: result.mediaKey,
        fileSha256: result.fileSha256,
        fileEncSha256: result.fileEncSha256,
        fileLength: result.fileLength ?? bytes.length,
        mediaKeyTimestamp: result.mediaKeyTimestamp,
        mimetype: result.mimetype || opts.mimetype || mimetypes[mediaType] || 'application/octet-stream',
    };
    if (content.caption) desc.caption = content.caption;
    if (raw?.fileName) desc.fileName = raw.fileName;
    if (raw?.ptt) desc.ptt = true;

    const out = { [field]: desc };
    if (mediaType === 'video' && raw?.gifPlayback) out.videoMessage.gifPlayback = true;
    return out;
}

/* ───────────────────────────── MEDIA ───────────────────────────── */

const { downloadContentFromMessage, downloadMessageBuffer } = require('./mediaDownload');

/* ───────────────────────────── POLL ───────────────────────────── */

function getKeyAuthor(key, meId) {
    if (!key) return meId || '';
    if (key.fromMe) return jidNormalizedUser(meId || key.remoteJid || '');
    return jidNormalizedUser(key.participant || key.remoteJid || '');
}

/** Agregat suara polling — port dari helper Baileys (logika identik). */
function getAggregateVotesInPollMessage({ message, pollUpdates } = {}, meId) {
    const opts = message?.pollCreationMessage?.options ||
        message?.pollCreationMessageV2?.options ||
        message?.pollCreationMessageV3?.options || [];
    const voteHashMap = {};
    for (const opt of opts) {
        const hash = crypto.createHash('sha256').update(Buffer.from(opt.optionName || '')).digest('hex');
        voteHashMap[hash] = { name: opt.optionName || '', voters: [] };
    }
    for (const update of pollUpdates || []) {
        const vote = update.vote;
        if (!vote) continue;
        for (const option of vote.selectedOptions || []) {
            const hash = Buffer.from(option).toString('hex');
            if (!voteHashMap[hash]) voteHashMap[hash] = { name: 'Unknown', voters: [] };
            voteHashMap[hash].voters.push(getKeyAuthor(update.pollUpdateMessageKey, meId));
        }
    }
    return Object.values(voteHashMap);
}

/* ───────────────────────────── EXPORT ───────────────────────────── */

module.exports = {
    // jid
    jidNormalizedUser, areJidsSameUser, jidDecode,
    isJidGroup, isJidNewsletter, isJidBroadcast, isJidStatusBroadcast, isJidBot, isLidUser, getDevice,
    // proto & content
    proto, WAProto: proto, getContentType, unwrapMessage, normalizeMessageContent,
    extractMessageContent, getContextInfo, resolveMessageTarget,
    // id / version / constants
    generateMessageID, DisconnectReason,
    delay, isJidMetaAI, extractImageThumb,
    WA_VERSION: z.WA_VERSION,
    // builders
    generateWAMessageFromContent, generateForwardMessageContent, prepareWAMessageMedia,
    // media
    downloadContentFromMessage, downloadMessageBuffer, downloadMediaMessage: z.downloadMediaMessage,
    // poll
    getAggregateVotesInPollMessage,
    // transport (dipakai index/jadibot bila perlu)
    WaClient: z.WaClient, createStore: z.createStore,
};
