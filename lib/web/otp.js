/**
 * OTP lewat WhatsApp untuk pendaftaran akun panel.
 *
 * Alur:
 *  1. Web kirim nomor → requestOtp() membuat kode 6 angka, disimpan di memori (TTL 5 menit).
 *  2. Kode dikirim ke WhatsApp nomor itu memakai socket bot utama.
 *  3. Web kirim nomor + kode → verifyOtp() memeriksa, lalu menandai nomor terverifikasi.
 *
 * Kode disimpan di memori (bukan database) karena hanya berlaku beberapa menit —
 * ikut hilang saat bot restart, dan itu memang perilaku yang aman.
 */
const crypto = require('crypto');
const { logInfo, logWarn } = require('../core/logger');

const OTP_TTL = 5 * 60 * 1000;        // 5 menit
const OTP_MAX_TRIES = 5;              // salah 5x → kode hangus
const OTP_RESEND_COOLDOWN = 60 * 1000; // jangan kirim ulang lebih cepat dari 60 detik
const OTP_DAILY_MAX = 10;             // maksimal 10 OTP per nomor per hari

/** number → { code, at, tries, purpose } */
const pending = new Map();
/** number → { sent: { [dayKey]: n }, lastAt } */
const throttles = new Map();

const dayKey = () => new Date().toISOString().slice(0, 10);
const normNumber = (n) => String(n || '').replace(/[^0-9]/g, '');

/** Samakan format nomor ke gaya WhatsApp: 08xx → 628xx */
function normalizeWa(n) {
    let s = normNumber(n);
    if (s.startsWith('0')) s = '62' + s.slice(1);
    if (s.startsWith('620')) s = '62' + s.slice(3);
    return s;
}

function isValidNumber(n) {
    const s = normalizeWa(n);
    return s.length >= 10 && s.length <= 15 && s.startsWith('62');
}

function purgeExpired() {
    const now = Date.now();
    for (const [k, v] of pending) if (now - v.at > OTP_TTL) pending.delete(k);
    for (const [k, v] of throttles) if (now - (v.lastAt || 0) > 24 * 3600 * 1000) throttles.delete(k);
}

function dailyCount(number) {
    const t = throttles.get(number);
    if (!t) return 0;
    return t.sent?.[dayKey()] || 0;
}

/** Sudah ada kode aktif untuk nomor ini? (dipakai saat daftar untuk tidak mengirim ulang) */
const hasPending = (number) => {
    const v = pending.get(normalizeWa(number));
    return Boolean(v && Date.now() - v.at <= OTP_TTL);
};

/**
 * Buat & kirim OTP ke WhatsApp.
 * @param {string} number nomor tujuan
 * @param {{purpose?:string, sock?:object}} [opts]
 * @returns {Promise<{sent:true, number:string, ttlSec:number, expiresAt:number}>}
 */
async function requestOtp(number, { purpose = 'register', sock = null } = {}) {
    purgeExpired();
    const wa = normalizeWa(number);
    if (!isValidNumber(wa)) throw new Error('Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.');

    const t = throttles.get(wa) || { sent: {}, lastAt: 0 };
    if (Date.now() - (t.lastAt || 0) < OTP_RESEND_COOLDOWN) {
        const wait = Math.ceil((OTP_RESEND_COOLDOWN - (Date.now() - t.lastAt)) / 1000);
        throw new Error(`Tunggu ${wait} detik sebelum minta kode lagi.`);
    }
    if (dailyCount(wa) >= OTP_DAILY_MAX) throw new Error('Terlalu banyak permintaan kode untuk nomor ini hari ini. Coba besok.');

    const bot = sock || global.__mainSock;
    if (!bot) throw new Error('Bot WhatsApp belum siap. Coba lagi sebentar.');

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const expiryMin = Math.round(OTP_TTL / 60000);

    const text =
        `🔐 *KODE VERIFIKASI MANZXYMD*\n\n` +
        `Kode kamu: *${code}*\n\n` +
        `Berlaku ${expiryMin} menit. Jangan bagikan kode ini ke siapa pun.\n` +
        `Kalau kamu tidak merasa mendaftar di panel ManzxyMD, abaikan pesan ini.`;

    await bot.sendMessage(`${wa}@s.whatsapp.net`, { text });

    pending.set(wa, { code, at: Date.now(), tries: 0, purpose });
    t.sent[dayKey()] = dailyCount(wa) + 1;
    t.lastAt = Date.now();
    throttles.set(wa, t);

    logInfo('WEBOTP', `OTP ${purpose} dikirim ke +${wa}`);
    return { sent: true, number: wa, ttlSec: OTP_TTL / 1000, expiresAt: Date.now() + OTP_TTL };
}

/**
 * Periksa kode OTP. Kode hangus setelah dipakai atau salah 5x.
 * `purpose` opsional: bila diisi, kode hanya berlaku untuk alur itu
 * (register/reset/profile) — kode untuk satu alur tidak bisa dipakai alur lain.
 * @returns {{ok:true, number:string}}
 */
function verifyOtp(number, code, purpose = '') {
    const wa = normalizeWa(number);
    const c = String(code || '').replace(/\D/g, '');
    const entry = pending.get(wa);
    if (!entry) throw new Error('Kode tidak ditemukan atau sudah kedaluwarsa. Minta kode baru.');
    if (purpose && entry.purpose && entry.purpose !== purpose) {
        throw new Error('Kode ini bukan untuk alur tersebut. Minta kode baru.');
    }
    if (Date.now() - entry.at > OTP_TTL) {
        pending.delete(wa);
        throw new Error('Kode sudah kedaluwarsa. Minta kode baru.');
    }
    entry.tries++;
    if (entry.tries > OTP_MAX_TRIES) {
        pending.delete(wa);
        throw new Error('Terlalu banyak percobaan salah. Minta kode baru.');
    }
    if (c.length !== 6 || c !== entry.code) {
        const left = Math.max(0, OTP_MAX_TRIES - entry.tries + 1);
        throw new Error(`Kode salah. Sisa ${left} percobaan.`);
    }
    pending.delete(wa);
    logInfo('WEBOTP', `OTP terverifikasi untuk +${wa}`);
    return { ok: true, number: wa };
}

/** Buang kode aktif sebuah nomor (mis. nomor sudah dipakai akun lain). */
const cancelOtp = (number) => pending.delete(normalizeWa(number));

module.exports = {
    requestOtp, verifyOtp, cancelOtp, hasPending,
    normalizeWa, isValidNumber,
    OTP_TTL, OTP_MAX_TRIES, OTP_RESEND_COOLDOWN
};
