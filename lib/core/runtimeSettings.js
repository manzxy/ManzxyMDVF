/**
 * RUNTIME SETTINGS — pengaturan yang bisa diubah Owner dari panel web TANPA restart.
 * Disimpan di database JSON (db.settings.slots) supaya tetap ada setelah bot mati.
 * Nilai kosong = ikut config.js.
 */
const config = require('../../config');
const db = require('../data/database');
const { parseDuration } = require('./utils');

function section() {
    const settings = db.data?.settings;
    if (!settings) return {};
    if (!settings.slots || typeof settings.slots !== 'object') settings.slots = {};
    return settings.slots;
}

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** Maksimal jadibot di server (slot total). */
function jadibotMax() {
    const override = section().max;
    return clampInt(override, 0, 500, config.jadibot.max || 10);
}

/** Maksimal jadibot per pengguna. */
function jadibotMaxPerUser() {
    const override = section().maxPerUser;
    return clampInt(override, 0, 100, config.jadibot.maxPerUser || 1);
}

function setSlots({ max, maxPerUser } = {}) {
    const s = section();
    if (max !== undefined) {
        const v = Number(max);
        if (!Number.isSafeInteger(v) || v < 0 || v > 500) throw new Error('Slot server harus angka 0–500.');
        s.max = v;
    }
    if (maxPerUser !== undefined) {
        const v = Number(maxPerUser);
        if (!Number.isSafeInteger(v) || v < 0 || v > 100) throw new Error('Slot per user harus angka 0–100.');
        s.maxPerUser = v;
    }
    db.markDirty();
    return { max: jadibotMax(), maxPerUser: jadibotMaxPerUser() };
}

/* ───────── Paket durasi & harga sewa jadibot (custom dari panel owner) ───────── */

const normalizePackages = (list) => (Array.isArray(list) ? list : [])
    .map((p) => ({
        label: String(p?.label || '').trim().slice(0, 24),
        days: Number(p?.days),
        price: Number(p?.price)
    }))
    .filter((p) => Number.isSafeInteger(p.days) && p.days >= 1 && p.days <= 3650
        && Number.isSafeInteger(p.price) && p.price >= 0)
    .slice(0, 20);

/** Daftar paket durasi jadibot: [{ label, days, price }]. Kosong → ikut config.js. */
function packages() {
    const custom = normalizePackages(section().packages);
    if (custom.length) return custom;
    return Object.entries(config.jadibot.price.packages || {}).map(([k, v]) => ({
        label: k,
        days: Math.round(parseDuration(k) / 86400000),
        price: v
    })).filter((p) => p.days > 0);
}

/** Harga per hari fleksibel (di luar paket). */
function perDay() {
    const override = section().perDay;
    const n = Number(override);
    return Number.isSafeInteger(n) && n >= 0 ? n : (config.jadibot.price.perDay || 1000);
}

/**
 * Objek harga lengkap gaya config.jadibot.price — dipakai payment.priceFor,
 * validateDuration, dan priceListText supaya WA & panel menampilkan harga yang sama.
 * Kunci paket diturunkan dari days ('7d', '30d', …) supaya pencocokan durasi tetap bekerja.
 */
function priceConfig() {
    return {
        perDay: perDay(),
        minDays: config.jadibot.price.minDays ?? 1,
        maxDays: config.jadibot.price.maxDays ?? 3650,
        packages: Object.fromEntries(packages().map((p) => [`${p.days}d`, p.price]))
    };
}

function setPackages({ perDay: perDayVal, packages: list } = {}) {
    const s = section();
    if (perDayVal !== undefined) {
        const v = Number(perDayVal);
        if (!Number.isSafeInteger(v) || v < 0 || v > 100_000_000) throw new Error('Harga per hari tidak valid.');
        s.perDay = v;
    }
    if (list !== undefined) {
        const clean = normalizePackages(list);
        if (!clean.length) throw new Error('Minimal satu paket durasi harus ada.');
        const seen = new Set();
        for (const p of clean) {
            if (seen.has(p.days)) throw new Error(`Durasi ${p.days} hari dobel.`);
            seen.add(p.days);
        }
        s.packages = clean;
    }
    db.markDirty();
    return { perDay: perDay(), packages: packages() };
}

module.exports = { jadibotMax, jadibotMaxPerUser, setSlots, packages, perDay, priceConfig, setPackages };
