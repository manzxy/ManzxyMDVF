/**
 * AUTH PANEL WEB — email/password lokal, Google OAuth, GitHub OAuth.
 *
 * Tanpa dependency tambahan:
 *   • Password  : scrypt (crypto bawaan Node)
 *   • Sesi      : token acak 48 hex, disimpan di SQLite (lib/web/store.js)
 *   • OAuth     : OAuth 2.0 Authorization Code flow manual via fetch
 *
 * Konfigurasi lewat environment:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 *   WEB_PANEL_URL  (opsional, untuk membentuk redirect URI)
 */
const crypto = require('crypto');
const store = require('./store');
const guard = require('./guard');
const { logInfo, logWarn, logError } = require('../core/logger');

const SESSION_TTL = 30 * 24 * 3600 * 1000;   // 30 hari — sesi login tidak hilang cepat
const OAUTH_STATE_TTL = 10 * 60 * 1000;

/* state OAuth sementara: state -> { provider, at, next } */
const oauthStates = new Map();

/* verifikasi nomor WA sementara: kode -> { accountId, number, at, tries } */
const waLinks = new Map();
const WA_LINK_TTL = 10 * 60 * 1000;     // kode berlaku 10 menit
const WA_LINK_MAX_TRIES = 5;

/* ───────────────────────── password ───────────────────────── */

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
    return { hash, salt };
}

