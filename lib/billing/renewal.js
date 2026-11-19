/**
 * PENGINGAT & PERPANJANGAN — sewa bot, premium, jadibot (satu modul untuk ketiganya).
 *
 *  1. Pengingat otomatis: sebelum habis (config.renewal.remindAt, mis. 3d → 1d → 3h) dan saat habis.
 *     Tiap pesan membawa tombol:  🔄 Perpanjang (langsung kirim QRIS)  &  ⬆️ Upgrade Waktu (pilih durasi lain).
 *  2. Perpanjang / upgrade = order QRIS tipe 'renew' (lihat lib/payment.js). Masa baru DITAMBAHKAN ke sisa masa aktif.
 *  3. Masa tenggang (config.renewal.graceHours): sesi jadibot & bot di grup sewa tidak langsung dihapus/keluar,
 *     sehingga pemilik masih bisa memperpanjang tanpa setup ulang.
 *
 * Keamanan (semua diperiksa di SERVER, bukan dari isi tombol):
 *  - harga & durasi dihitung ulang dari config tiap membuat tagihan; id tombol hanya membawa jenis, target, durasi
 *  - hak akses: premium = diri sendiri; sewa = penyewa / admin grup / Root Owner; jadibot = pemilik / Root Owner
 *  - satu tagihan perpanjangan aktif per target + kunci anti klik ganda
 *  - perpanjangan hanya diterapkan SEKALI per order (flag `applied`), aman dari retry / restart saat pemrosesan
 *  - pengingat dibatasi per putaran, diberi jeda, dan tiap tahap hanya terkirim sekali
 */
const config = require('../../config');
const db = require('../data/database');
const promotions = require('./promotions');
const { button } = require('../wa/rich');
const { parseDuration, formatDuration, formatDateTime, rupiah, sleep } = require('../core/utils');
const { logInfo, logSuccess, logWarn, logError, logDebug } = require('../core/logger');

const state = { sock: null, timer: null, busy: false, handleIncomingMessage: null };
const locks = new Set();

const cfg = () => config.renewal || {};
const pfx = () => config.prefix || '.';

const setSock = (sock) => { state.sock = sock; };

/* ───────────────────────── Jenis & helper ───────────────────────── */

const KINDS = {
    prem: { cmd: 'prem', label: 'Premium', icon: '⭐' },
    rent: { cmd: 'sewa', label: 'Sewa Bot', icon: '🏷️' },
    jadibot: { cmd: 'jadibot', label: 'Jadibot', icon: '🤖' }
};
const KIND_ALIAS = { prem: 'prem', premium: 'prem', buyprem: 'prem', sewa: 'rent', rent: 'rent', sewabot: 'rent', jadibot: 'jadibot', jb: 'jadibot', bot: 'jadibot' };

const normalizeKind = (token) => KIND_ALIAS[String(token || '').toLowerCase()] || '';
const digits = (v) => String(v || '').replace(/[^0-9]/g, '');
const jidOf = (number) => `${digits(number)}@s.whatsapp.net`;
const keyOf = (kind, target) => `${kind}:${target}`;

/** ms → token durasi yang bisa dibaca parseDuration ('30d', '1d12h', ...). */
function msToKey(ms) {
    let m = Math.max(1, Math.round(ms / 60000));
    const d = Math.floor(m / 1440); m -= d * 1440;
    const h = Math.floor(m / 60); m -= h * 60;
    return `${d ? d + 'd' : ''}${h ? h + 'h' : ''}${m ? m + 'm' : ''}`;
}

const bands = () => (cfg().remindAt || []).map(parseDuration).filter(Boolean).sort((a, b) => a - b);
const graceMs = () => Math.max(0, Number(cfg().graceHours) || 0) * 3600 * 1000;

/** Jalankan fn hanya bila kunci bebas (cegah klik ganda / tagihan ganda). */
async function withLock(key, fn) {
    if (locks.has(key)) return { busy: true };
    locks.add(key);
    try { return { value: await fn() }; } finally { locks.delete(key); }
}

/* ───────────────────────── Entitas langganan ───────────────────────── */

