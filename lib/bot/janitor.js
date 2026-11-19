/**
 * JANITOR — pembersih sampah menyeluruh (session lama, backup, kode mati, file sampah).
 *
 * Beda dengan cleaner.js (yang fokus ke sesi jadibot aktif + sender-key):
 * janitor menyapu hal-hal yang ditinggalkan migrasi & kerjaan sehari-hari.
 *
 * PRINSIP:
 *  - Default = DRY RUN. Tidak ada yang dihapus tanpa { apply: true }.
 *  - Yang "dihapus" sebenarnya DIPINDAH ke .cleanup-trash/<id>/ + manifest.json,
 *    jadi selalu bisa dikembalikan lewat restore().
 *  - Daftar PROTECTED tidak pernah disentuh (session_zapo, db.json aktif, dll).
 *  - Deteksi kode mati (orphan .js) BERSIFAT LAPORAN; tidak pernah auto-hapus
 *    kecuali pemanggil eksplisit meminta lewat opsi removeDeadCode.
 *
 * PEMAKAIAN:
 *   const janitor = require('./lib/bot/janitor');
 *   const preview = janitor.scan();                 // lihat apa yang bakal dibersihkan
 *   const result  = janitor.run({ apply: true });   // pindahkan ke trash
 *   janitor.restore();                              // kembalikan trash terakhir
 *   janitor.formatReport(result);                   // ringkasan teks untuk WhatsApp
 *
 * CLI: node scripts/cleanup.js [--scan|--apply|--restore|--aggressive]
 */
const fs = require('fs');
const path = require('path');
const { logInfo, logWarn, logError } = require('../core/logger');
const { formatBytes } = require('../core/utils');

const ROOT = path.join(__dirname, '..', '..');
const TRASH_ROOT = path.join(ROOT, '.cleanup-trash');
const DAY = 24 * 3600 * 1000;

/** Jalur yang TIDAK BOLEH pernah dipindahkan, apa pun opsinya. */
const PROTECTED = [
    'session_zapo', 'sessions_jadibot', 'database/db.json',
    'node_modules', '.perch', '.git', '.env', '.env.example',
    'index.js', 'config.js', 'package.json', 'package-lock.json',
    'ecosystem.config.js', 'README.md', '.cleanup-trash',
];

/* ───────────── util ───────────── */
function rel(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }

function sizeOf(p) {
    try {
        const st = fs.statSync(p);
        // Pakai blok teralokasi (st.blocks * 512) bila tersedia: itu ruang disk
        // yang benar-benar dibebaskan. Fallback ke st.size di platform tanpa blocks.
        const allocated = (st.blocks || 0) * 512;
        const own = Math.max(st.size, allocated);
        if (!st.isDirectory()) return own;
        return fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), own);
    } catch { return 0; }
}

function ageDays(p) {
    try { return (Date.now() - fs.statSync(p).mtimeMs) / DAY; } catch { return 0; }
}

function isProtected(target) {
    const r = rel(target);
    return PROTECTED.some((x) => r === x || r.startsWith(x + '/'));
}

/** Jelajahi pohon direktori; lewati node_modules, .git, trash. */
function walk(dir, visit, depth = 0) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.cleanup-trash') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { visit(p, rel(p), true); walk(p, visit, depth + 1); }
        else visit(p, rel(p), false);
    }
}

/* ───────────── aturan sampah ─────────────
 * Tiap rule: collect() → array path absolut kandidat; minAgeDays; label.
 * minAgeDays = umur minimal sebelum kandidat dianggap sampah.
 */
