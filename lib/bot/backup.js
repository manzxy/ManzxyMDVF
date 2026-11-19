/**
 * lib/backup.js — backup otomatis database (JSON + gzip, tanpa dependency eksternal).
 * Snapshot harian di folder backups/, maks BACKUP_KEEP file. Dipanggil dari web.start().
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('../data/database');
const { logInfo, logSuccess, logError } = require('../core/logger');

const BACKUP_KEEP = 7;
const BACKUP_EVERY_MS = 24 * 3600 * 1000;   // 24 jam
const dir = path.join(process.cwd(), 'backups');

let timer = null;

function ensureDir() {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function fileName(ts = Date.now()) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `db-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json.gz`;
}

/** Buat snapshot sekarang. Return path file. */
function create() {
    ensureDir();
    const json = JSON.stringify(db.data || {});
    const out = path.join(dir, fileName());
    fs.writeFileSync(out, zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 6 }));
    prune();
    return out;
}

/** Hapus snapshot lama, sisakan BACKUP_KEEP terbaru. */
function prune() {
    try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort();
        for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
            try { fs.unlinkSync(path.join(dir, f)); } catch {}
        }
    } catch {}
}

/** Daftar snapshot: [{file, size, atText}] terbaru dulu. */
function list() {
    ensureDir();
    const { formatDateTime } = require('../core/utils');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort().reverse().map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { file: f, size: st.size, sizeText: st.size > 1048576 ? (st.size / 1048576).toFixed(1) + ' MB' : Math.round(st.size / 1024) + ' KB', atText: formatDateTime(new Date(st.mtime)) };
    });
}

/** Baca snapshot jadi Buffer (untuk download). */
function read(file) {
    const safe = path.basename(String(file || ''));
    return fs.readFileSync(path.join(dir, safe));
}

function start() {
    if (timer) return;
    ensureDir();
    timer = setInterval(() => {
        try {
            const files = list();
            const newest = files[0];
            const fresh = newest && (Date.now() - new Date(newest.atText).getTime() < BACKUP_EVERY_MS);
            if (fresh) return;
            const f = create();
            logSuccess('BACKUP', `Snapshot database tersimpan: ${path.basename(f)}`);
        } catch (e) { logError('BACKUP', `Gagal backup: ${e.message}`); }
    }, 60 * 60 * 1000);   // cek tiap jam; backup bila snapshot terakhir > 24 jam
    if (timer.unref) timer.unref();
    // backup pertama saat boot (kalau belum ada snapshot segar)
    try {
        const files = list();
        if (!files.length) { create(); logInfo('BACKUP', 'Snapshot awal dibuat saat boot.'); }
    } catch {}
}

module.exports = { start, create, list, read, dir };