/** Data langganan (tanpa efek samping). null bila belum pernah ada. */
function getEntity(kind, target) {
    const now = Date.now();
    if (kind === 'prem') {
        const u = db.data.users[target];
        const pr = u?.premium;
        if (!pr || (!pr.since && !pr.expire && !pr.active)) return null;
        const active = db.isPremium(u);
        return { kind, target, label: `Premium +${target}`, owner: target, expire: pr.expire || 0, permanent: Boolean(pr.active && !pr.expire), active, lastDurationMs: pr.lastDurationMs || 0, age: now - (pr.since || now) };
    }
    if (kind === 'rent') {
        const g = db.data.groups[target];
        const r = g?.rent;
        if (!r || (!r.since && !r.expire)) return null;
        return { kind, target, label: g.name || target, owner: r.by || '', expire: r.expire || 0, permanent: Boolean(r.active && !r.expire), active: Boolean(r.active && (!r.expire || r.expire > now)), lastDurationMs: r.lastDurationMs || 0, age: now - (r.since || now), leaveAt: r.leaveAt || 0 };
    }
    if (kind === 'jadibot') {
        const rec = db.data.jadibots[target];
        if (!rec) return null;
        return { kind, target, label: `Jadibot +${target}`, owner: rec.owner || rec.requestedBy || '', expire: rec.expire || 0, permanent: !rec.expire, active: Boolean(rec.expire && rec.expire > now), lastDurationMs: rec.lastDurationMs || 0, age: now - (rec.createdAt || now), connected: rec.status === 'open' };
    }
    return null;
}

/** Siapa yang boleh memperpanjang? (selalu diperiksa server) */
function canManage(ent, who) {
    if (!ent) return false;
    if (who.isRootOwner) return true;
    if (ent.kind === 'prem') return ent.target === who.senderNumber;
    if (ent.kind === 'rent') return ent.owner === who.senderNumber || Boolean(who.isGroup && who.from === ent.target && who.isAdmin);
    if (ent.kind === 'jadibot') return ent.owner === who.senderNumber;
    return false;
}

/** Gratis? (mengikuti pengaturan jadibot/sewa/premium di config) */
function isFree(kind, { isRootOwner = false, isOwner = false, isPremium = false } = {}) {
    const cfg = kind === 'rent' ? config.sewa : kind === 'prem' ? config.premium : config.jadibot;
    if (!cfg) return false;
    return Boolean(((isRootOwner || isOwner) && cfg.freeForOwner) || (isPremium && cfg.freeForPremium));
}
function isFreeNumber(kind, number) {
    const u = db.data.users[number];
    return isFree(kind, { isRootOwner: (config.ownerNumber || []).includes(number), isPremium: db.isPremium(u) });
}

/* ───────────────────────── Harga & validasi ───────────────────────── */

function premPrice(ms) {
    const p = config.premium.price;
    const hours = Math.ceil(ms / 3600000);
    const days = Math.floor(hours / 24);
    const rem = hours - days * 24;
    return days * p.perDay + Math.min(rem * p.perHour, p.perDay);
}

function priceOf(kind, ms) {
    const payment = require('./payment');
    if (kind === 'prem') return premPrice(ms);
    if (kind === 'rent') return payment.priceFor(ms, config.sewa.price);
    return payment.priceFor(ms, config.jadibot.price);
}

/** '' bila valid, selain itu pesan error. */
function validate(kind, ms) {
    const payment = require('./payment');
    if (!Number.isFinite(ms) || ms <= 0) return 'Durasi tidak valid. Contoh: 7d, 30d, 1y.';
    if (kind === 'prem') {
        const p = config.premium.price;
        if (ms < p.minHours * 3600000) return `Durasi minimal ${p.minHours} jam.`;
        if (ms > p.maxDays * 86400000) return `Durasi maksimal ${p.maxDays} hari.`;
        return '';
    }
    return payment.validateDuration(ms, kind === 'rent' ? config.sewa.price : config.jadibot.price);
}

/** Durasi untuk tombol "Perpanjang": pembelian terakhir bila masih valid, kalau tidak paket bawaan. */
function defaultDuration(kind, ent) {
    const last = ent?.lastDurationMs || 0;
    if (last && !validate(kind, last)) return last;
    const key = cfg().defaultPackage?.[kind] || '30d';
    const ms = parseDuration(key);
    if (ms && !validate(kind, ms)) return ms;
    const pk = Object.keys((kind === 'rent' ? config.sewa.price : config.jadibot.price).packages || {})[0];
    return pk ? parseDuration(pk) : 30 * 86400000;
}

