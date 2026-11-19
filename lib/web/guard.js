/**
 * GUARD KEAMANAN PANEL WEB — lapisan pertahanan berlapis (tanpa dependency).
 *
 * Lapis 1  Rate limiting per-IP (anti flood / DoS ringan)
 * Lapis 2  Lockout brute-force login (5x salah → terkunci 15 menit, per email+IP)
 * Lapis 3  Verifikasi Origin/Referer untuk request ubah data (anti CSRF)
 * Lapis 4  Security headers (CSP, X-Frame-Options, HSTS, Permissions-Policy, dll)
 * Lapis 5  2FA TOTP untuk akun (lihat lib/web/auth.js — lapis terakhir di akun owner)
 */
const crypto = require('crypto');

/* ───────────── Lapis 1: rate limiter token-bucket sederhana ───────────── */

const buckets = new Map();          // key -> { count, resetAt }
let lastSweep = Date.now();

function sweep() {
    const now = Date.now();
    if (now - lastSweep < 60_000) return;
    lastSweep = now;
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}

/**
 * Cek apakah request diperbolehkan.
 * @returns {{ ok: boolean, retryAfterSec: number }}
 */
function rateLimit(key, max, windowMs) {
    sweep();
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt < now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
    b.count++;
    if (b.count > max) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
    return { ok: true, retryAfterSec: 0 };
}

/* ───────────── Lapis 2: lockout brute-force ───────────── */

const fails = new Map();            // key -> { count, lockedUntil }
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

function failKey(...parts) { return parts.filter(Boolean).join(':'); }

/** Catat kegagalan. Mengembalikan sisa detik terkunci (0 = tidak terkunci). */
function recordFailure(...parts) {
    const key = failKey(...parts);
    const now = Date.now();
    const f = fails.get(key) || { count: 0, lockedUntil: 0 };
    f.count++;
    if (f.count >= MAX_FAILS) { f.lockedUntil = now + LOCK_MS; f.count = 0; }
    fails.set(key, f);
    return Math.max(0, Math.ceil((f.lockedUntil - now) / 1000));
}

/** Berapa detik lagi terkunci (0 = bebas). */
function lockedFor(...parts) {
    const f = fails.get(failKey(...parts));
    if (!f) return 0;
    const left = Math.ceil((f.lockedUntil - Date.now()) / 1000);
    return left > 0 ? left : 0;
}

function clearFailures(...parts) { fails.delete(failKey(...parts)); }

/* ───────────── Lapis 3: CSRF via verifikasi Origin ───────────── */

/**
 * Request yang mengubah data wajib berasal dari situs yang sama.
 * Origin kosong (curl / aplikasi native dengan Bearer token) diizinkan —
 * cookie sesi saja tidak bisa dipakai untuk CSRF tanpa Origin yang cocok.
 */
function sameOrigin(req, secure) {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE') return true;
    const origin = req.headers.origin || '';
    const referer = req.headers.referer || '';
    if (!origin && !referer) return true;                       // non-browser client
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const check = (raw) => {
        try {
            const u = new URL(raw);
            return u.host === host;
        } catch { return false; }
    };
    if (origin) return check(origin);
    return check(referer);
}

/* ───────────── Lapis 4: security headers ───────────── */

const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
].join('; ');

/** Set header keamanan pada setiap respons. */
function applyHeaders(res, secure) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/* ───────────── util ───────────── */

const safeEqual = (a, b) => {
    const ba = Buffer.from(String(a || ''));
    const bb = Buffer.from(String(b || ''));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

module.exports = {
    rateLimit, recordFailure, lockedFor, clearFailures,
    sameOrigin, applyHeaders, safeEqual,
    MAX_FAILS, LOCK_MS
};
