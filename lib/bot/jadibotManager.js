/**
 * JADIBOT MANAGER
 *
 * Akar masalah "jadibot tidak bisa masuk" pada versi lama:
 *  1. Pengecekan putus koneksi salah: `(error instanceof Boom)?.output` selalu undefined,
 *     sehingga bot SELALU dianggap boleh reconnect (bahkan saat logout → loop tanpa henti).
 *  2. Setelah kode pairing dimasukkan, WhatsApp WAJIB memutus koneksi (kode 515 "restart required")
 *     dan klien harus membuat socket baru. Versi lama memanggil startJadibot() lagi, tetapi sesi
 *     masih terdaftar di Map → langsung ditolak "sudah aktif" dan error-nya ditelan `.catch(() => {})`.
 *     Hasilnya bot tidak pernah masuk.
 *  3. Kode yang ditampilkan "MANZKENZ-XXXX-XXXX" hanyalah kode acak yang ditempeli awalan, sehingga
 *     kode itu tidak valid jika diketik di WhatsApp. Sekarang memakai pairing code custom asli.
 *  4. Permintaan kode memakai setTimeout 3 detik tanpa retry; sesi setengah jadi tidak pernah dibersihkan.
 */
const { jidNormalizedUser, DisconnectReason } = require('../wa/waCompat');
const { createZapoEngine } = require('../wa/zapoEngine');
const fs = require('fs');
const path = require('path');

const config = require('../../config');
const db = require('../data/database');
const { attachRichHelpers, button } = require('../wa/rich');
const { bindGroupCacheListeners, getCachedGroupMetadata } = require('../core/jid');
const { logInfo, logSuccess, logWarn, logError, logDebug, reasonName } = require('../core/logger');
const { sleep, numberOf, formatDuration, formatDateTime, normalizePhone } = require('../core/utils');

const runtimeSettings = require('../core/runtimeSettings');
const webhook = require('../web/webhook');

const baseJadibotDir = path.join(__dirname, '..', '..', 'sessions_jadibot');
fs.mkdirSync(baseJadibotDir, { recursive: true });
// Sesi jadibot kini disimpan sebagai sqlite zapo (satu file per nomor).
const jadibotDbDir = path.join(__dirname, '..', '..', 'session_zapo');
fs.mkdirSync(jadibotDbDir, { recursive: true });

/** number -> entry { number, sock, state, attempts, timers..., notify, stopped } */
const jadibotSessions = new Map();
let expiryTimer = null;
let watchdogTimer = null;

/* ───────────────────────── PAIRING CODE ───────────────────────── */

function normalizeCustomCode() {
    const c = String(config.customPairingCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    // Alfabet Crockford yang dipakai WhatsApp tidak memuat I, L, O, U
    return c.length === 8 && !/[ILOU]/.test(c) ? c : '';
}

function formatManzkenzPairingCode(code) {
    const raw = String(code).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return (raw.match(/.{1,4}/g) || [raw]).join('-');
}

/**
 * Minta kode pairing (custom jika didukung), dengan retry karena websocket
 * kadang belum siap tepat setelah socket dibuat.
 */
async function requestPairingCodeBranded(sock, number, tries = 4) {
    const custom = normalizeCustomCode();
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            const code = (custom && i < 2)
                ? await sock.requestPairingCode(number, custom)
                : await sock.requestPairingCode(number);
            return { code: String(code).toUpperCase(), custom: Boolean(custom) && String(code).toUpperCase() === custom };
        } catch (err) {
            lastErr = err;
            logDebug('PAIRING', `Percobaan ${i + 1}/${tries} gagal: ${err.message}`);
            await sleep(2000 + i * 1000);
        }
    }
    throw lastErr || new Error('Gagal meminta kode pairing');
}

/* ───────────────────────── UTIL INTERNAL ───────────────────────── */

const sessionFolder = (number) => path.join(baseJadibotDir, number);
// Sesi zapo: satu file sqlite per nomor di session_zapo/jadibot_<no>.sqlite.
const sessionDbFile = (number) => path.join(jadibotDbDir, `jadibot_${number}.sqlite`);
/** Hapus semua berkas sesi untuk nomor (sqlite zapo + fallback folder Baileys lama). */
function removeSessionFiles(number) {
    try { fs.rmSync(sessionDbFile(number), { force: true }); } catch {}
    for (const suffix of ['-wal', '-shm', '-journal']) {
        try { fs.rmSync(sessionDbFile(number) + suffix, { force: true }); } catch {}
    }
    try { fs.rmSync(sessionFolder(number), { recursive: true, force: true }); } catch {}
}

function clearTimers(entry) {
    for (const k of ['pairTimer', 'reconnectTimer', 'codeTimer', 'fallbackTimer']) {
        if (entry[k]) { clearTimeout(entry[k]); entry[k] = null; }
    }
}

function closeSocket(sock) {
    if (!sock) return;
    try { sock.ev.removeAllListeners(); } catch {}
    try { sock.end ? sock.end() : sock.ws?.close(); } catch {}
}

async function tell(entry, text) {
    const n = entry.notify;
    if (!n?.sock || !n.chat) return;
    try { await n.sock.sendMessage(n.chat, { text }, { quoted: n.quoted || undefined }); } catch (err) { logDebug('JADIBOT', `notif gagal: ${err.message}`); }
}

function record(number, patch) {
    try { Object.assign(db.getJadibot(number), patch); } catch {}
}

