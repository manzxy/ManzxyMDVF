/**
 * PEMBERSIH SAMPAH — dipakai `.sampah` (manual) dan berjalan otomatis berkala (config.cleaner).
 *
 * Yang dibersihkan (semuanya aman dibuat ulang / memang sudah tidak terpakai):
 *   1. Sesi jadibot setengah jadi (pairing tidak selesai)
 *   2. Sesi jadibot yatim (tidak ada datanya di database) setelah config.cleaner.orphanSessionDays hari
 *   3. Sesi jadibot kedaluwarsa SETELAH masa tenggang lewat (+ data di database)
 *   4. Data jadibot di database yang sesinya sudah tidak ada
 *   5. File sender-key lama (bot utama & jadibot)
 *   6. Sisa lama: folder backup_plugins, db.json.tmp, db.json.corrupt-*
 * TIDAK pernah menghapus: sesi yang sedang aktif, sesi dalam masa tenggang, session-* / pre-key-* (kunci enkripsi aktif).
 */
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const db = require('../data/database');
const { logInfo, logWarn, logError } = require('../core/logger');
const { formatBytes } = require('../core/utils');

const ROOT = path.join(__dirname, '..', '..');
const JADIBOT_DIR = path.join(ROOT, 'sessions_jadibot');
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const PAIRING_GRACE = 10 * 60 * 1000;

/* ───────────── util file ───────────── */
function sizeOf(p) {
    try {
        const st = fs.statSync(p);
        if (!st.isDirectory()) return st.size;
        return fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0);
    } catch { return 0; }
}

/** Waktu ubah terbaru di dalam folder (ms). */
function lastTouched(p) {
    try {
        const st = fs.statSync(p);
        if (!st.isDirectory()) return st.mtimeMs;
        return fs.readdirSync(p).reduce((t, f) => Math.max(t, lastTouched(path.join(p, f))), st.mtimeMs);
    } catch { return 0; }
}

const remove = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch (err) { logWarn('CLEANER', `Gagal hapus ${p}: ${err.message}`); return false; } };

const graceMs = () => (config.renewal?.enabled ? Number(config.renewal.graceHours || 0) * HOUR : 0);

function readCreds(folder) {
    try { return JSON.parse(fs.readFileSync(path.join(folder, 'creds.json'), 'utf8')); } catch { return null; }
}

/* ───────────── inti ───────────── */
/**
 * @param {{dryRun?: boolean}} opts  dryRun: hanya hitung, tidak menghapus
 * @returns {{dryRun, jadibot: Array, records: Array, senderKeys: {n, bytes}, legacy: Array, bytes: number}}
 */