/** Baris button list pilihan durasi. */
function packageRows(kind, target, ent, free = false) {
    const keys = kind === 'prem'
        ? ['1d', '3d', '7d', '30d', '90d', '1y']
        : Object.keys((kind === 'rent' ? config.sewa.price : config.jadibot.price).packages || {});
    const rows = [];
    for (const k of keys) {
        const ms = parseDuration(k);
        if (!ms || validate(kind, ms)) continue;
        const price = priceOf(kind, ms);
        const t = target ? ` ${target}` : '';
        rows.push({
            header: KINDS[kind].label.toUpperCase(),
            title: `+${formatDuration(ms)} • ${free ? 'GRATIS' : rupiah(promotions.quote(kind, price).price)}`.slice(0, 24),
            description: `${!free && promotions.discount(kind) ? `Diskon ${promotions.discount(kind)}% • ` : ''}Berakhir ${formatDateTime(new Date(previewExpire(ent, ms)))}`.slice(0, 72),
            id: `${pfx()}perpanjang ${KINDS[kind].cmd}${t} ${k}`
        });
    }
    return rows;
}

const previewExpire = (ent, ms) => Math.max(ent?.expire || 0, Date.now()) + ms;

/* ───────────────────────── Tombol & pesan ───────────────────────── */

/** [🔄 Perpanjang (QRIS langsung)] + [⬆️ Upgrade Waktu (pilih durasi)] */
function renewButtons(kind, target, ent = getEntity(kind, target)) {
    const dur = defaultDuration(kind, ent);
    const t = kind === 'prem' ? '' : ` ${target}`;
    const short = formatDuration(dur).split(' ').slice(0, 2).join(' ');
    return [
        button.quick(`🔄 Perpanjang ${short}`.slice(0, 24), `${pfx()}perpanjang ${KINDS[kind].cmd}${t} ${msToKey(dur)}`),
        button.quick('⬆️ Upgrade Waktu', `${pfx()}perpanjang ${KINDS[kind].cmd}${t}`)
    ];
}

async function deliver(jid, content, buttons, fallbackHint = '') {
    const sock = state.sock;
    if (!sock) return false;
    try {
        await sock.sendUniversalButton(jid, { ...content, footer: config.footerText }, buttons);
        return true;
    } catch (err) {
        logDebug('RENEWAL', `Tombol ke ${jid} gagal (${err.message}), kirim teks`);
        try { await sock.sendMessage(jid, { text: `${content.body}${fallbackHint}` }); return true; }
        catch (err2) { logWarn('RENEWAL', `Kirim ke ${jid} gagal: ${err2.message}`); return false; }
    }
}

function infoLines(ent, now = Date.now()) {
    const lines = [`${KINDS[ent.kind].icon} *${KINDS[ent.kind].label}* • ${ent.label}`];
    if (ent.expire) {
        const remain = ent.expire - now;
        lines.push(remain > 0 ? `⌛ Sisa     : *${formatDuration(remain)}*` : `⌛ Status   : *sudah habis*`);
        lines.push(`📅 Berakhir : ${formatDateTime(new Date(ent.expire))}`);
    }
    return lines.join('\n');
}

function renewalHint(kind, ent) {
    const dur = defaultDuration(kind, ent);
    const free = ent.owner && isFreeNumber(kind, ent.owner);
    return `🔄 *Perpanjang ${formatDuration(dur)}* = ${free ? 'GRATIS' : promotions.priceText(kind, priceOf(kind, dur), rupiah)} (QRIS langsung dikirim)\n⬆️ *Upgrade Waktu* = pilih durasi lain`;
}

/** Penerima pengingat: [{ jid, rich }] — rich = boleh memakai tombol (hanya yang berwenang). */
function recipients(ent) {
    const out = [];
    const owner = digits(ent.owner);
    if (ent.kind === 'prem') {
        const u = db.data.users[ent.target];
        if (u?.settings?.notify === false) return out;
        out.push({ jid: u?.jid || jidOf(ent.target), rich: true });
    } else {
        if (owner) out.push({ jid: db.data.users[owner]?.jid || jidOf(owner), rich: true });
        if (ent.kind === 'rent' && cfg().notifyGroup !== false) out.push({ jid: ent.target, rich: true, group: true });
        if (ent.kind === 'jadibot' && ent.target !== owner) out.push({ jid: jidOf(ent.target), rich: false });
    }
    return out;
}

