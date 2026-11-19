/**
 * LOGGER — tampilan console VPS yang profesional.
 *
 * Prinsip desain:
 *  - Satu palet warna konsisten (indigo/cyan sebagai brand, warna semantik untuk status).
 *  - Tag modul sebagai badge berwarna + ikon status → mudah dipindai mata.
 *  - Kotak info rounded dengan kolom label yang rata.
 *  - Command log ringkas satu baris (bukan kotak besar) → console tetap bersih saat ramai.
 *
 * PENTING: format baris tetap `[HH:MM:SS] TAG       pesan` — Live Log di panel web
 * (lib/web/logbus.js) mengandalkan pola ini untuk menampilkan badge tag.
 */
const chalk = require('chalk');
const os = require('os');
const config = require('../../config');
const { clock, runtime } = require('./utils');

/* ───────────────────────── palet warna ───────────────────────── */

const C = {
    brand: chalk.hex('#818cf8'),      // indigo terang — identitas bot
    cyan: chalk.hex('#22d3ee'),
    dim: chalk.hex('#64748b'),
    ok: chalk.hex('#34d399'),
    warn: chalk.hex('#fbbf24'),
    err: chalk.hex('#f87171'),
    info: chalk.hex('#7dd3fc'),
    key: chalk.hex('#94a3b8'),
    val: chalk.hex('#e2e8f0'),
    accent: chalk.hex('#f472b6'),
    white: chalk.hex('#f8fafc'),
};

/** Warna badge per tag modul — fallback otomatis untuk tag tak dikenal. */
const TAG_COLORS = {
    MAIN: C.brand, START: C.cyan, SHUTDOWN: C.err, CONFIG: chalk.hex('#a78bfa'),
    KONEKSI: C.cyan, PAIRING: C.warn, JADIBOT: C.accent, WEB: C.brand, WEBDB: chalk.hex('#a78bfa'),
    WEBAUTH: C.brand, WEBGUARD: C.warn, PAYMENT: C.ok, SEWA: C.ok, RENTAL: C.ok, RENEWAL: C.ok,
    PLUGINS: chalk.hex('#a78bfa'), PLUGIN: chalk.hex('#a78bfa'), DB: chalk.hex('#a78bfa'),
    GUARD: C.err, VERSI: C.cyan, SCHEDULER: C.cyan, HANDLER: C.info, QUEUE: C.warn,
    REFERRAL: C.ok, OTP: C.warn, BACKUP: C.info, MSG: C.dim, CMD: C.ok, ANTICALL: C.err,
};
const tagColor = (t) => TAG_COLORS[String(t || '').toUpperCase()] || C.info;

/* ───────────────────────── banner ───────────────────────── */

const ART = [
    String.raw` __  __    _    _   _ _____  __   ____   __`,
    String.raw`|  \/  |  / \  | \ | |__  /  \ \ / /\ \ / /`,
    String.raw`| |\/| | / _ \ |  \| | / /    \ V /  \ V / `,
    String.raw`| |  | |/ ___ \| |\  |/ /_     | |    | |  `,
    String.raw`|_|  |_/_/   \_\_| \_/____|   |_|    |_|  `,
];
const GRADIENT = ['#f472b6', '#a78bfa', '#818cf8', '#38bdf8', '#22d3ee'];

