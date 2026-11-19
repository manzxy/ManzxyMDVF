/**
 * PENJAGA KONEKSI — mencegah error "Cannot read properties of undefined (reading 'attrs')" setelah bot lama berjalan.
 *
 * AKAR MASALAH
 *   Baileys menyimpan koneksi upload media (media_conn) sebagai Promise di dalam socket. Bila SATU kali saja
 *   pengambilan media_conn gagal (koneksi goyang / server membalas error), Promise itu menyimpan kegagalannya
 *   dan SETIAP upload berikutnya ikut gagal dengan "reading 'attrs'" — sampai socket dibuat ulang.
 *   Itu sebabnya .ping / .getplug (kirim gambar / dokumen) error terus di bot utama maupun jadibot,
 *   sementara pesan teks tetap normal.
 *
 * PERBAIKAN (otomatis, bot utama + jadibot)
 *   1. Setiap kegagalan upload dikenali → socket disambung ulang otomatis (media_conn baru).
 *   2. Pemeriksa berkala: ping server + cek media_conn. Gagal berturut-turut → sambung ulang sebelum user kena error.
 *   3. `sock.mediaOk()` → plugin bisa langsung kirim teks bila media sedang bermasalah (tanpa menunggu timeout).
 */
const { Boom } = require('@hapi/boom');
const config = require('../../config');
const { logWarn } = require('../core/logger');

const MEDIA_KEYS = ['image', 'video', 'audio', 'document', 'sticker', 'ptv'];
const POISON_RE = /reading 'attrs'|media_conn|upload|Timed Out|Connection Closed|Stream Errored/i;

const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms))]);
const hasMedia = (content) => Boolean(content) && MEDIA_KEYS.some((k) => content[k]);
const isDead = (sock) => Boolean(sock.ws?.isClosed || sock.ws?.isClosing || sock.__guardStopped);

/** Paksa socket putus → logika reconnect bot utama / jadibot membuat socket baru. */
function heal(sock, reason) {
    const gap = (config.guard?.minReconnectGapSec ?? 90) * 1000;
    if (sock.__healing || isDead(sock) || Date.now() - (sock.__lastHeal || 0) < gap) return false;
    sock.__healing = true;
    sock.__lastHeal = Date.now();
    sock.__mediaDownUntil = Date.now() + 60000;
    const who = sock.isJadibot ? `JADIBOT +${sock.jadibotNumber}` : 'MAIN';
    logWarn('GUARD', `${who}: ${reason} → menyambung ulang socket`);
    try { invalidate(); } catch {}
    setTimeout(() => {
        try { sock.end(new Boom(`guard: ${reason}`, { statusCode: 428 })); }
        catch { try { sock.ws?.close(); } catch {} }
    }, 300);
    return true;
}

async function checkHealth(sock, round) {
    if (isDead(sock)) return;
    const fail = (why) => {
        sock.__failCount = (sock.__failCount || 0) + 1;
        logWarn('GUARD', `${sock.isJadibot ? `+${sock.jadibotNumber}` : 'MAIN'} pemeriksaan gagal (${why}) ${sock.__failCount}/${config.guard?.maxFailures ?? 2}`);
        if (sock.__failCount >= (config.guard?.maxFailures ?? 2)) heal(sock, why);
    };
    try {
        await withTimeout(sock.query({ tag: 'iq', attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:p' }, content: [{ tag: 'ping', attrs: {} }] }), 15000, 'ping');
    } catch (err) { return fail(`ping: ${err.message}`); }

    // Cek media_conn tiap beberapa putaran (inilah yang "keracunan" pada bot yang lama berjalan)
    if (round % (config.guard?.mediaCheckEvery ?? 3) === 0 && typeof sock.refreshMediaConn === 'function') {
        try { await withTimeout(sock.refreshMediaConn(true), 15000, 'media_conn'); sock.__mediaDownUntil = 0; }
        catch (err) { return fail(`media_conn: ${err.message}`); }
    }
    sock.__failCount = 0;
}

function attachGuard(sock) {
    if (config.guard?.enabled === false || sock.__guardAttached) return;
    sock.__guardAttached = true;
    sock.__mediaDownUntil = 0;
    let round = 0;

    /** true = upload media diperkirakan normal. Plugin boleh kirim gambar/dokumen. */
    sock.mediaOk = () => !isDead(sock) && Date.now() >= (sock.__mediaDownUntil || 0);

    /** Dipanggil saat upload gagal: bila cirinya "keracunan" → sambung ulang. */
    sock.reportMediaFailure = (err) => {
        if (!POISON_RE.test(String(err?.message || err))) return;
        sock.__mediaDownUntil = Date.now() + 60000;
        heal(sock, `upload media gagal (${err?.message || err})`);
    };

    sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'open') {
            sock.__failCount = 0; sock.__healing = false; sock.__mediaDownUntil = 0; sock.__guardStopped = false;
            clearInterval(sock.__guardTimer);
            round = 0;
            const every = (config.guard?.intervalMin ?? 5) * 60000;
            sock.__guardTimer = setInterval(() => { round++; checkHealth(sock, round).catch(() => {}); }, every);
            sock.__guardTimer.unref?.();
        } else if (connection === 'close') {
            sock.__guardStopped = true;
            clearInterval(sock.__guardTimer);
        }
    });
}

/** Kompatibilitas: dulu dipakai cache versi WA; sekarang tidak ada yang di-cache. */
function invalidate() {}

module.exports = { attachGuard, heal, hasMedia, POISON_RE, withTimeout, invalidate };