/** Kirim pengingat/pemberitahuan habis. True bila minimal satu penerima berhasil. */
async function sendPrompt(ent, mode) {
    const now = Date.now();
    const K = KINDS[ent.kind];
    const expired = mode === 'expired';
    const title = expired ? `⌛ ${K.label.toUpperCase()} BERAKHIR` : `⏰ ${K.label.toUpperCase()} HAMPIR HABIS`;
    let tail;
    if (expired) {
        if (ent.kind === 'jadibot') tail = graceMs() ? `Sesi *disimpan sampai ${formatDateTime(new Date(ent.expire + graceMs()))}*. Perpanjang sekarang — bot tersambung lagi otomatis tanpa pairing ulang.` : 'Beli ulang dengan *.jadibot <nomor> <durasi>*.';
        else if (ent.kind === 'rent') tail = ent.leaveAt > now ? `Bot menunggu perpanjangan sampai *${formatDateTime(new Date(ent.leaveAt))}*, setelah itu keluar dari grup.` : 'Sewa lagi kapan saja.';
        else tail = 'Limit harian kembali ke batas user biasa dan jadibot tidak lagi gratis.';
    } else tail = 'Perpanjang sekarang agar layanan tidak terputus. Masa baru *ditambahkan* ke sisa waktu (tidak hangus).';
    const body = `${infoLines(ent, now)}\n\n${tail}\n\n${renewalHint(ent.kind, ent)}`;
    const hint = `\n\nPerpanjang: *${pfx()}perpanjang ${K.cmd}${ent.kind === 'prem' ? '' : ' ' + ent.target}*`;
    let ok = false;
    for (const r of recipients(ent)) {
        const sent = r.rich
            ? await deliver(r.jid, { title, body }, renewButtons(ent.kind, ent.target, ent), hint)
            : await deliver(r.jid, { title, body: `${infoLines(ent, now)}\n\n${tail}\n\n👑 Perpanjangan dilakukan oleh pemilik bot: +${digits(ent.owner)}.` }, [], '');
        ok = ok || sent;
        await sleep(1200);
    }
    return ok;
}

/** Dipakai lib/rental.js: beri tahu penyewa lewat chat pribadi bahwa sewa grupnya habis. */
async function notifyExpiredOwner(kind, target) {
    if (!cfg().enabled) return false;
    const ent = getEntity(kind, target);
    if (!ent) return false;
    const owner = digits(ent.owner);
    if (!owner) return false;
    const K = KINDS[kind];
    const tail = ent.leaveAt > Date.now() ? `Bot menunggu perpanjangan sampai *${formatDateTime(new Date(ent.leaveAt))}*, setelah itu keluar dari grup.` : 'Sewa lagi kapan saja dengan *.sewabot*.';
    return await deliver(db.data.users[owner]?.jid || jidOf(owner), { title: `⌛ ${K.label.toUpperCase()} BERAKHIR`, body: `${infoLines(ent)}\n\n${tail}\n\n${renewalHint(kind, ent)}` }, renewButtons(kind, target, ent), `\n\nPerpanjang: *${pfx()}perpanjang ${K.cmd} ${target}*`);
}

/* ───────────────────────── Menerapkan perpanjangan ───────────────────────── */

/** Reset status pengingat setelah masa aktif berubah (hanya pengingat ke depan yang dikirim). */
function touch(kind, target, expire) {
    db.data.reminders = db.data.reminders || {};
    const remain = expire ? expire - Date.now() : Infinity;
    db.data.reminders[keyOf(kind, target)] = { expire: expire || 0, sent: bands().filter((t) => remain <= t), expiredNotified: false, fail: 0 };
    db.markDirty();
}

/**
 * Tambahkan masa aktif. Melempar Error bila tidak bisa (order pembayaran lalu dicoba ulang otomatis).
 * @returns {{expire:number, note:string}}
 */
