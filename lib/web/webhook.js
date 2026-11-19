/**
 * WEBHOOK — kirim event panel ke URL milik user (integrasi pihak ketiga).
 * - URL + secret + daftar event disimpan di tabel settings per akun.
 * - Payload di-sign HMAC-SHA256 (header X-Manzxy-Signature) supaya penerima
 *   bisa memverifikasi bahwa request benar berasal dari panel ini.
 * - Pengiriman fire-and-forget dengan timeout 6 detik; gagal tidak mengganggu bot.
 */
const crypto = require('crypto');
const store = require('./store');
const { logInfo, logWarn } = require('../core/logger');

const EVENTS = ['topup', 'bot_online', 'bot_offline', 'jadibot_created', 'sewa_habis'];
const TIMEOUT_MS = 6000;

const getConf = (accountId) => ({
    url: store.getSetting(accountId, 'webhook_url', ''),
    secret: store.getSetting(accountId, 'webhook_secret', ''),
    events: (store.getSetting(accountId, 'webhook_events', '') || '').split(',').filter(Boolean)
});

function setConf(accountId, { url, secret, events }) {
    if (url !== undefined) store.setSetting(accountId, 'webhook_url', String(url || '').trim());
    if (secret !== undefined) store.setSetting(accountId, 'webhook_secret', String(secret || '').trim());
    if (events !== undefined) {
        const list = (Array.isArray(events) ? events : String(events).split(','))
            .map((e) => String(e).trim()).filter((e) => EVENTS.includes(e));
        store.setSetting(accountId, 'webhook_events', list.join(','));
    }
}

/** Kirim event ke semua akun yang nomor WA-nya cocok (bila event didaftarkan). */
function emit(waNumber, event, payload = {}) {
    try { require('../billing/notify').emit(waNumber, event, payload); } catch {}   // notifikasi Telegram/Discord (event sama)
    try {
        const acc = store.getAccountByWa(String(waNumber || ''));
        if (!acc) return;
        const conf = getConf(acc.id);
        if (!conf.url || !conf.events.includes(event)) return;
        const body = JSON.stringify({
            event,
            number: String(waNumber || ''),
            at: new Date().toISOString(),
            data: payload
        });
        const sig = conf.secret
            ? crypto.createHmac('sha256', conf.secret).update(body).digest('hex')
            : '';
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        fetch(conf.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'ManzxyMD-Webhook/1.0',
                ...(sig ? { 'X-Manzxy-Signature': `sha256=${sig}` } : {})
            },
            body,
            signal: ctrl.signal
        }).then((res) => {
            clearTimeout(timer);
            logInfo('WEBHOOK', `${event} → ${maskUrl(conf.url)} : HTTP ${res.status}`);
        }).catch((err) => {
            clearTimeout(timer);
            logWarn('WEBHOOK', `${event} → ${maskUrl(conf.url)} gagal: ${err.message}`);
        });
    } catch { /* jangan pernah ganggu alur utama */ }
}

/** Kirim payload tes dari halaman Profil. Kembalikan status HTTP atau pesan error. */
async function test(accountId) {
    const conf = getConf(accountId);
    if (!conf.url) throw new Error('Isi URL webhook dulu.');
    const body = JSON.stringify({ event: 'test', at: new Date().toISOString(), data: { ok: true } });
    const sig = conf.secret ? crypto.createHmac('sha256', conf.secret).update(body).digest('hex') : '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(conf.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'ManzxyMD-Webhook/1.0',
                ...(sig ? { 'X-Manzxy-Signature': `sha256=${sig}` } : {})
            },
            body,
            signal: ctrl.signal
        });
        return { status: res.status, ok: res.ok };
    } catch (err) {
        return { status: 0, ok: false, error: err.name === 'AbortError' ? 'Timeout — server tidak menjawab dalam 6 detik.' : err.message };
    } finally {
        clearTimeout(timer);
    }
}

const maskUrl = (u) => { try { return new URL(u).host; } catch { return String(u || '').slice(0, 30); } };

module.exports = { EVENTS, getConf, setConf, emit, test };
