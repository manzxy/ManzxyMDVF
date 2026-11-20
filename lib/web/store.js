/**
 * LOCAL WEB DATABASE — SQLite via node:sqlite (bawaan Node 22+, tanpa dependency baru).
 *
 * Menyimpan SEMUA data akun panel web secara terpisah dari database/db.json milik bot:
 *   accounts   → akun web (email/password lokal, atau tertaut Google/GitHub)
 *   oauth      → tautan identitas OAuth (provider + provider_uid)
 *   sessions   → token sesi login web
 *   logs       → catatan aktivitas panel (login, topup, jadibot, dll)
 *   settings   → pengaturan kecil per akun (tema, notif)
 *
 * Penghubung ke bot: accounts.wa_number → nomor WhatsApp (dipakai untuk jadibot & saldo).
 * Saldo TETAP disimpan di database/db.json (user.money) supaya bot dan panel melihat angka yang sama.
 */
const fs = require('fs');
const path = require('path');

const { logInfo, logWarn, logError } = require('../core/logger');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { DatabaseSync = null; }

const DB_DIR = path.join(__dirname, '..', '..', 'database');
const DB_FILE = path.join(DB_DIR, 'webpanel.db');

let db = null;

/* ───────────────────────── skema ───────────────────────── */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE,                 -- NULL untuk akun yang hanya pakai OAuth tanpa email
    password_hash TEXT,                        -- NULL bila hanya OAuth
    password_salt TEXT,
    display_name  TEXT DEFAULT '',
    wa_number     TEXT DEFAULT '',             -- nomor WhatsApp (terhubung ke bot)
    avatar        TEXT DEFAULT '',
    role          TEXT DEFAULT 'user',         -- user | owner
    plan          TEXT DEFAULT 'free',         -- free | premium
    verified      INTEGER DEFAULT 0,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_wa ON accounts(wa_number) WHERE wa_number <> '';

