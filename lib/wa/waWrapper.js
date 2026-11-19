/**
 * WA WRAPPER — helper ramah plugin di atas facade zapo-js (lib/wa/waCompat).
 *
 * Koneksi/pairing ditangani lib/wa/zapoEngine.js + zapoCompat.js. Modul ini
 * hanya menyediakan helper kirim/media/JID dan `createClient()` untuk plugin.
 *
 * Pemakaian:
 *   const wa = require('./lib/wa/waWrapper');
 *   await wa.sendText(sock, '628xxx@s.whatsapp.net', 'halo!');
 *   await wa.reply(sock, jid, m, 'balasan');
 *   await wa.react(sock, m, '🔥');
 *   const buf = await wa.downloadMedia(m);
 */
const B = require('./waCompat');
const {
    extractImageThumb,
    generateForwardMessageContent,
    generateWAMessageFromContent,
    prepareWAMessageMedia,
    generateMessageID,
    jidNormalizedUser,
    jidDecode,
    areJidsSameUser,
    isJidGroup,
    isJidNewsletter,
    isJidBroadcast,
    isJidStatusBroadcast,
    isJidBot,
    isJidMetaAI,
    isLidUser,
    getDevice,
    delay,
    DisconnectReason,
    proto,
    WAProto,
    downloadContentFromMessage,
} = B;

/* ───────────────────────────── JID ───────────────────────────── */

const isGroupJid = (jid) => isJidGroup(jid);
const isChannelJid = (jid) => isJidNewsletter(jid);          // saluran/newsletter
const isStatusJid = (jid) => isJidStatusBroadcast(jid) || jid === 'status@broadcast';
const isBotJid = (jid) => isJidBot(jid);
const isMetaAIJid = (jid) => isJidMetaAI(jid);
const normalizeJid = (jid) => jidNormalizedUser(jid);        // 628xx@s.whatsapp.net → 628xx (tanpa device)
const decodeJid = (jid) => jidDecode(jid);

/** Terima '628xx', '+628xx', '08xx', jid penuh → jid user standar. LID dipertahankan apa adanya. */
function toUserJid(input) {
    let s = String(input || '').trim();
    if (s.includes('@')) {
        // LID/group/newsletter/broadcast bukan nomor telepon — jangan dipaksa ke PN.
        if (s.endsWith('@lid') || s.endsWith('@g.us') || s.endsWith('@newsletter') || s.endsWith('@broadcast')) return normalizeJid(s);
        return s.endsWith('@s.whatsapp.net') ? normalizeJid(s) : `${normalizeJid(s)}@s.whatsapp.net`;
    }
    s = s.replace(/[^0-9]/g, '');
    if (s.startsWith('0')) s = '62' + s.slice(1);
    return `${s}@s.whatsapp.net`;
}

/** Terima jid grup/link invite → jid grup; angka → jid user. */
const isChatAllowed = (jid) => Boolean(jid) && !isStatusJid(jid);

/* ─────────────────── retry untuk error sementara ─────────────────── */

const TRANSIENT_RE = /timed? ?out|429|500|503|stream errored|connection closed|precondition/i;
async function withRetry(fn, { tries = 3, waitMs = 1200 } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); }
        catch (err) {
            lastErr = err;
            const status = err?.output?.statusCode ?? err?.statusCode ?? err?.data;
            const transient = TRANSIENT_RE.test(String(err?.message || '')) || [429, 500, 503].includes(Number(status));
            if (!transient || i === tries - 1) throw err;
            await delay(waitMs * (i + 1));
        }
    }
    throw lastErr;
}

/* ───────────────────────────── kirim pesan ───────────────────────────── */

/** Kirim apa pun (content bebas) dengan retry. */
async function send(sock, jid, content, options = {}) {
    return withRetry(() => sock.sendMessage(jid, content, options));
}

async function sendText(sock, jid, text, options = {}) {
    return send(sock, jid, { text: String(text ?? '') }, options);
}

/** Balas (quote) pesan. quoted = objek m / WAMessage. */
async function reply(sock, jid, quoted, text, options = {}) {
    return send(sock, jid, { text: String(text ?? '') }, { ...options, quoted });
}