function verifyPassword(password, hash, salt) {
    if (!hash || !salt) return false;
    try {
        const calc = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
        const stored = Buffer.from(hash, 'hex');
        return stored.length === calc.length && crypto.timingSafeEqual(stored, calc);
    } catch { return false; }
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

function validatePassword(pw) {
    const s = String(pw || '');
    if (s.length < 8) return 'Password minimal 8 karakter.';
    if (!/[a-zA-Z]/.test(s)) return 'Password harus memuat huruf.';
    if (!/[0-9]/.test(s)) return 'Password harus memuat angka.';
    return '';
}

/* ───────────────────────── sessions ───────────────────────── */

const newToken = () => crypto.randomBytes(48).toString('hex');

function issueSession(account, { ip = '', ua = '' } = {}) {
    const token = newToken();
    store.createSession({ token, accountId: account.id, ttlMs: SESSION_TTL, ip, ua });
    store.touchLogin(account.id);
    return token;
}

function sessionAccount(token) {
    const s = store.getSession(token);
    if (!s) return null;
    const acc = store.getAccountById(s.account_id);
    return acc || null;
}

function revoke(token) { return store.deleteSession(token); }

/* ───────── rotasi token sesi (batasi masa pakai token yang terbocor) ───────── */

const SESSION_ROTATE_MS = 7 * 24 * 3600 * 1000;   // sesi > 7 hari diganti token baru

/**
 * Ambil akun dari token; bila umur sesi sudah melewati SESSION_ROTATE_MS,
 * buat token baru (TTL penuh), cabut token lama, dan kembalikan token baru
 * supaya server menempelkannya ke cookie/header respons.
 * @returns {{ account: object|null, newToken: string }}
 */
function rotateSessionIfNeeded(token) {
    const s = store.getSession(token);
    if (!s) return { account: null, newToken: '' };
    const acc = store.getAccountById(s.account_id);
    if (!acc) return { account: null, newToken: '' };
    if (Date.now() - s.created_at < SESSION_ROTATE_MS) return { account: acc, newToken: '' };
    const fresh = newToken();
    store.createSession({ token: fresh, accountId: acc.id, ttlMs: SESSION_TTL, ip: s.ip, ua: s.ua });
    store.deleteSession(token);
    logInfo('WEBAUTH', `Sesi akun #${acc.id} dirotasi (token baru).`);
    return { account: acc, newToken: fresh };
}

/* ───────── reset password (lupa password, lewat OTP WhatsApp) ───────── */

/**
 * Ganti password memakai nomor WA terverifikasi + OTP yang sudah diverifikasi pemanggil.
 * Semua sesi login dicabut setelah reset.
 */
function resetPassword(waNumber, newPassword) {
    if (!store.init()) throw new Error('Database panel tidak tersedia.');
    const wa = String(waNumber || '').replace(/[^0-9]/g, '');
    const acc = store.getAccountByWa(wa);
    if (!acc) throw new Error('Nomor WhatsApp tidak terhubung ke akun panel mana pun.');
    if (!acc.wa_verified) throw new Error('Nomor WhatsApp akun ini belum terverifikasi. Hubungi owner bot.');
    const err = validatePassword(newPassword);
    if (err) throw new Error(err);
    const { hash, salt } = hashPassword(newPassword);
    store.updateAccount(acc.id, { password_hash: hash, password_salt: salt });
    store.deleteSessionsForAccount(acc.id);          // perangkat lain ikut keluar
    store.log(acc.id, 'password_reset', `wa=+${wa}`);
    logInfo('WEBAUTH', `Password direset via OTP WhatsApp untuk akun #${acc.id}`);
    return store.getAccountById(acc.id);
}

/* ───────────────── 2FA TOTP (RFC 6238, tanpa dependency) ───────────────── */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
    let bits = 0, value = 0, out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0, value = 0;
    const out = [];
    for (const ch of clean) {
        const idx = B32.indexOf(ch);
        if (idx < 0) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(out);
}

/** Kode TOTP 6 digit pada step waktu tertentu (±offset untuk toleransi jam). */
function totpAt(secretB32, counter) {
    const key = base32Decode(secretB32);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(bin % 1_000_000).padStart(6, '0');
}

/** Verifikasi kode dengan jendela ±1 step (30 detik) untuk toleransi jam. */
function verifyTotp(secretB32, token) {
    const code = String(token || '').replace(/\D/g, '');
    if (!secretB32 || code.length !== 6) return false;
    const step = Math.floor(Date.now() / 30000);
    for (const off of [0, 1, -1]) {
        if (guard.safeEqual(code, totpAt(secretB32, step + off))) return true;
    }
    return false;
}

const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

function otpauthUrl(secret, email) {
    const label = encodeURIComponent(`ManzxyMD:${email || 'owner'}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=ManzxyMD&algorithm=SHA1&digits=6&period=30`;
}

/** Buat (atau pakai) secret 2FA yang belum aktif. Belum berlaku sampai enable. */
function setupTotp(accountId) {
    const acc = store.getAccountById(accountId);
    if (!acc) throw new Error('Akun tidak ditemukan.');
    if (acc.totp_enabled) throw new Error('2FA sudah aktif. Matikan dulu bila ingin ganti perangkat.');
    const secret = acc.totp_secret || newTotpSecret();
    if (!acc.totp_secret) store.updateAccount(accountId, { totp_secret: secret, totp_enabled: 0 });
    return { secret, otpauth: otpauthUrl(secret, acc.email) };
}

function enableTotp(accountId, token) {
    const acc = store.getAccountById(accountId);
    if (!acc?.totp_secret) throw new Error('Jalankan setup 2FA dulu.');
    if (!verifyTotp(acc.totp_secret, token)) throw new Error('Kode 2FA salah. Coba lagi.');
    store.updateAccount(accountId, { totp_enabled: 1 });
    store.log(accountId, '2fa_enabled');
    logInfo('WEBAUTH', `2FA aktif untuk akun #${accountId}`);
    return true;
}

function disableTotp(accountId, token) {
    const acc = store.getAccountById(accountId);
    if (!acc?.totp_enabled) throw new Error('2FA belum aktif.');
    if (!verifyTotp(acc.totp_secret, token)) throw new Error('Kode 2FA salah.');
    store.updateAccount(accountId, { totp_secret: null, totp_enabled: 0 });
    store.log(accountId, '2fa_disabled');
    return true;
}

/* ───────────────────────── registrasi / login lokal ───────────────────────── */

function isOwnerNumber(wa, ownerList) {
    const n = String(wa || '').replace(/[^0-9]/g, '');
    return Boolean(n) && (ownerList || []).map((x) => String(x).replace(/[^0-9]/g, '')).includes(n);
}

/**
 * Daftar dengan email + password.
 * Bila `waVerified` true (nomor sudah lolos OTP WhatsApp), nomor langsung ditautkan & diverifikasi.
 * @param {{email:string, password:string, displayName?:string, waNumber?:string, ownerList?:string[], waVerified?:boolean}} p
 */
function register({ email, password, displayName = '', waNumber = '', ownerList = [], waVerified = false }) {
    if (!store.init()) throw new Error('Database panel tidak tersedia (butuh Node 22+).');
    if (!isEmail(email)) throw new Error('Format email tidak valid.');
    const pwErr = validatePassword(password);
    if (pwErr) throw new Error(pwErr);
    if (store.getAccountByEmail(email)) throw new Error('Email sudah terdaftar. Silakan login.');

    const wa = String(waNumber || '').replace(/[^0-9]/g, '');
    if (wa && (wa.length < 8 || wa.length > 15)) throw new Error('Nomor WhatsApp tidak valid.');
    // nomor yang sudah lolos OTP tidak boleh dipakai akun lain
    if (wa && waVerified) {
        const other = store.getAccountByWa(wa);
        if (other) throw new Error('Nomor WhatsApp itu sudah dipakai akun lain.');
    }

    const { hash, salt } = hashPassword(password);
    const acc = store.createAccount({
        email,
        passwordHash: hash,
        passwordSalt: salt,
        displayName: displayName || String(email).split('@')[0],
        // Nomor hanya disimpan bila sudah lolos OTP WhatsApp saat daftar.
        waNumber: waVerified ? wa : '',
        role: waVerified && isOwnerNumber(wa, ownerList) ? 'owner' : 'user',
        verified: 0
    });
    if (waVerified) store.updateAccount(acc.id, { wa_verified: 1 });
    store.log(acc.id, 'register', `email=${email}${waVerified ? ` wa=+${wa}` : ''}`);
    logInfo('WEBAUTH', `Akun web baru: ${email}${waVerified ? ` (WA +${wa} terverifikasi)` : ''}`);
    return store.getAccountById(acc.id) || acc;
}

function login({ email, password, totp = '', ip = '', ua = '' }) {
    if (!store.init()) throw new Error('Database panel tidak tersedia (butuh Node 22+).');
    const acc = store.getAccountByEmail(email);
    if (!acc) {
        // samakan beban komputasi dengan login valid → pesan salah tidak bisa dibedakan lewat timing
        crypto.scryptSync(String(password || ''), 'timing-equalizer', SCRYPT_KEYLEN);
        throw new Error('Email atau password salah.');
    }
    if (!acc.password_hash) {
        const linked = store.listOauth(acc.id).map((o) => o.provider).join(' / ');
        throw new Error(`Akun ini terdaftar lewat ${linked || 'OAuth'}. Login dengan tombol ${linked || 'OAuth'}.`);
    }
    if (!verifyPassword(password, acc.password_hash, acc.password_salt)) {
        store.log(acc.id, 'login_failed', 'password salah', ip);
        throw new Error('Email atau password salah.');
    }
    // Lapis 2FA: akun dengan TOTP aktif wajib membawa kode dari aplikasi authenticator
    if (acc.totp_enabled) {
        if (!totp) { const e = new Error('Kode 2FA diperlukan.'); e.needs2fa = true; throw e; }
        if (!verifyTotp(acc.totp_secret, totp)) {
            store.log(acc.id, 'login_failed', 'kode 2FA salah', ip);
            throw new Error('Kode 2FA salah.');
        }
    }
    const token = issueSession(acc, { ip, ua });
    store.log(acc.id, 'login', acc.totp_enabled ? 'password+2fa' : 'password', ip);
    return { account: acc, token };
}

/* ───────────────────────── OAuth 2.0 ───────────────────────── */

const PROVIDERS = {
    google: {
        label: 'Google',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
        scope: 'openid email profile',
        clientId: () => process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: () => process.env.GOOGLE_CLIENT_SECRET || ''
    },
    github: {
        label: 'GitHub',
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userUrl: 'https://api.github.com/user',
        emailUrl: 'https://api.github.com/user/emails',
        scope: 'read:user user:email',
        clientId: () => process.env.GITHUB_CLIENT_ID || '',
        clientSecret: () => process.env.GITHUB_CLIENT_SECRET || ''
    }
};

function providerStatus() {
    const out = {};
    for (const [id, p] of Object.entries(PROVIDERS)) {
        const cid = clientId(id);
        const sec = clientSecret(id);
        out[id] = {
            enabled: Boolean(cid && sec),
            label: p.label,
            // hanya client id (publik, memang terlihat di URL OAuth) — secret tidak pernah dikirim ke klien
            clientId: cid,
            configuredInPanel: Boolean(cid && sec)
        };
    }
    return out;
}

/* ───────── base URL panel (WAJIB origin bersih) ─────────
 * WEB_PANEL_URL disimpan owner dari panel (DB) → env → config.js.
 * Nilai selalu dinormalkan: buang spasi, garis miring di akhir, dan path
 * (mis. `https://panel.manzxy.biz.id/panel` → `https://panel.manzxy.biz.id`)
 * supaya redirect URI OAuth tidak pernah jadi `.../panel/panel`.
 */

const FALLBACK_BASE = 'https://panel.manzxy.biz.id';

function normalizeBaseUrl(raw) {
    let s = String(raw || '').trim().replace(/\s+/g, '');
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    try {
        const u = new URL(s);
        if (!u.hostname) return '';
        // hostname harus domain valid atau localhost/IP (mencegah nilai sampah seperti 'panel') 
        if (!u.hostname.includes('.') && u.hostname !== 'localhost') return '';
        u.pathname = '';
        u.search = '';
        u.hash = '';
        u.username = '';
        u.password = '';
        return u.origin;
    } catch { return ''; }
}

/** Base URL dari pengaturan panel saat runtime (disimpan di SQLite, tabel settings). */
function storedBaseUrl() {
    try { return normalizeBaseUrl(getPanelSetting('web_panel_url', '')); } catch { return ''; }
}

function isLocalHost(url) {
    return /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(String(url || ''));
}

/**
 * Base URL panel. Urutan prioritas:
 *   1. nilai yang disimpan owner dari panel — kecuali masih menunjuk host lokal sedangkan
 *      env/config sudah menunjuk domain publik (mencegah salah simpan saat uji di VPS)
 *   2. WEB_PANEL_URL (environment)
 *   3. config.js → webPanelUrl
 *   4. tebakan dari header request (pilihan terakhir)
 * Semua sumber dinormalkan sehingga tidak pernah memuat path `/panel`.
 */
function baseUrl(req) {
    const fromEnv = normalizeBaseUrl(process.env.WEB_PANEL_URL);
    let fromCfg = '';
    try { fromCfg = normalizeBaseUrl(require('../../config').webPanelUrl); } catch { /* config opsional */ }
    const publicEnv = fromEnv && !isLocalHost(fromEnv) ? fromEnv : (fromCfg && !isLocalHost(fromCfg) ? fromCfg : '');

    const fromStore = storedBaseUrl();
    if (fromStore && !(isLocalHost(fromStore) && publicEnv)) return fromStore;
    if (publicEnv) return publicEnv;
    if (fromStore) return fromStore;

    // Deteksi dari header hanya sebagai pilihan terakhir.
    if (!req) return FALLBACK_BASE;
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    return normalizeBaseUrl(`${proto}://${host}`) || FALLBACK_BASE;
}

function redirectUri(req, provider) {
    return `${baseUrl(req)}/api/auth/${provider}/callback`;
}

/* ───────── kredensial OAuth yang bisa diatur dari panel ─────────
 * Urutan prioritas: nilai yang disimpan owner di panel → environment.
 * Secret disimpan di SQLite (tabel settings) dan tidak pernah dikirim balik ke klien.
 */

const OAUTH_SETTING_KEYS = {
    google: { id: 'oauth_google_id', secret: 'oauth_google_secret' },
    github: { id: 'oauth_github_id', secret: 'oauth_github_secret' }
};

/* Pengaturan panel bersifat global. Disimpan pada akun owner pertama agar ikut
 * terhapus bersama akunnya; bila belum ada owner dipakai slot 0. */
let globalSettingOwner = null;
function panelSettingOwner() {
    if (globalSettingOwner !== null) return globalSettingOwner;
    try {
        const acc = store.db.prepare("SELECT id FROM accounts WHERE role = 'owner' ORDER BY id ASC LIMIT 1").get();
        globalSettingOwner = acc ? Number(acc.id) : 0;
    } catch { globalSettingOwner = 0; }
    return globalSettingOwner;
}

function getPanelSetting(key, fallback = '') {
    return store.getSetting(panelSettingOwner(), key, fallback);
}

function setPanelSetting(key, value) {
    globalSettingOwner = null;                       // owner bisa baru dibuat/berubah
    return store.setSetting(panelSettingOwner(), key, value);
}

function clientId(providerName) {
    const p = PROVIDERS[providerName];
    if (!p) return '';
    const keys = OAUTH_SETTING_KEYS[providerName];
    let stored = '';
    try { stored = getPanelSetting(keys.id, ''); } catch { /* DB belum siap */ }
    return String(stored || p.clientId() || '').trim();
}

function clientSecret(providerName) {
    const p = PROVIDERS[providerName];
    if (!p) return '';
    const keys = OAUTH_SETTING_KEYS[providerName];
    let stored = '';
    try { stored = getPanelSetting(keys.secret, ''); } catch { /* DB belum siap */ }
    return String(stored || p.clientSecret() || '').trim();
}

/** Simpan (atau hapus bila kosong) kredensial OAuth milik satu provider. */
function saveProviderConfig(providerName, { clientId: cid, clientSecret: sec }) {
    const keys = OAUTH_SETTING_KEYS[providerName];
    if (!keys) throw new Error('Provider tidak dikenal.');
    if (!store.init()) throw new Error('Database panel tidak tersedia.');
    const id = String(cid || '').trim();
    if (id && !/^[A-Za-z0-9._-]{8,200}$/.test(id)) throw new Error('Client ID tidak valid.');
    if (sec !== undefined && sec !== null && sec !== '' && String(sec).length < 8) throw new Error('Client Secret terlalu pendek.');
    setPanelSetting(keys.id, id);
    if (sec !== undefined) setPanelSetting(keys.secret, String(sec || '').trim());
    return providerStatus()[providerName];
}

/** Simpan base URL panel (sudah dinormalkan) atau hapus bila kosong. */
function saveBaseUrl(raw) {
    if (!store.init()) throw new Error('Database panel tidak tersedia.');
    if (!String(raw || '').trim()) { setPanelSetting('web_panel_url', ''); return ''; }
    const clean = normalizeBaseUrl(raw);
    if (!clean) throw new Error('URL panel tidak valid. Contoh: https://panel.manzxy.biz.id');
    setPanelSetting('web_panel_url', clean);
    return clean;
}

function clientId(providerName) {
    const p = PROVIDERS[providerName];
    if (!p) return '';
    const keys = OAUTH_SETTING_KEYS[providerName];
    let stored = '';
    try { stored = getPanelSetting(keys.id, '') || ''; } catch { /* DB belum siap */ }
    return String(stored || p.clientId() || '').trim();
}

function clientSecret(providerName) {
    const p = PROVIDERS[providerName];
    if (!p) return '';
    const keys = OAUTH_SETTING_KEYS[providerName];
    let stored = '';
    try { stored = getPanelSetting(keys.secret, '') || ''; } catch { /* DB belum siap */ }
    return String(stored || p.clientSecret() || '').trim();
}

function authorizeUrl(req, providerName, next = '/panel') {
    const p = PROVIDERS[providerName];
    if (!p) throw new Error('Provider tidak dikenal.');
    const cid = clientId(providerName);
    const sec = clientSecret(providerName);
    if (!cid || !sec) throw new Error(`Login ${p.label} belum dikonfigurasi. Isi Client ID & Secret di Panel → Owner → Login OAuth.`);

    const state = crypto.randomBytes(20).toString('hex');
    oauthStates.set(state, { provider: providerName, at: Date.now(), next });
    // bersihkan state lama
    for (const [k, v] of oauthStates) if (Date.now() - v.at > OAUTH_STATE_TTL) oauthStates.delete(k);

    const params = new URLSearchParams({
        client_id: cid,
        redirect_uri: redirectUri(req, providerName),
        scope: p.scope,
        state,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'select_account'
    });
    return `${p.authUrl}?${params.toString()}`;
}

async function exchangeCode(providerName, req, code) {
    const p = PROVIDERS[providerName];
    const body = new URLSearchParams({
        client_id: clientId(providerName),
        client_secret: clientSecret(providerName),
        code,
        redirect_uri: redirectUri(req, providerName),
        grant_type: 'authorization_code'
    });
    const res = await fetch(p.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body
    });
    const txt = await res.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = Object.fromEntries(new URLSearchParams(txt)); }
    if (!res.ok || !data.access_token) {
        throw new Error(`${p.label} menolak kode: ${data.error_description || data.error || res.status}`);
    }
    return data.access_token;
}

