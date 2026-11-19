/**
 * SEWA BOT per grup — otomatis:
 *   grant()  : bot masuk grup (via link) + aktifkan/perpanjang masa sewa
 *   watcher  : pengingat sebelum habis, lalu pamit & keluar grup saat habis
 */
const config = require('../../config');
const db = require('../data/database');
const { sleep, formatDateTime, formatDuration } = require('../core/utils');
const { logInfo, logSuccess, logWarn, logError } = require('../core/logger');

const state = { sock: null, timer: null, busy: false };
const setSock = (sock) => { state.sock = sock; };

const parseInviteCode = (text) => (String(text || '').match(/chat\.whatsapp\.com\/([A-Za-z0-9]{10,})/) || [])[1] || '';

/** Sewa aktif? (tidak bergantung pada pembersihan DB) */
const isActive = (group) => Boolean(group?.rent?.active && (!group.rent.expire || group.rent.expire > Date.now()));

async function inviteInfo(sock, code) {
    try { return await sock.groupGetInviteInfo(code); }
    catch (err) { throw new Error('Link grup tidak valid / sudah kedaluwarsa / ditarik admin.'); }
}

/** Masuk grup lewat link. Bila bot sudah di dalam, tetap lanjut. Mengembalikan JID grup. */
async function joinByInvite(sock, code) {
    let gid = '';
    try { gid = await sock.groupAcceptInvite(code); }
    catch (err) { gid = (await inviteInfo(sock, code)).id; }          // sudah jadi anggota / butuh persetujuan
    if (!gid) throw new Error('Gagal mendapatkan ID grup.');
    try { await sock.groupMetadata(gid); }
    catch { throw new Error('Bot belum berhasil masuk grup (grup memakai persetujuan admin?). Setujui permintaan bot lalu coba lagi.'); }
    return gid;
}

/**
 * Aktifkan / perpanjang sewa. Masa baru ditambahkan ke sisa masa aktif (tidak hangus).
 * @param {{groupJid?:string, inviteCode?:string, owner:string, durationMs:number}} p
 */
async function grant(sock, { groupJid, inviteCode, owner, durationMs }) {
    if (!sock?.sendMessage) throw new Error('Bot utama belum terhubung, coba lagi sebentar.');
    let gid = groupJid;
    if (inviteCode) gid = await joinByInvite(sock, inviteCode);      // masuk lewat link (bila sudah anggota tetap lanjut)
    if (!gid) throw new Error('Grup tidak diketahui.');
    let name = '';
    try { name = (await sock.groupMetadata(gid))?.subject || ''; } catch {}

    const g = db.getGroup(gid, { name });
    const now = Date.now();
    const base = isActive(g) && g.rent.expire > now ? g.rent.expire : now;
    g.rent = { active: true, since: g.rent.active ? g.rent.since : now, expire: base + durationMs, by: owner, reminded: false, expiredPending: false, expiredNotified: false, leaveAt: 0, lastDurationMs: durationMs };
    db.markDirty();
    logSuccess('SEWA', `${name || gid} aktif s/d ${formatDateTime(new Date(g.rent.expire))} (oleh +${owner})`);

    const text =
        `✅ *BOT AKTIF DI GRUP INI!*\n\n` +
        `╭───「 *INFO SEWA* 」\n` +
        `│ 👥 Grup      : ${name || '-'}\n` +
        `│ 👑 Penyewa   : +${owner}\n` +
        `│ ⌛ Aktif s/d : ${formatDateTime(new Date(g.rent.expire))}\n` +
        `│ ➕ Durasi    : ${formatDuration(durationMs)}\n` +
        `╰────────────────────────\n\nKetik *${config.prefix}menu* untuk melihat fitur.`;
    try { await sock.sendMessage(gid, { text }); } catch (err) { logWarn('SEWA', `Pesan aktivasi gagal: ${err.message}`); }
    return { groupJid: gid, name, expire: g.rent.expire };
}