CREATE TABLE IF NOT EXISTS oauth (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    INTEGER NOT NULL,
    provider      TEXT NOT NULL,               -- google | github
    provider_uid  TEXT NOT NULL,
    email         TEXT DEFAULT '',
    name          TEXT DEFAULT '',
    avatar        TEXT DEFAULT '',
    created_at    INTEGER NOT NULL,
    UNIQUE(provider, provider_uid),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip         TEXT DEFAULT '',
    ua         TEXT DEFAULT '',
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    action     TEXT NOT NULL,
    detail     TEXT DEFAULT '',
    ip         TEXT DEFAULT '',
    at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_account ON logs(account_id, at DESC);

CREATE TABLE IF NOT EXISTS settings (
    account_id INTEGER NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT DEFAULT '',
    PRIMARY KEY(account_id, key),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
);
`;

/* ───────────────────────── init ───────────────────────── */

/** Tambah kolom baru secara aman (idempoten) — dipakai untuk migrasi skema ringan. */
function ensureColumn(table, column, ddl) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function init() {
    if (db) return db;
    if (!DatabaseSync) {
        logWarn('WEBDB', 'node:sqlite tidak tersedia (butuh Node 22+). Panel web tidak bisa menyimpan akun.');
        return null;
    }
    try {
        fs.mkdirSync(DB_DIR, { recursive: true });
        db = new DatabaseSync(DB_FILE);
        db.exec(SCHEMA);
        // Kendali ukuran WAL: jangan biarkan -wal membesar tanpa batas (makan disk).
        db.exec("PRAGMA journal_size_limit = 4194304;");   // maks 4 MB
        db.exec("PRAGMA synchronous = NORMAL;");            // cukup aman dengan WAL, jauh lebih ringan
        try {
            db.exec("PRAGMA wal_checkpoint(TRUNCATE);");    // kecilkan WAL yang sudah menumpuk
        } catch {}
        // checkpoint ringan tiap jam supaya WAL rutin dikosongkan
        const ckpt = setInterval(() => { try { db.exec("PRAGMA wal_checkpoint(PASSIVE);"); } catch {} }, 60 * 60 * 1000);
        if (ckpt.unref) ckpt.unref();
        // migrasi: 2FA TOTP (lapis keamanan akun)
        ensureColumn('accounts', 'totp_secret', 'totp_secret TEXT');
        ensureColumn('accounts', 'totp_enabled', 'totp_enabled INTEGER DEFAULT 0');
        // migrasi: verifikasi nomor WA — nomor WA tidak lagi dipercaya begitu saja;
        // harus diverifikasi lewat .verifweb dari nomor itu sendiri (lihat lib/web/auth.js)
        ensureColumn('accounts', 'wa_verified', 'wa_verified INTEGER DEFAULT 0');
        // migrasi: referral + kunci 1 akun per perangkat
        ensureColumn('accounts', 'ref_code', 'ref_code TEXT');          // kode referral milik akun ini
        ensureColumn('accounts', 'ref_by', 'ref_by INTEGER');           // akun yang mengajak (referrer id)
        ensureColumn('accounts', 'ref_paid', 'ref_paid INTEGER DEFAULT 0'); // bonus referral sudah dibayar
        ensureColumn('accounts', 'device_hash', 'device_hash TEXT');    // sidik perangkat (1 akun / HP)
        // migrasi: personal API key (cek saldo/status bot lewat HTTP sederhana)
        ensureColumn('accounts', 'api_key', "api_key TEXT DEFAULT ''");
        // migrasi: sub-akun reseller (akun pantau milik akun induk)
        ensureColumn('accounts', 'parent_id', 'parent_id INTEGER');
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_ref ON accounts(ref_code) WHERE ref_code IS NOT NULL AND ref_code <> \'\'');
        db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_device ON accounts(device_hash) WHERE device_hash IS NOT NULL');
        db.exec(`CREATE TABLE IF NOT EXISTS referrals (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id INTEGER NOT NULL,
            referee_id  INTEGER NOT NULL UNIQUE,
            code        TEXT NOT NULL,
            bonus       INTEGER DEFAULT 0,
            status      TEXT DEFAULT 'pending',   -- pending | paid | rejected
            reason      TEXT DEFAULT '',
            created_at  INTEGER NOT NULL,
            paid_at     INTEGER DEFAULT 0
        )`);
        db.exec('CREATE INDEX IF NOT EXISTS idx_referrals_ref ON referrals(referrer_id, created_at DESC)');
        const migrated = db.prepare("SELECT value FROM meta WHERE key = 'wa_verified_migrated'").get();
        if (!migrated) {
            // data lama (sebelum fitur verifikasi ada) dianggap sudah terverifikasi sekali saja
            db.exec("UPDATE accounts SET wa_verified = 1 WHERE wa_number <> ''");
            db.prepare("INSERT INTO meta (key, value) VALUES ('wa_verified_migrated', ?)").run(String(now()));
            logInfo('WEBDB', 'Migrasi: nomor WA lama ditandai terverifikasi (wa_verified_migrated)');
        }
        logInfo('WEBDB', `Database panel siap: database/webpanel.db`);
    } catch (err) {
        logError('WEBDB', `Gagal membuka database panel: ${err.message}`);
        db = null;
    }
    return db;
}

const ready = () => Boolean(db || init());

/* ───────────────────────── accounts ───────────────────────── */

const now = () => Date.now();

function createAccount({ email = null, passwordHash = null, passwordSalt = null, displayName = '', waNumber = '', avatar = '', role = 'user', verified = 0, parentId = null }) {
    if (!ready()) throw new Error('Database panel tidak tersedia.');
    const stmt = db.prepare(`INSERT INTO accounts (email, password_hash, password_salt, display_name, wa_number, avatar, role, verified, created_at, parent_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const info = stmt.run(
        email ? String(email).toLowerCase().trim() : null,
        passwordHash, passwordSalt,
        String(displayName || ''), String(waNumber || ''), String(avatar || ''), role, verified ? 1 : 0, now(),
        parentId ? Number(parentId) : null
    );
    return getAccountById(Number(info.lastInsertRowid));
}

function getAccountById(id) {
    if (!ready()) return null;
    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(id)) || null;
}