const RULES = [
    {
        id: 'legacySession',
        label: 'Sesi Baileys lama (runtime sudah pakai session_zapo)',
        minAgeDays: 0,
        collect() {
            // Hanya aman kalau sesi zapo aktif benar-benar ada.
            if (!fs.existsSync(path.join(ROOT, 'session_zapo', 'session.sqlite'))) return [];
            const p = path.join(ROOT, 'session');
            return fs.existsSync(p) ? [p] : [];
        },
    },
    {
        id: 'oldBackup',
        label: 'Folder backup lama',
        minAgeDays: 7,
        collect() {
            const d = path.join(ROOT, 'backups');
            if (!fs.existsSync(d)) return [];
            return fs.readdirSync(d)
                .map((n) => path.join(d, n))
                .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
        },
    },
    {
        id: 'backupZip',
        label: 'Arsip backup .zip',
        minAgeDays: 7,
        collect() {
            try {
                return fs.readdirSync(ROOT)
                    .filter((n) => /^Backup_Bot_.*\.zip$/i.test(n))
                    .map((n) => path.join(ROOT, n));
            } catch { return []; }
        },
    },
    {
        id: 'dbBackup',
        label: 'Backup / sisa database',
        minAgeDays: 2,
        collect() {
            const d = path.join(ROOT, 'database');
            if (!fs.existsSync(d)) return [];
            return fs.readdirSync(d)
                .filter((n) => /\.(bak|tmp|corrupt-\d+)$/i.test(n))
                .map((n) => path.join(d, n));
        },
    },
    {
        id: 'junk',
        label: 'File sampah (.orig, .old, .log, *~)',
        minAgeDays: 1,
        collect() {
            const out = [];
            walk(ROOT, (p, r, isDir) => {
                if (isDir) return;
                if (/\.(orig|old|log)$/i.test(r) || /~$/.test(r)) out.push(p);
            });
            return out;
        },
    },
];

/* ───────────── deteksi kode mati (report-only by default) ───────────── */
/**
 * Cari file .js di lib/, handler/, scripts/ dan root yang tidak direferensikan
 * oleh file lain lewat require/import. Plugin dilewati (dimuat dinamis oleh
 * pluginLoader). Hasilnya KANDIDAT, bisa false positive → perlu konfirmasi.
 */
function findDeadCode() {
    const scanDirs = ['lib', 'handler', 'scripts'];
    const files = [];
    for (const d of scanDirs) {
        walk(path.join(ROOT, d), (p, r, isDir) => {
            if (!isDir && p.endsWith('.js')) files.push(p);
        });
    }
    for (const f of ['index.js', 'config.js']) {
        const p = path.join(ROOT, f);
        if (fs.existsSync(p)) files.push(p);
    }

    // Kumpulkan semua teks sumber untuk mencari referensi nama file.
    const sources = [];
    walk(ROOT, (p, r, isDir) => {
        if (isDir || !p.endsWith('.js')) return;
        if (r.startsWith('node_modules/') || r.startsWith('.cleanup-trash/')) return;
        try { sources.push(fs.readFileSync(p, 'utf8')); } catch {}
    });
    const allText = sources.join('\n');

    const orphans = [];
    for (const f of files) {
        const base = path.basename(f, '.js');
        const r = rel(f);
        // Entry point & file yang dimuat lewat mekanisme dinamis dikenal aktif.
        if (['index', 'config'].includes(base)) continue;
        if (r.startsWith('scripts/')) continue; // script CLI dijalankan langsung
        if (r.startsWith('lib/web/public/')) continue; // frontend: dibundle jadi /panel/app.js atau <script src>
        // Cari segmen path "/base" di dalam string require/import. Path lokal
        // selalu mengandung '/' sebelum nama file (require('./lib/x/base')),
        // jadi ini menangkap semua bentuk: require('../base'), from './base.js',
        // import('./base'). Lebih aman false-positive daripada menghapus file aktif.
        const ref = new RegExp(`[/]${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.js)?['"]`, 'm');
        if (!ref.test(allText)) orphans.push({ path: r, bytes: sizeOf(f) });
    }
    return orphans;
}