async function fetchProfile(providerName, token) {
    const p = PROVIDERS[providerName];
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'ManzxyMD-Panel' };

    if (providerName === 'google') {
        const res = await fetch(p.userUrl, { headers });
        if (!res.ok) throw new Error(`Gagal mengambil profil Google (HTTP ${res.status})`);
        const u = await res.json();
        return {
            uid: String(u.sub),
            email: u.email || '',
            emailVerified: Boolean(u.email_verified),
            name: u.name || '',
            avatar: u.picture || ''
        };
    }

    // github
    const res = await fetch(p.userUrl, { headers });
    if (!res.ok) throw new Error(`Gagal mengambil profil GitHub (HTTP ${res.status})`);
    const u = await res.json();
    let email = u.email || '';
    if (!email) {
        try {
            const er = await fetch(p.emailUrl, { headers });
            if (er.ok) {
                const list = await er.json();
                const primary = list.find((e) => e.primary && e.verified) || list.find((e) => e.verified);
                if (primary) email = primary.email;
            }
        } catch { /* biarkan kosong */ }
    }
    return {
        uid: String(u.id),
        email,
        emailVerified: Boolean(email),
        name: u.name || u.login || '',
        avatar: u.avatar_url || ''
    };
}

/**
 * Selesaikan alur OAuth.
 * @returns {{ account, token, created:boolean }}
 */