/** Hentikan entry sepenuhnya (tidak ada reconnect lagi). */
async function destroy(entry, { deleteSession = false, status = 'closed', message = '' } = {}) {
    entry.stopped = true;
    entry.state = status;
    clearTimers(entry);
    closeSocket(entry.sock);
    if (jadibotSessions.get(entry.number) === entry) jadibotSessions.delete(entry.number);
    if (deleteSession) {
        try { await entry.engine?.dispose?.(); } catch {}
        removeSessionFiles(entry.number);
        db.removeJadibot(entry.number);
        db.addBotEvent(entry.number, 'deleted', message || 'Sesi dihapus');
    } else record(entry.number, { status });
    if (message) await tell(entry, message);
    logInfo('JADIBOT', `+${entry.number} dihentikan (${status}${deleteSession ? ', sesi dihapus' : ''})`);
}

/* ───────────────────────── KONEKSI ───────────────────────── */

async function connect(entry) {
    if (entry.stopped) return;
    const number = entry.number;

    closeSocket(entry.sock);
    entry.codeRequested = false;

    // Tutup engine lama bila ada (reconnect) supaya tidak ada websocket / sqlite handle ganda.
    try { await entry.engine?.dispose?.(); } catch {}

    let sock; // diisi dari engine.sock setelah engine dibuat; dipakai closure di bawah
    const engine = await createZapoEngine({
        sessionId: `jadibot_${number}`,
        dbDir: jadibotDbDir,
        getMessage: async (key) => require('../core/messageStore').getMessage(key),
        onQr: () => {},
        onPairing: (code) => {
            if (!entry.stopped && entry.sock === sock) {
                entry.pairingCode = String(code).toUpperCase();
                record(entry.number, { status: 'pairing' });
                logSuccess('JADIBOT', `Kode pairing +${number}: ${formatManzkenzPairingCode(entry.pairingCode)}`);
            }
        },
        onConnection: (ev) => onConnectionUpdate(entry, sock, {
            connection: ev.status,
            lastDisconnect: (ev.isLogout || ev.status === 'close')
                ? { error: { output: { statusCode: ev.isLogout ? DisconnectReason.loggedOut : ev.code }, data: { attrs: { code: ev.code } } } }
                : undefined,
        }),
    });
    entry.engine = engine;
    sock = engine.sock;
    entry.sock = sock;
    entry.registered = Boolean(sock.authState?.creds?.registered);
    entry.state = entry.registered ? 'connecting' : 'pairing';

    // statistik pesan keluar per jadibot: bungkus sendMessage sekali (panel web)
    if (!sock.__statsWrapped) {
        sock.__statsWrapped = true;
        const origSend = sock.sendMessage.bind(sock);
        sock.sendMessage = async (jid, content, opts) => {
            try { if (entry.number) db.recordBotMessage(entry.number, 'out'); } catch {}
            return origSend(jid, content, opts);
        };
    }

    sock.isJadibot = true;
    sock.jadibotNumber = number;                       // nomor akun yang dijadikan bot
    sock.jadibotOwner = entry.owner || number;         // nomor PEMILIK (yang mengetik .jadibot)
    sock.jadibotAdmins = Array.isArray(db.data?.jadibots?.[number]?.admins) ? db.data.jadibots[number].admins : [];
    sock.selfMode = db.getJadibot(number).selfMode !== false;

    attachRichHelpers(sock);
    bindGroupCacheListeners(sock);
    require('../../handler/index').bindEvents(sock, { isActive: () => entry.sock === sock });      // semua event socket → handler.js

    // Cadangan: jika kode pairing tidak datang, minta setelah 6 detik
    if (!entry.registered) {
        entry.fallbackTimer = setTimeout(() => { if (!entry.codeRequested && entry.sock === sock) requestCode(entry, sock); }, 6000);
    }

    await engine.connect();
}

async function requestCode(entry, sock) {
    if (entry.codeRequested || entry.stopped || entry.sock !== sock || sock.authState?.creds?.registered) return;
    entry.codeRequested = true;
    try {
        const result = await requestPairingCodeBranded(sock, entry.number);
        if (entry.stopped || entry.sock !== sock) return;
        entry.pairingCode = result.code;
        entry.pairingCustom = Boolean(result.custom);
        record(entry.number, { status: 'pairing' });
        logSuccess('JADIBOT', `Kode pairing +${entry.number}: ${formatManzkenzPairingCode(result.code)}${result.custom ? ' (custom)' : ''}`);

        const sec = config.jadibot.pairingTimeoutSec || 180;
        if (entry.pairTimer) clearTimeout(entry.pairTimer);
        entry.pairTimer = setTimeout(() => {
            if (entry.state !== 'open') destroy(entry, { deleteSession: true, status: 'closed', message: `⌛ Waktu pairing +${entry.number} habis (${sec} detik). Ketik ulang *${config.prefix}jadibot ${entry.number}* untuk kode baru.` });
        }, sec * 1000);

        if (entry.firstResolve) { entry.firstResolve({ registered: false, number: entry.number, ...result }); entry.firstResolve = entry.firstReject = null; }
    } catch (err) {
        logError('JADIBOT', `Gagal meminta kode pairing +${entry.number}: ${err.message}`);
        if (entry.firstReject) { entry.firstReject(new Error(`Gagal meminta kode pairing: ${err.message}`)); entry.firstResolve = entry.firstReject = null; }
        await destroy(entry, { deleteSession: true, status: 'failed' });
    }
}