const ramMB = () => (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
const bar = (n) => '─'.repeat(n);

/** Cetak kotak info rounded dengan border rata. rows = [[label, value, colorFn?]]
 *  Nilai yang panjang otomatis dilipat ke beberapa baris (kotak tetap ramping). */
function box(title, rows, color = C.brand) {
    const labelW = Math.max(...rows.map((r) => String(r[0]).length));
    const maxVal = Math.max(12, 66 - 6 - labelW);          // batas lebar kotak ±70 kolom
    const wrap = (v) => {
        const words = String(v).split(/\s+/);
        const lines = [];
        let cur = '';
        for (const w of words) {
            if (cur && (cur + ' ' + w).length > maxVal) { lines.push(cur); cur = w; }
            else cur = cur ? cur + ' ' + w : w;
        }
        if (cur) lines.push(cur);
        return lines.length ? lines : [''];
    };
    const valW = Math.max(...rows.flatMap(([, v]) => wrap(v).map((l) => l.length)));
    // lebar total = kolom isi (1+labelW+3+valW) + margin kanan 2
    const width = Math.max(title.length + 6, labelW + valW + 6) + 2;
    console.log(color(`╭─ ${chalk.bold(title)} ${bar(Math.max(2, width - title.length - 5))}╮`));
    rows.forEach(([k, v, fn]) => {
        wrap(v).forEach((part, i) => {
            const label = i === 0 ? String(k) : '';
            const content = ` ${C.key(label.padEnd(labelW))} ${C.dim(i === 0 ? '·' : ' ')} ${(fn || C.val)(part)}`;
            const pad = Math.max(0, width - 6 - labelW - part.length);
            console.log(color('│') + content + ' '.repeat(pad) + color('│'));
        });
    });
    console.log(color(`╰${bar(width - 2)}╯`));
}

function printBanner(info = {}) {
    if (config.console.clear && !info.keepScreen) console.clear();
    console.log('');
    ART.forEach((line, i) => console.log('  ' + chalk.hex(GRADIENT[i % GRADIENT.length]).bold(line)));
    console.log('');
    console.log('  ' + C.brand.bold(config.botName) + C.dim(`  v${config.version}`));
    console.log('  ' + C.dim('WhatsApp Bot • Jadibot Ready • Panel Web'));
    console.log('');
    box('SYSTEM', [
        ['Bot', `${config.botName} v${config.version}`, C.brand.bold],
        ['Node.js', process.version],
        ['zapo-js', info.waVersion ? `v${info.waVersion}` : '-', C.warn],
        ['Platform', `${os.platform()} ${os.arch()} • ${os.cpus().length} CPU`],
        ['RAM Bot', `${ramMB()} MB`, C.ok],
        ['RAM VPS', `${((os.totalmem() - os.freemem()) / 1073741824).toFixed(2)} / ${(os.totalmem() / 1073741824).toFixed(2)} GB`],
        ['PID', String(process.pid)],
        ['Zona Waktu', config.timezone],
    ]);
    box('KONFIGURASI', [
        ['Mode', config.selfMode ? 'SELF (pribadi)' : 'PUBLIC (umum)', config.selfMode ? C.ok : C.warn],
        ['Login', info.pairing ? 'Pairing Code' : 'QR Code'],
        ['Prefix', config.multiPrefix ? config.prefixes.join('  ') : config.prefix],
        ['Jadibot', config.jadibot.enabled ? `ON (maks ${config.jadibot.max}, auto-restore ${config.jadibot.autoRestore ? 'ON' : 'OFF'})` : 'OFF'],
        ['Pairing Brand', config.customPairingCode || 'acak'],
        ['Root Owner', config.ownerNumber.join(', ')],
    ], C.accent);
    console.log('');
}

/** Ringkasan setelah bot terhubung. */
function printReady({ user, plugins, categories, commands, jadibots, dbStats }) {
    box('BOT ONLINE', [
        ['Akun', user, C.ok.bold],
        ['Plugin', `${plugins} file • ${commands} command`],
        ['Kategori', categories.map((c) => `${c.name}(${c.count})`).join('  ')],
        ['Jadibot', `${jadibots} sesi aktif`],
        ['Database', `${dbStats.users} user • ${dbStats.groups} grup • ${dbStats.jadibots} jadibot`],
        ['Waktu', `${clock()} ${config.timezone}`],
    ], C.ok);
    console.log(C.dim('  Menunggu pesan masuk…') + C.dim(`  (RAM ${ramMB()} MB)\n`));
}

/* ───────────────────────── baris log ───────────────────────── */

const ICONS = { info: '·', success: '✔', warn: '⚠', error: '✖', debug: '…' };

function stamp() { return C.dim(`[${clock()}]`); }

/** Badge tag berwarna, lebar tetap 10 karakter. */
function tag(label, color) {
    const t = String(label || '').toUpperCase().slice(0, 10);
    return color.bold(` ${t.padEnd(10)} `);
}

function line(level, t, msg) {
    const icon = C.dim(ICONS[level] || '·');
    console.log(`${stamp()} ${tag(t, tagColor(t))} ${icon} ${msg}`);
}

function logInfo(t, msg) { line('info', t, C.val(msg)); }
function logSuccess(t, msg) { line('success', t, C.ok(msg)); }
function logWarn(t, msg) { line('warn', t, C.warn(msg)); }
function logDebug(t, msg) { if (config.console.debug) line('debug', t, C.dim(msg)); }

function logError(t, errOrMsg) {
    const msg = errOrMsg instanceof Error ? errOrMsg.message : String(errOrMsg);
    line('error', t, C.err.bold(msg));
    if (config.console.stack && errOrMsg instanceof Error && errOrMsg.stack) {
        errOrMsg.stack.split('\n').slice(1, 4).forEach((l) => console.log(C.dim('             ' + l.trim())));
    }
}

/** Satu baris untuk semua pesan (aktifkan lewat config.console.logAllMessages). */
function logMessage({ pushname, senderNumber, isGroup, groupName, mtype, body, botLabel }) {
    if (!config.console.logAllMessages) return;
    const where = isGroup ? C.accent(groupName || 'Grup') : C.info('Private');
    const text = String(body || '').replace(/\s+/g, ' ').slice(0, 60);
    console.log(
        `${stamp()} ${tag('MSG', tagColor('MSG'))} ${C.val(pushname)}${C.dim(`(${senderNumber})`)} ` +
        `${C.dim('→')} ${where} ${C.dim(`[${mtype}]`)} ${C.dim(text)}${botLabel ? '  ' + C.dim(botLabel) : ''}`
    );
}

/** Command log ringkas satu baris — console tetap bersih saat bot ramai. */
function logCommand({ command, prefix, args = [], pushname, senderNumber, isGroup, groupName, isOwner, botLabel, execTime, mtype, status = 'OK', queue = 0 }) {
    if (!config.console.logCommands) return;
    const ok = status === 'OK';
    const icon = ok ? C.ok('✔') : C.err('✖');
    const role = isOwner ? chalk.bgHex('#818cf8').black('OWNER') : '';
    const where = isGroup ? C.accent(groupName || 'Grup') : C.info('Private');
    const argText = args.length ? C.dim(' ' + args.join(' ').slice(0, 40)) : '';
    console.log(
        `${stamp()} ${tag('CMD', ok ? C.ok : C.err)} ${icon} ${C.brand.bold(`${prefix}${command}`)}${argText} ` +
        `${C.dim('•')} ${C.val(pushname)}${role ? ' ' + role : ''} ${C.dim(`(${senderNumber})`)} ` +
        `${C.dim('•')} ${where} ${C.dim('•')} ${C.val(`${execTime}ms`)} ${C.dim(`• RAM ${ramMB()} MB${queue ? ` • antrean ${queue}` : ''}`)}` +
        `${botLabel && botLabel !== 'MAIN' ? ` ${C.dim(botLabel)}` : ''}`
    );
}

const DISCONNECT_REASONS = {
    400: 'Bad Request', 401: 'Logged Out', 403: 'Forbidden', 408: 'Connection Lost / Timed Out',
    411: 'Multi-device Mismatch', 428: 'Connection Closed', 440: 'Connection Replaced',
    500: 'Bad Session', 503: 'Unavailable Service', 515: 'Restart Required',
};
const reasonName = (code) => DISCONNECT_REASONS[code] || 'Unknown';

module.exports = {
    C, box, printBanner, printReady, logCommand, logMessage, logInfo, logSuccess, logWarn, logError, logDebug,
    reasonName, runtime,
};
