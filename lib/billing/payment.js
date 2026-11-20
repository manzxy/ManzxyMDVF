/**
 * PEMBAYARAN (KiPay QRIS) — jadibot, premium & topup
 * Alur: command → buat transaksi → kirim QR → poller cek status → LUNAS → proses otomatis.
 * Status order: pending → paid → fulfilling → done   |  expired | failed
 * Order disimpan di database sehingga tetap diproses meski bot restart.
 * Tipe order: 'jadibot' (target = nomor), 'prem' (target = nomor penerima premium), 'topup', 'renew'.
 */
const config = require('../../config');
const db = require('../data/database');
const promotions = require('./promotions');
const axios = require('axios');
const { launchAndDeliver } = require('../bot/jadibotManager');
const { button } = require('../wa/rich');
const { parseDuration, rupiah, formatDuration, formatDateTime } = require('../core/utils');
const runtimeSettings = require('../core/runtimeSettings');
const { logInfo, logSuccess, logWarn, logError, logDebug } = require('../core/logger');

/* ───────────── Klien KiPay QRIS (https://kipay.biz.id/docs/api) ─────────────
 * KiPay menambah kode unik ke nominal: requested_amount → yang diminta, amount → TOTAL yang wajib dibayar persis.
 * Webhook KiPay belum punya signature publik → status SELALU diverifikasi lewat getTransaction().
 */
const BASE = 'https://api.kipay.biz.id/api/pay';

const fail = (e) => {
    // KiPay membalas { "error": "pesan" } untuk 4xx
    throw new Error(e?.response?.data?.error || e?.message || 'KiPay error');
};

const key = () => {
    if (!config.kipay?.api_key) throw new Error('KiPay api_key belum diisi di config.js');
    return config.kipay.api_key;
};

/**
 * Buat transaksi QRIS. KiPay menambahkan kode unik ke nominal:
 *   requested_amount → yang diminta, amount → TOTAL yang wajib dibayar persis, net_amount → setelah fee.
 */