function scheduleReconnect(entry, delayMs, reason) {
    if (entry.stopped) return;
    clearTimeout(entry.reconnectTimer);
    logInfo('JADIBOT', `+${entry.number} reconnect dalam ${(delayMs / 1000).toFixed(1)} dtk (${reason})`);
    entry.state = 'connecting';
    entry.reconnectTimer = setTimeout(async () => {
        try { await connect(entry); }
        catch (err) {
            logError('JADIBOT', `Reconnect +${entry.number} gagal: ${err.message}`);
            entry.attempts++;
            if (entry.attempts > (config.jadibot.maxReconnect || 10)) await destroy(entry, { status: 'failed', message: `❌ Jadibot +${entry.number} berhenti setelah terlalu banyak gagal reconnect.` });
            else scheduleReconnect(entry, Math.min(30000, 2000 * entry.attempts), 'retry');
        }
    }, delayMs);
}

/**
 * Pesan "jadibot online" dikirim KE NOMOR YANG DIJADIKAN BOT.
 * Lewat bot utama (pasti muncul di daftar chat nomor itu); bila gagal, lewat chat ke diri sendiri
 * (JID dinormalisasi — JID berakhiran ":device" sebelumnya membuat pesan tidak sampai).
 */
async function sendWelcome(entry, sock) {
    const rec = db.data?.jadibots?.[entry.number] || {};
    if (rec.welcomeText) {
        // sambutan kustom dari panel web (message builder)
        const target2 = `${entry.number}@s.whatsapp.net`;
        const parent2 = entry.notify?.sock;
        try {
            if (!parent2) throw new Error('bot utama tidak tersedia');
            await parent2.sendMessage(target2, { text: rec.welcomeText });
            return;
        } catch {}
        try { await sock.sendMessage(jidNormalizedUser(sock.user?.id || target2), { text: rec.welcomeText }); } catch {}
        return;
    }
    const text =
        `🎉 *JADIBOT ${config.botName.toUpperCase()} ONLINE!*\n\n` +
        `╭───「 *INFO BOT* 」\n` +
        `│ 📱 Nomor bot  : +${entry.number}\n` +
        `│ 👑 Owner      : +${entry.owner}\n` +
        `│ ⚙️ Mode       : ${sock.selfMode ? 'Self (hanya owner)' : 'Public (semua orang)'}\n` +
        `│ ⌛ Masa aktif : ${rec.expire ? `s/d ${formatDateTime(new Date(rec.expire))}` : 'Permanen'}\n` +
        `╰────────────────────────\n\n` +
        `*Cara pakai:*\n` +
        `• Owner (+${entry.owner}) kirim *${config.prefix}menu* ke nomor ini\n` +
        `• Ubah mode: *${config.prefix}self* / *${config.prefix}public*\n` +
        `• Kelola bot: ketik *${config.prefix}listjadibot* di bot utama`;
    const target = `${entry.number}@s.whatsapp.net`;
    const parent = entry.notify?.sock;
    try {
        if (!parent) throw new Error('bot utama tidak tersedia');
        await parent.sendMessage(target, { text });
        return;
    } catch (err) { logDebug('JADIBOT', `welcome via bot utama gagal (${err.message}), coba chat diri sendiri`); }
    try {
        const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : target;
        await sock.sendMessage(me, { text });
    } catch (err) { logWarn('JADIBOT', `Pesan online +${entry.number} gagal terkirim: ${err.message}`); }
}

async function onConnectionUpdate(entry, sock, update) {
    if (entry.stopped || entry.sock !== sock) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr && !entry.registered && !entry.codeRequested) requestCode(entry, sock);

    if (connection === 'open') {
        entry.state = 'open';
        entry.attempts = 0;
        entry.connectedAt = Date.now();
        entry.offlineSince = 0;
        entry.offlineAlerted = false;
        clearTimeout(entry.pairTimer); entry.pairTimer = null;
        record(entry.number, { status: 'open', lastConnected: Date.now() });
        db.addBotEvent(entry.number, 'online', 'Terhubung ke WhatsApp');
        webhook.emit(entry.number, 'bot_online', { number: entry.number, owner: entry.owner });
        logSuccess('JADIBOT', `Aktif: +${entry.number} (${sock.user?.name || sock.user?.id || '-'})`);

        if (!entry.announced) {
            entry.announced = true;
            if (config.jadibot.welcomeMessage && !entry.restored) await sendWelcome(entry, sock);
            await tell(entry, `✅ Jadibot *+${entry.number}* berhasil tersambung!\n\nKirim *${config.prefix}menu* dari nomormu (+${entry.owner}) ke nomor *+${entry.number}* untuk memakainya.`);
            entry.notify = null;
        }
        return;
    }

    if (connection !== 'close') return;

    const code = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.data?.attrs?.code;
    const reason = `${code ?? '?'} ${reasonName(code)}`;
    entry.offlineSince = entry.offlineSince || Date.now();
    db.addBotEvent(entry.number, 'offline', `Terputus (${reason})`);
    webhook.emit(entry.number, 'bot_offline', { number: entry.number, owner: entry.owner, reason });
    logWarn('JADIBOT', `+${entry.number} terputus (${reason})`);

    // Belum sempat terdaftar → pairing gagal / kode kedaluwarsa. Bersihkan agar bisa diulang.
    if (!sock.authState?.creds?.registered) {
        return destroy(entry, { deleteSession: true, status: 'closed', message: `⚠️ Pairing +${entry.number} terputus (${reason}). Ketik ulang *${config.prefix}jadibot ${entry.number}*.` });
    }

    switch (code) {
        case DisconnectReason.loggedOut:
        case DisconnectReason.forbidden:
        case DisconnectReason.multideviceMismatch:
            return destroy(entry, { deleteSession: true, status: 'closed', message: `🚪 Jadibot +${entry.number} keluar dari WhatsApp (${reason}). Sesi dihapus.` });

        case DisconnectReason.connectionReplaced:
            return destroy(entry, { status: 'closed', message: `⚠️ Jadibot +${entry.number} digantikan sesi lain (${reason}).` });

        case DisconnectReason.restartRequired:      // 515 — normal setelah pairing berhasil
            return scheduleReconnect(entry, 800, 'restart required');

        default:
            entry.attempts++;
            if (entry.attempts > (config.jadibot.maxReconnect || 10)) {
                return destroy(entry, { status: 'failed', message: `❌ Jadibot +${entry.number} berhenti setelah ${entry.attempts - 1}x gagal reconnect (${reason}). Ketik *${config.prefix}jadibot ${entry.number}* untuk mencoba lagi.` });
            }
            return scheduleReconnect(entry, Math.min(30000, 2000 * entry.attempts), reason);
    }
}