async function applyExtension(kind, target, ms, { sock = state.sock, handleIncomingMessage = state.handleIncomingMessage, by = '' } = {}) {
    const ent = getEntity(kind, target);
    if (!ent) throw new Error(`${KINDS[kind]?.label || kind} tidak ditemukan (data sudah dihapus).`);
    if (ent.permanent) throw new Error(`${ent.label} berstatus permanen — tidak perlu diperpanjang.`);
    if (validate(kind, ms)) throw new Error(validate(kind, ms));

    let expire, note = '';
    if (kind === 'prem') {
        const payment = require('./payment');
        const pr = payment.grantPremium(target, ms);
        pr.lastDurationMs = ms;
        expire = pr.expire;
    } else if (kind === 'rent') {
        const rental = require('./rental');
        if (!sock?.sendMessage) throw new Error('Bot utama belum terhubung, coba lagi sebentar.');
        try { await sock.groupMetadata(target); }
        catch { throw new Error('Bot sudah tidak berada di grup itu. Kirim link grup lewat *.sewabot <link>* untuk menyewa ulang.'); }
        const r = await rental.grant(sock, { groupJid: target, owner: ent.owner || by, durationMs: ms });
        expire = r.expire;
    } else {
        const jadibot = require('../bot/jadibotManager');
        const r = await jadibot.extendJadibot(target, ms, { handleIncomingMessage, by });
        expire = r.expire;
        if (r.restarted) note = '\n🔌 Sesi tersimpan dinyalakan kembali otomatis (tanpa pairing ulang).';
    }
    touch(kind, target, expire);
    return { expire, note };
}

/** Dipanggil lib/payment.js setelah LUNAS. Mengembalikan teks notifikasi untuk pembeli. */
async function fulfill(order, ctx = {}) {
    const kind = order.kind;
    if (!KINDS[kind]) throw new Error(`Jenis perpanjangan tidak dikenal: ${kind}`);
    if (!order.applied) {
        const r = await applyExtension(kind, order.target, order.durationMs, { sock: ctx.sock, handleIncomingMessage: ctx.handleIncomingMessage, by: order.owner });
        order.applied = true;                  // tandai SEGERA: retry tidak akan menambah waktu dua kali
        order.appliedExpire = r.expire;
        order.appliedNote = r.note || '';
        db.markDirty();
    }
    const ent = getEntity(kind, order.target);
    const label = ent?.label || order.targetLabel || order.target;
    return `✅ *Pembayaran diterima — perpanjangan berhasil!*\n${KINDS[kind].icon} ${KINDS[kind].label}: *${label}*\n➕ Ditambah: ${formatDuration(order.durationMs)}\n📅 Aktif sampai: *${formatDateTime(new Date(order.appliedExpire))}*${order.appliedNote || ''}`;
}

/* ───────────────────────── Daftar langganan milik user ───────────────────────── */

function listOwned(senderNumber, isRootOwner = false) {
    const out = [];
    const u = db.data.users[senderNumber];
    if (u?.premium && (u.premium.since || u.premium.expire)) out.push(getEntity('prem', senderNumber));
    for (const [jid, g] of Object.entries(db.data.groups)) if ((g.rent?.by === senderNumber || (isRootOwner && g.rent?.expire)) && (g.rent.since || g.rent.expire)) out.push(getEntity('rent', jid));
    for (const [num, rec] of Object.entries(db.data.jadibots)) if ((rec.owner === senderNumber || (isRootOwner && rec.expire)) && rec.expire) out.push(getEntity('jadibot', num));
    return out.filter(Boolean);
}

/* ───────────────────────── Penjadwal pengingat ───────────────────────── */

function* items(now) {
    for (const [num, u] of Object.entries(db.data.users)) if (u.premium?.expire > 0) yield { kind: 'prem', target: num };
    for (const [jid, g] of Object.entries(db.data.groups)) if (g.rent?.expire > 0) yield { kind: 'rent', target: jid };
    for (const [num, rec] of Object.entries(db.data.jadibots)) if (rec.expire > 0) yield { kind: 'jadibot', target: num };
}

async function processItem(ent, st, bs, budget, now) {
    const remain = ent.expire - now;
    if (remain > 0) {
        const T = bs.find((t) => remain <= t);
        if (!T || st.sent.includes(T)) return;
        if (budget.left <= 0) return;
        budget.left--;
        const ok = await sendPrompt(ent, 'reminder');
        if (ok || ++st.fail >= 3) { st.sent = [...new Set([...st.sent, ...bs.filter((t) => t >= T)])]; st.fail = 0; }
        db.markDirty();
        return;
    }
    // sudah habis
    if (ent.kind === 'prem') {                                  // rapikan status (getUser melakukannya juga saat user aktif)
        const u = db.data.users[ent.target];
        if (u.premium.active) { u.premium.active = false; if (u.role === 'premium') u.role = 'user'; db.markDirty(); }
    }
    if (ent.kind === 'rent' || st.expiredNotified) return;     // pesan habis untuk sewa dikirim lib/rental.js
    if (budget.left <= 0) return;
    budget.left--;
    const ok = await sendPrompt(ent, 'expired');
    if (ok || ++st.fail >= 3) { st.expiredNotified = true; st.fail = 0; }
    db.markDirty();
}

