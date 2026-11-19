/**
 * PENGATURAN BOT (per socket): online, mengetik, merekam, baca otomatis, baca status, anti-call.
 *  - Bot utama  → db.data.settings.bot
 *  - Jadibot    → db.data.jadibots[nomor].botSettings   (tiap jadibot punya pengaturan sendiri)
 * Nilai awal diambil dari config.botSettings.
 */
const config = require('../../config');
const db = require('../data/database');
const { logDebug } = require('./logger');

const KEYS = {
    online:          { label: 'Selalu Online',         desc: 'Status akun tampil "online" terus-menerus' },
    typing:          { label: 'Mengetik',              desc: 'Tampil "mengetik..." saat bot memproses perintah' },
    recording:       { label: 'Merekam Suara',         desc: 'Tampil "merekam suara..." saat bot memproses perintah' },
    autoRead:        { label: 'Baca Otomatis',         desc: 'Pesan masuk otomatis ditandai sudah dibaca (centang biru)' },
    autoReadStatus:  { label: 'Lihat Status',          desc: 'Status/story kontak otomatis dilihat' },
    antiCall:        { label: 'Anti Call',             desc: 'Panggilan masuk otomatis ditolak' },
    antiCallBlock:   { label: 'Blokir Penelepon',      desc: 'Penelepon diblokir (butuh Anti Call aktif)' }
};

const fallback = new Map();        // jadibot yang belum ada di db

function storeOf(sock) {
    if (sock?.isJadibot) {
        const rec = db.data?.jadibots?.[sock.jadibotNumber];
        if (rec) return (rec.botSettings ||= {});
        if (!fallback.has(sock.jadibotNumber)) fallback.set(sock.jadibotNumber, {});
        return fallback.get(sock.jadibotNumber);
    }
    const s = db.data?.settings;
    if (!s) return {};
    return (s.bot ||= {});
}

/** Pengaturan lengkap (bawaan config + yang tersimpan). */
function get(sock) {
    return { ...(config.botSettings || {}), ...storeOf(sock) };
}

function set(sock, key, value) {
    if (!KEYS[key]) throw new Error(`Pengaturan "${key}" tidak dikenal.`);
    const st = storeOf(sock);
    st[key] = Boolean(value);
    // mengetik & merekam saling meniadakan
    if (st[key] && key === 'typing') st.recording = false;
    if (st[key] && key === 'recording') st.typing = false;
    if (key === 'antiCallBlock' && st[key]) st.antiCall = true;
    db.markDirty();
    if (key === 'online') refreshPresence(sock);
    return get(sock);
}

/* ───────────── Presence ───────────── */
async function tick(sock) {
    try {
        if (sock.ws?.isClosed || sock.ws?.isClosing) return stopPresence(sock);
        const online = Boolean(get(sock).online);
        if (online) { await sock.sendPresenceUpdate('available'); sock.__presence = 'available'; }
        else if (sock.__presence === 'available') { await sock.sendPresenceUpdate('unavailable'); sock.__presence = 'unavailable'; }
    } catch (err) { logDebug('PRESENCE', err.message); }
}

function startPresence(sock) {
    stopPresence(sock);
    tick(sock);
    sock.__presenceTimer = setInterval(() => tick(sock), 25000);
    if (sock.__presenceTimer.unref) sock.__presenceTimer.unref();
}

function stopPresence(sock) {
    if (sock.__presenceTimer) clearInterval(sock.__presenceTimer);
    sock.__presenceTimer = null;
}

/** Terapkan perubahan setting online segera (perintah berjalan = socket sedang hidup). */
const refreshPresence = (sock) => { if (sock.__presenceTimer) tick(sock); else startPresence(sock); };

/** Tampilkan "mengetik..." / "merekam..." (sesuai pengaturan) di chat. Tidak pernah melempar error. */
async function showActivity(sock, jid) {
    try {
        const s = get(sock);
        if (s.typing) await sock.sendPresenceUpdate('composing', jid);
        else if (s.recording) await sock.sendPresenceUpdate('recording', jid);
    } catch (err) { logDebug('PRESENCE', err.message); }
}

async function clearActivity(sock, jid) {
    try { const s = get(sock); if (s.typing || s.recording) await sock.sendPresenceUpdate('paused', jid); } catch { /* abaikan */ }
}

module.exports = { KEYS, get, set, startPresence, stopPresence, refreshPresence, showActivity, clearActivity };
