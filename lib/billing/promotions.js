/* Promo global tersimpan di database, hanya bisa diubah oleh Root Owner. */
const db = require('../data/database');

const KINDS = ['jadibot', 'prem'];
const LABELS = { jadibot: 'Jadibot', prem: 'Premium' };

function state() {
    const settings = db.data.settings;
    if (!settings.promotions || typeof settings.promotions !== 'object') settings.promotions = {};
    const promo = settings.promotions;
    if (!promo.discounts || typeof promo.discounts !== 'object') promo.discounts = {};
    return promo;
}

function freeSlots() {
    const n = Number(state().freeSlots);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
function setFreeSlots(count) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Slot gratis harus bilangan bulat >= 0.');
    state().freeSlots = count;
    db.markDirty();
}
function freeJadibot() { return state().freeJadibot === true && freeSlots() > 0; }
function setFreeJadibot(value) { state().freeJadibot = value === true; db.markDirty(); }
function freeUsage() {
    const now = Date.now();
    return Object.values(db.data.jadibots).filter((rec) => rec.tier === 'free' && (!rec.expire || rec.expire > now)).length;
}
function freeAvailable(target = '') {
    const existing = db.data.jadibots[target];
    if (existing?.tier === 'free' && (!existing.expire || existing.expire > Date.now())) return true;
    return freeJadibot() && freeUsage() < freeSlots();
}

function discount(kind) {
    if (!KINDS.includes(kind)) return 0;      // jenis tanpa promo (mis. topup saldo) = tanpa diskon
    const value = Number(state().discounts[kind]);
    return Number.isInteger(value) && value >= 0 && value <= 99 ? value : 0;
}
function setDiscount(kind, percent) {
    if (!KINDS.includes(kind) || !Number.isInteger(percent) || percent < 0 || percent > 99) throw new Error('Diskon harus 0–99 persen.');
    state().discounts[kind] = percent;
    db.markDirty();
}

/** Potongan berlaku pada harga dasar; total QRIS mungkin ditambah kode unik oleh KiPay. */
function quote(kind, basePrice) {
    if (!Number.isSafeInteger(basePrice) || basePrice <= 0) throw new Error('Harga dasar tidak valid.');
    const percent = discount(kind);
    const price = Math.max(1, basePrice - Math.floor(basePrice * percent / 100));
    return { basePrice, percent, price };
}
function priceText(kind, basePrice, rupiah) {
    const q = quote(kind, basePrice);
    return q.percent ? `${rupiah(q.price)} (diskon ${q.percent}%, dari ${rupiah(q.basePrice)})` : rupiah(q.price);
}
function invoiceLine(order, rupiah) {
    if (!order.discountPercent) return '';
    return `│ 🏷️ Diskon   : ${order.discountPercent}% (${rupiah(order.basePrice)} → ${rupiah(order.price)})\n`;
}

module.exports = { KINDS, LABELS, freeJadibot, setFreeJadibot, freeSlots, setFreeSlots, freeUsage, freeAvailable, discount, setDiscount, quote, priceText, invoiceLine };
