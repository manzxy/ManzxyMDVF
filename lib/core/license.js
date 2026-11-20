/**
 * ManzxyMD Free — License Verifier (Ed25519, HARD gate)
 * ------------------------------------------------------------------
 * Edisi gratis HANYA bisa dijalankan dengan license key yang diterbitkan
 * oleh owner (ManzxyBase). Tanpa key valid → bot berhenti.
 *
 * Verifikasi memakai PUBLIC KEY milik penerbit yang ditanam di
 * .license-public.pem. Private key TIDAK ADA di edisi ini, sehingga user
 * tidak bisa membuat/meniru key sendiri.
 *
 * Jenis key (payload.k):
 *   - shared     → bisa dipakai banyak bot/user (rame-rame)
 *   - individual → terkunci otomatis di mesin pertama yang memakainya.
 *                  Lock disimpan lokal di .license-lock.json. Tidak perlu
 *                  mengirim fingerprint ke owner.
 *
 * Cooldown: setelah 3x input key salah, .license-fail.json menyimpan
 * waktu sampai 5 menit ke depan. Selama cooldown, bot menolak start.
 *
 * Key dibaca dari:
 *   1. process.env.MZ_LICENSE_KEY
 *   2. file .license-key (diisi otomatis saat input di console / .setkey)
 *
 * Pencabutan: owner mencabut key lewat .delkey di bot penerbit; daftar ID
 * yang dicabut disalin ke .license-revoked.json di sini (atau diisi manual).
 *
 * CLI: node scripts/license.js <perintah>
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'MZF-';
const ROOT = path.join(__dirname, '..', '..');
const KEY_FILE = path.join(ROOT, '.license-key');
const PUB_FILE = path.join(ROOT, '.license-public.pem');
const REVOKED_FILE = path.join(ROOT, '.license-revoked.json');
const LOCK_FILE = path.join(ROOT, '.license-lock.json');
const FAIL_FILE = path.join(ROOT, '.license-fail.json');

const COOLDOWN_MS = 5 * 60 * 1000; // 5 menit setelah 3x salah

/* ─────────────── Public key ─────────────── */

function loadPublicKey() {
    try {
        if (fs.existsSync(PUB_FILE)) return fs.readFileSync(PUB_FILE, 'utf8');
    } catch {}
    return null;
}

/* ─────────────── Machine ID lokal (untuk lock individual) ─────────────── */

function machineId() {
    const parts = [];
    try {
        const id = fs.readFileSync('/etc/machine-id', 'utf8').trim();
        if (id) parts.push('mid:' + id);
    } catch {}
    parts.push('host:' + os.hostname());
    try {
        const macs = Object.values(os.networkInterfaces())
            .flat()
            .filter((n) => n && n.mac && !/^(00:00:00:00:00:00|.*:00:00)$/.test(n.mac))
            .map((n) => n.mac.toLowerCase());
        if (macs.length) parts.push('mac:' + [...new Set(macs)].sort().join(','));
    } catch {}
    parts.push('plat:' + process.platform + '/' + process.arch);
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/* ─────────────── Key storage ─────────────── */

function readKeyFile() {
    try { return fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : null; }
    catch { return null; }
}

function saveKey(key) {
    const clean = String(key || '').trim();
    if (!clean) throw new Error('Key tidak boleh kosong.');
    fs.writeFileSync(KEY_FILE, clean + '\n', { mode: 0o600 });
    return true;
}

function clearKey() {
    try { if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE); } catch {}
    return true;
}

function loadRevoked() {
    try {
        if (fs.existsSync(REVOKED_FILE)) {
            const v = JSON.parse(fs.readFileSync(REVOKED_FILE, 'utf8'));
            return Array.isArray(v) ? v.map(String) : [];
        }
    } catch {}
    return [];
}

/* ─────────────── Lock individual ─────────────── */

function loadLocks() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const v = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
            return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
        }
    } catch {}
    return {};
}

function saveLocks(locks) {
    fs.writeFileSync(LOCK_FILE, JSON.stringify(locks, null, 2) + '\n', { mode: 0o600 });
    return true;
}

/** Cek & pasang lock untuk key individual. Dipanggil saat verifikasi sukses. */
function checkIndividualLock(payload, { mid = machineId(), autoLock = true } = {}) {
    if (payload.k !== 'individual') return { ok: true };
    const id = String(payload.j || '');
    if (!id) return { ok: true };
    const locks = loadLocks();
    const locked = locks[id];
    if (locked && String(locked.mid) !== String(mid)) {
        return {
            ok: false,
            reason: 'DEVICE_LOCKED',
            message: 'Key individual sudah terpakai di mesin lain. Minta key baru ke owner.'
        };
    }
    if (!locked && autoLock) {
        locks[id] = { mid: String(mid), at: Date.now(), customer: payload.c || '' };
        saveLocks(locks);
    }
    return { ok: true, locked: !locked };
}