async function cleanupJadibotGrace(now) {
    const jadibot = require('../bot/jadibotManager');
    const grace = graceMs();
    for (const [num, rec] of Object.entries(db.data.jadibots)) {
        if (!rec.expire || now <= rec.expire + grace) continue;
        if (jadibot.jadibotSessions.has(num)) continue;             // watcher jadibotManager yang mematikan dulu
        const owner = digits(rec.owner);
        const had = await jadibot.stopJadibot(num, true);
        if (!had) db.removeJadibot(num);
        delete (db.data.reminders || {})[keyOf('jadibot', num)];
        logInfo('RENEWAL', `Masa tenggang jadibot +${num} habis, sesi dihapus`);
        if (owner) { try { await state.sock?.sendMessage(jidOf(owner), { text: `🗑️ Masa tenggang jadibot *+${num}* berakhir, sesi dihapus. Buat lagi dengan *${pfx()}jadibot ${num} <durasi>*.` }); } catch {} }
    }
}

async function tick() {
    if (!cfg().enabled || state.busy || !state.sock || !db.data) return;
    state.busy = true;
    try {
        const now = Date.now();
        const bs = bands();
        const budget = { left: Math.max(1, Number(cfg().maxSendPerCycle) || 30) };
        const rem = db.data.reminders = db.data.reminders || {};
        const live = new Set();

        for (const { kind, target } of items(now)) {
            const key = keyOf(kind, target);
            live.add(key);
            const ent = getEntity(kind, target);
            if (!ent || !ent.expire || ent.permanent) continue;
            const remain = ent.expire - now;
            let st = rem[key];
            if (!st || st.expire !== ent.expire) {                  // baru terlihat, atau masa aktif berubah (diperpanjang)
                const first = !st;
                const quiet = !first || ent.age < 30 * 60 * 1000;   // perpanjangan / langganan baru: tidak mengirim tahap yang sudah lewat
                st = rem[key] = { expire: ent.expire, sent: quiet ? bs.filter((t) => remain <= t) : [], expiredNotified: first && remain <= 0, fail: 0 };
                db.markDirty();
            }
            try { await processItem(ent, st, bs, budget, now); }
            catch (err) { logWarn('RENEWAL', `${key}: ${err.message}`); }
            if (budget.left <= 0) break;
        }
        for (const key of Object.keys(rem)) if (!live.has(key) && budget.left > 0) { delete rem[key]; db.markDirty(); }
        await cleanupJadibotGrace(now);
    } catch (err) { logError('RENEWAL', err); }
    finally { state.busy = false; }
}

function start({ handleIncomingMessage } = {}) {
    if (handleIncomingMessage) state.handleIncomingMessage = handleIncomingMessage;
    if (state.timer || !cfg().enabled) return;
    const every = Math.max(1, Number(cfg().checkIntervalMin) || 10) * 60 * 1000;
    state.timer = setInterval(() => tick().catch((e) => logError('RENEWAL', e)), every);
    if (state.timer.unref) state.timer.unref();
    const first = setTimeout(() => tick().catch((e) => logError('RENEWAL', e)), 45000);
    if (first.unref) first.unref();
    logInfo('RENEWAL', `Pengingat aktif • cek tiap ${Math.round(every / 60000)} mnt • tahap: ${(cfg().remindAt || []).join(', ')} • masa tenggang ${cfg().graceHours || 0} jam`);
}

const stop = () => { clearInterval(state.timer); state.timer = null; };

module.exports = {
    KINDS, setSock, start, stop, tick,
    normalizeKind, getEntity, canManage, isFree, isFreeNumber, priceOf, validate, defaultDuration, packageRows, previewExpire,
    renewButtons, infoLines, renewalHint, sendPrompt, notifyExpiredOwner, applyExtension, fulfill, listOwned, withLock, msToKey, touch
};