/* ───────────────────────── API PUBLIK ───────────────────────── */

/**
 * Mulai jadibot. Resolve:
 *   { registered:false, code, custom }  → sesi baru, tampilkan kode ke user
 *   { registered:true }                 → sesi lama dipulihkan
 */
async function startJadibot({ targetNumber, ownerNumber = '', parentSock, chatFrom, quotedMsg, requestedBy = '', expireMs = 0, tier = 'paid', handleIncomingMessage, restored = false }) {
    if (!config.jadibot.enabled) throw new Error('Fitur jadibot dinonaktifkan di config.js');
    if (typeof handleIncomingMessage !== 'function') throw new Error('handleIncomingMessage tidak diberikan');

    const number = String(targetNumber || '').replace(/[^0-9]/g, '');
    if (number.length < 8 || number.length > 15) throw new Error('Nomor tidak valid! Gunakan format internasional tanpa "+", contoh 628123456789');
    if (parentSock?.user?.id && numberOf(parentSock.user.id) === number) throw new Error('Nomor itu adalah bot utama, tidak bisa dijadikan jadibot.');

    const existing = jadibotSessions.get(number);
    const prevRec = db.data?.jadibots?.[number];
    if (tier === 'free' && !restored) {
        const promotions = require('../billing/promotions');
        if (!promotions.freeJadibot() || !promotions.freeAvailable(number)) throw new Error('Slot jadibot gratis penuh atau promo tidak aktif.');
    }
    const owner = String(ownerNumber || requestedBy || prevRec?.owner || number).replace(/[^0-9]/g, '');
    if (prevRec?.owner && owner !== prevRec.owner && !restored) throw new Error('Nomor sudah terdaftar milik owner lain.');
    if (existing) {
        if (existing.state === 'open') throw new Error(`Nomor +${number} sudah aktif sebagai jadibot.`);
        await destroy(existing, { status: 'closed' });
    }
    if (jadibotSessions.size >= runtimeSettings.jadibotMax()) throw new Error(`Slot jadibot penuh (maks ${runtimeSettings.jadibotMax()}).`);
    const entry = {
        number, owner, sock: null, state: 'connecting', attempts: 0, stopped: false, restored,
        createdAt: Date.now(), handleIncomingMessage,
        notify: parentSock && chatFrom ? { sock: parentSock, chat: chatFrom, quoted: quotedMsg } : null
    };
    jadibotSessions.set(number, entry);
    startExpiryWatcher();
    startWatchdog();

    const rec = db.getJadibot(number);
    rec.requestedBy = requestedBy || rec.requestedBy;
    rec.owner = owner;
    if (!restored && tier === 'paid' && expireMs > 0) rec.tier = tier;
    else if (!restored && tier !== 'paid') rec.tier = tier;
    if (expireMs > 0) rec.expire = Date.now() + expireMs;
    else if (!restored && tier === 'free') rec.expire = 0;
    rec.status = 'connecting';

    return await new Promise((resolve, reject) => {
        entry.firstResolve = resolve;
        entry.firstReject = reject;
        const guard = setTimeout(() => {
            if (entry.firstReject) {
                entry.firstReject(new Error('Timeout menunggu kode pairing (60 detik). Coba lagi.'));
                entry.firstResolve = entry.firstReject = null;
                destroy(entry, { deleteSession: !entry.registered, status: 'failed' });
            }
        }, 60000);
        const done = (fn) => (v) => { clearTimeout(guard); fn(v); };
        entry.firstResolve = done(resolve);
        entry.firstReject = done(reject);

        connect(entry).then(() => {
            if (entry.registered && entry.firstResolve) { entry.firstResolve({ registered: true, number }); entry.firstResolve = entry.firstReject = null; }
        }).catch((err) => {
            logError('JADIBOT', err);
            if (entry.firstReject) { entry.firstReject(err); entry.firstResolve = entry.firstReject = null; }
            destroy(entry, { deleteSession: false, status: 'failed' });
        });
    });
}