async function handleCallback(providerName, req, { code, state, ip = '', ua = '' }) {
    const st = oauthStates.get(state);
    if (!st || st.provider !== providerName) throw new Error('State OAuth tidak valid atau kedaluwarsa. Ulangi login.');
    oauthStates.delete(state);

    const accessToken = await exchangeCode(providerName, req, code);
    const prof = await fetchProfile(providerName, accessToken);

    // 1. sudah pernah ditautkan?
    let link = store.getOauth(providerName, prof.uid);
    let acc = link ? store.getAccountById(link.account_id) : null;
    let created = false;

    // 2. email sudah punya akun lokal? → tautkan otomatis HANYA bila email terverifikasi provider
    //    (tanpa ini, akun lokal bisa diambil alih lewat OAuth dengan email yang belum terverifikasi)
    if (!acc && prof.email && prof.emailVerified) {
        const byEmail = store.getAccountByEmail(prof.email);
        if (byEmail) {
            acc = byEmail;
            store.linkOauth({ accountId: acc.id, provider: providerName, providerUid: prof.uid, email: prof.email, name: prof.name, avatar: prof.avatar });
            store.log(acc.id, 'oauth_link', providerName, ip);
        }
    }

    // 3. buat akun baru
    if (!acc) {
        acc = store.createAccount({
            email: prof.email ? String(prof.email).toLowerCase() : null,
            displayName: prof.name || prof.email?.split('@')[0] || providerName,
            avatar: prof.avatar,
            role: 'user',
            verified: prof.emailVerified ? 1 : 0
        });
        store.linkOauth({ accountId: acc.id, provider: providerName, providerUid: prof.uid, email: prof.email, name: prof.name, avatar: prof.avatar });
        store.log(acc.id, 'register', `oauth:${providerName}`);
        created = true;
        logInfo('WEBAUTH', `Akun web baru via ${providerName}: ${prof.email || prof.uid}`);
    } else {
        // perbarui avatar/nama bila kosong
        const patch = {};
        if (!acc.avatar && prof.avatar) patch.avatar = prof.avatar;
        if (!acc.display_name && prof.name) patch.display_name = prof.name;
        if (Object.keys(patch).length) acc = store.updateAccount(acc.id, patch);
    }

    const token = issueSession(acc, { ip, ua });
    store.log(acc.id, 'login', `oauth:${providerName}`, ip);
    return { account: acc, token, created };
}