function releaseLock(keyId) {
    const locks = loadLocks();
    if (locks[String(keyId)]) {
        delete locks[String(keyId)];
        saveLocks(locks);
        return true;
    }
    return false;
}

/* ─────────────── Cooldown setelah 3x salah ─────────────── */

function loadFail() {
    try {
        if (fs.existsSync(FAIL_FILE)) {
            const v = JSON.parse(fs.readFileSync(FAIL_FILE, 'utf8'));
            return (v && typeof v === 'object') ? v : {};
        }
    } catch {}
    return {};
}

/** Sisa cooldown dalam ms (0 = tidak ada cooldown). */
function cooldownRemaining(now = Date.now()) {
    const until = Number(loadFail().until || 0);
    return until > now ? until - now : 0;
}

function isCoolingDown(now = Date.now()) {
    return cooldownRemaining(now) > 0;
}

/** Mulai cooldown 5 menit. */
function startCooldown(ms = COOLDOWN_MS, now = Date.now()) {
    fs.writeFileSync(FAIL_FILE, JSON.stringify({ until: now + ms, at: now }, null, 2) + '\n', { mode: 0o600 });
    return now + ms;
}

function clearCooldown() {
    try { if (fs.existsSync(FAIL_FILE)) fs.unlinkSync(FAIL_FILE); } catch {}
    return true;
}

/* ─────────────── Verify ─────────────── */

function verifyKey(key, { publicKey = loadPublicKey(), now = Date.now(), mid = machineId(), autoLock = true } = {}) {
    if (!publicKey) return { ok: false, reason: 'PUBLIC_KEY_MISSING', message: 'Public key penerbit tidak ditemukan (.license-public.pem).' };
    if (!key || typeof key !== 'string' || !key.startsWith(PREFIX)) {
        return { ok: false, reason: 'NO_KEY', message: 'License key belum dipasang. Dapatkan dari owner.' };
    }
    const body = key.slice(PREFIX.length);
    const dot = body.lastIndexOf('.');
    if (dot < 1) return { ok: false, reason: 'MALFORMED', message: 'Format license key rusak.' };
    const payloadB64 = body.slice(0, dot);
    const sigB64 = body.slice(dot + 1);

    let valid = false;
    try {
        valid = crypto.verify(null, Buffer.from(payloadB64), publicKey, Buffer.from(sigB64, 'base64url'));
    } catch {}
    if (!valid) return { ok: false, reason: 'BAD_SIGNATURE', message: 'Tanda tangan lisensi tidak valid / key bukan dari owner.' };

    let payload;
    try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); }
    catch { return { ok: false, reason: 'BAD_PAYLOAD', message: 'Isi lisensi tidak bisa dibaca.' }; }

    if (payload.e && Number(payload.e) < now) {
        return { ok: false, reason: 'EXPIRED', message: 'Lisensi sudah kedaluwarsa.', payload };
    }
    if (payload.j && loadRevoked().includes(String(payload.j))) {
        return { ok: false, reason: 'REVOKED', message: 'Lisensi telah dicabut owner.', payload };
    }
    const lock = checkIndividualLock(payload, { mid, autoLock });
    if (!lock.ok) return { ...lock, payload };

    return { ok: true, reason: 'OK', message: 'Lisensi aktif.', payload, kind: payload.k || 'shared', justLocked: !!lock.locked };
}

function check() {
    return verifyKey(process.env.MZ_LICENSE_KEY || readKeyFile());
}

/**
 * Gate HARD: selalu mengembalikan hasil; `fatal = !ok`.
 * index.js yang memutuskan untuk process.exit(1).
 */
function enforce() {
    const result = check();
    return { ...result, fatal: !result.ok };
}

module.exports = {
    PREFIX,
    KEY_FILE,
    PUB_FILE,
    REVOKED_FILE,
    LOCK_FILE,
    FAIL_FILE,
    COOLDOWN_MS,
    loadPublicKey,
    machineId,
    readKeyFile,
    saveKey,
    clearKey,
    loadRevoked,
    loadLocks,
    checkIndividualLock,
    releaseLock,
    cooldownRemaining,
    isCoolingDown,
    startCooldown,
    clearCooldown,
    verifyKey,
    check,
    enforce
};