function getAccountByEmail(email) {
    if (!ready() || !email) return null;
    return db.prepare('SELECT * FROM accounts WHERE email = ?').get(String(email).toLowerCase().trim()) || null;
}

function getAccountByWa(wa) {
    if (!ready() || !wa) return null;
    const n = String(wa).replace(/[^0-9]/g, '');
    if (!n) return null;
    return db.prepare('SELECT * FROM accounts WHERE wa_number = ?').get(n) || null;
}

function updateAccount(id, fields) {
    if (!ready()) return null;
    const allowed = ['email', 'password_hash', 'password_salt', 'display_name', 'wa_number', 'wa_verified', 'avatar', 'role', 'plan', 'verified', 'last_login_at', 'totp_secret', 'totp_enabled', 'api_key', 'ref_code', 'ref_by', 'ref_paid', 'device_hash', 'parent_id'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return getAccountById(id);
    const set = keys.map((k) => `${k} = ?`).join(', ');
    const vals = keys.map((k) => fields[k]);
    db.prepare(`UPDATE accounts SET ${set} WHERE id = ?`).run(...vals, Number(id));
    return getAccountById(id);
}

function touchLogin(id) { return updateAccount(id, { last_login_at: now() }); }

/* ───────────────────────── oauth ───────────────────────── */

function getOauth(provider, uid) {
    if (!ready()) return null;
    return db.prepare('SELECT * FROM oauth WHERE provider = ? AND provider_uid = ?').get(String(provider), String(uid)) || null;
}

function linkOauth({ accountId, provider, providerUid, email = '', name = '', avatar = '' }) {
    if (!ready()) throw new Error('Database panel tidak tersedia.');
    db.prepare(`INSERT INTO oauth (account_id, provider, provider_uid, email, name, avatar, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider, provider_uid) DO UPDATE SET
                    email = excluded.email, name = excluded.name, avatar = excluded.avatar`)
        .run(Number(accountId), String(provider), String(providerUid), String(email || ''), String(name || ''), String(avatar || ''), now());
    return getOauth(provider, providerUid);
}

function listOauth(accountId) {
    if (!ready()) return [];
    return db.prepare('SELECT provider, email, name, avatar, created_at FROM oauth WHERE account_id = ?').all(Number(accountId));
}

function unlinkOauth(accountId, provider) {
    if (!ready()) return false;
    const info = db.prepare('DELETE FROM oauth WHERE account_id = ? AND provider = ?').run(Number(accountId), String(provider));
    return info.changes > 0;
}

/* ───────────────────────── sessions ───────────────────────── */

function createSession({ token, accountId, ttlMs, ip = '', ua = '' }) {
    if (!ready()) return null;
    db.prepare('INSERT INTO sessions (token, account_id, created_at, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?)')
        .run(String(token), Number(accountId), now(), now() + ttlMs, String(ip || ''), String(ua || '').slice(0, 200));
    return { token, accountId, expiresAt: now() + ttlMs };
}

function getSession(token) {
    if (!ready() || !token) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(String(token));
    if (!s) return null;
    if (s.expires_at < now()) { db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token)); return null; }
    return s;
}

function deleteSession(token) {
    if (!ready()) return false;
    return db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token)).changes > 0;
}