/* ───────────── inti ───────────── */
/**
 * @param {{aggressive?: boolean, includeDeadCode?: boolean}} opts
 *   aggressive: umur minimal diabaikan (hati-hati; tetap masuk trash).
 *   includeDeadCode: sertakan kandidat orphan .js ke dalam daftar.
 */
function scan(opts = {}) {
    const report = {
        at: new Date().toISOString(),
        aggressive: !!opts.aggressive,
        items: [],
        deadCode: [],
        bytes: 0,
        protected: PROTECTED.slice(),
    };
    for (const rule of RULES) {
        const minAge = opts.aggressive ? 0 : rule.minAgeDays;
        for (const p of rule.collect()) {
            if (isProtected(p)) continue;
            const age = ageDays(p);
            if (age < minAge) continue;
            const bytes = sizeOf(p);
            report.items.push({
                id: rule.id,
                label: rule.label,
                path: rel(p),
                absolute: p,
                bytes,
                ageDays: Math.round(age * 10) / 10,
            });
            report.bytes += bytes;
        }
    }
    if (opts.includeDeadCode) report.deadCode = findDeadCode();
    return report;
}

/**
 * Jalankan pembersihan. Tanpa apply:true hanya sama dengan scan().
 * @param {{apply?: boolean, aggressive?: boolean, removeDeadCode?: boolean, label?: string}} opts
 */
function run(opts = {}) {
    const report = scan({ aggressive: opts.aggressive, includeDeadCode: !!opts.removeDeadCode });
    report.applied = false;
    if (!opts.apply) return report;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashId = `${stamp}${opts.label ? '-' + opts.label.replace(/[^\w-]/g, '') : ''}`;
    const trashDir = path.join(TRASH_ROOT, trashId);
    const manifest = { id: trashId, createdAt: new Date().toISOString(), entries: [] };

    try { fs.mkdirSync(trashDir, { recursive: true }); }
    catch (err) { report.error = 'Gagal buat folder trash: ' + err.message; return report; }

    let moved = 0;
    for (const item of report.items) {
        if (isProtected(item.absolute) || !fs.existsSync(item.absolute)) continue;
        const dest = path.join(trashDir, String(moved).padStart(3, '0') + '_' + path.basename(item.absolute));
        try {
            fs.renameSync(item.absolute, dest);
            manifest.entries.push({ from: item.path, to: path.relative(ROOT, dest), bytes: item.bytes, id: item.id });
            moved++;
        } catch (err) {
            logWarn('JANITOR', `Gagal pindahkan ${item.path}: ${err.message}`);
        }
    }

    // Kode mati: pindahkan juga bila diminta (masuk trash, bisa restore).
    if (opts.removeDeadCode) {
        for (const d of report.deadCode) {
            const abs = path.join(ROOT, d.path);
            if (isProtected(abs) || !fs.existsSync(abs)) continue;
            const dest = path.join(trashDir, String(moved).padStart(3, '0') + '_' + path.basename(abs));
            try {
                fs.renameSync(abs, dest);
                manifest.entries.push({ from: d.path, to: path.relative(ROOT, dest), bytes: d.bytes, id: 'deadCode' });
                moved++;
            } catch (err) { logWarn('JANITOR', `Gagal pindahkan kode mati ${d.path}: ${err.message}`); }
        }
    }

    manifest.moved = moved;
    manifest.bytes = manifest.entries.reduce((n, e) => n + e.bytes, 0);
    try { fs.writeFileSync(path.join(trashDir, 'manifest.json'), JSON.stringify(manifest, null, 2)); }
    catch (err) { logError('JANITOR', 'Gagal tulis manifest: ' + err.message); }

    report.applied = true;
    report.trashId = trashId;
    report.moved = moved;
    report.restoredBytes = manifest.bytes;
    report.deadCodeMoved = opts.removeDeadCode ? manifest.entries.filter((e) => e.id === 'deadCode').length : 0;
    logInfo('JANITOR', `Dipindahkan ${moved} item (${formatBytes(manifest.bytes)}) ke .cleanup-trash/${trashId}`);
    return report;
}

