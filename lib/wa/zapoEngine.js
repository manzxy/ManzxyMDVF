/**
 * ZAPO ENGINE — bootstrap koneksi zapo-js yang menghasilkan `sock` ala Baileys.
 *
 * Dipakai oleh index.js / jadibotManager.js bila WA_ENGINE=zapo.
 * Semua detail koneksi (store sqlite, auth, pairing, event translation, reconnect)
 * ditutup di sini supaya file inti tidak berubah banyak.
 */
'use strict';

const path = require('node:path');
const { WaClient, WA_VERSION } = require('zapo-js');
const { createZapoStore, buildSock } = require('./zapoCompat');
const { logInfo, logWarn, logError, logSuccess } = require('../core/logger');

const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined));

/* Paket opsional resmi zapo. Semua bersifat soft-dependency: bila tidak
   terpasang, engine tetap jalan dengan fallback bawaan. */
const optional = (name) => { try { return require(name); } catch { return null; } };
const mediaUtils = optional('@zapo-js/media-utils');
const wamPkg = optional('@zapo-js/wam');

// Satu processor bisa dipakai bersama semua session (main + jadibot).
const mediaProcessor = mediaUtils?.createMediaProcessor ? mediaUtils.createMediaProcessor() : undefined;
const basePlugins = [];
if (wamPkg?.wamPlugin) {
    try { basePlugins.push(wamPkg.wamPlugin()); } catch (e) { logWarn('ZAPO', 'wamPlugin gagal dipasang: ' + e.message); }
}

/**
 * Buat engine zapo untuk satu sesi.
 *
 * @param {object} o
 *   sessionId   {string}  id sesi unik (main: config.sessionName, jadibot: nomor)
 *   dbDir       {string}  folder untuk file sqlite
 *   phone       {string}  nomor untuk pairing (opsional)
 *   onEvent     {function(name, payload)}  terjemahan event -> handler
 *   onQr        {function(qr)}
 *   onPairing   {function(code)}
 *   onConnection{function(update)} update ala Baileys {connection,lastDisconnect}
 *
 * @returns {Promise<{sock, client, store, connect, disconnect, requestPairingCode}>}
 */
async function createZapoEngine(o = {}) {
    const sessionId = o.sessionId || 'main';
    const dbDir = o.dbDir || path.join(process.cwd(), 'session_zapo');
    require('node:fs').mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, `${sessionId}.sqlite`);

    const store = createZapoStore(dbPath);
    const logger = o.logger || undefined;

    const client = new WaClient(clean({
        store,
        sessionId,
        connectTimeoutMs: o.connectTimeoutMs ?? 60000,
        keepAliveIntervalMs: o.keepAliveIntervalMs ?? 25000,
        deadSocketTimeoutMs: o.deadSocketTimeoutMs ?? 90000,
        markOnlineOnConnect: false,
        recoverFromClientTooOld: true,
        history: { enabled: false },
        deviceBrowser: 'Chrome',
        deviceOsDisplayName: 'Ubuntu',
        media: mediaProcessor ? { processor: mediaProcessor } : undefined,
        plugins: basePlugins.length ? basePlugins : undefined,
    }), logger);

    const sock = buildSock({ client, store, sessionId, getMessage: o.getMessage });

    // Ekspos semua coordinator resmi zapo ke sock agar plugin bisa memakai
    // kemampuan penuh library tanpa menulis ulang (group, newsletter, status,
    // privacy, profile, business, bot, email, mobile, presence, lowlevel, auth).
    sock.zapo = {
        client,
        auth: client.auth,
        message: client.message,
        presence: client.presence,
        chat: client.chat,
        group: client.group,
        status: client.status,
        broadcastList: client.broadcastList,
        newsletter: client.newsletter,
        privacy: client.privacy,
        profile: client.profile,
        business: client.business,
        bot: client.bot,
        email: client.email,
        mobile: client.mobile,
        lowlevel: client.lowlevel,
        wam: client.wam,
    };

    // Event koneksi & pairing -> callback ala Baileys
    client.on('auth_qr', ({ qr }) => { try { o.onQr?.(qr); } catch {} });
    client.on('auth_pairing_code', ({ code }) => { try { o.onPairing?.(code); } catch {} });
    client.on('connection', (ev) => {
        try { o.onConnection?.(ev); } catch {}
    });

    // Event lain: buildSock() sudah meneruskan semuanya ke sock.ev lewat
    // translateEvent. Di sini hanya callback opsional onEvent (tanpa emit ulang,
    // supaya message/call/group tidak diproses dua kali).
    const relay = ['message', 'group', 'call', 'message_addon', 'message_protocol', 'presence', 'chatstate'];
    for (const name of relay) {
        client.on(name, (payload) => {
            try { o.onEvent?.(name, payload); } catch {}
        });
    }

    const connect = async () => {
        logInfo('ZAPO', `Menyambung sesi ${sessionId}...`);
        await client.connect();
        logSuccess('ZAPO', `Sesi ${sessionId} tersambung`);
    };
    const disconnect = async () => { try { await client.disconnect(); } catch {} };
    // Lepas resource sqlite saat sesi diganti / shutdown (hindari handle bocor).
    const dispose = async () => {
        await disconnect();
        try { sock._unbind?.(); } catch {}
        try { await store.destroy?.(); } catch {}
    };
    const requestPairingCode = (phone) => client.auth.requestPairingCode(String(phone).replace(/\D/g, ''));

    return { sock, client, store, dbPath, connect, disconnect, dispose, requestPairingCode };
}

module.exports = { createZapoEngine, WA_VERSION };
