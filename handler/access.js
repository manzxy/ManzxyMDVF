/**
 * IDENTITAS & HAK AKSES — siapa pengirim pesan (LID → nomor asli), cocok-tidaknya admin grup,
 * dan aturan wajib daftar untuk plugin.
 */
const { jidNormalizedUser } = require('../lib/wa/waCompat');
const config = require('../config');
const { isJid, isLid, learnFromKey, resolveJid } = require('../lib/core/jid');
const { getCachedGroupMetadata } = require('../lib/core/jid');
const { numberOf } = require('../lib/core/utils');

/* ───────────────────────── IDENTITAS PENGIRIM ───────────────────────── */

/**
 * WhatsApp versi baru memakai LID (xxx@lid) sebagai ganti nomor. Fungsi ini mencari
 * nomor asli dari berbagai field (participantAlt, remoteJidAlt, mapping LID) agar
 * pengecekan owner tetap benar.
 */
async function resolveIdentity(sock, m, isGroup, botJid) {
    const k = m.key;
    if (k.fromMe) return { jid: botJid, lid: sock.user?.lid || '', number: numberOf(botJid) };

    learnFromKey(k);
    const candidates = (isGroup
        ? [k.participantAlt, k.participantPn, k.participant, m.participant]
        : [k.remoteJidAlt, k.senderPn, k.remoteJid]).filter(Boolean).map(String);

    let jid = candidates.find((j) => isJid(j));
    const lid = candidates.find((j) => isLid(j)) || '';
    if (!jid && lid) jid = await resolveJid(sock, lid, { groupJid: isGroup ? k.remoteJid : '', getMetadata: (g) => getCachedGroupMetadata(sock, g) });
    jid = jidNormalizedUser(jid || candidates[0] || k.remoteJid);
    return { jid, lid, number: numberOf(jid) };
}

function participantMatches(p, identity) {
    // Nomor telepon (PN) dibandingkan langsung. LID dibandingkan sebagai LID,
    // bukan digitnya — numberOf(lid) bisa kebetulan sama dengan nomor orang lain.
    if (!p || typeof p !== 'object') return String(p || '') === identity.jid;
    const pn = [p.phoneNumber, p.phoneJid, p.jid, p.id]
        .filter((v) => v && !String(v).endsWith('@lid')).map(numberOf);
    if (pn.includes(identity.number)) return true;
    const lids = [p.lid, p.lidJid, p.jid, p.id].filter((v) => v && String(v).endsWith('@lid')).map(String);
    return Boolean(identity.lid && lids.includes(identity.lid));
}

/* ───────────────────────── ATURAN AKSES PLUGIN ───────────────────────── */

/**
 * Plugin wajib daftar bila: `register: true`, atau (config.register.enforce aktif, kategorinya tidak
 * dikecualikan, dan plugin tidak memakai `register: false`).
 */
function needsRegister(plugin) {
    if (!config.register?.enabled) return false;
    if (plugin.register === true) return true;
    if (plugin.register === false) return false;
    return Boolean(config.register.enforce) && !(config.register.exemptCategories || []).includes(plugin.category);
}


module.exports = { resolveIdentity, participantMatches, needsRegister };