/** Kembalikan isi trash. Tanpa argumen → trash terakhir. */
function restore(trashId) {
    let dir = trashId ? path.join(TRASH_ROOT, path.basename(trashId)) : null;
    if (!dir) {
        try {
            const list = fs.readdirSync(TRASH_ROOT)
                .filter((n) => fs.existsSync(path.join(TRASH_ROOT, n, 'manifest.json')))
                .sort().reverse();
            if (!list.length) return { ok: false, message: 'Tidak ada trash untuk dikembalikan.' };
            dir = path.join(TRASH_ROOT, list[0]);
        } catch { return { ok: false, message: 'Tidak ada trash untuk dikembalikan.' }; }
    }
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
    catch (err) { return { ok: false, message: 'Manifest trash rusak: ' + err.message }; }

    let restored = 0, skipped = 0;
    for (const e of manifest.entries) {
        const from = path.join(ROOT, e.from);
        const to = path.join(ROOT, e.to);
        if (!fs.existsSync(to)) { skipped++; continue; }
        try {
            fs.mkdirSync(path.dirname(from), { recursive: true });
            if (fs.existsSync(from)) fs.rmSync(from, { recursive: true, force: true });
            fs.renameSync(to, from);
            restored++;
        } catch (err) { logWarn('JANITOR', `Gagal kembalikan ${e.from}: ${err.message}`); skipped++; }
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    return { ok: true, restored, skipped, trashId: manifest.id };
}

/** Daftar trash yang tersedia. */
function listTrash() {
    try {
        return fs.readdirSync(TRASH_ROOT)
            .filter((n) => fs.existsSync(path.join(TRASH_ROOT, n, 'manifest.json')))
            .map((n) => {
                const m = JSON.parse(fs.readFileSync(path.join(TRASH_ROOT, n, 'manifest.json'), 'utf8'));
                return { id: n, createdAt: m.createdAt, moved: m.moved, bytes: m.bytes };
            }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch { return []; }
}

/* ───────────── format laporan ───────────── */
function formatReport(r) {
    const L = [];
    if (r.applied) L.push(`🧹 *PEMBERSIHAN SELESAI* — trash: \`${r.trashId}\``);
    else L.push('🔍 *PRATINJAU PEMBERSIHAN* (belum ada yang dipindah)');
    L.push('');
    if (r.items?.length) {
        const byCat = {};
        for (const it of r.items) (byCat[it.label] ||= []).push(it);
        for (const [label, items] of Object.entries(byCat)) {
            L.push(`• *${label}* (${items.length})`);
            for (const it of items) L.push(`   – \`${it.path}\` — ${formatBytes(it.bytes)}${it.ageDays ? `, ${it.ageDays} hr` : ''}`);
        }
    }
    if (r.deadCode?.length) {
        L.push('');
        L.push(`⚠️ *Kandidat kode mati* (${r.deadCode.length}) — perlu konfirmasi, tidak dihapus otomatis:`);
        for (const d of r.deadCode.slice(0, 15)) L.push(`   – \`${d.path}\``);
        if (r.deadCode.length > 15) L.push(`   … dan ${r.deadCode.length - 15} lagi`);
    }
    if (!r.items?.length && !r.deadCode?.length) L.push('✨ Tidak ada sampah yang memenuhi kriteria.');
    L.push('');
    L.push(`💾 ${r.applied ? 'Dipindah ke trash' : 'Bisa dibebaskan'}: *${formatBytes(r.applied ? r.restoredBytes : r.bytes)}*`);
    if (r.applied) L.push('_Pulihkan dengan: janitor.restore() atau .bersih restore_');
    return L.join('\n');
}

module.exports = {
    scan, run, restore, listTrash, findDeadCode, formatReport,
    ROOT, TRASH_ROOT, PROTECTED,
};
