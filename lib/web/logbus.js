/**
 * LOGBUS — menangkap output console bot ke ring buffer + langganan realtime.
 * Dipakai Live Log Viewer di web panel (khusus owner). Tanpa dependency:
 * murni membungkus console.log/info/warn/error bawaan.
 *
 * - Baris disimpan BERSIH dari kode warna ANSI (chalk) supaya enak dibaca di web.
 * - Buffer maks 500 baris terakhir; pelanggan SSE menerima baris baru seketika.
 */
const MAX_LINES = 500;
const ANSI = /\x1B\[[0-9;]*[A-Za-z]/g;

const ring = [];
const subs = new Set();
let installed = false;

const counts = { info: 0, warn: 0, error: 0 };

function toText(args) {
    return args.map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
        try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ').replace(ANSI, '').replace(/\s+$/, '');
}

/**
 * Parse baris log bergaya logger.js: `[HH:MM:SS] TAG       pesan`.
 * Tag adalah kata kapital yang di-pad 10 karakter (tag() di lib/logger.js).
 * Kembalikan { tag, msg } atau null bila bukan baris ber-tag.
 */
const TAG_RE = /^\[(\d{1,2}:\d{2}:\d{2})\]\s+([A-Z][A-Z0-9 ]{1,9})\s{2,}(\S.*)$/;
function parseTag(text) {
    const m = TAG_RE.exec(text);
    if (!m) return null;
    return { tag: m[2].trim(), msg: m[3] };
}

function push(level, args) {
    const text = toText(args);
    if (!text) return;
    const parsed = parseTag(text);
    const entry = { t: Date.now(), level, text: text.slice(0, 2000) };
    if (parsed) { entry.tag = parsed.tag; entry.msg = parsed.msg.slice(0, 1800); }
    ring.push(entry);
    if (ring.length > MAX_LINES) ring.shift();
    if (counts[level] !== undefined) counts[level]++;
    for (const fn of subs) {
        try { fn(entry); } catch { /* pelanggan nakal — abaikan */ }
    }
}

/** Pasang hook sekali di awal (dipanggil dari server.start()). */
function install() {
    if (installed) return;
    installed = true;
    for (const method of ['log', 'info', 'warn', 'error']) {
        const orig = console[method].bind(console);
        const level = method === 'log' ? 'info' : method;
        console[method] = (...args) => {
            try { push(level, args); } catch { /* jangan pernah ganggu bot */ }
            orig(...args);
        };
    }
}

/** N baris terakhir (terlama → terbaru). */
function recent(limit = 200) {
    const n = Math.max(1, Math.min(MAX_LINES, Number(limit) || 200));
    return ring.slice(-n);
}

/** Langganan baris baru; kembalikan fungsi berhenti. */
function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
}

const subscriberCount = () => subs.size;
const stats = () => ({ lines: ring.length, subscribers: subs.size, ...counts });

module.exports = { install, recent, subscribe, subscriberCount, stats };