/** Cabut semua sesi satu akun (kecuali token yang sedang dipakai, bila diisi). */
function deleteSessionsForAccount(accountId, exceptToken = '') {
    if (!ready()) return 0;
    if (exceptToken) {
        return db.prepare('DELETE FROM sessions WHERE account_id = ? AND token <> ?').run(Number(accountId), String(exceptToken)).changes;
    }
    return db.prepare('DELETE FROM sessions WHERE account_id = ?').run(Number(accountId)).changes;
}

function purgeExpiredSessions() {
    if (!ready()) return 0;
    return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()).changes;
}

/* ───────────────────────── logs ───────────────────────── */

/* Event bus untuk Live Activity Feed. store.log adalah titik universal yang
 * dipanggil semua aksi panel (topup, jadibot, premium, login, ...), jadi cukup
 * emit di sini untuk menyuap SSE tanpa menyentuh puluhan route. */
const activitySubscribers = new Set();
function onActivity(fn) {
    if (typeof fn !== 'function') return () => {};
    activitySubscribers.add(fn);
    return () => activitySubscribers.delete(fn);
}
function emitActivity(entry) {
    for (const fn of activitySubscribers) {
        try { fn(entry); } catch (err) { logWarn('WEBDB', `activity subscriber: ${err.message}`); }
    }
}

function log(accountId, action, detail = '', ip = '') {
    if (!ready()) return;
    try {
        const at = now();
        db.prepare('INSERT INTO logs (account_id, action, detail, ip, at) VALUES (?, ?, ?, ?, ?)')
            .run(accountId ? Number(accountId) : null, String(action), String(detail || '').slice(0, 500), String(ip || ''), at);
        // simpan maksimal 500 entri terakhir per akun
        if (accountId) {
            db.prepare(`DELETE FROM logs WHERE account_id = ? AND id NOT IN (
                          SELECT id FROM logs WHERE account_id = ? ORDER BY at DESC LIMIT 500)`).run(Number(accountId), Number(accountId));
        }
        // Emit hanya untuk event bertema (abaikan noise seperti apikey_revoke).
        if (accountId && FEED_ACTIONS.has(String(action))) {
            emitActivity({ accountId: Number(accountId), action: String(action), detail: String(detail || '').slice(0, 200), at });
        }
    } catch (err) { logError('WEBDB', `log: ${err.message}`); }
}

/** Aksi yang ditampilkan di Live Activity Feed + dipakai untuk filter emit. */
const FEED_ACTIONS = new Set([
    'register', 'login', 'wa_verified_otp', 'jadibot_start', 'jadibot_free',
    'jadibot_buy', 'jadibot_delete', 'jadibot_stop', 'jadibot_import',
    'topup_create', 'voucher_redeem', 'premium_free', 'premium_buy',
    'premium_qris', 'broadcast',
]);

function listLogs(accountId, limit = 50) {
    if (!ready()) return [];
    return db.prepare('SELECT action, detail, ip, at FROM logs WHERE account_id = ? ORDER BY at DESC LIMIT ?').all(Number(accountId), Number(limit));
}

/* ───────────────────────── settings ───────────────────────── */

function getSetting(accountId, key, fallback = '') {
    if (!ready()) return fallback;
    const r = db.prepare('SELECT value FROM settings WHERE account_id = ? AND key = ?').get(Number(accountId), String(key));
    return r ? r.value : fallback;
}

function setSetting(accountId, key, value) {
    if (!ready()) return false;
    db.prepare(`INSERT INTO settings (account_id, key, value) VALUES (?, ?, ?)
                ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value`)
        .run(Number(accountId), String(key), String(value ?? ''));
    return true;
}

/* ───────────────────────── stats ───────────────────────── */

function stats() {
    if (!ready()) return { accounts: 0, oauth: 0, sessions: 0 };
    const one = (q) => db.prepare(q).get()?.n || 0;
    return {
        accounts: one('SELECT COUNT(*) AS n FROM accounts'),
        oauth: one('SELECT COUNT(*) AS n FROM oauth'),
        sessions: one('SELECT COUNT(*) AS n FROM sessions')
    };
}