async function stopJadibot(targetNumber, deleteSession = false) {
    const number = String(targetNumber || '').replace(/[^0-9]/g, '');
    const entry = jadibotSessions.get(number);
    if (entry) { await destroy(entry, { deleteSession, status: 'closed' }); return true; }
    if (deleteSession && (fs.existsSync(sessionDbFile(number)) || fs.existsSync(sessionFolder(number)))) {
        removeSessionFiles(number);
        db.removeJadibot(number);
        return true;
    }
    return false;
}

function getActiveJadibots() {
    return [...jadibotSessions.values()].map((e) => ({
        number: e.number,
        owner: e.owner,
        name: e.sock?.user?.name || (e.state === 'pairing' ? 'Menunggu pairing' : '-'),
        state: e.state,
        connected: e.state === 'open',
        selfMode: e.sock ? e.sock.selfMode !== false : true,
        uptime: e.connectedAt ? Math.floor((Date.now() - e.connectedAt) / 1000) : 0,
        attempts: e.attempts,
        pairingCode: e.pairingCode || '',                       // untuk ditampilkan di panel web
        pairingCustom: Boolean(e.pairingCustom),
        expire: db.data?.jadibots?.[e.number]?.expire || 0
    }));
}

/** Semua jadibot: yang sedang berjalan + yang sesinya tersimpan di disk (belum aktif). */
function listAllJadibots() {
    const out = new Map();
    for (const j of getActiveJadibots()) out.set(j.number, j);
    for (const dir of fs.existsSync(baseJadibotDir) ? fs.readdirSync(baseJadibotDir) : []) {
        if (!/^\d{8,15}$/.test(dir) || out.has(dir)) continue;
        const rec = db.data?.jadibots?.[dir] || {};
        out.set(dir, { number: dir, owner: rec.owner || rec.requestedBy || dir, name: '-', state: rec.status === 'open' ? 'closed' : (rec.status || 'closed'), connected: false, selfMode: rec.selfMode !== false, uptime: 0, attempts: 0, expire: rec.expire || 0 });
    }
    // Sertakan juga record yang baru dibuat (mis. sedang pairing) meski folder sesinya belum ada,
    // supaya dashboard/panel web langsung melihatnya.
    for (const [num, rec] of Object.entries(db.data?.jadibots || {})) {
        if (!/^\d{8,15}$/.test(num) || out.has(num)) continue;
        out.set(num, {
            number: num, owner: rec.owner || rec.requestedBy || num, name: '-',
            state: rec.status === 'open' ? 'closed' : (rec.status || 'closed'), connected: false,
            selfMode: rec.selfMode !== false, uptime: 0, attempts: 0, expire: rec.expire || 0
        });
    }
    return [...out.values()];
}

/** Apakah ada sesi tersimpan (sudah pernah pairing) untuk nomor ini? */
function hasSavedSession(number) {
    try { if (fs.statSync(sessionDbFile(number)).size > 0) return true; } catch {}
    try { return Boolean(JSON.parse(fs.readFileSync(path.join(sessionFolder(number), 'creds.json'), 'utf8')).registered); } catch { return false; }
}

/** Nomor pemilik sebuah jadibot ('' jika tidak dikenal). */
function getJadibotOwner(number) {
    const e = jadibotSessions.get(number);
    return e?.owner || db.data?.jadibots?.[number]?.owner || db.data?.jadibots?.[number]?.requestedBy || '';
}

/* ── backup sesi: export/import folder sesi sebagai kontainer JSON base64 ── */

const EXPORT_MAX_FILE = 2 * 1024 * 1024;   // satu file sesi maks 2 MB
const EXPORT_MAX_TOTAL = 8 * 1024 * 1024;  // total kontainer maks 8 MB

function collectSessionFiles(dir, base = '', out = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const rel = base ? `${base}/${e.name}` : e.name;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) collectSessionFiles(full, rel, out);
        else {
            let size = 0;
            try { size = fs.statSync(full).size; } catch { continue; }
            if (size <= EXPORT_MAX_FILE) out.push({ rel, full, size });
        }
    }
    return out;
}

/**
 * Ekspor sesi jadibot menjadi kontainer JSON { files: { rel: base64 } }.
 * Format v2 = sqlite zapo (jadibot_<no>.sqlite + wal/shm), v1 = folder Baileys lama.
 * Dipakai untuk pindah VPS tanpa scan QR ulang. Throw jika sesi tidak ada.
 */
function exportSession(number) {
    const files = {};
    let total = 0;
    const add = (rel, full) => {
        const b64 = fs.readFileSync(full).toString('base64');
        total += b64.length;
        if (total > EXPORT_MAX_TOTAL) throw new Error('Sesi terlalu besar untuk diekspor.');
        files[rel] = b64;
    };

    // Utamakan sesi zapo (aktif saat ini).
    const dbFile = sessionDbFile(number);
    if (fs.existsSync(dbFile)) {
        add('session.sqlite', dbFile);
        for (const suffix of ['-wal', '-shm']) {
            const side = dbFile + suffix;
            if (fs.existsSync(side)) { try { add('session.sqlite' + suffix, side); } catch {} }
        }
        return { format: 'manzxy-session-v2', number: String(number), exportedAt: new Date().toISOString(), files };
    }

    // Fallback: folder Baileys lama (kompatibel dengan backup lama).
    const folder = sessionFolder(number);
    if (!fs.existsSync(path.join(folder, 'creds.json'))) throw new Error('Tidak ada sesi tersimpan untuk nomor ini.');
    for (const f of collectSessionFiles(folder)) add(f.rel, f.full);
    if (!files['creds.json']) throw new Error('Sesi tidak lengkap (creds.json hilang).');
    return { format: 'manzxy-session-v1', number: String(number), exportedAt: new Date().toISOString(), files };
}

