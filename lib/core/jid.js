const NodeCache = require('node-cache');
const config = require('../../config');
const { logWarn, logError, logDebug } = require('./logger');

/**
 * LID → JID.
 * WhatsApp versi baru memakai LID (xxxx@lid) sebagai ID anggota/pengirim, sedangkan bot, database,
 * mention, dan pengecekan owner/admin memakai JID nomor (62xxx@s.whatsapp.net). Modul inti ini
 * mengubah LID menjadi JID dengan cara: (1) pasangan yang pernah terlihat (cache), (2) mapping bawaan
 * Baileys v7, (3) daftar peserta grup (phoneNumber). Jika tetap tidak ketemu, LID dikembalikan apa adanya.
 */
const lidToJid = new Map();          // 'xxx@lid' -> '62xxx@s.whatsapp.net'
const failedAt = new Map();          // LID yang gagal dipetakan -> waktu (hindari tanya berulang)
const RETRY_MS = 5 * 60 * 1000;
const MAX = 20000;

const strip = (j) => String(j || '').replace(/:\d+(?=@)/, '');
const isLid = (j) => /@lid$/.test(String(j || ''));
const isJid = (j) => /@s\.whatsapp\.net$/.test(String(j || ''));

function learn(a, b) {
    const x = strip(a), y = strip(b);
    const lid = isLid(x) ? x : isLid(y) ? y : '';
    const jid = isJid(x) ? x : isJid(y) ? y : '';
    if (!lid || !jid) return;
    if (lidToJid.size > MAX) lidToJid.delete(lidToJid.keys().next().value);
    lidToJid.set(lid, jid);
    failedAt.delete(lid);
}

/** Pelajari pasangan LID↔JID dari key pesan (participantAlt, remoteJidAlt, senderPn, ...). */
function learnFromKey(k = {}) {
    learn(k.participant, k.participantAlt); learn(k.participant, k.participantPn);
    learn(k.remoteJid, k.remoteJidAlt); learn(k.remoteJid, k.senderPn);
}

/** Pelajari dari daftar peserta grup ({id, lid, phoneNumber, jid}). */
function learnFromParticipants(list) {
    for (const p of list || []) {
        if (!p || typeof p === 'string') continue;
        learn(p.id, p.phoneNumber); learn(p.lid, p.phoneNumber); learn(p.id, p.jid); learn(p.lid, p.jid); learn(p.id, p.lid);
    }
}

/** JID satu peserta grup (string atau objek). Selalu mengutamakan nomor telepon. */
function participantJid(p) {
    if (!p) return '';
    if (typeof p === 'string') return isLid(p) ? (lidToJid.get(strip(p)) || strip(p)) : strip(p);
    if (p.phoneNumber) return strip(p.phoneNumber);
    if (isJid(p.jid)) return strip(p.jid);
    if (isJid(p.id)) return strip(p.id);
    return lidToJid.get(strip(p.lid || p.id)) || strip(p.jid || p.id);
}

/**
 * Ubah ID apa pun menjadi JID nomor bila bisa.
 * @param {object} sock
 * @param {string} id
 * @param {{groupJid?:string, getMetadata?:(g:string)=>Promise<object>}} opts  getMetadata dipakai untuk membaca peserta grup
 */
async function resolveJid(sock, id, { groupJid = '', getMetadata } = {}) {
    const x = strip(id);
    if (!x || !isLid(x)) return x;
    const hit = lidToJid.get(x);
    if (hit) return hit;
    if (Date.now() - (failedAt.get(x) || 0) < RETRY_MS) return x;

    try {
        const m = await sock?.signalRepository?.lidMapping?.getPNForLID?.(x);
        if (m) { const jid = String(m).includes('@') ? strip(m) : `${m}@s.whatsapp.net`; learn(x, jid); if (lidToJid.has(x)) return lidToJid.get(x); }
    } catch { /* tidak ada mapping bawaan */ }

    if (groupJid) {
        try {
            const meta = getMetadata ? await getMetadata(groupJid) : await sock.groupMetadata(groupJid);
            learnFromParticipants(meta?.participants);
            if (lidToJid.has(x)) return lidToJid.get(x);
        } catch { /* grup tidak terbaca */ }
    }
    failedAt.set(x, Date.now());
    if (failedAt.size > MAX) failedAt.delete(failedAt.keys().next().value);
    return x;
}

const _reset = () => { lidToJid.clear(); failedAt.clear(); };         // untuk pengujian


/* ═════════ CACHE & ANTREAN (mantan lib/cache.js) ═════════ */

/**
 * CACHE & ANTREAN
 *  - groupCache      : metadata grup (hemat panggilan ke WhatsApp)
 *  - msgDedupeCache  : mencegah satu pesan diproses dua kali
 *  - commandQueue    : antrean command (concurrency & ukuran maks dari config)
 * Tidak ada batas RAM: cache otomatis kedaluwarsa (TTL) dan jumlah kuncinya dibatasi.
 */

const groupCache = new NodeCache({ stdTTL: config.groupCacheTTL || 300, checkperiod: 120, maxKeys: 500, useClones: false });
const msgDedupeCache = new NodeCache({ stdTTL: 60, checkperiod: 30, maxKeys: 2000, useClones: false });

async function getCachedGroupMetadata(sock, jid) {
    if (!jid || !jid.endsWith('@g.us')) return null;
    let metadata = groupCache.get(jid);
    if (!metadata) {
        try {
            metadata = await sock.groupMetadata(jid);
            if (metadata) { groupCache.set(jid, metadata); learnFromParticipants(metadata.participants); }
        } catch (err) { logDebug('GROUP', `groupMetadata ${jid}: ${err.message}`); return null; }
    }
    return metadata;
}

function bindGroupCacheListeners(sock) {
    sock.ev.on('groups.update', (updates) => { for (const u of updates) if (u.id) groupCache.del(u.id); });
    sock.ev.on('group-participants.update', (u) => { if (u.id) groupCache.del(u.id); });
}

class TaskQueue {
    constructor(concurrency = 3, maxSize = 30) {
        this.concurrency = concurrency;
        this.maxSize = maxSize;
        this.running = 0;
        this.queue = [];
    }
    get size() { return this.queue.length + this.running; }
    push(fn) {
        if (this.queue.length >= this.maxSize) { logWarn('QUEUE', `Antrean penuh (${this.maxSize}), command dibuang`); return false; }
        this.queue.push(fn);
        this.next();
        return true;
    }
    next() {
        while (this.running < this.concurrency && this.queue.length > 0) {
            const fn = this.queue.shift();
            this.running++;
            Promise.resolve().then(fn)
                .catch((err) => logError('QUEUE', err))
                .finally(() => { this.running--; this.next(); });
        }
    }
}

const commandQueue = new TaskQueue(config.queueConcurrency, config.queueMaxSize);

module.exports = {
    // LID → JID
    lidToJid, failedAt, strip, isLid, isJid, learn, learnFromKey, learnFromParticipants,
    participantJid, resolveJid, _reset,
    // cache & antrean
    groupCache, msgDedupeCache, getCachedGroupMetadata, bindGroupCacheListeners, commandQueue,
};