function close() { try { db?.close(); } catch {} db = null; }

/* ───────────────────────── referral & perangkat ───────────────────────── */

/** Cari akun lewat kode referral (tidak peka huruf besar/kecil). */
function getAccountByRefCode(code) {
    if (!ready() || !code) return null;
    return db.prepare('SELECT * FROM accounts WHERE ref_code = ?').get(String(code).trim().toUpperCase()) || null;
}

/** Akun lain yang memakai perangkat yang sama (kunci 1 akun per HP). */
function getAccountByDevice(hash, exceptId = 0) {
    if (!ready() || !hash) return null;
    return db.prepare('SELECT * FROM accounts WHERE device_hash = ? AND id <> ? ORDER BY id LIMIT 1')
        .get(String(hash), Number(exceptId) || 0) || null;
}

function setRefCode(accountId, code) {
    if (!ready()) return null;
    db.prepare('UPDATE accounts SET ref_code = ? WHERE id = ?').run(String(code), Number(accountId));
    return getAccountById(accountId);
}

/* ── personal API key ── */

function setApiKey(accountId, key) {
    return updateAccount(accountId, { api_key: String(key || '') });
}

function getAccountByApiKey(key) {
    if (!db || !key || String(key).length < 16) return null;
    try {
        const row = db.prepare('SELECT * FROM accounts WHERE api_key = ? AND api_key <> \'\'').get(String(key));
        return row || null;
    } catch { return null; }
}

/* ───────────────────────── sesi login aktif (manajemen perangkat) ───────────────────────── */

function listSessions(accountId) {
    if (!ready()) return [];
    try {
        return db.prepare(`SELECT rowid AS id, token, created_at, expires_at, ip, ua FROM sessions
            WHERE account_id = ? AND expires_at > ?
            ORDER BY created_at DESC`).all(Number(accountId), Date.now());
    } catch { return []; }
}

function revokeSessionById(accountId, rowid) {
    if (!ready()) return false;
    try {
        const info = db.prepare('DELETE FROM sessions WHERE account_id = ? AND rowid = ?').run(Number(accountId), Number(rowid));
        return info.changes > 0;
    } catch { return false; }
}

function revokeAllSessions(accountId, exceptToken = '') {
    if (!ready()) return 0;
    try {
        const info = exceptToken
            ? db.prepare('DELETE FROM sessions WHERE account_id = ? AND token <> ?').run(Number(accountId), String(exceptToken))
            : db.prepare('DELETE FROM sessions WHERE account_id = ?').run(Number(accountId));
        return info.changes;
    } catch { return 0; }
}

/* ───────────────────────── sub-akun reseller ───────────────────────── */

function createSubAccount({ parentId, email, passwordHash, passwordSalt, displayName = '' }) {
    return createAccount({ email, passwordHash, passwordSalt, displayName, waNumber: '', role: 'user', verified: 0, parentId });
}

function listSubAccounts(parentId) {
    if (!ready()) return [];
    try {
        return db.prepare(`SELECT id, email, display_name, created_at, last_login_at FROM accounts
            WHERE parent_id = ? ORDER BY created_at DESC`).all(Number(parentId));
    } catch { return []; }
}

function deleteSubAccount(parentId, id) {
    if (!ready()) return false;
    try {
        const info = db.prepare('DELETE FROM accounts WHERE id = ? AND parent_id = ?').run(Number(id), Number(parentId));
        if (info.changes > 0) db.prepare('DELETE FROM sessions WHERE account_id = ?').run(Number(id));
        return info.changes > 0;
    } catch { return false; }
}

/* ───────────────────────── leaderboard referral ───────────────────────── */