/**
 * Impor kontainer sesi ke nomor tertentu (v2 sqlite zapo atau v1 folder Baileys).
 * File lama DITIMPA (dipanggil setelah validasi kepemilikan). Kembalikan jumlah file.
 */
function importSession(number, files) {
    if (!files || typeof files !== 'object') throw new Error('Kontainer sesi tidak valid.');
    const isV2 = typeof files['session.sqlite'] === 'string';
    if (!isV2 && !files['creds.json']) throw new Error('Kontainer sesi tidak valid (creds.json / session.sqlite wajib ada).');

    if (isV2) {
        const target = sessionDbFile(number);
        fs.mkdirSync(jadibotDbDir, { recursive: true });
        // Hapus berkas lama dulu supaya tidak ada campuran sesi.
        removeSessionFiles(number);
        let count = 0;
        for (const [rel, b64] of Object.entries(files)) {
            if (typeof b64 !== 'string' || rel.includes('..') || rel.startsWith('/')) continue;
            if (rel !== 'session.sqlite' && !/^session\.sqlite-(wal|shm)$/.test(rel)) continue;
            fs.writeFileSync(target + rel.slice('session.sqlite'.length), Buffer.from(b64, 'base64'));
            count++;
        }
        if (!fs.existsSync(target)) throw new Error('Impor gagal: session.sqlite tidak tertulis.');
        return count;
    }

    const folder = sessionFolder(number);
    fs.mkdirSync(folder, { recursive: true });
    let count = 0;
    for (const [rel, b64] of Object.entries(files)) {
        if (typeof b64 !== 'string' || rel.includes('..') || rel.startsWith('/')) continue;
        const target = path.join(folder, rel);
        if (!target.startsWith(folder)) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(b64, 'base64'));
        count++;
    }
    if (!fs.existsSync(path.join(folder, 'creds.json'))) throw new Error('Impor gagal: creds.json tidak tertulis.');
    return count;
}

function setJadibotMode(number, selfMode) {
    const entry = jadibotSessions.get(number);
    if (entry?.sock) entry.sock.selfMode = selfMode;
    record(number, { selfMode });
}

/** Nyalakan kembali semua sesi tersimpan setelah bot (re)start. */
async function restoreJadibots({ handleIncomingMessage }) {
    if (!config.jadibot.enabled || !config.jadibot.autoRestore) return 0;
    let restored = 0;
    for (const dir of fs.readdirSync(baseJadibotDir).sort((a, b) => {
        const priority = (n) => db.data?.jadibots?.[n]?.tier === 'free' ? 1 : 0;
        return priority(a) - priority(b);
    })) {
        if (!/^\d{8,15}$/.test(dir)) continue;
        let saved = false;
        try { saved = fs.statSync(sessionDbFile(dir)).size > 0; } catch {}
        if (!saved) {
            let creds = null;
            try { creds = JSON.parse(fs.readFileSync(path.join(sessionFolder(dir), 'creds.json'), 'utf8')); } catch {}
            saved = Boolean(creds?.registered);
        }
        if (!saved) {                                               // sesi setengah jadi → buang
            removeSessionFiles(dir);
            continue;
        }
        const rec = db.data?.jadibots?.[dir];
        if (rec?.expire && rec.expire < Date.now()) {
            if (rec.expire + graceMs() > Date.now()) {                  // masa tenggang → sesi disimpan, tidak dinyalakan
                logInfo('JADIBOT', `+${dir} habis, sesi disimpan (masa tenggang) — menunggu perpanjangan`);
                record(dir, { status: 'expired' });
                continue;
            }
            logWarn('JADIBOT', `+${dir} sudah kedaluwarsa, sesi dihapus`);
            removeSessionFiles(dir);
            db.removeJadibot(dir);
            continue;
        }
        if (jadibotSessions.has(dir) || jadibotSessions.size >= runtimeSettings.jadibotMax()) continue;
        try {
            await startJadibot({ targetNumber: dir, ownerNumber: rec?.owner || rec?.requestedBy || dir, handleIncomingMessage, restored: true });
            restored++;
        } catch (err) { logError('JADIBOT', `Restore +${dir}: ${err.message}`); }
        await sleep(config.jadibot.restoreDelayMs || 2500);
    }
    if (restored) logSuccess('JADIBOT', `${restored} sesi jadibot dipulihkan`);
    return restored;
}

/* ───────────── Buat jadibot + kirim kode pairing ke NOMOR TARGET (dipakai .jadibot dan pembayaran) ───────────── */