/* ───────────────────────── akun & keamanan ───────────────────────── */

function changePassword(accountId, currentPassword, newPassword, exceptToken = '') {
    const acc = store.getAccountById(accountId);
    if (!acc) throw new Error('Akun tidak ditemukan.');
    if (acc.password_hash && !verifyPassword(currentPassword, acc.password_hash, acc.password_salt)) {
        throw new Error('Password lama salah.');
    }
    const err = validatePassword(newPassword);
    if (err) throw new Error(err);
    const { hash, salt } = hashPassword(newPassword);
    store.updateAccount(accountId, { password_hash: hash, password_salt: salt });
    // cabut semua sesi lain: perangkat asing yang sudah login ikut keluar
    store.deleteSessionsForAccount(accountId, exceptToken);
    store.log(accountId, 'password_change');
    return true;
}

function updateProfile(accountId, { displayName, avatar }) {
    const patch = {};
    if (displayName !== undefined) patch.display_name = String(displayName).slice(0, 60);
    if (avatar !== undefined) patch.avatar = String(avatar).slice(0, 500);
    // catatan: nomor WA TIDAK diubah di sini — harus lewat requestWaLink + .verifweb (anti pembajakan role)
    const acc = store.updateAccount(accountId, patch);
    store.log(accountId, 'profile_update');
    return acc;
}