function topReferrers(limit = 10) {
    if (!ready()) return [];
    try {
        return db.prepare(`SELECT a.id, a.display_name, a.wa_number, COUNT(r.id) AS total
            FROM referrals r JOIN accounts a ON a.id = r.referrer_id
            WHERE r.status = 'paid'
            GROUP BY r.referrer_id ORDER BY total DESC, a.id ASC LIMIT ?`).all(Math.max(1, Math.min(50, Number(limit) || 10)));
    } catch { return []; }
}

function setDeviceHash(accountId, hash) {
    if (!ready()) return null;
    db.prepare('UPDATE accounts SET device_hash = ? WHERE id = ?').run(String(hash || ''), Number(accountId));
    return getAccountById(accountId);
}

function createReferral({ referrerId, refereeId, code, bonus = 0, status = 'pending', reason = '' }) {
    if (!ready()) throw new Error('Database panel tidak tersedia.');
    db.prepare(`INSERT INTO referrals (referrer_id, referee_id, code, bonus, status, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(Number(referrerId), Number(refereeId), String(code || ''), Number(bonus) || 0, String(status), String(reason || ''), now());
    db.prepare('UPDATE accounts SET ref_by = ? WHERE id = ?').run(Number(referrerId), Number(refereeId));
    return db.prepare('SELECT * FROM referrals WHERE referee_id = ?').get(Number(refereeId)) || null;
}

function markReferralPaid(refereeId, bonus) {
    if (!ready()) return null;
    db.prepare("UPDATE referrals SET status = 'paid', bonus = ?, paid_at = ? WHERE referee_id = ?")
        .run(Number(bonus) || 0, now(), Number(refereeId));
    db.prepare('UPDATE accounts SET ref_paid = 1 WHERE id = ?').run(Number(refereeId));
    return db.prepare('SELECT * FROM referrals WHERE referee_id = ?').get(Number(refereeId)) || null;
}

function getReferral(refereeId) {
    if (!ready()) return null;
    return db.prepare('SELECT * FROM referrals WHERE referee_id = ?').get(Number(refereeId)) || null;
}

/** Daftar orang yang diundang oleh satu akun + total bonus yang sudah dibayar. */
function listReferrals(referrerId) {
    if (!ready()) return { rows: [], total: 0, paid: 0, pending: 0 };
    const rows = db.prepare(`
        SELECT r.id, r.referee_id, r.bonus, r.status, r.reason, r.created_at, r.paid_at,
               a.display_name, a.email
        FROM referrals r
        LEFT JOIN accounts a ON a.id = r.referee_id
        WHERE r.referrer_id = ?
        ORDER BY r.created_at DESC
        LIMIT 100`).all(Number(referrerId));
    const paid = rows.filter((r) => r.status === 'paid').reduce((n, r) => n + (Number(r.bonus) || 0), 0);
    const pending = rows.filter((r) => r.status === 'pending').length;
    return { rows, total: rows.length, paid, pending };
}

/** Berapa akun yang sudah mendaftar memakai kode ini (untuk batas harian). */
function countReferralsSince(referrerId, sinceMs) {
    if (!ready()) return 0;
    const r = db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ? AND created_at >= ?')
        .get(Number(referrerId), Number(sinceMs));
    return Number(r?.n) || 0;
}

module.exports = {
    init, close, stats,
    createAccount, getAccountById, getAccountByEmail, getAccountByWa, updateAccount, touchLogin,
    listSessions, revokeSessionById, revokeAllSessions,
    createSubAccount, listSubAccounts, deleteSubAccount, topReferrers,
    getAccountByRefCode, getAccountByDevice, setRefCode, setDeviceHash,
    createReferral, markReferralPaid, getReferral, listReferrals, countReferralsSince,
    getOauth, linkOauth, listOauth, unlinkOauth,
    setApiKey, getAccountByApiKey,
    createSession, getSession, deleteSession, deleteSessionsForAccount, purgeExpiredSessions,
    log, listLogs, getSetting, setSetting,
    onActivity, FEED_ACTIONS,
    get db() { return db; },
    DB_FILE
};