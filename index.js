const readline = require('readline');
const fs = require('fs');
const path = require('path');

/* ── License gate. Jalan SEBELUM modul lain. ──
 * Alur: owner buat key → kasih ke user → user tempel di console saat start.
 *   --key <key>            pakai key dari argumen (PM2/systemd), simpan, lanjut
 *   key di env/.license-key → lanjut otomatis
 *   belum ada key          → TANYA di console, verifikasi, simpan, lanjut
 * Key tidak diikat fingerprint — cukup key.
 */
const lic = require('./lib/core/license');

/* ── Console styling ── */
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m',
    yellow: '\x1b[33m', gray: '\x1b[90m', white: '\x1b[97m'
};
const W = 56;
const paint = (s, c) => c + s + C.reset;
const row = (text = '') => '  │ ' + text.padEnd(W - 4) + ' │';
const lineTop = '  ╭' + '─'.repeat(W - 2) + '╮';
const lineBot = '  ╰' + '─'.repeat(W - 2) + '╯';
const center = (text) => '  │ ' + text.padStart(Math.floor((W - 4 + text.length) / 2)).padEnd(W - 4) + ' │';

function boxHeader(title, subtitle) {
    console.log('\n' + lineTop);
    console.log(center(paint(title, C.bold + C.cyan)));
    if (subtitle) console.log(row(paint(subtitle, C.gray)));
    console.log(lineBot);
}

function statusLine(label, value, color) {
    console.log('  ' + paint(label.padEnd(11), C.gray) + paint(value, color));
}

function expiryText(e) {
    if (!e) return 'Seumur hidup';
    const d = new Date(e);
    const days = Math.ceil((d - Date.now()) / 86400000);
    if (days <= 0) return 'Hari ini';
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) +
        '  (' + days + ' hari lagi)';
}

function printLicense(r, source) {
    console.log('');
    console.log(lineTop);
    console.log(center(paint('✓ LISENSI AKTIF', C.bold + C.green)));
    console.log(lineBot);
    statusLine('Customer', r.payload?.c || '-', C.white);
    statusLine('Tier', String(r.payload?.t || 'free').toUpperCase(), C.cyan);
    statusLine('Jenis', r.payload?.k === 'individual' ? 'Individual (1 bot)' : 'Shared (rame-rame)', C.cyan);
    statusLine('ID', r.payload?.j || '-', C.gray);
    statusLine('Berlaku', expiryText(r.payload?.e), C.green);
    if (source) statusLine('Sumber', source, C.gray);
    console.log('');
}

let _licenseRl = null;
const question = (text) => new Promise((resolve) => {
    if (!_licenseRl) _licenseRl = readline.createInterface({ input: process.stdin, output: process.stdout });
    _licenseRl.question(text, (ans) => resolve(ans));
});
const closeQuestion = () => { try { _licenseRl?.close(); } catch {} _licenseRl = null; };

function fmtDuration(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + 'm ' + String(sec).padStart(2, '0') + 's';
}

async function licenseGate() {
    // 0. Cooldown setelah 3x key salah — tolak start sampai masa jeda habis.
    const cd = lic.cooldownRemaining();
    if (cd > 0) {
        console.log('\n' + lineTop);
        console.log(center(paint('⏳ JEDA LISENSI AKTIF', C.bold + C.yellow)));
        console.log(row(paint('3x key salah sebelumnya. Silakan coba lagi nanti.', C.gray)));
        console.log(row(paint('Sisa jeda: ' + fmtDuration(cd), C.yellow)));
        console.log(lineBot + '\n');
        process.exit(1);
    }

    // 1. Argumen --key <key> (dipakai PM2 / systemd / docker)
    const keyArgIdx = process.argv.indexOf('--key');
    if (keyArgIdx !== -1 && process.argv[keyArgIdx + 1]) {
        const key = process.argv[keyArgIdx + 1].trim();
        const r = lic.verifyKey(key);
        if (!r.ok) {
            boxHeader('LICENSE KEY DITOLAK', 'Periksa key yang diberikan owner.');
            console.log('  ' + paint('Alasan', C.gray) + ': ' + paint(r.message, C.red) + '  [' + r.reason + ']\n');
            process.exit(1);
        }
        lic.saveKey(key);
        printLicense(r, 'argumen --key');
        return;
    }

    // 2. Key dari env / file yang tersimpan
    let r = lic.check();
    if (r.ok) {
        printLicense(r, process.env.MZ_LICENSE_KEY ? 'environment' : '.license-key');
        return;
    }

    // 3. Prompt interaktif
    const stored = process.env.MZ_LICENSE_KEY || lic.readKeyFile();
    boxHeader('MANZXYMD FREE — LISENSI', 'Masukkan license key dari owner untuk menjalankan bot.');
    if (stored) {
        console.log(row(paint('Key tersimpan tidak aktif: ' + r.message, C.yellow)));
        console.log(lineBot);
    }
    console.log('');
    console.log('  ' + paint('Format', C.gray) + ': MZF-<payload>.<signature>');
    console.log('  ' + paint('Bantuan', C.gray) + ': minta key ke owner, lalu tempel di bawah.\n');

    for (let attempt = 1; attempt <= 3; attempt++) {
        const input = String(await question(paint('  Key [' + attempt + '/3]: ', C.cyan))).trim();
        if (!input) { console.log('  ' + paint('Key kosong, coba lagi.', C.yellow) + '\n'); continue; }
        r = lic.verifyKey(input);
        if (r.ok) {
            lic.saveKey(input);
            closeQuestion();
            printLicense(r, 'disimpan ke .license-key');
            return;
        }
        console.log('  ' + paint('✗ Ditolak', C.red) + '  ' + paint(r.message, C.gray) + '  [' + r.reason + ']\n');
    }

    closeQuestion();
    const until = lic.startCooldown();
    console.log(lineTop);
    console.log(center(paint('LISENSI GAGAL', C.bold + C.red)));
    console.log(row(paint('3 percobaan habis. Bot tidak dijalankan.', C.gray)));
    console.log(row(paint('Jeda 5 menit dimulai. Coba lagi setelah ' + fmtDuration(until - Date.now()) + '.', C.yellow)));
    console.log(lineBot);
    console.log('  ' + paint('Cara lain', C.gray) + ': node index.js --key <key>\n');
    process.exit(1);
}

// Gate async (bisa menunggu input console). Boot dijalankan setelah lolos.
const licenseReady = licenseGate().catch((err) => {
    console.error('\n  ' + paint('GAGAL MEMPROSES LISENSI: ' + (err.message || err), C.red) + '\n');
    process.exit(1);
});

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

/* ───────────── Boot (setelah lisensi lolos) ───────────── */
licenseReady.then(() => {
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
});
