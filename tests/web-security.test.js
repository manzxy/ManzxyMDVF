/**
 * REGRESI KEAMANAN PANEL WEB — dipakai bersama lib/web/auth.js.
 *   1. Nomor WA yang diketik sendiri TIDAK boleh memberi role owner (verifikasi .verifweb wajib).
 *   2. confirmWaLink hanya menerima kode dari nomor yang didaftarkan, dengan batas percobaan & TTL.
 *   3. Ganti password mencabut sesi lain.
 * Store SQLite di-stub in-memory supaya test tidak menyentuh database/webpanel.db sungguhan.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/* ── stub store (in-memory) ── */
const store = require('../lib/web/store');
const accounts = new Map();
const sessions = new Map();
let nextId = 1;
const now = () => Date.now();

store.init = () => ({});
store.createAccount = (p) => {
    const acc = {
        id: nextId++, email: p.email ? String(p.email).toLowerCase() : null,
        password_hash: p.passwordHash || null, password_salt: p.passwordSalt || null,
        display_name: p.displayName || '', wa_number: p.waNumber || '', wa_verified: 0,
        avatar: p.avatar || '', role: p.role || 'user', plan: 'free', verified: p.verified ? 1 : 0,
        created_at: now(), last_login_at: 0, totp_secret: null, totp_enabled: 0
    };
    accounts.set(acc.id, acc);
    return { ...acc };
};
store.getAccountById = (id) => { const a = accounts.get(Number(id)); return a ? { ...a } : null; };
store.getAccountByEmail = (e) => { for (const a of accounts.values()) if (a.email === String(e).toLowerCase().trim()) return { ...a }; return null; };
store.getAccountByWa = (w) => { const n = String(w).replace(/[^0-9]/g, ''); for (const a of accounts.values()) if (a.wa_number === n) return { ...a }; return null; };
store.updateAccount = (id, fields) => { const a = accounts.get(Number(id)); if (!a) return null; Object.assign(a, fields); return { ...a }; };
store.log = () => {};
store.touchLogin = () => {};
store.createSession = ({ token, accountId, ttlMs }) => { sessions.set(token, { account_id: accountId, created_at: now(), expires_at: now() + ttlMs }); return {}; };
store.getSession = (t) => { const s = sessions.get(t); return s && s.expires_at > now() ? s : null; };
store.deleteSession = (t) => sessions.delete(t);
store.deleteSessionsForAccount = (accountId, exceptToken = '') => {
    let n = 0;
    for (const [t, s] of sessions) if (s.account_id === Number(accountId) && t !== exceptToken) { sessions.delete(t); n++; }
    return n;
};
store.listOauth = () => [];

const auth = require('../lib/web/auth');
const config = require('../config');
require('../lib/core/configDefaults').apply(config);
const ROOT_OWNER = String(config.ownerNumber[0]).replace(/[^0-9]/g, '');

test('register TIDAK memberi role owner walau mengisi nomor root owner', () => {
    const acc = auth.register({ email: 'penyerang@example.com', password: 'Abcdef12', waNumber: ROOT_OWNER, ownerList: config.ownerNumber });
    assert.equal(acc.role, 'user');
    assert.equal(acc.wa_number, '');                       // nomor dari form daftar tidak dipercaya
    const acc2 = auth.register({ email: 'warga@example.com', password: 'Abcdef12' });
    assert.equal(acc2.role, 'user');
});

test('requestWaLink → confirmWaLink: nomor root owner jadi owner HANYA setelah kode dari nomor itu', () => {
    const acc = auth.register({ email: 'owner-asli@example.com', password: 'Abcdef12' });
    const r = auth.requestWaLink(acc.id, ROOT_OWNER);
    assert.ok(r.pending && /^\d{6}$/.test(r.code));
    // nomor belum berubah sebelum verifikasi
    assert.equal(store.getAccountById(acc.id).wa_number, '');
    // kode dikirim dari nomor lain → ditolak
    assert.throws(() => auth.confirmWaLink('628111111111', r.code), /bukan untuk nomor itu/);
    // kode benar dari nomor yang didaftarkan → diterima & role owner
    const updated = auth.confirmWaLink(ROOT_OWNER, r.code);
    assert.equal(updated.wa_verified, 1);
    assert.equal(updated.role, 'owner');
    // kode sekali pakai
    assert.throws(() => auth.confirmWaLink(ROOT_OWNER, r.code), /tidak dikenal|kedaluwarsa/);
});

