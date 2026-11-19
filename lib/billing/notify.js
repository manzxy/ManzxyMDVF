/**
 * NOTIFY — semua notifikasi keluar bot (mantan notifyChat.js + dailyReport.js).
 *
 * BAGIAN 1 — Notifikasi chat (Telegram/Discord) per akun panel, dipicu webhook.emit().
 * BAGIAN 2 — Laporan harian ke WA root owner tiap malam (dikontrol dari panel web).
 */
const store = require('../web/store');
const { logDebug } = require('../core/logger');

const LABELS = {
    topup: '💰 Saldo masuk',
    bot_online: '✅ Bot online',
    bot_offline: '❌ Bot offline',
    jadibot_created: '🤖 Jadibot baru',
    sewa_habis: '⌛ Sewa habis',
    test: '🧪 Tes notifikasi'
};

function getConf(accountId) {
    try {
        const raw = store.getSetting(accountId, 'chatNotify', '');
        if (!raw) return { platform: 'none' };
        const c = JSON.parse(raw);
        return { platform: c.platform === 'telegram' || c.platform === 'discord' ? c.platform : 'none', token: c.token || '', chatId: c.chatId || '', url: c.url || '' };
    } catch { return { platform: 'none' }; }
}

function setConf(accountId, conf) {
    const clean = {
        platform: conf.platform === 'telegram' || conf.platform === 'discord' ? conf.platform : 'none',
        token: String(conf.token || '').trim(),
        chatId: String(conf.chatId || '').trim(),
        url: String(conf.url || '').trim()
    };
    if (clean.platform === 'telegram' && (!clean.token || !clean.chatId)) throw new Error('Telegram butuh bot token & chat ID.');
    if (clean.platform === 'discord' && !/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(clean.url)) throw new Error('URL webhook Discord tidak valid.');
    store.setSetting(accountId, 'chatNotify', JSON.stringify(clean));
    return clean;
}

function formatText(event, payload = {}) {
    const parts = [`*${LABELS[event] || event}*`];
    if (payload.number) parts.push(`Bot: +${payload.number}`);
    if (payload.amount !== undefined) parts.push(`Nominal: Rp${Number(payload.amount).toLocaleString('id-ID')}`);
    if (payload.balance !== undefined) parts.push(`Saldo: Rp${Number(payload.balance).toLocaleString('id-ID')}`);
    if (payload.reason) parts.push(`Alasan: ${payload.reason}`);
    parts.push(`Waktu: ${new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`);
    return parts.join('\n');
}