function pairingText({ target, owner, code, custom, expireMs }) {
    const pretty = formatManzkenzPairingCode(code);
    return (
        `╭───「 *PAIRING CODE JADIBOT* 」\n` +
        `│ 📱 *Nomor bot :* +${target}\n` +
        `│ 👑 *Owner bot :* +${owner}\n` +
        `│ 🔑 *Kode      :* \`${pretty}\`\n` +
        `│ ⏳ *Berlaku   :* ${Math.round(config.jadibot.pairingTimeoutSec / 60)} menit\n` +
        `│ ⌛ *Masa aktif:* ${expireMs ? formatDuration(expireMs) : 'Permanen'}\n` +
        `╰────────────────────────\n\n` +
        `*Cara memasukkan kode di nomor ini:*\n` +
        `1. Buka WhatsApp › menu ⋮ › *Perangkat Tertaut*\n` +
        `2. *Tautkan Perangkat* › *Tautkan dengan nomor telepon saja*\n` +
        `3. Masukkan kode di atas${custom ? '' : '\n\n_ℹ️ Kode acak dipakai karena versi Baileys belum mendukung kode custom._'}`
    );
}

/**
 * @returns {{ registered:boolean, code?:string, deliveredTo:'target'|'owner'|'restored'|'web' }}
 */
async function launchAndDeliver({ parentSock, targetNumber, ownerNumber, chatFrom, quotedMsg, expireMs = 0, tier = 'paid', handleIncomingMessage, deliver = true }) {
    if (!parentSock?.sendMessage) throw new Error('Bot utama belum terhubung, coba lagi sebentar.');
    const target = normalizePhone(targetNumber);
    const owner = normalizePhone(ownerNumber);
    const targetJid = `${target}@s.whatsapp.net`;
    const ownerJid = `${owner}@s.whatsapp.net`;

    try {
        const r = await parentSock.onWhatsApp?.(targetJid);
        if (Array.isArray(r) && r[0] && r[0].exists === false) throw new Error(`Nomor +${target} tidak terdaftar di WhatsApp.`);
    } catch (e) { if (/tidak terdaftar/.test(e.message)) throw e; }

    const result = await startJadibot({
        targetNumber: target, ownerNumber: owner, parentSock, chatFrom, quotedMsg,
        requestedBy: owner, expireMs, tier, handleIncomingMessage
    });
    if (result.registered) return { ...result, deliveredTo: 'restored' };

    /* deliver = false → kode TIDAK dikirim via WhatsApp; ditampilkan di panel web. */
    if (!deliver) return { ...result, deliveredTo: 'web', code: result.code || '' };

    const text = pairingText({ target, owner, code: result.code, custom: result.custom, expireMs });
    let deliveredTo = 'target';
    let dest = targetJid;
    try {
        await parentSock.sendMessage(targetJid, { text });
    } catch (err) {
        // Gagal kirim ke nomor target (mis. privasi) → kirim ke owner jadibot supaya diteruskan manual
        deliveredTo = 'owner';
        dest = ownerJid;
        try { await parentSock.sendMessage(ownerJid, { text: `${text}\n\n_⚠️ Kode tidak bisa dikirim langsung ke +${target}. Teruskan kode ini ke pemilik nomor._` }); }
        catch (err2) { await stopJadibot(target, true); throw new Error(`Gagal mengirim kode pairing: ${err2.message}`); }
    }
    try {
        await parentSock.sendUniversalButton(dest, { title: '🔑 SALIN KODE', body: `Kode pairing: *${formatManzkenzPairingCode(result.code)}*`, footer: config.footerText, fallback: false },
            [button.copy('Salin Kode', result.code)]);
    } catch { /* tombol salin hanya pelengkap */ }
    return { ...result, deliveredTo };
}


/** Masa tenggang (ms) setelah habis: sesi tetap disimpan agar pemilik bisa memperpanjang tanpa setup ulang. */
const graceMs = () => Math.max(0, Number(config.renewal?.graceHours) || 0) * 3600 * 1000;

/**
 * Hentikan jadibot yang masa sewanya habis.
 * graceHours > 0 → socket dimatikan, SESI DISIMPAN (status 'expired') sampai masa tenggang selesai
 *                  (penghapusan sesi + pemberitahuan dilakukan lib/renewal.js). graceHours = 0 → sesi langsung dihapus.
 */
/**
 * Watchdog: kalau jadibot pemiliknya mati lebih lama dari WATCHDOG_MINUTES menit,
 * kirim satu alert WhatsApp ke pemilik bot (tidak diulang sampai bot online lagi).
 */
function startWatchdog() {
    if (watchdogTimer) return;
    const minutes = Math.max(5, Number(config.jadibot?.watchdogMinutes) || 10);
    watchdogTimer = setInterval(() => {
        const sock = global.__mainSock;
        if (!sock?.user) return;
        const now = Date.now();
        for (const entry of jadibotSessions.values()) {
            if (entry.state === 'open' || entry.stopped) continue;
            if (!entry.offlineSince || entry.offlineAlerted) continue;
            if (now - entry.offlineSince < minutes * 60000) continue;
            entry.offlineAlerted = true;
            const owner = entry.owner ? `${entry.owner}@s.whatsapp.net` : null;
            if (!owner) continue;
            const mins = Math.round((now - entry.offlineSince) / 60000);
            sock.sendMessage(owner, { text: `⚠️ *Watchdog Jadibot*

Bot *+${entry.number}* sudah offline *${mins} menit* dan belum berhasil tersambung kembali.

Cek panel: ${config.web?.baseUrl || 'http://localhost:3000/panel'} → MONITOR` })
                .catch(() => {});
            db.addBotEvent(entry.number, 'error', `Watchdog: offline ${mins} menit, alert dikirim ke pemilik`);
        }
    }, 60 * 1000);
    if (watchdogTimer.unref) watchdogTimer.unref();
}