/** Kirim media. src = Buffer | URL | path file. */
async function resolveMedia(src) {
    if (Buffer.isBuffer(src)) return src;
    if (/^https?:\/\//.test(String(src))) {
        const r = await fetch(src);
        if (!r.ok) throw new Error(`Gagal mengunduh media (${r.status})`);
        return Buffer.from(await r.arrayBuffer());
    }
    return require('fs').readFileSync(String(src));
}

const mediaSenders = {
    image: 'image',
    video: 'video',
    audio: 'audio',
    document: 'document',
    sticker: 'sticker',
};
for (const [name, key] of Object.entries(mediaSenders)) {
    module.exports[name] = async function (sock, jid, src, extra = {}, options = {}) {
        const buffer = await resolveMedia(src);
        const content = { [key]: buffer, ...extra };
        if (key === 'document' && !content.fileName) content.fileName = 'file';
        return send(sock, jid, content, options);
    };
}
// simpan referensi supaya tidak tertimpa oleh export akhir
const mediaFns = { image: module.exports.image, video: module.exports.video, audio: module.exports.audio, document: module.exports.document, sticker: module.exports.sticker };

/** Voice note (PTT). */
async function sendVoice(sock, jid, src, extra = {}, options = {}) {
    const buffer = await resolveMedia(src);
    return send(sock, jid, { audio: buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus', ...extra }, options);
}

/** Polling. values = ['opsi 1', 'opsi 2']. */
async function sendPoll(sock, jid, name, values = [], { selectableCount = 1, ...extra } = {}, options = {}) {
    const list = [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].slice(0, 12);
    if (list.length < 2) throw new Error('Polling butuh minimal 2 opsi.');
    return send(sock, jid, { poll: { name: String(name), values: list, selectableCount, ...extra } }, options);
}

/** Album (BARU di rc14 — kirim banyak media sebagai 1 album). items = [{ image|video: src, caption? }] */
async function sendAlbum(sock, jid, items = [], { caption = '' } = {}, options = {}) {
    if (!Array.isArray(items) || !items.length) throw new Error('Album butuh minimal 1 media.');
    const medias = await Promise.all(items.map(async (it) => {
        const key = it.image !== undefined ? 'image' : 'video';
        const buffer = await resolveMedia(it.image ?? it.video);
        return prepareWAMessageMedia({ [key]: buffer }, { upload: sock.waUploadToServer });
    }));
    const content = { album: medias.map((m, i) => ({ ...m, caption: items[i].caption || (i === 0 ? caption : undefined) })) };
    return send(sock, jid, content, options);
}

/** Reaksi emoji. m = pesan (WAMessage) ATAU key { remoteJid, id, fromMe, participant }. */
async function react(sock, jid, emoji, key) {
    const k = key || jid;   // react(sock, m, '🔥') atau react(sock, jid, '🔥', key)
    const targetJid = key ? jid : k?.key?.remoteJid || jid;
    const msgKey = key ? key : k.key;
    return send(sock, targetJid, {
        react: { text: String(emoji || ''), key: msgKey },
    });
}

/** Edit pesan sendiri (BARU: lewat content `edit`). key = m.key atau { id, remoteJid, fromMe }. */
async function edit(sock, jid, key, newText, options = {}) {
    return send(sock, jid, { text: String(newText ?? ''), edit: key }, options);
}

/** Hapus pesan (sendiri, atau pesan orang lain di grup jika admin). */
async function del(sock, jid, key, options = {}) {
    return send(sock, jid, { delete: key }, options);
}

/** Pin / unpin pesan di chat. time: 86400 | 604800 | 2592000 (0/undefined = unpin). */
async function pin(sock, jid, key, time, options = {}) {
    const type = time ? proto.PinInChat.Type.PIN_FOR_ALL : proto.PinInChat.Type.UNPIN_FOR_ALL;
    return send(sock, jid, { pin: key, type, ...(time ? { time } : {}) }, options);
}

/** Teruskan pesan. m = WAMessage. */
async function forward(sock, jid, m, { force = false, ...options } = {}) {
    return send(sock, jid, { forward: m, force }, options);
}

/** Kontak / vCard. contacts = [{ name, number }] */
async function sendContact(sock, jid, contacts = [], options = {}) {
    const list = contacts.map((c) => proto.Message.ContactMessage.create({
        displayName: String(c.name || '').trim() || String(c.number),
        vcard: [
            'BEGIN:VCARD', 'VERSION:3.0',
            `FN:${String(c.name || '').trim() || c.number}`,
            'TEL;type=CELL;type=VOICE;waid=' + String(c.number).replace(/[^0-9]/g, '') + ':+' + String(c.number).replace(/[^0-9]/g, ''),
            'END:VCARD',
        ].join('\n'),
    }));
    if (list.length === 1) return send(sock, jid, { contacts: { displayName: list[0].displayName, contacts: list } }, options);
    // >1 kontak: kirim berantai dengan jeda kecil (WhatsApp tidak punya kontak multi sekaligus)
    const out = [];
    for (const c of list) { out.push(await send(sock, jid, { contacts: { displayName: c.displayName, contacts: [c] } }, options)); await delay(400); }
    return out;
}

/** Lokasi. */
async function sendLocation(sock, jid, { lat, lng, name, address, live = false } = {}, options = {}) {
    if (live) return send(sock, jid, { location: { degreesLatitude: lat, degreesLongitude: lng, isLive: true } }, options);
    return send(sock, jid, { location: { degreesLatitude: lat, degreesLongitude: lng, name, address } }, options);
}

/** Typing / rekam / hadir. */
async function sendTyping(sock, jid, on = true) {
    await sock.sendPresenceUpdate(on ? 'composing' : 'paused', jid);
}
async function sendPresence(sock, type) { return sock.sendPresenceUpdate(type); }   // 'available' | 'unavailable'

/** Tandai dibaca. keys = [{ remoteJid, id, fromMe, participant }] atau array m.key. */
async function markRead(sock, keys) {
    const list = (Array.isArray(keys) ? keys : [keys]).map((k) => (k?.key ? k.key : k));
    return sock.readMessages(list);
}

/* ───────────────────────────── media ───────────────────────────── */

/** Unduh media dari pesan → Buffer. m = WAMessage (mendukung viewOnce & quoted). */
async function downloadMedia(m, options = {}) {
    const msg = m?.message ? m : (m?.quoted || m);
    if (!msg?.message) throw new Error('Tidak ada media pada pesan ini.');
    const { downloadMessageBuffer } = require('./mediaDownload');
    return downloadMessageBuffer(msg, { ...options, reuploadRequest: sock_reupload(msg) });
}

function sock_reupload(m) {
    return async (data) => {
        const sock = m.__sock;
        if (sock?.waUploadToServer) return sock.waUploadToServer(data);
        throw data;
    };
}

/** Unduh media dari pesan yang DIBALAS (m.quoted). */
async function downloadQuoted(m, options = {}) {
    if (!m?.quoted) throw new Error('Tidak ada pesan yang dibalas.');
    return downloadMedia(m.quoted, options);
}

/** Thumbnail dari gambar (Buffer) → { thumbnail: Buffer<jpeg>, imgWidth, imgHeight }. */
async function makeThumb(buffer, sizes = [32, 64, 128, 256]) {
    return extractImageThumb(buffer, sizes);
}

/* ───────────────────────────── grup ───────────────────────────── */

const groupMeta = (sock, jid) => sock.groupMetadata(jid);
const groupAll = (sock) => sock.groupFetchAllParticipating();
const groupInviteCode = (sock, jid) => sock.groupInviteCode(jid);
const groupLeave = (sock, jid) => sock.groupLeave(jid);

/** action: 'add' | 'remove' | 'promote' | 'demote'; users = ['628xx', ...] */
async function groupMembers(sock, jid, action, users = []) {
    const jids = users.map((u) => toUserJid(u));
    return sock.groupParticipantsUpdate(jid, jids, action);
}

/** setting: 'announcement' (hanya admin) | 'not_announcement' | 'locked' | 'unlocked' */
const groupSetting = (sock, jid, setting) => sock.groupSettingUpdate(jid, setting);
const setGroupPhoto = (sock, jid, src) => resolveMedia(src).then((b) => sock.updateProfilePicture(jid, b));
const setGroupSubject = (sock, jid, subject) => sock.groupUpdateSubject(jid, subject);
const setGroupDesc = (sock, jid, desc) => sock.groupUpdateDescription(jid, desc);

/* ───────────────────────────── kontak & profil ───────────────────────────── */

const profilePic = (sock, jid, type = 'image') => sock.profilePictureUrl(jid, type).catch(() => null);
const onWa = async (sock, ...numbers) => sock.onWhatsApp(...numbers.map((n) => String(n).replace(/[^0-9]/g, '')));
const block = (sock, jid, action = 'block') => sock.updateBlockStatus(jid, action);   // 'block' | 'unblock'
const subscribePresence = (sock, jid) => sock.presenceSubscribe(jid);
const fetchStatusOf = (sock, jid) => sock.fetchStatus(jid).catch(() => null);
const setPushName = (sock, name) => sock.chatModify({ pushNameSetting: String(name) }, undefined);

/* ───────────────────────────── util pesan ───────────────────────────── */

/** Tipe konten utama pesan ('imageMessage', 'conversation', ...). */
function msgType(m) {
    const c = m?.message;
    if (!c) return null;
    return Object.keys(c)[0] || null;
}

/** Konten pesan yang sudah dibongkar (viewOnce, ephemeral, dsb). */
const unwrap = (m) => B.extractMessageContent(B.normalizeMessageContent(m?.message));

/** Pesan yang di-quote (balasan). */
function quotedOf(m) {
    const ctx = m?.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return null;
    return {
        key: {
            remoteJid: ctx.remoteJid || m.key.remoteJid,
            fromMe: ctx.remoteJid ? areJidsSameUser(ctx.participant || '', m.key.participant || m.key.remoteJid) : false,
            id: ctx.stanzaId,
            participant: ctx.participant,
        },
        message: B.normalizeMessageContent(ctx.quotedMessage),
    };
}

/** URL gambar profil? gunakan profilePic(). Bungkus ambil teks pesan biasa: */
function msgText(m) {
    const c = unwrap(m);
    if (!c) return '';
    return c.conversation || c.extendedTextMessage?.text || c.imageMessage?.caption
        || c.videoMessage?.caption || c.documentMessage?.caption || c.documentWithCaptionMessage?.message?.documentMessage?.caption || '';
}

/* ───────────────────────────── export ───────────────────────────── */

/* ═══════════ CLIENT — API ramah untuk plugin (mantan lib/client.js) ═══════════
 * Semua method TIDAK perlu isi jid/quoted manual — otomatis mengarah ke chat & pesan
 * yang sedang diproses. Pemakaian di plugin: async execute(sock, m, { client: c }) →
 * await c.text('halo'); await c.reply('balasan'); await c.react('🔥'); await c.download();
 * Dokumentasi lengkap: docs/CLIENT.md
 * ═══════════════════════════════════════════════════════════════════════════ */

function createClient({ sock, from, m, toJid }) {
    if (!sock) throw new Error('createClient butuh sock');
    const target = from || m?.key?.remoteJid;
    const lastSent = { key: null };

    /** key pesan user (untuk react/delete/edit/quote). */
    const userKey = () => m?.key || null;
    const quotedMsg = () => m?.quoted || wa.quotedOf(m);

    const client = {
        /** jid chat saat ini */
        get chat() { return target; },
        /** nomor pengirim (628xx…) */
        get sender() { return wa.normalizeJid(m?.key?.participant || m?.key?.remoteJid || ''); },
        /** nomor bot */
        get botNumber() { return wa.normalizeJid(sock.user?.id || ''); },

        /** ubah '08xx' / '+62xx' / '62xx' → jid user */
        jid(number) { return toJid ? toJid(number) : wa.toUserJid(number); },

        /* ─────────────── kirim ke chat ini (tanpa isi jid) ─────────────── */

        /** Kirim teks. opts: { quoted, ephemeral, linkPreview… } */
        async text(text, opts = {}) {
            const r = await wa.sendText(sock, target, text, opts.quoted ? { quoted: opts.quoted } : opts);
            lastSent.key = r?.key || lastSent.key;
            return r;
        },

        /** Balas (quote) pesan user / pesan tertentu. */
        async reply(text, opts = {}) {
            const r = await wa.reply(sock, target, opts.quoted || m, text, opts);
            lastSent.key = r?.key || lastSent.key;
            return r;
        },

        /** Kirim gambar. src = URL | Buffer | path. opts: { caption, jpegThumbnail, quoted… } */
        async image(src, opts = {}) { return wa.image(sock, target, src, opts, { quoted: opts.quoted }); },
        /** Kirim video. opts: { caption, gif (jadikan GIF), mimetype, quoted… } */
        async video(src, opts = {}) { return wa.video(sock, target, src, opts, { quoted: opts.quoted }); },
        /** Kirim audio (musik/suara biasa). */
        async audio(src, opts = {}) { return wa.audio(sock, target, src, opts, { quoted: opts.quoted }); },
        /** Kirim voice note (PTT, tampil "rekaman suara"). */
        async voice(src, opts = {}) { return wa.sendVoice(sock, target, src, opts, { quoted: opts.quoted }); },
        /** Kirim sticker (buffer webp). */
        async sticker(src, opts = {}) { return wa.sticker(sock, target, src, opts, { quoted: opts.quoted }); },
        /** Kirim dokumen. wajib fileName. opts: { mimetype, caption, quoted… } */
        async document(src, fileName, opts = {}) {
            return wa.document(sock, target, src, { fileName, ...opts }, { quoted: opts.quoted });
        },

        /** Polling: c.poll('Judul', ['A', 'B'], { selectableCount: 1 }) */
        async poll(name, values, opts = {}) { return wa.sendPoll(sock, target, name, values, opts, { quoted: opts.quoted }); },
        /** Kontak: c.contact([{ name: 'Budi', number: '628xx' }]) */
        async contact(contacts, opts = {}) { return wa.sendContact(sock, target, contacts, { quoted: m, ...opts }); },
        /** Lokasi: c.location(-6.2, 106.8, { name: 'Monas' }) */
        async location(lat, lng, opts = {}) {
            return wa.sendLocation(sock, target, { lat, lng, name: opts.name, address: opts.address }, { quoted: m, ...opts });
        },

        /** Kirim ke chat LAIN: c.textTo('628xx', 'halo') — nomor/jid bebas. */
        async textTo(jid, text, opts = {}) {
            const dest = typeof jid === 'string' && /^\d+$/.test(jid) ? wa.toUserJid(jid) : jid;
            return wa.sendText(sock, dest, text, opts);
        },

        /* ─────────────── aksi pada pesan ─────────────── */

        /** Reaksi emoji pada pesan user: c.react('🔥') */
        async react(emoji, key) { return wa.react(sock, target, emoji, key || userKey()); },
        /** Edit pesan bot yang baru dikirim: const s = await c.text('a'); await c.edit('b', s.key) */
        async edit(newText, key) { return wa.edit(sock, target, key || lastSent.key, newText); },
        /** Hapus pesan: pesan yang di-reply user, atau pesan bot terakhir (tanpa argumen). */
        async del(key) {
            const k = key || quotedMsg()?.key || userKey();
            if (!k) throw new Error('Tidak ada pesan untuk dihapus.');
            return wa.del(sock, target, k);
        },
        alias_delete(key) { return client.del(key); },

        /** Teruskan pesan (default: pesan yang di-reply user) ke chat ini / jid lain. */
        async forward(srcMsg, jid) {
            const msg = srcMsg || quotedMsg() || m;
            return wa.forward(sock, jid || target, msg);
        },

        /** "mengetik…" selama menjalankan sesuatu: await c.typing(async () => berat()); */
        async typing(fn) {
            await sock.sendPresenceUpdate('composing', target).catch(() => {});
            try { return await (typeof fn === 'function' ? fn() : fn); }
            finally { await sock.sendPresenceUpdate('paused', target).catch(() => {}); }
        },

        /* ─────────────── media ─────────────── */

        /** Unduh media dari pesan user → Buffer. */
        async download() { return wa.downloadMedia(m); },
        /** Unduh media dari pesan yang di-reply user → Buffer. */
        async downloadQuoted() { return wa.downloadQuoted(m); },
        /** Buffer dari URL/path (kecil, sering kepakai). */
        async fetchBuffer(src) { return wa.resolveMedia(src); },

        /* ─────────────── rich response (AIRichResponse ala Meta AI) ───────────────
         * Kirim pesan berformat kaya: teks, tabel, blok kode, gambar, LaTeX, peta.
         * Contoh:
         *   await c.rich([ c.richText('Ringkasan'), c.richTable([['A','B'],['1','2']]) ]);
         *   await c.richCode('const x = 1;');
         */
        /** Kirim gabungan blok rich. blocks = [rich.text(...), rich.table(...), …] */
        async rich(blocks, opts = {}) {
            return rich.send(sock, target, blocks, { quoted: m, ...opts });
        },
        /** Teks bergaya AI (mendukung *tebal*, _miring_, `kode`, list). */
        async richText(content, opts = {}) { return this.rich([rich.text(content)], opts); },
        /** Tabel: rows = [[header...], [baris...]] — opts: { title } */
        async richTable(rows, opts = {}) { return this.rich([rich.table(rows, opts)], opts); },
        /** Blok kode dengan syntax highlight — opts: { language, meta } */
        async richCode(codeStr, opts = {}) { return this.rich([rich.code(codeStr, opts)], opts); },
        /** Gambar inline dalam balon rich — src = URL. */
        async richImage(url, opts = {}) { return this.rich([rich.image(url, opts)], opts); },
        /** Grid banyak gambar sekaligus. */
        async richGrid(urls, opts = {}) { return this.rich([rich.gridImages(urls, opts)], opts); },
        /** Rumus LaTeX yang dirender WhatsApp. */
        async richLatex(expr, opts = {}) { return this.rich([rich.latex(expr, opts)], opts); },
        /** Peta lokasi dalam balon rich. */
        async richMap(lat, lng, opts = {}) { return this.rich([rich.map(lat, lng, opts.annotations || [], opts)], opts); },

        /* ─────────────── info ─────────────── */

        /** Cek nomor terdaftar WhatsApp: await c.onWa('628xx') → true/false */
        async onWa(number) { const r = await wa.onWa(sock, number); return Boolean(r?.[0]?.exists); },
        /** Foto profil → URL atau null. */
        async profilePic(jid) { return wa.profilePic(sock, jid || (m?.key?.participant || target)); },
        /** Metadata grup chat ini (null kalau bukan grup). */
        async groupMeta() { return wa.isGroupJid(target) ? wa.groupMeta(sock, target) : null; },
    };

    return client;
}

module.exports = { createClient };

module.exports = {
    // semua helper statis dari facade zapo-js
    ...B,
    ...mediaFns,
    // client ramah untuk plugin
    createClient,
    withRetry,
    // kirim
    send, sendText, reply, sendVoice, sendPoll, sendAlbum, sendContact, sendLocation,
    sendTyping, sendPresence, markRead,
    // aksi pesan (API baru rc14)
    react, edit, del, pin, forward,
    // media
    downloadMedia, downloadQuoted, makeThumb, resolveMedia,
    // grup
    groupMeta, groupAll, groupInviteCode, groupLeave, groupMembers, groupSetting,
    setGroupPhoto, setGroupSubject, setGroupDesc,
    // kontak / profil
    profilePic, onWa, block, subscribePresence, fetchStatusOf, setPushName,
    // util
    toUserJid, normalizeJid, decodeJid, isGroupJid, isChannelJid, isStatusJid, isBotJid,
    isMetaAIJid, isLidUser, isChatAllowed, areJidsSameUser, getDevice, msgType, unwrap, quotedOf, msgText,
    delay, proto, WAProto, downloadContentFromMessage, prepareWAMessageMedia,
    generateForwardMessageContent, generateWAMessageFromContent, generateMessageID,
    DisconnectReason,
};