async function deliver(conf, text) {
    if (conf.platform === 'telegram') {
        const res = await fetch(`https://api.telegram.org/bot${conf.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: conf.chatId, text, parse_mode: 'Markdown' })
        });
        return { ok: res.ok, status: res.status };
    }
    if (conf.platform === 'discord') {
        const res = await fetch(conf.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text.replace(/\*/g, '**') })
        });
        return { ok: res.ok, status: res.status };
    }
    return { ok: false, status: 0 };
}

/** Kirim notifikasi untuk akun pemilik nomor WA tsb. Fire-and-forget. */
function emit(waNumber, event, payload = {}) {
    (async () => {
        try {
            const acc = store.getAccountByWa(waNumber);
            if (!acc) return;
            const conf = getConf(acc.id);
            if (conf.platform === 'none') return;
            const r = await deliver(conf, formatText(event, payload));
            if (!r.ok) logDebug('NOTIF-CHAT', `kirim ${event} gagal: HTTP ${r.status}`);
        } catch (e) { logDebug('NOTIF-CHAT', `emit ${event}: ${e.message}`); }
    })();
}

/** Tes kirim dari panel. Return {ok, status} atau throw. */
async function test(accountId) {
    const conf = getConf(accountId);
    if (conf.platform === 'none') throw new Error('Pilih platform & isi konfigurasi dulu.');
    return deliver(conf, formatText('test', {}));
}

function maskConf(accountId) {
    const c = getConf(accountId);
    return {
        platform: c.platform,
        token: c.token ? c.token.slice(0, 8) + '•••' : '',
        chatId: c.chatId,
        url: c.url ? (new URL(c.url).host + '/•••') : '',
        configured: c.platform !== 'none'
    };
}

module.exports = { getConf, setConf, emit, test, maskConf, LABELS };


/* ═════════ BAGIAN 2: LAPORAN HARIAN (mantan dailyReport.js) ═════════ */

const config = require('../../config');
const db = require('../data/database');
const { logInfo, logWarn } = require('../core/logger');
const { numberOf, rupiah, formatDateTime } = require('../core/utils');

const CHECK_EVERY_MS = 10 * 60 * 1000;   // cek tiap 10 menit
let timer = null;

function conf() {
    db.data.settings.dailyReport = db.data.settings.dailyReport || { enabled: false, hour: 20, lastSent: 0 };
    return db.data.settings.dailyReport;
}

function buildReport() {
    const stats = db.data.stats || {};
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const series = db.trafficSeries(24);
    const msg24 = series.reduce((a, x) => a + x.messages, 0);
    const cmd24 = series.reduce((a, x) => a + x.commands, 0);
    const top = db.topCommands(3).map((c, i) => `${i + 1}. ${c.command} (${c.count}x)`).join('\n') || '-';
    // saldo masuk hari ini (ledger)
    let topupToday = 0, topupCount = 0;
    for (const rows of Object.values(db.data.ledger || {})) {
        for (const l of rows) {
            if (l.kind === 'topup' && l.at >= dayStart.getTime()) { topupToday += l.amount; topupCount++; }
        }
    }
    const bots = Object.values(db.data.jadibots || {});
    const active = bots.filter((j) => (j.status || '') === 'open').length;
    const newBots = bots.filter((j) => (j.createdAt || 0) >= dayStart.getTime()).length;
    const lines = [
        '📊 *LAPORAN HARIAN* ' + config.botName,
        `🗓 ${formatDateTime(new Date())}`,
        '',
        `💬 Pesan 24 jam: *${msg24}* (command: ${cmd24})`,
        `🤖 Jadibot: *${active}/${bots.length}* aktif (baru hari ini: ${newBots})`,
        `💰 Topup hari ini: *${rupiah(topupToday)}* (${topupCount}x)`,
        `📈 Total pesan sepanjang masa: ${(stats.messages || 0).toLocaleString('id-ID')}`,
        '',
        `🔥 Command terpopuler:\n${top}`,
        '',
        '_Laporan otomatis dari panel web — bisa dimatikan di halaman Owner._'
    ];
    return lines.join('\n');
}

async function maybeSend() {
    const c = conf();
    if (!c.enabled) return;
    const now = new Date();
    if (now.getHours() !== Number(c.hour || 20)) return;
    const today = now.toISOString().slice(0, 10);
    const lastDay = c.lastSent ? new Date(c.lastSent).toISOString().slice(0, 10) : '';
    if (lastDay === today) return;
    const sock = global.__mainSock;
    if (!sock?.user) return;
    try {
        const owner = numberOf((config.ownerNumber || [])[0] || '');
        if (!owner) return;
        await sock.sendMessage(`${owner}@s.whatsapp.net`, { text: buildReport() });
        c.lastSent = Date.now();
        db.markDirty();
        logInfo('REPORT', `Laporan harian dikirim ke owner +${owner}`);
    } catch (err) {
        logWarn('REPORT', `Gagal kirim laporan harian: ${err.message}`);
    }
}

function start() {
    if (timer) return;
    timer = setInterval(() => { maybeSend().catch(() => {}); }, CHECK_EVERY_MS);
    if (timer.unref) timer.unref();
}

function setEnabled(on) {
    const c = conf();
    c.enabled = Boolean(on);
    db.markDirty();
    return { ...c };
}

const status = () => ({ ...conf() });



module.exports = {
    // notifikasi chat
getConf, setConf, emit, test, maskConf, LABELS,
    // laporan harian
start, setEnabled, status, buildReport
};
