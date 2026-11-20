const readline = require('readline');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');

const config = require('./config');
require('./lib/core/configDefaults').apply(config);
const db = require('./lib/data/database');
const keepAlive = require('./lib/core/keepAlive');
const webPanel = require('./lib/web/server');
const { attachRichHelpers } = require('./lib/wa/rich');
const { loadPlugins, watchPlugins, plugins, commandIndex, getPluginsByCategory } = require('./lib/bot/pluginLoader');
const { printBanner, printReady, logInfo, logSuccess, logWarn, logError, reasonName } = require('./lib/core/logger');
const { getCachedGroupMetadata, bindGroupCacheListeners } = require('./lib/core/jid');
const jadibot = require('./lib/bot/jadibotManager');
const payment = require('./lib/billing/payment');
const renewal = require('./lib/billing/renewal');
const cleaner = require('./lib/bot/cleaner');
const { handleIncomingMessage, bindEvents, getStoredMessage } = require('./handler/index');
const { numberOf } = require('./lib/core/utils');
const { createZapoEngine } = require('./lib/wa/zapoEngine');

const args = process.argv.slice(2);
let isPairingMode = config.usePairingCode;
if (args.includes('--qr')) isPairingMode = false;
if (args.includes('--pairing')) isPairingMode = true;

let firstConnect = true;
let reconnectAttempts = 0;
let shuttingDown = false;
let currentSock = null;

/* ───────────── Proteksi proses: error tak terduga tidak mematikan bot ───────────── */
process.on('uncaughtException', (err) => logError('UNCAUGHT', err));
process.on('unhandledRejection', (err) => logError('REJECTION', err instanceof Error ? err : new Error(String(err))));

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logWarn('SHUTDOWN', `${signal} diterima, menyimpan data...`);
    try { await jadibot.shutdownAll(); payment.stop(); renewal.stop(); cleaner.stop(); } catch {}
    try { currentSock?.ws?.close(); } catch {}
    db.saveSync();
    keepAlive.stop();
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const question = (text) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(text, (ans) => { rl.close(); resolve(ans); });
});

/**
 * Satu-satunya jalur koneksi: zapo-js. Menghasilkan `sock` ala Baileys lewat
 * facade agar seluruh handler & 100 plugin tetap memakai API yang sama.
 * Sesi dibaca dari session_zapo/<sessionId>.sqlite (lihat lib/zapoCompat migrator).
 */
async function startBotZapo() {
    if (firstConnect) {
        const { WA_VERSION } = require('./lib/wa/zapoEngine');
        printBanner({ waVersion: String(WA_VERSION || '').split('.').slice(0, 3).join('.'), pairing: isPairingMode });
        if (config.__addedDefaults?.length) {
            logWarn('CONFIG', `config.js belum punya ${config.__addedDefaults.length} pengaturan baru → memakai nilai bawaan:`);
            logWarn('CONFIG', config.__addedDefaults.slice(0, 12).join(', ') + (config.__addedDefaults.length > 12 ? ' …' : ''));
            logWarn('CONFIG', 'Salin bagian terkait dari config.js terbaru bila ingin mengubahnya.');
        }
    }

    const engine = await createZapoEngine({
        sessionId: config.sessionName || 'main',
        dbDir: path.join(__dirname, 'session_zapo'),
        getMessage: getStoredMessage,
        onQr: (qr) => {
            if (isPairingMode) return;
            qrcode.generate(qr, { small: true });
        },
        onPairing: (code) => {
            console.log(`\n  🔑 KODE PAIRING : ${jadibot.formatManzkenzPairingCode(code)}`);
            console.log('  Buka WhatsApp > Perangkat Tertaut > Tautkan dengan nomor telepon.\n');
        },
        onConnection: async (ev) => {
            const sock = engine?.sock;
            if (!sock || currentSock !== sock) return;
            if (ev.status === 'open') {
                reconnectAttempts = 0;
                const cats = Object.entries(getPluginsByCategory()).map(([name, list]) => ({ name, count: list.reduce((n, p) => n + p.commands.length, 0) }));
                printReady({
                    user: `${sock.user?.name || '-'} (+${numberOf(sock.user?.id)})`,
                    plugins: plugins.size, categories: cats, commands: commandIndex.size,
                    jadibots: jadibot.jadibotSessions.size, dbStats: db.summary()
                });
                if (firstConnect) {
                    firstConnect = false;
                    jadibot.restoreJadibots({ handleIncomingMessage }).catch((err) => logError('JADIBOT', err));
                }
                webPanel.bindBot({ sock, handleIncomingMessage });
            } else if (ev.status === 'close') {
                if (shuttingDown) return;
                if (ev.isLogout) {
                    logError('KONEKSI', 'Akun logout. Hapus session_zapo/<id>.sqlite lalu jalankan ulang untuk pairing.');
                    return process.exit(1);
                }
                const delay = Math.min(30000, 2000 * ++reconnectAttempts);
                logInfo('KONEKSI', `Menyambung ulang (zapo) dalam ${(delay / 1000).toFixed(1)} dtk...`);
                return setTimeout(() => engine.connect().catch((err) => logError('ZAPO', err)), delay);
            }
        },
    });

    const sock = engine.sock;
    currentSock = sock;
    attachRichHelpers(sock);
    bindGroupCacheListeners(sock);
    payment.setSock(sock);
    renewal.setSock(sock);
    bindEvents(sock, { isActive: () => currentSock === sock });

    if (isPairingMode && !sock.authState.creds.registered) {
        const num = config.pairingNumber || String(process.env.PAIRING_NUMBER || '').replace(/\D/g, '');
        if (num) setTimeout(() => engine.requestPairingCode(num).catch((e) => logError('PAIRING', e)), 1500);
    }

    await engine.connect();
}

/* ───────────── Boot ───────────── */
db.load();
loadPlugins();
if (config.hotReload && !process.env.MANZXY_SUPERVISED) watchPlugins(); // supervisor memantau seluruh proyek; jangan pasang pemantau plugin kedua
keepAlive.start();
// Panel web memakai port keep-alive yang sama (/panel dan /api/*)
if (keepAlive.server) webPanel.attachTo(keepAlive.server);
else webPanel.start(config.port);
payment.start({ handleIncomingMessage });
renewal.start({ handleIncomingMessage });
cleaner.start();
startBotZapo().catch((err) => { logError('START', err); process.exit(1); });
