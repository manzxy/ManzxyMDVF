/**
 * ManzxyMD Free — License Guard (soft-by-default)
 * ------------------------------------------------------------------
 * Sistem lisensi ringan untuk edisi gratis. Beda dengan edisi Premium:
 *
 *   - Tanpa key            → bot TETAP jalan, hanya tampil warning di boot.
 *   - Key invalid/expired  → bot TETAP jalan, warning lebih keras.
 *   - MZ_LICENSE_REQUIRED=1 → baru memaksa bot berhenti bila key tidak valid.
 *
 * Key ditandatangani HMAC-SHA256 memakai secret milik penyedia lisensi,
 * terikat fingerprint mesin + tanggal kedaluwarsa. Format: MZF-<payload>.<sig>
 *
 * Secret dibaca (urutan prioritas):
 *   1. process.env.MZ_LICENSE_SECRET
 *   2. file .license-secret di root proyek (JANGAN di-commit)
 *
 * Key dibaca (urutan prioritas):
 *   1. process.env.MZ_LICENSE_KEY
 *   2. file .license-key di root proyek (diisi otomatis oleh command .setkey)
 *
 * CLI pengelola: node scripts/license.js <perintah>
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'MZF-';
const ROOT = path.join(__dirname, '..', '..');
const KEY_FILE = path.join(ROOT, '.license-key');
const SECRET_FILE = path.join(ROOT, '.license-secret');

/* ─────────────── Secret ─────────────── */

function loadSecret() {
    if (process.env.MZ_LICENSE_SECRET) return process.env.MZ_LICENSE_SECRET.trim();
    try {
        if (fs.existsSync(SECRET_FILE)) {
            const v = fs.readFileSync(SECRET_FILE, 'utf8').trim();
            if (v) return v;
        }
    } catch {}
    return null;
}

/* ─────────────── Machine fingerprint ─────────────── */

function machineFingerprint() {
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

function displayFingerprint() {
    return machineFingerprint().toUpperCase();
}

/* ─────────────── Key storage ─────────────── */

function readKeyFile() {
    try {
        return fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : null;
    } catch { return null; }
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

/* ─────────────── Encode / decode ─────────────── */

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const unb64url = (str) => Buffer.from(str, 'base64url');
const sign = (payloadB64, secret) => crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

function issueKey({ customer, fingerprint, days = 30, tier = 'free', secret = loadSecret() } = {}) {
    if (!secret) throw new Error('Secret lisensi belum diset (MZ_LICENSE_SECRET / .license-secret).');
    if (!customer) throw new Error('customer wajib diisi.');
    if (!fingerprint) throw new Error('fingerprint wajib diisi.');
    if (!Number.isFinite(Number(days)) || Number(days) < 0) throw new Error('days harus angka >= 0 (0 = lifetime).');

    const payload = {
        c: String(customer).slice(0, 80),
        f: String(fingerprint).toLowerCase().replace(/[^a-f0-9]/gi, '').slice(0, 16),
        e: days === 0 ? 0 : Date.now() + Number(days) * 24 * 3600 * 1000,
        t: String(tier).slice(0, 20),
        v: 1
    };
    const payloadB64 = b64url(JSON.stringify(payload));
    const sig = sign(payloadB64, secret);
    return { key: PREFIX + payloadB64 + '.' + sig, payload };
}

function verifyKey(key, { secret = loadSecret(), fingerprint = machineFingerprint(), now = Date.now() } = {}) {
    if (!secret) return { ok: false, reason: 'SECRET_MISSING', message: 'Secret lisensi tidak ditemukan di server ini.' };
    if (!key || typeof key !== 'string' || !key.startsWith(PREFIX)) {
        return { ok: false, reason: 'NO_KEY', message: 'License key tidak ada / format salah.' };
    }
    const body = key.slice(PREFIX.length);
    const dot = body.lastIndexOf('.');
    if (dot < 1) return { ok: false, reason: 'MALFORMED', message: 'Format license key rusak.' };
    const payloadB64 = body.slice(0, dot);
    const sig = body.slice(dot + 1);

    const expected = sign(payloadB64, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { ok: false, reason: 'BAD_SIGNATURE', message: 'Tanda tangan lisensi tidak valid.' };
    }

    let payload;
    try { payload = JSON.parse(unb64url(payloadB64).toString('utf8')); }
    catch { return { ok: false, reason: 'BAD_PAYLOAD', message: 'Isi lisensi tidak bisa dibaca.' }; }

    if (payload.f && String(payload.f).toLowerCase() !== String(fingerprint).toLowerCase()) {
        return { ok: false, reason: 'FINGERPRINT_MISMATCH', message: 'Lisensi terikat pada mesin lain.', payload };
    }
    if (payload.e && Number(payload.e) < now) {
        return { ok: false, reason: 'EXPIRED', message: 'Lisensi sudah kedaluwarsa.', payload };
    }
    return { ok: true, reason: 'OK', message: 'Lisensi aktif.', payload };
}

/** Cek key aktif dari env / file. */
function check() {
    const key = process.env.MZ_LICENSE_KEY || readKeyFile();
    return verifyKey(key);
}

/**
 * Dipanggil sekali saat boot. Bersifat soft by default:
 * mengembalikan hasil + flag `fatal` bila MZ_LICENSE_REQUIRED=1.
 * TIDAK melempar error kecuali mode hard dan key invalid.
 */
function enforce() {
    const required = /^(1|true|yes)$/i.test(process.env.MZ_LICENSE_REQUIRED || '');
    const result = check();
    return { ...result, required, fatal: required && !result.ok };
}

module.exports = {
    PREFIX,
    KEY_FILE,
    SECRET_FILE,
    loadSecret,
    machineFingerprint,
    displayFingerprint,
    readKeyFile,
    saveKey,
    clearKey,
    issueKey,
    verifyKey,
    check,
    enforce
};
