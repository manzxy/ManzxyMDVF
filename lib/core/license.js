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
 * Pencabutan: owner mencabut key lewat .delkey di bot penerbit; daftar ID
 * yang dicabut disalin ke .license-revoked.json di sini (atau diisi manual).
 *
 * Key dibaca (urutan prioritas):
 *   1. process.env.MZ_LICENSE_KEY
 *   2. file .license-key (diisi otomatis oleh command .setkey)
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

/* ─────────────── Public key ─────────────── */

function loadPublicKey() {
    try {
        if (fs.existsSync(PUB_FILE)) return fs.readFileSync(PUB_FILE, 'utf8');
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

/* ─────────────── Verify ─────────────── */

function verifyKey(key, { publicKey = loadPublicKey(), fingerprint = machineFingerprint(), now = Date.now() } = {}) {
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

    if (payload.f && String(payload.f).toLowerCase() !== String(fingerprint).toLowerCase()) {
        return { ok: false, reason: 'FINGERPRINT_MISMATCH', message: 'Lisensi terikat pada mesin lain.', payload };
    }
    if (payload.e && Number(payload.e) < now) {
        return { ok: false, reason: 'EXPIRED', message: 'Lisensi sudah kedaluwarsa.', payload };
    }
    if (payload.j && loadRevoked().includes(String(payload.j))) {
        return { ok: false, reason: 'REVOKED', message: 'Lisensi telah dicabut owner.', payload };
    }
    return { ok: true, reason: 'OK', message: 'Lisensi aktif.', payload };
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
    loadPublicKey,
    machineFingerprint,
    displayFingerprint,
    readKeyFile,
    saveKey,
    clearKey,
    loadRevoked,
    verifyKey,
    check,
    enforce
};