/** Hentikan sewa sekarang (opsional keluar grup). */
async function revoke(sock, gid, { leave = true, notice = '' } = {}) {
    const g = db.data.groups[gid];
    if (g) { g.rent.active = false; g.rent.expiredPending = false; g.rent.expire = 0; db.markDirty(); }
    if (notice) { try { await sock.sendMessage(gid, { text: notice }); } catch {} }
    if (leave) { await sleep(1200); try { await sock.groupLeave(gid); } catch (err) { logWarn('SEWA', `Gagal keluar ${gid}: ${err.message}`); } }
}

async function tick() {
    const sock = state.sock;
    if (state.busy || !sock || !db.data) return;
    state.busy = true;
    try {
        const now = Date.now();
        const grace = Math.max(0, Number(config.renewal?.graceHours) || 0) * 3600 * 1000;
        const renewal = require('./renewal');
        const { button } = require('../wa/rich');
        for (const [jid, g] of Object.entries(db.data.groups)) {
            const r = g.rent;
            if (!r?.expire) continue;
            const expired = r.expire <= now;

            // Pengingat SEBELUM habis dikirim oleh lib/renewal.js (beberapa tahap + tombol Perpanjang QRIS).
            if (!expired) continue;

            if (r.active || r.expiredPending) { r.active = false; r.expiredPending = false; db.markDirty(); }

            if (!r.expiredNotified) {
                r.expiredNotified = true;
                r.leaveAt = config.sewa.leaveOnExpire ? r.expire + grace : 0;
                db.markDirty();
                logInfo('SEWA', `Masa sewa habis: ${g.name || jid}`);
                const leaving = config.sewa.leaveOnExpire;
                const body = leaving && grace > 0 && r.leaveAt > now
                    ? `⌛ *Masa sewa bot di grup ini telah habis.*\nBot masih menunggu perpanjangan sampai *${formatDateTime(new Date(r.leaveAt))}* — setelah itu bot keluar dari grup.\nPerpanjang sekarang (data & pengaturan grup aman):`
                    : `⌛ *Masa sewa bot di grup ini telah habis.*\nTerima kasih sudah menggunakan ${config.botName}! Sewa lagi kapan saja dengan *${config.prefix}sewabot*.`;
                try {
                    if (config.renewal?.enabled && leaving && r.leaveAt > now) {
                        await sock.sendUniversalButton(jid, { title: '⌛ SEWA BERAKHIR', body, footer: config.footerText }, renewal.renewButtons('rent', jid, g));
                    } else await sock.sendMessage(jid, { text: body });
                } catch (err) { logWarn('SEWA', `Pesan habis gagal: ${err.message}`); }
                try { await renewal.notifyExpiredOwner('rent', jid); } catch {}
            }

            if (config.sewa.leaveOnExpire && r.leaveAt && now >= r.leaveAt) {
                r.leaveAt = 0; db.markDirty();
                try { await sock.sendMessage(jid, { text: `👋 Masa tenggang berakhir. ${config.botName} pamit dari grup ini. Sampai jumpa!` }); } catch {}
                await sleep(1500);
                try { await sock.groupLeave(jid); } catch (err) { logWarn('SEWA', `Gagal keluar ${jid}: ${err.message}`); }
            }
        }
    } catch (err) { logError('SEWA', err); }
    finally { state.busy = false; }
}

function start() {
    if (state.timer) return;
    state.timer = setInterval(() => tick(), 5 * 60 * 1000);
    if (state.timer.unref) state.timer.unref();
    setTimeout(() => tick(), 30000).unref?.();      // cek sekali tak lama setelah bot hidup
}
const stop = () => { clearInterval(state.timer); state.timer = null; };

module.exports = { setSock, start, stop, tick, isActive, parseInviteCode, inviteInfo, joinByInvite, grant, revoke };