test('confirmWaLink menolak kode salah berulang (batas percobaan)', () => {
    const acc = auth.register({ email: 'brute@example.com', password: 'Abcdef12' });
    const r = auth.requestWaLink(acc.id, '628777888990');
    assert.throws(() => auth.confirmWaLink('628777888990', '000000'), /tidak dikenal/);
    assert.throws(() => auth.confirmWaLink('628777888990', '000000'), /tidak dikenal/);
    // kode asli masih valid (percobaan salah tidak menghapus kode, tapi dihitung)
    const updated = auth.confirmWaLink('628777888990', r.code);
    assert.equal(updated.wa_verified, 1);
    assert.equal(updated.role, 'user');                    // bukan root owner → tetap user
});

test('menautkan nomor non-owner pada akun owner menurunkan role ke user', () => {
    // bebaskan nomor root owner dari akun test sebelumnya
    for (const [id, a] of accounts) if (a.wa_number === ROOT_OWNER) accounts.delete(id);
    const acc = auth.register({ email: 'turun@example.com', password: 'Abcdef12' });
    const r1 = auth.requestWaLink(acc.id, ROOT_OWNER);
    auth.confirmWaLink(ROOT_OWNER, r1.code);
    assert.equal(store.getAccountById(acc.id).role, 'owner');
    const r2 = auth.requestWaLink(acc.id, '6289876543210');
    const updated = auth.confirmWaLink('6289876543210', r2.code);
    assert.equal(updated.role, 'user');
});

test('ganti password mencabut sesi lain, sesi aktif tetap', () => {
    const acc = auth.register({ email: 'sesi@example.com', password: 'Abcdef12' });
    const t1 = auth.issueSession(store.getAccountById(acc.id), {});
    const t2 = auth.issueSession(store.getAccountById(acc.id), {});
    auth.changePassword(acc.id, 'Abcdef12', 'Abcdef34', t1);
    assert.ok(store.getSession(t1), 'sesi saat ini masih ada');
    assert.equal(store.getSession(t2), null, 'sesi lain dicabut');
    // password lama tidak lagi bisa login
    assert.throws(() => auth.login({ email: 'sesi@example.com', password: 'Abcdef12' }), /Email atau password salah/);
    assert.ok(auth.login({ email: 'sesi@example.com', password: 'Abcdef34', ip: '', ua: '' }).token);
});

test('resetPassword lewat nomor WA terverifikasi: password berganti & semua sesi dicabut', () => {
    const acc = auth.register({ email: 'reset@example.com', password: 'Abcdef12' });
    const t1 = auth.issueSession(store.getAccountById(acc.id), {});
    store.updateAccount(acc.id, { wa_number: '628555444333', wa_verified: 1 });

    // nomor tidak dikenal ditolak
    assert.throws(() => auth.resetPassword('6289999999999', 'Qwerty12'), /tidak terhubung/);
    // password lemah ditolak
    assert.throws(() => auth.resetPassword('628555444333', 'pendek'), /minimal 8/);

    auth.resetPassword('628555444333', 'Zx9wvuts');
        assert.equal(store.getSession(t1), null, 'semua sesi dicabut setelah reset');
    // login dengan password baru berhasil, lama gagal
    assert.throws(() => auth.login({ email: 'reset@example.com', password: 'Abcdef12' }), /Email atau password salah/);
    assert.ok(auth.login({ email: 'reset@example.com', password: 'Zx9wvuts', ip: '', ua: '' }).token);
});

test('rotasi sesi: token berumur > 7 hari diganti, token lama mati, akun tetap sama', () => {
    const acc = auth.register({ email: 'rotasi@example.com', password: 'Abcdef12' });
    const tok = auth.issueSession(store.getAccountById(acc.id), {});

    // sesi muda → tidak dirotasi
    let r = auth.rotateSessionIfNeeded(tok);
    assert.equal(r.newToken, '');
    assert.equal(r.account.id, acc.id);
    assert.ok(store.getSession(tok), 'token lama masih hidup');

    // buat sesi tampak berumur 8 hari
    sessions.get(tok).created_at = now() - 8 * 24 * 3600 * 1000;
    r = auth.rotateSessionIfNeeded(tok);
    assert.ok(r.newToken, 'token baru diterbitkan');
    assert.equal(r.account.id, acc.id);
    assert.equal(store.getSession(tok), null, 'token lama dicabut');
    assert.equal(store.getSession(r.newToken).account_id, acc.id, 'token baru menunjuk akun yang sama');
    // token baru belum dirotasi lagi
    assert.equal(auth.rotateSessionIfNeeded(r.newToken).newToken, '');
});
