/**
 * DETEKSI PERUBAHAN GRUP (aktif per grup lewat `.detect on`) — nama, deskripsi, foto, pengaturan kirim pesan /
 * edit info, pesan sementara, link undangan, persetujuan bergabung, penambahan anggota, admin, join/keluar/kick,
 * permintaan bergabung. Teks: handler/texts.js (detect*).
 */
const { proto } = require('../lib/wa/waCompat');
const config = require('../config');
const db = require('../lib/data/database');
const { isLid, resolveJid, participantJid } = require('../lib/core/jid');
const { getCachedGroupMetadata } = require('../lib/core/jid');
const { logError } = require('../lib/core/logger');
const { numberOf } = require('../lib/core/utils');
const TEXT = require('./texts');

/* ── deteksi perubahan grup ── */
const detectSeen = new Map();

/** Grup yang boleh dikirimi notifikasi deteksi (fitur aktif, tidak diban/mute), atau null. */
function detectGroup(sock, gid) {
    if (!config.groupDetect?.enabled || !gid || !gid.endsWith('@g.us')) return null;
    const group = db.getGroup(gid);
    if (!group || !group.settings.detect || group.banned.active || group.settings.mute) return null;
    return group;
}

/** true bila kejadian sama sudah dilaporkan dalam rentang cooldown. */
function detectDuplicate(key) {
    const now = Date.now();
    const ttl = (config.groupDetect?.cooldownSec || 20) * 1000;
    for (const [k, t] of detectSeen) if (now - t > ttl) detectSeen.delete(k);
    if (detectSeen.has(key)) return true;
    detectSeen.set(key, now);
    return false;
}

async function jidOf(sock, gid, raw) {
    let j = participantJid(raw);
    if (isLid(j)) j = await resolveJid(sock, j, { groupJid: gid, getMetadata: (g) => getCachedGroupMetadata(sock, g) });
    return j;
}

/** Kirim pesan deteksi dengan mention. who/by = JID. */
async function sendDetect(sock, gid, build) {
    const mentions = [];
    const tag = (jid) => {
        if (!jid) return '';
        if (!mentions.includes(jid)) mentions.push(jid);
        return `@${numberOf(jid)}`;
    };
    const text = build(tag);
    if (!text) return;
    try { await sock.reply(gid, text, null, { mentions }); } catch (err) { logError('DETECT', err); }
}

async function onGroupParticipants(sock, ev) {
    const { id: gid, action } = ev || {};
    const group = detectGroup(sock, gid);
    if (!group || !action) return;
    const s = group.settings;
    // add/remove sudah ditangani Welcome/Bye → hanya dilaporkan bila Welcome/Bye mati
    if (action === 'add' && s.welcome) return;
    if (action === 'remove' && s.bye) return;
    if (!['add', 'remove', 'promote', 'demote'].includes(action)) return;

    const by = ev.author ? await jidOf(sock, gid, ev.authorPn || ev.author) : '';
    const botNumber = numberOf(sock.user?.id);
    for (const raw of ev.participants || []) {
        const who = await jidOf(sock, gid, raw);
        if (!who || (action === 'remove' && numberOf(who) === botNumber)) continue;
        if (detectDuplicate(`${gid}:p:${action}:${numberOf(who)}`)) continue;
        const self = by && numberOf(by) === numberOf(who);
        await sendDetect(sock, gid, (tag) => {
            if (action === 'promote') return TEXT.detectPromote(tag(who), tag(by));
            if (action === 'demote') return TEXT.detectDemote(tag(who), tag(by));
            if (action === 'add') return self || !by ? TEXT.detectJoin(tag(who)) : TEXT.detectAdd(tag(who), tag(by));
            return self || !by ? TEXT.detectLeave(tag(who)) : TEXT.detectKick(tag(who), tag(by));
        });
    }
}

async function onGroupsUpdate(sock, updates) {
    for (const u of updates || []) {
        const gid = u?.id;
        if (!gid) continue;
        if (u.subject !== undefined || u.desc !== undefined) db.getGroup(gid, { name: u.subject, description: u.desc });
        const group = detectGroup(sock, gid);
        if (!group) continue;
        const by = u.author ? await jidOf(sock, gid, u.authorPn || u.author) : '';
        const lines = [];
        const add = (kindKey, value, fn) => { if (!detectDuplicate(`${gid}:g:${kindKey}:${value}`)) lines.push(fn); };
        await sendDetect(sock, gid, (tag) => {
            const who = tag(by);
            if (u.subject !== undefined) add('subject', u.subject, TEXT.detectSubject(u.subject, who));
            if (u.desc !== undefined) add('desc', u.desc, TEXT.detectDesc(u.desc, who));
            if (u.announce !== undefined) add('announce', u.announce, TEXT.detectAnnounce(Boolean(u.announce), who));
            if (u.restrict !== undefined) add('restrict', u.restrict, TEXT.detectRestrict(Boolean(u.restrict), who));
            if (u.ephemeralDuration !== undefined) add('ephemeral', u.ephemeralDuration, TEXT.detectEphemeral(Number(u.ephemeralDuration) || 0, who));
            if (u.inviteCode !== undefined) add('invite', u.inviteCode, TEXT.detectInvite(who));
            if (u.joinApprovalMode !== undefined) add('approval', u.joinApprovalMode, TEXT.detectApproval(Boolean(u.joinApprovalMode), who));
            if (u.memberAddMode !== undefined) add('memberadd', u.memberAddMode, TEXT.detectMemberAdd(Boolean(u.memberAddMode), who));
            return lines.join('\n\n');
        });
    }
}

async function onJoinRequest(sock, ev) {
    const gid = ev?.id;
    const group = detectGroup(sock, gid);
    if (!group || !ev.action) return;
    const who = await jidOf(sock, gid, ev.participantPn || ev.participant);
    if (!who || detectDuplicate(`${gid}:jr:${ev.action}:${numberOf(who)}`)) return;
    await sendDetect(sock, gid, (tag) => TEXT.detectJoinRequest(tag(who), ev.action));
}

/** Pesan "stub" (tanpa isi) dari WhatsApp — dipakai untuk perubahan yang tidak lewat groups.update, mis. foto grup. */
async function onGroupStub(sock, m) {
    const gid = m.key.remoteJid;
    const group = detectGroup(sock, gid);
    if (!group) return;
    const name = proto?.WebMessageInfo?.StubType?.[m.messageStubType];
    if (name !== 'GROUP_CHANGE_ICON') return;
    const ts = Number(m.messageTimestamp?.toNumber ? m.messageTimestamp.toNumber() : m.messageTimestamp) || 0;
    if (ts && Date.now() / 1000 - ts > config.ignoreOldSeconds) return;
    const by = await jidOf(sock, gid, m.participant || m.key.participant || '');
    if (detectDuplicate(`${gid}:icon:${m.key.id}`)) return;
    await sendDetect(sock, gid, (tag) => TEXT.detectIcon(tag(by)));
}


module.exports = { onGroupParticipants, onGroupsUpdate, onJoinRequest, onGroupStub };