function run({ dryRun = false } = {}) {
    const cfg = config.cleaner || {};
    const now = Date.now();
    const report = { dryRun, jadibot: [], records: [], senderKeys: { n: 0, bytes: 0 }, legacy: [], bytes: 0 };
    let active = new Set();
    try { active = new Set(require('./jadibotManager').jadibotSessions.keys()); } catch { /* jadibotManager belum dimuat */ }
    const records = db.data?.jadibots || {};
    const grace = graceMs();

    /* 1-3. folder sesi jadibot */
    if (fs.existsSync(JADIBOT_DIR)) {
        for (const num of fs.readdirSync(JADIBOT_DIR)) {
            if (!/^\d{8,15}$/.test(num) || active.has(num)) continue;
            const folder = path.join(JADIBOT_DIR, num);
            let reason = '';
            const creds = readCreds(folder);
            const rec = records[num];
            const idle = now - lastTouched(folder);

            if (!creds?.registered && idle > PAIRING_GRACE) reason = 'pairing tidak selesai';
            else if (!rec && idle > Number(cfg.orphanSessionDays || 3) * DAY) reason = 'yatim (tidak ada di database)';
            else if (rec?.expire && rec.expire + grace < now) reason = 'kedaluwarsa (lewat masa tenggang)';
            if (!reason) continue;

            const bytes = sizeOf(folder);
            report.jadibot.push({ number: num, reason, bytes });
            report.bytes += bytes;
            if (!dryRun && remove(folder)) {
                if (rec && reason !== 'yatim (tidak ada di database)') db.removeJadibot(num);
            }
        }
    }

    /* 4. data jadibot tanpa sesi */
    for (const [num, rec] of Object.entries(records)) {
        if (active.has(num)) continue;
        const folder = path.join(JADIBOT_DIR, num);
        const folderGone = !fs.existsSync(folder) || (dryRun && report.jadibot.some((j) => j.number === num));
        if (!folderGone) continue;
        const dead = ['closed', 'failed', 'expired'].includes(rec.status) || (rec.status === 'pairing' && now - (rec.createdAt || 0) > PAIRING_GRACE);
        if (!dead) continue;
        if (!report.records.includes(num)) report.records.push(num);
        if (!dryRun) db.removeJadibot(num);
    }

    /* 5. sender-key lama */
    const dirs = [path.join(ROOT, config.sessionName)];
    if (fs.existsSync(JADIBOT_DIR)) for (const d of fs.readdirSync(JADIBOT_DIR)) dirs.push(path.join(JADIBOT_DIR, d));
    const maxAge = Number(cfg.senderKeyHours || 24) * HOUR;
    for (const dir of dirs) {
        let files = [];
        try { files = fs.readdirSync(dir); } catch { continue; }
        for (const f of files) {
            if (!f.startsWith('sender-key-')) continue;
            const p = path.join(dir, f);
            try {
                const st = fs.statSync(p);
                if (now - st.mtimeMs <= maxAge) continue;
                report.senderKeys.n++; report.senderKeys.bytes += st.size; report.bytes += st.size;
                if (!dryRun) fs.unlinkSync(p);
            } catch { /* abaikan */ }
        }
    }

    /* 6. sisa lama */
    const legacyBackup = path.join(ROOT, 'backup_plugins');
    if (fs.existsSync(legacyBackup)) {
        const bytes = sizeOf(legacyBackup);
        report.legacy.push({ name: 'backup_plugins/', bytes }); report.bytes += bytes;
        if (!dryRun) remove(legacyBackup);
    }
    const dbDir = path.dirname(path.resolve(ROOT, config.database.path));
    if (fs.existsSync(dbDir)) {
        for (const f of fs.readdirSync(dbDir)) {
            const p = path.join(dbDir, f);
            const old = (ms) => now - fs.statSync(p).mtimeMs > ms;
            try {
                if ((/\.tmp$/.test(f) && old(HOUR)) || (/\.corrupt-\d+$/.test(f) && old(7 * DAY))) {
                    const bytes = sizeOf(p);
                    report.legacy.push({ name: `database/${f}`, bytes }); report.bytes += bytes;
                    if (!dryRun) fs.unlinkSync(p);
                }
            } catch { /* abaikan */ }
        }
    }
    return report;
}

const isEmpty = (r) => !r.jadibot.length && !r.records.length && !r.senderKeys.n && !r.legacy.length;

/** Ringkasan teks (WhatsApp). */
function formatReport(r) {
    if (isEmpty(r)) return '✨ Tidak ada sampah yang perlu dibersihkan.';
    const L = [];
    if (r.jadibot.length) L.push(`🤖 *Sesi jadibot* (${r.jadibot.length})`, ...r.jadibot.map((j) => `   • +${j.number} — ${j.reason} (${formatBytes(j.bytes)})`));
    if (r.records.length) L.push(`🗄️ *Data jadibot tanpa sesi* (${r.records.length})`, ...r.records.map((n) => `   • +${n}`));
    if (r.senderKeys.n) L.push(`🔑 *Sender-key lama:* ${r.senderKeys.n} file (${formatBytes(r.senderKeys.bytes)})`);
    if (r.legacy.length) L.push(`📦 *Sisa lama:*`, ...r.legacy.map((x) => `   • ${x.name} (${formatBytes(x.bytes)})`));
    L.push(`\n💾 Total ${r.dryRun ? 'bisa dibebaskan' : 'dibebaskan'}: *${formatBytes(r.bytes)}*`);
    return L.join('\n');
}

/* ───────────── otomatis ───────────── */
let first = null, loop = null;

function runAuto() {
    try {
        const r = run();
        if (!isEmpty(r)) logInfo('CLEANER', `Dibersihkan: ${r.jadibot.length} sesi jadibot, ${r.records.length} data, ${r.senderKeys.n} sender-key, ${r.legacy.length} sisa lama (${formatBytes(r.bytes)})`);
    } catch (err) { logError('CLEANER', err); }
}

function start() {
    const cfg = config.cleaner || {};
    if (!cfg.auto || loop || first) return;
    first = setTimeout(() => { first = null; runAuto(); }, 10 * 60 * 1000);       // 10 menit setelah bot nyala
    loop = setInterval(runAuto, Math.max(1, Number(cfg.intervalHours || 6)) * HOUR);
    for (const t of [first, loop]) if (t.unref) t.unref();
}

function stop() { clearTimeout(first); clearInterval(loop); first = loop = null; }

module.exports = { run, formatReport, isEmpty, start, stop };