function startExpiryWatcher() {
    if (expiryTimer) return;
    expiryTimer = setInterval(async () => {
        for (const entry of [...jadibotSessions.values()]) {
            const exp = db.data?.jadibots?.[entry.number]?.expire;
            if (!exp || exp >= Date.now()) continue;
            const grace = graceMs();
            try {
                if (entry.sock?.user?.id) {
                    await entry.sock.sendMessage(entry.sock.user.id, { text: grace
                        ? `⌛ Masa aktif jadibot habis. Sesi disimpan ${Math.round(grace / 3600000)} jam — minta pemilik bot memperpanjang agar tersambung lagi tanpa pairing ulang.`
                        : `⌛ Masa aktif jadibot habis. Hubungi owner untuk perpanjang.` });
                }
            } catch {}
            db.addBotEvent(entry.number, 'expired', 'Masa sewa habis');
            webhook.emit(entry.number, 'sewa_habis', { number: entry.number, owner: entry.owner });
            await destroy(entry, { deleteSession: grace === 0, status: 'expired' });
        }
    }, 60 * 1000);
    if (expiryTimer.unref) expiryTimer.unref();
}

/**
 * Perpanjang masa aktif jadibot (dipakai pembayaran perpanjangan). Masa baru DITAMBAHKAN ke sisa masa aktif.
 * Bila sesi sedang mati (habis / masa tenggang) dan sesi tersimpan masih ada → dinyalakan lagi otomatis.
 */
async function extendJadibot(targetNumber, ms, { handleIncomingMessage, by = '' } = {}) {
    const number = String(targetNumber || '').replace(/[^0-9]/g, '');
    const rec = db.data?.jadibots?.[number];
    if (!rec) throw new Error(`Jadibot +${number} tidak ditemukan (sudah dihapus). Buat baru dengan ${config.prefix}jadibot.`);
    if (!rec.expire) throw new Error(`Jadibot +${number} berstatus permanen, tidak perlu diperpanjang.`);
    if (!(ms > 0)) throw new Error('Durasi perpanjangan tidak valid.');
    const now = Date.now();
    const base = rec.expire > now ? rec.expire : now;
    rec.expire = base + ms;
    rec.lastDurationMs = ms;
    db.markDirty();

    let restarted = false;
    if (!jadibotSessions.has(number) && hasSavedSession(number) && typeof handleIncomingMessage === 'function') {
        // tidak ditunggu: koneksi bisa lama, perpanjangan sudah tercatat
        startJadibot({ targetNumber: number, ownerNumber: rec.owner || by || number, handleIncomingMessage, restored: true })
            .catch((err) => logError('JADIBOT', `Nyalakan ulang +${number} setelah perpanjang: ${err.message}`));
        restarted = true;
    }
    logSuccess('JADIBOT', `+${number} diperpanjang s/d ${formatDateTime(new Date(rec.expire))}${restarted ? ' (sesi dinyalakan ulang)' : ''}`);
    return { expire: rec.expire, restarted, owner: rec.owner };
}

/** Dipanggil saat proses berhenti: tutup socket tanpa menghapus sesi. */
async function shutdownAll() {
    for (const entry of jadibotSessions.values()) {
        entry.stopped = true;
        clearTimers(entry);
        closeSocket(entry.sock);
        try { await entry.engine?.dispose?.(); } catch {}
    }
    jadibotSessions.clear();
}


/* ═════════ SCHEDULER — pesan terjadwal per jadibot (mantan lib/scheduler.js) ═════════
 * Item tersimpan di db.data.scheduled: { id, number, jid, text, at, repeat, status, ... }.
 * Dicek tiap 30 detik; dikirim memakai socket jadibot yang sedang online. */

let __schedTimer = null;
const SCHED_DAY = 24 * 3600 * 1000;

async function schedTick() {
    const items = db.data.scheduled || [];
    const now = Date.now();
    let dirty = false;
    for (const item of items) {
        if (item.status !== 'pending') continue;
        if (now - item.at > SCHED_DAY && item.tries > 40) { item.status = 'missed'; dirty = true; continue; }
        if (now < item.at) continue;
        const sock = jadibotSessions.get(item.number)?.sock;
        if (!sock?.user?.id) { item.tries = (item.tries || 0) + 1; continue; }
        try {
            await sock.sendMessage(item.jid, { text: item.text });
            if (item.repeat === 'daily') { item.at = now + SCHED_DAY; item.tries = 0; }
            else item.status = 'sent';
            item.sentAt = now;
            dirty = true;
            logInfo('SCHEDULER', `Terkirim: jadwal #${item.id} → ${item.jid} via +${item.number}`);
        } catch (e) {
            item.tries = (item.tries || 0) + 1;
            logDebug('SCHEDULER', `gagal kirim #${item.id}: ${e.message}`);
        }
    }
    if (dirty) db.markDirty();
}

function startScheduler() {
    if (__schedTimer) return;
    __schedTimer = setInterval(() => schedTick().catch(() => {}), 30 * 1000);
    if (__schedTimer.unref) __schedTimer.unref();
}

module.exports = { startScheduler, schedTick,
    jadibotSessions, formatManzkenzPairingCode, requestPairingCodeBranded,
    startJadibot, stopJadibot, extendJadibot, launchAndDeliver, pairingText, getActiveJadibots, listAllJadibots, getJadibotOwner, hasSavedSession, setJadibotMode, restoreJadibots, shutdownAll, formatDuration,
    exportSession, importSession
};
