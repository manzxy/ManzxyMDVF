const readline = require('readline');
const fs = require('fs');
const path = require('path');

/* ── License gate. Jalan SEBELUM modul lain. ──
 * Alur: owner buat key → kasih ke user → user tempel di console saat start.
 *   --fingerprint        → tampilkan fingerprint, keluar (buat minta key)
 *   --key <key>          → pakai key dari argumen (PM2/systemd), simpan, lanjut
 *   key di env/.license-key → lanjut
 *   belum ada key        → TANYA di console, verifikasi, simpan, lanjut
 */
const lic = require('./lib/core/license');

let _licenseRl = null;
const question = (text) => new Promise((resolve) => {
    if (!_licenseRl) _licenseRl = readline.createInterface({ input: process.stdin, output: process.stdout });
    _licenseRl.question(text, (ans) => resolve(ans));
});
const closeQuestion = () => { try { _licenseRl?.close(); } catch {} _licenseRl = null; };

function printLicense(r) {
    console.log(`\n  🔐 Lisensi aktif — ${r.payload?.c || 'customer'} (${r.payload?.t || 'free'})`);
    console.log(`     ID: ${r.payload?.j || '-'} | Berlaku s/d: ${r.payload?.e ? new Date(r.payload.e).toISOString() : 'selamanya'}\n`);
}

async function licenseGate() {
    if (process.argv.includes('--fingerprint')) {
        console.log('\n  Fingerprint mesin ini:');
        console.log('  ' + lic.displayFingerprint());
        console.log('  Kirim ke owner untuk dibuatkan license key.\n');
        process.exit(0);
    }

    // 1. Argumen --key <key> (dipakai PM2 / systemd / docker)
    const keyArgIdx = process.argv.indexOf('--key');
    if (keyArgIdx !== -1 && process.argv[keyArgIdx + 1]) {
        const r = lic.verifyKey(process.argv[keyArgIdx + 1].trim());
        if (!r.ok) {
            console.error(`\n  ⛔ LICENSE KEY DITOLAK [${r.reason}]: ${r.message}`);
            console.error('  Cek key dari owner, atau lihat fingerprint: node index.js --fingerprint\n');
            process.exit(1);
        }
        lic.saveKey(process.argv[keyArgIdx + 1].trim());
        printLicense(r);
        return;
    }

    // 2. Key dari env / file yang tersimpan
    let r = lic.check();
    if (r.ok) { printLicense(r); return; }

    // 3. Kalau ada key lama tapi invalid/expired, beri tahu dulu
    const stored = process.env.MZ_LICENSE_KEY || lic.readKeyFile();
    if (stored) {
        console.error(`\n  ⚠️  Key tersimpan tidak aktif [${r.reason}]: ${r.message}`);
    }

    // 4. Minta key lewat console
    console.log('\n  ─────────────────────────────────────────────────────────');
    console.log('  🔑 MANZXYMD FREE — BUTUH LICENSE KEY');
    console.log('  Belum ada key aktif. Masukkan license key dari owner.');
    console.log('  Fingerprint mesin ini: ' + lic.displayFingerprint());
    console.log('  (Kirim fingerprint ke owner bila belum punya key)');
    console.log('  ─────────────────────────────────────────────────────────');

    for (let attempt = 1; attempt <= 3; attempt++) {
        const input = String(await question(`  License key (percobaan ${attempt}/3): `)).trim();
        if (!input) { console.log('  Key kosong.\n'); continue; }
        r = lic.verifyKey(input);
        if (r.ok) {
            lic.saveKey(input);
            closeQuestion();
            console.log('  ✅ Key valid. Tersimpan di .license-key\n');
            printLicense(r);
            return;
        }
        console.error(`  ❌ Ditolak [${r.reason}]: ${r.message}\n`);
    }

    closeQuestion();
    console.error('\n  ⛔ 3x gagal — bot tidak dijalankan.');
    console.error('  Dapatkan key dari owner, lalu jalankan: node index.js --key <key>\n');
    process.exit(1);
}

// Gate async (bisa menunggu input console). Boot dijalankan setelah lolos.
const licenseReady = licenseGate().catch((err) => {
    console.error('\n  ⛔ GAGAL MEMPROSES LISENSI:', err.message || err);
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