/* ───────────── verifikasi nomor WhatsApp (anti eskalasi role owner) ─────────────
 * Nomor WA yang diketik sendiri di form TIDAK dipercaya: siapa pun bisa mengetik nomor owner.
 * Alur: panel minta kode → pemilik nomor kirim `.verifweb <kode>` dari WhatsApp nomor itu →
 * hanya pemilik nomor yang bisa melakukannya → baru nomor tertaut (dan role owner diberikan
 * bila nomornya memang root owner di config.ownerNumber).
 */

/** Minta kode verifikasi untuk menautkan nomor WA ke akun panel. */
function requestWaLink(accountId, waNumber) {
    if (!store.init()) throw new Error('Database panel tidak tersedia.');
    const acc = store.getAccountById(accountId);
    if (!acc) throw new Error('Akun tidak ditemukan.');
    const wa = String(waNumber || '').replace(/[^0-9]/g, '');
    if (!wa) {
        // kosongkan nomor: lepas tautan + turunkan role owner yang bersumber dari nomor itu
        store.updateAccount(accountId, { wa_number: '', wa_verified: 0, role: acc.role === 'owner' ? 'user' : acc.role });
        store.log(accountId, 'wa_unlink');
        return { cleared: true };
    }
    if (wa.length < 8 || wa.length > 15) throw new Error('Nomor WhatsApp tidak valid.');
    const other = store.getAccountByWa(wa);
    if (other && other.id !== Number(accountId)) throw new Error('Nomor WhatsApp itu sudah dipakai akun lain.');
    if (acc.wa_number === wa && acc.wa_verified) return { already: true, number: wa };

    for (const [k, v] of waLinks) if (Date.now() - v.at > WA_LINK_TTL) waLinks.delete(k);
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    waLinks.set(code, { accountId: Number(accountId), number: wa, at: Date.now(), tries: 0 });
    store.log(accountId, 'wa_link_request', `+${wa}`);
    return { pending: true, number: wa, code, ttlSec: WA_LINK_TTL / 1000 };
}