async function createTransaction(amount, note = '') {
    try {
        const { data } = await axios.post(
            `${BASE}/${key()}/transactions`,
            { amount: Math.round(amount), note: note || undefined },
            { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        return data;
    } catch (e) { fail(e); }
}

/** status: 'pending' | 'paid' | 'expired' */
async function getTransaction(trxId) {
    try {
        const { data } = await axios.get(`${BASE}/${key()}/transactions/${trxId}`, { headers: { Accept: 'application/json' }, timeout: 10000 });
        return data;
    } catch (e) { fail(e); }
}

/** URL QR PNG dari KiPay (cadangan). Mengandung api_key → jangan dikirim ke user sebagai teks. */
const qrPngUrl = (trxId) => `${BASE}/${key()}/transactions/${trxId}/qr.png`;

/** Buat PNG QR secara lokal dari qr_payload (butuh paket "qrcode"); null bila tidak tersedia. */
async function qrBuffer(payload) {
    try {
        const QR = require('qrcode');
        return await QR.toBuffer(String(payload), { width: 500, margin: 2 });
    } catch { return null; }
}


const kipay = { createTransaction, getTransaction, qrPngUrl, qrBuffer };

const state = { sock: null, handleIncoming: null, timer: null, busy: false };
const MAX_FULFILL_ATTEMPTS = 10;
const FULFILL_RETRY_MS = 30000;
const ACTIVE = ['pending', 'paid', 'fulfilling'];

const isEnabled = () => Boolean(config.kipay?.api_key);
const setSock = (sock) => { state.sock = sock; };

/* ───────────── Harga ───────────── */

/** Harga untuk durasi (ms): paket persis dulu, kalau tidak ada → perDay × hari (dibulatkan ke atas). */
function priceFor(durationMs, p = runtimeSettings.priceConfig()) {
    for (const [key, price] of Object.entries(p.packages || {})) if (parseDuration(key) === durationMs) return price;
    return Math.ceil(durationMs / 86400000) * p.perDay;
}

/** Mengembalikan pesan error bila durasi tidak valid, '' jika valid. */
function validateDuration(durationMs, p = runtimeSettings.priceConfig()) {
    const days = durationMs / 86400000;
    if (!durationMs) return 'Durasi wajib diisi, contoh: 7d, 30d.';
    if (days < p.minDays) return `Durasi minimal ${p.minDays} hari.`;
    if (days > p.maxDays) return `Durasi maksimal ${p.maxDays} hari.`;
    return '';
}

function priceListText(prefix, p = runtimeSettings.priceConfig(), title = 'HARGA JADIBOT', withFooter = true, kind = 'jadibot') {
    const lines = Object.entries(p.packages || {}).map(([k, v]) => `• ${k.padEnd(4)} → ${promotions.priceText(kind, v, rupiah)}`);
    const base = `*💰 ${title}*\n${lines.join('\n')}\n• Durasi lain: ${rupiah(p.perDay)}/hari (${p.minDays}–${p.maxDays} hari)${promotions.discount(kind) ? `, diskon ${promotions.discount(kind)}% saat checkout` : ''}`;
    return withFooter ? `${base}\n\n${promotions.freeJadibot() ? `🆓 Promo slot gratis terbatas: ${promotions.freeUsage()}/${promotions.freeSlots()} terpakai.` : '🆓 Gratis untuk *Owner* & user *Premium* sesuai pengaturan.'}\n\nContoh: *${prefix}jadibot 628123456789 7d*` : base;
}

/* ───────────── Order ───────────── */

const orders = () => db.data.orders;

function findPending(owner, target) {
    return Object.values(orders()).find((o) => o.type === 'jadibot' && o.owner === owner && o.target === target && ACTIVE.includes(o.status));
}
function countPendingByOwner(owner) {
    return Object.values(orders()).filter((o) => o.type === 'jadibot' && o.owner === owner && ACTIVE.includes(o.status)).length;
}
async function createOrder(fields, priceCfg, note, fixedPrice) {
    const basePrice = fixedPrice ?? priceFor(fields.durationMs, priceCfg);
    const kind = fields.type === 'renew' ? fields.kind : fields.type;
    const { price, percent: discountPercent } = promotions.quote(kind, basePrice);
    const trx = await kipay.createTransaction(price, note);
    const parsedExpiry = Date.parse(trx.expires_at);
    const order = {
        trxId: trx.trx_id, ...fields, basePrice, discountPercent, price, amount: trx.amount, status: 'pending', attempts: 0, lastError: '',
        createdAt: Date.now(), expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 30 * 60 * 1000,
        qrPayload: trx.qr_payload || ''
    };
    orders()[order.trxId] = order;
    db.markDirty();
    ensurePoller();
    logSuccess('PAYMENT', `Order ${order.trxId} [${order.type}] owner +${order.owner} ${formatDuration(order.durationMs)} = ${rupiah(order.amount)}`);
    return { order, trx };
}

const createJadibotOrder = ({ target, owner, chat, durationMs }) =>
    createOrder({ type: 'jadibot', target, owner, chat, durationMs }, runtimeSettings.priceConfig(), `jadibot:${target}:owner:${owner}`);

/** Beri / perpanjang premium: masa baru ditambahkan ke sisa masa aktif. ms = 0 → permanen. */
function grantPremium(number, ms) {
    const u = db.getUser(number);
    const now = Date.now();
    const base = u.premium.active && u.premium.expire > now ? u.premium.expire : now;
    const permanent = !ms || (u.premium.active && !u.premium.expire);
    u.premium = { active: true, expire: permanent ? 0 : base + ms, since: u.premium.active ? u.premium.since : now };
    u.role = 'premium';
    db.markDirty();
    return u.premium;
}

/** `price` dihitung oleh plugin .buyprem (harga per jam/hari). */
const createPremOrder = ({ target, owner, chat, durationMs, price }) =>
    createOrder({ type: 'prem', target, targetKey: target, owner, chat, durationMs }, null, `prem:${target}:by:${owner}`, price);

function findPendingPrem(owner, target) {
    return Object.values(orders()).find((o) => o.type === 'prem' && o.owner === owner && o.target === target && ACTIVE.includes(o.status));
}

/**
 * Order PERPANJANGAN / UPGRADE WAKTU (kind: 'prem' | 'jadibot').
 * `price` SELALU dihitung server (lib/renewal.js) — tidak pernah dari input pengguna.
 */
const createRenewOrder = ({ kind, target, targetLabel = '', owner, chat, durationMs, price }) =>
    createOrder({ type: 'renew', kind, target, targetKey: `${kind}:${target}`, targetLabel, owner, chat, durationMs }, null, `renew:${kind}:${target}:by:${owner}`, price);

/** Topup saldo (dipakai panel web). `credit` = saldo yang masuk setelah lunas. */
const createTopupOrder = ({ target, owner, chat, credit, packageId, price }) =>
    createOrder({ type: 'topup', target, targetKey: `topup:${owner}`, owner, chat, credit, packageId, durationMs: 0 }, null, `topup:${owner}:${packageId}`, price);

const findPendingRenew = (kind, target) =>
    Object.values(orders()).find((o) => o.type === 'renew' && o.kind === kind && o.target === target && ACTIVE.includes(o.status));

const TYPE_LABEL = { jadibot: 'Jadibot', prem: 'Premium', renew: 'Perpanjangan', topup: 'Topup Saldo' };
const STATUS_LABEL = { pending: '⏳ Menunggu pembayaran', paid: '💰 Dibayar (diproses)', fulfilling: '⚙️ Sedang diproses', done: '✅ Selesai', expired: '⌛ Kedaluwarsa', cancelled: '❌ Dibatalkan', failed: '⚠️ Gagal diproses' };

function describeOrder(o) {
    const target = o.type === 'renew' ? (o.targetLabel || `+${o.target}`) : `+${o.target}`;
    return `*${TYPE_LABEL[o.type] || o.type}* • ${target}\n   ${STATUS_LABEL[o.status] || o.status} • ${rupiah(o.amount)} • ${formatDuration(o.durationMs)}\n   🧾 ${o.trxId}`;
}

const buttonsFor = (order) => [
    button.quick('❌ Batalkan Tagihan', `${config.prefix}batalbayar ${order.trxId}`),
    button.quick('🔄 Cek Status', `${config.prefix}cekbayar ${order.trxId}`)
];

/** Kirim tagihan: gambar QRIS + tombol Batalkan / Cek Status (cadangan: gambar + caption biasa). */
async function sendInvoice(sock, chat, quoted, order, trx, caption) {
    const png = await kipay.qrBuffer(trx.qr_payload);
    const image = png || { url: kipay.qrPngUrl(order.trxId) };
    try {
        await sock.sendUniversalButton(chat, { body: caption, footer: config.footerText, image, requireMedia: true, fallback: false }, buttonsFor(order), quoted);
        return;
    } catch (err) { logWarn('PAYMENT', `Tagihan bertombol gagal (${err.message}), kirim gambar biasa`); }
    try {
        await sock.sendMessage(chat, { image, caption: `${caption}\n\nBatalkan: *${config.prefix}batalbayar ${order.trxId}*` }, { quoted });
    } catch (err) {
        await sock.sendMessage(chat, { text: `${caption}\n\n_(Gambar QR gagal dikirim: ${err.message})_\nQR payload:\n${trx.qr_payload || '-'}\n\nBatalkan: *${config.prefix}batalbayar ${order.trxId}*` }, { quoted });
    }
}

/** Pengingat "tagihan masih berjalan" + tombol Batalkan. */
async function sendPendingNotice(sock, chat, quoted, order, what = 'ini') {
    await sock.sendUniversalButton(chat, {
        title: '⏳ TAGIHAN MASIH BERJALAN',
        body: `Tagihan untuk ${what} masih menunggu pembayaran.\n\n${describeOrder(order)}\n\nBayar tepat *${rupiah(order.amount)}* via QRIS, atau batalkan untuk membuat tagihan baru.\n_Catatan: jangan membayar QR yang sudah dibatalkan._`,
        footer: config.footerText
    }, buttonsFor(order), quoted);
}

/**
 * Batalkan tagihan (hanya yang masih menunggu pembayaran). KiPay tidak punya API pembatalan, jadi
 * QR lama tetap bisa dibayar sampai kedaluwarsa — bila ternyata dibayar, tetap diproses (uang tidak hilang).
 */
function cancelOrder(trxId, byNumber, isRoot = false) {
    const o = orders()[trxId];
    if (!o) return { ok: false, error: 'Tagihan tidak ditemukan.' };
    if (o.owner !== byNumber && !isRoot) return { ok: false, error: 'Itu bukan tagihanmu.' };
    if (o.status === 'cancelled') return { ok: false, error: 'Tagihan ini sudah dibatalkan.' };
    if (o.status !== 'pending') return { ok: false, error: `Tagihan tidak bisa dibatalkan (${(STATUS_LABEL[o.status] || o.status).replace(/^\S+ /, '')}).` };
    o.status = 'cancelled';
    o.cancelledAt = Date.now();
    db.markDirty();
    logInfo('PAYMENT', `Order ${trxId} dibatalkan oleh +${byNumber}`);
    return { ok: true, order: o };
}

const ownOrders = (owner, statuses) => Object.values(orders()).filter((o) => o.owner === owner && (!statuses || statuses.includes(o.status))).sort((a, b) => b.createdAt - a.createdAt);

async function notify(order, text) {
    try { await state.sock?.sendMessage(order.chat, { text }); } catch (e) { logDebug('PAYMENT', `notif gagal: ${e.message}`); }
}
async function notifyRootOwners(text) {
    for (const n of config.ownerNumber) { try { await state.sock?.sendMessage(`${n}@s.whatsapp.net`, { text }); } catch {} }
}

/* ───────────── Proses setelah LUNAS ───────────── */

async function runJadibot(order) {
    const r = await launchAndDeliver({
        parentSock: state.sock, targetNumber: order.target, ownerNumber: order.owner,
        chatFrom: order.chat, expireMs: order.durationMs, handleIncomingMessage: state.handleIncoming
    });
    return `✅ *Pembayaran diterima!*\n` + (r.deliveredTo === 'restored'
        ? `Sesi jadibot *+${order.target}* sedang disambungkan kembali.`
        : r.deliveredTo === 'target'
            ? `Kode pairing sudah dikirim ke *+${order.target}*. Minta pemilik nomor memasukkan kode di WhatsApp (Perangkat Tertaut).`
            : `Kode pairing tidak bisa dikirim ke +${order.target}, jadi dikirim ke chat pribadimu. Teruskan ke pemilik nomor.`) +
        `\n\n👑 Kamu adalah *owner* jadibot ini. Kelola lewat *${config.prefix}listjadibot*.`;
}

async function runPrem(order) {
    const pr = grantPremium(order.target, order.durationMs);
    const gift = order.target !== order.owner;
    if (gift) { try { await state.sock?.sendMessage(`${order.target}@s.whatsapp.net`, { text: `🎁 *Kamu mendapat PREMIUM dari +${order.owner}!*\nAktif sampai ${pr.expire ? formatDateTime(new Date(pr.expire)) : 'selamanya'}. Limit harian jadi *unlimited*.` }); } catch {} }
    return `✅ *Pembayaran diterima!*\n⭐ Premium ${gift ? `untuk *+${order.target}*` : 'kamu'} aktif sampai *${pr.expire ? formatDateTime(new Date(pr.expire)) : 'selamanya'}*.\n\n• Limit harian: *UNLIMITED*\n• Jadibot: *gratis*\nCek kapan saja dengan *${config.prefix}cekprem*.`;
}

async function runRenew(order) {
    const renewal = require('./renewal');
    return await renewal.fulfill(order, { sock: state.sock, handleIncomingMessage: state.handleIncoming });
}

/** Topup saldo: tambahkan ke user.money. */
async function runTopup(order) {
    const u = db.getUser(order.owner);
    const credit = Number(order.credit) || 0;
    if (!credit) throw new Error('Nominal saldo tidak valid.');
    u.money = (u.money || 0) + credit;
    order.creditedAt = Date.now();
    order.credited = credit;
    db.markDirty();
    db.addLedger(order.owner, { kind: 'topup', amount: credit, balanceAfter: u.money, note: 'Topup QRIS', ref: order.trxId });
    require('../web/webhook').emit(order.owner, 'topup', { amount: credit, balance: u.money, ref: order.trxId });
    logSuccess('PAYMENT', `Topup ${rupiah(credit)} → +${order.owner} (saldo ${rupiah(u.money)})`);
    return `✅ *Topup berhasil!*\n\n💳 Saldo masuk: *${rupiah(credit)}*\n💰 Saldo sekarang: *${rupiah(u.money)}*\n🧾 ${order.trxId}\n\n_Saldo bisa dipakai untuk membeli jadibot langsung dari panel web._`;
}

async function fulfill(order) {
    order.status = 'fulfilling';
    order.attempts++;
    order.lastTry = Date.now();
    db.markDirty();
    try {
        // Order 'rent' (sewa grup) sudah dihapus — gagalkan bila masih ada sisa data lama.
        if (order.type === 'rent' || (order.type === 'renew' && order.kind === 'rent')) throw new Error('Fitur sewa grup sudah tidak tersedia.');
        const text = order.type === 'renew' ? await runRenew(order) : order.type === 'prem' ? await runPrem(order) : order.type === 'topup' ? await runTopup(order) : await runJadibot(order);
        order.status = 'done';
        order.doneAt = Date.now();
        db.markDirty();
        await notify(order, text);
    } catch (err) {
        order.status = 'paid';
        order.lastError = err.message;
        db.markDirty();
        logError('PAYMENT', `Fulfill ${order.trxId} gagal (${order.attempts}/${MAX_FULFILL_ATTEMPTS}): ${err.message}`);
        if (order.attempts >= MAX_FULFILL_ATTEMPTS) {
            order.status = 'failed';
            await notify(order, `⚠️ Pembayaran sudah diterima tetapi proses gagal: ${err.message}\nHubungi owner dengan menyebut ID: *${order.trxId}*`);
            await notifyRootOwners(`⚠️ *Order ${order.type} gagal diproses*\nID: ${order.trxId}\nTarget: ${order.target || order.targetKey}\nOwner: +${order.owner}\nDibayar: ${rupiah(order.amount)}\nError: ${err.message}`);
        }
    }
}

async function checkOrder(order) {
    const now = Date.now();
    if (order.status === 'paid') {
        if (now - (order.lastTry || 0) >= FULFILL_RETRY_MS) fulfill(order).catch((e) => logError('PAYMENT', e));
        return;
    }
    if (order.status === 'cancelled') {
        // QR lama masih bisa dibayar sampai kedaluwarsa → tetap dipantau (jarang), supaya pembayaran tidak hilang
        if (now > order.expiresAt + 5 * 60 * 1000 || now - (order.lastCheck || 0) < 30000) return;
        order.lastCheck = now;
        const t = await kipay.getTransaction(order.trxId);
        if (t.status === 'paid') {
            order.status = 'paid';
            order.paidAt = now;
            order.paidAfterCancel = true;
            db.markDirty();
            logSuccess('PAYMENT', `LUNAS (setelah dibatalkan) ${order.trxId}`);
            await notify(order, `ℹ️ Tagihan yang sudah kamu batalkan ternyata *dibayar*. Pembayarannya tetap kami proses ya.`);
            fulfill(order).catch((e) => logError('PAYMENT', e));
        }
        return;
    }
    if (order.status !== 'pending') return;

    const trx = await kipay.getTransaction(order.trxId);
    if (trx.status === 'paid') {
        order.status = 'paid';
        order.paidAt = now;
        db.markDirty();
        logSuccess('PAYMENT', `LUNAS ${order.trxId} (${rupiah(order.amount)})`);
        fulfill(order).catch((e) => logError('PAYMENT', e));     // tidak menahan poller
    } else if (trx.status === 'expired' || now > order.expiresAt + 5 * 60 * 1000) {
        order.status = 'expired';
        db.markDirty();
        const again = order.type === 'renew' ? `${config.prefix}perpanjang` : order.type === 'prem' ? `${config.prefix}buyprem` : `${config.prefix}jadibot ${order.target} ${Math.round(order.durationMs / 86400000)}d`;
        await notify(order, `⌛ Tagihan ${order.type === 'renew' ? 'perpanjangan' : order.type === 'prem' ? 'premium' : `jadibot *+${order.target}*`} kedaluwarsa (tidak dibayar). Ketik ulang *${again}* untuk membuat tagihan baru.`);
    }
}

async function tick() {
    if (state.busy || !db.data) return;
    state.busy = true;
    try {
        const now = Date.now();
        // Hanya order aktif yang perlu dicek — order selesai (done/expired/failed) dilewati
        // supaya poller 5 detik tidak mengiterasi ratusan order lama sia-sia.
        const all = Object.values(orders());
        const live = all.filter((o) => ACTIVE.includes(o.status) || o.status === 'cancelled');
        for (const order of live) {
            if (order.status === 'fulfilling' && now - (order.lastTry || 0) > 120000) order.status = 'paid';   // macet → coba lagi
            try { await checkOrder(order); } catch (err) { logWarn('PAYMENT', `Cek ${order.trxId}: ${err.message}`); }
        }
        for (const [id, o] of Object.entries(orders())) {
            if (['done', 'expired', 'failed'].includes(o.status) && now - o.createdAt > 7 * 86400000) delete orders()[id];
        }
    } finally { state.busy = false; }
}

function ensurePoller() {
    if (state.timer || !isEnabled()) return;
    state.timer = setInterval(() => tick().catch((e) => logError('PAYMENT', e)), Math.max(3, config.kipay.pollIntervalSec || 5) * 1000);
    if (state.timer.unref) state.timer.unref();
}

/** Dipanggil saat boot: lanjutkan order yang belum selesai. */
function start({ handleIncomingMessage }) {
    state.handleIncoming = handleIncomingMessage;
    if (!isEnabled()) { logInfo('PAYMENT', 'KiPay api_key kosong → pembayaran nonaktif (owner tetap gratis)'); return; }
    const pending = Object.values(orders()).filter((o) => ACTIVE.includes(o.status));
    for (const o of pending) if (o.status === 'fulfilling') o.status = 'paid';
    ensurePoller();
    logInfo('PAYMENT', `KiPay aktif • ${pending.length} order belum selesai dilanjutkan`);
}

function stop() { clearInterval(state.timer); state.timer = null; }

module.exports = {
    isEnabled, setSock, start, stop, tick, priceFor, validateDuration, priceListText,
    createJadibotOrder, createPremOrder, createRenewOrder, createTopupOrder, findPendingRenew, grantPremium, findPendingPrem, findPending, sendPendingNotice, cancelOrder, ownOrders, describeOrder, STATUS_LABEL, countPendingByOwner, sendInvoice
};
