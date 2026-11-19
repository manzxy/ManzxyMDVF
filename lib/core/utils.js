const config = require('../../config');
require('./configDefaults').apply(config);      // lengkapi config.js lama dengan kunci baru

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runtime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (d) parts.push(`${d}hr`);
    if (d || h) parts.push(`${h}jam`);
    if (d || h || m) parts.push(`${m}mnt`);
    parts.push(`${s}dtk`);
    return parts.join(' ');
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function hourInTz() {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hour12: false }).format(new Date())) % 24;
}

function getGreeting() {
    const h = hourInTz();
    if (h < 4) return 'Selamat Malam 🌙';
    if (h < 11) return 'Selamat Pagi 🌅';
    if (h < 15) return 'Selamat Siang ☀️';
    if (h < 18) return 'Selamat Sore 🌇';
    return 'Selamat Malam 🌙';
}

/** 'YYYY-MM-DD' pada timezone bot (dipakai reset limit harian). */
function dateKey(date = new Date()) {
    return date.toLocaleDateString('en-CA', { timeZone: config.timezone });
}

function formatDateTime(date = new Date()) {
    return date.toLocaleString('id-ID', { timeZone: config.timezone, hour12: false, dateStyle: 'medium', timeStyle: 'short' });
}

function clock(date = new Date()) {
    return date.toLocaleTimeString('id-ID', { timeZone: config.timezone, hour12: false }).replace(/\./g, ':');
}

/** Ambil angka nomor dari JID apa pun (62xxx@s.whatsapp.net, 62xxx:12@s.whatsapp.net, xxx@lid). */
function numberOf(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
}

const UNIT_MS = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3, mo: 30 * 86400e3, y: 365 * 86400e3 };

/**
 * Durasi → milidetik (0 jika tidak valid). Mendukung satuan m, h, d, w, mo, y dan gabungan:
 * '30m' '12h' '7d' '2w' '1mo' '1y' '1d12h' '1y6mo'
 */
function parseDuration(str) {
    const t = String(str || '').trim().toLowerCase();
    if (!/^(\d+(mo|y|w|d|h|m))+$/.test(t)) return 0;
    let total = 0;
    for (const m of t.matchAll(/(\d+)(mo|y|w|d|h|m)/g)) total += Number(m[1]) * UNIT_MS[m[2]];
    return total;
}

/** 90061000 → '1 hari 1 jam 1 menit'. 0 → 'Permanen'. */
function formatDuration(ms) {
    if (!ms || ms <= 0) return 'Permanen';
    let s = Math.floor(ms / 60000);              // menit
    const parts = [];
    for (const [label, size] of [['tahun', 525600], ['bulan', 43200], ['hari', 1440], ['jam', 60], ['menit', 1]]) {
        const n = Math.floor(s / size);
        if (n) { parts.push(`${n} ${label}`); s -= n * size; }
    }
    return parts.slice(0, 3).join(' ') || 'kurang dari 1 menit';
}

function truncate(str, n = 60) {
    str = String(str || '').replace(/\s+/g, ' ').trim();
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

/** Buang pembungkus ```code fence``` jika ada. */
function stripCodeFence(text) {
    let t = String(text || '').trim();
    const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
    if (m) t = m[1];
    return t.replace(/\r\n/g, '\n');
}

/** Pecah teks panjang menjadi beberapa pesan tanpa memotong di tengah baris. */
function splitMessage(text, limit = 3500) {
    if (text.length <= limit) return [text];
    const out = [];
    let buf = '';
    for (const block of text.split(/\n(?=\n)/)) {
        if ((buf + block).length > limit && buf) { out.push(buf.trim()); buf = ''; }
        if (block.length > limit) {
            for (let i = 0; i < block.length; i += limit) out.push(block.slice(i, i + limit));
        } else buf += block + '\n';
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
}

const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');

/** 0812xxx → 62812xxx, buang spasi/+/tanda hubung. */
function normalizePhone(input) {
    let n = String(input || '').replace(/[^0-9]/g, '');
    if (n.startsWith('0')) n = '62' + n.slice(1);
    return n;
}

/** Teks → huruf tebal Unicode (𝗟𝗜𝗠𝗜𝗧). Dipakai untuk label di menu; karakter lain dibiarkan. */
function boldFont(str) {
    return Array.from(String(str)).map((ch) => {
        const c = ch.codePointAt(0);
        if (c >= 65 && c <= 90) return String.fromCodePoint(0x1D5D4 + c - 65);
        if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D5EE + c - 97);
        if (c >= 48 && c <= 57) return String.fromCodePoint(0x1D7EC + c - 48);
        return ch;
    }).join('');
}

function isPlainObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
}

module.exports = {
    sleep, runtime, formatBytes, getGreeting, dateKey, formatDateTime, clock, numberOf,
    parseDuration, formatDuration, rupiah, normalizePhone, boldFont, truncate, stripCodeFence, splitMessage, isPlainObject
};