/** Konfirmasi kode dari WhatsApp nomor itu sendiri (dipanggil plugin bot `.verifweb`). */
function confirmWaLink(number, code) {
    if (!store.init()) throw new Error('Database panel tidak tersedia.');
    const wa = String(number || '').replace(/[^0-9]/g, '');
    const c = String(code || '').replace(/\D/g, '');
    const pending = c ? waLinks.get(c) : null;
    if (!pending) throw new Error('Kode verifikasi tidak dikenal atau sudah kedaluwarsa. Minta kode baru di panel web (Profil → Nomor WhatsApp).');
    if (pending.number !== wa) throw new Error('Kode ini bukan untuk nomor itu. Kirim perintah dari nomor yang didaftarkan di panel web.');
    if (Date.now() - pending.at > WA_LINK_TTL) { waLinks.delete(c); throw new Error('Kode sudah kedaluwarsa. Minta kode baru di panel web.'); }
    pending.tries++;
    if (pending.tries > WA_LINK_MAX_TRIES) { waLinks.delete(c); throw new Error('Terlalu banyak percobaan. Minta kode baru di panel web.'); }
    const acc = store.getAccountById(pending.accountId);
    if (!acc) { waLinks.delete(c); throw new Error('Akun panel tidak ditemukan.'); }

    let config;
    try { config = require('../../config'); } catch { config = { ownerNumber: [] }; }
    const role = isOwnerNumber(wa, config.ownerNumber) ? 'owner' : (acc.role === 'owner' ? 'user' : (acc.role || 'user'));
    const updated = store.updateAccount(acc.id, { wa_number: wa, wa_verified: 1, role });
    waLinks.delete(c);
    store.log(acc.id, 'wa_link', `+${wa}${role === 'owner' ? ' (owner)' : ''}`);
    logInfo('WEBAUTH', `Nomor +${wa} terverifikasi untuk akun panel #${acc.id}${role === 'owner' ? ' → OWNER' : ''}`);
    return updated;
}

function deleteAccount(accountId) {
    if (!store.init()) throw new Error('Database tidak tersedia.');
    store.db.prepare('DELETE FROM accounts WHERE id = ?').run(Number(accountId));
    return true;
}

function publicAccount(acc) {
    if (!acc) return null;
    return {
        id: acc.id,
        email: acc.email || '',
        displayName: acc.display_name || '',
        waNumber: acc.wa_number || '',
        avatar: acc.avatar || '',
        role: acc.role || 'user',
        plan: acc.plan || 'free',
        verified: Boolean(acc.verified),
        waVerified: Boolean(acc.wa_verified),
        hasPassword: Boolean(acc.password_hash),
        totpEnabled: Boolean(acc.totp_enabled),
        createdAt: acc.created_at,
        lastLoginAt: acc.last_login_at,
        providers: store.listOauth(acc.id).map((o) => ({
            provider: o.provider,
            email: o.email,
            name: o.name,
            avatar: o.avatar,
            linkedAt: o.created_at
        }))
    };
}

module.exports = {
    SESSION_TTL, PROVIDERS,
    hashPassword, verifyPassword, validatePassword, isEmail,
    register, login, issueSession, sessionAccount, revoke, rotateSessionIfNeeded,
    resetPassword,
    providerStatus, authorizeUrl, handleCallback,
    baseUrl, normalizeBaseUrl, redirectUri, clientId, clientSecret, saveProviderConfig, isLocalHost,
    saveBaseUrl, getPanelSetting, setPanelSetting,
    changePassword, updateProfile, deleteAccount, publicAccount,
    isOwnerNumber, requestWaLink, confirmWaLink,
    setupTotp, enableTotp, disableTotp, verifyTotp, totpAt, newTotpSecret, otpauthUrl
};