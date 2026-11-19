/**
 * ANTI CALL — tolak panggilan masuk (setting `.anticall`, opsi blokir `.anticallblock`). Owner & akun bot dilewati.
 */
const config = require('../config');
const botSettings = require('../lib/core/botSettings');
const { resolveJid } = require('../lib/core/jid');
const { logError, logInfo } = require('../lib/core/logger');
const { numberOf } = require('../lib/core/utils');
const TEXT = require('./texts');

async function onCall(sock, calls) {
    const s = botSettings.get(sock);
    if (!s.antiCall) return;
    const rootOwners = config.ownerNumber.map((v) => String(v).replace(/[^0-9]/g, ''));
    for (const c of calls || []) {
        if (c.status !== 'offer' || !c.id || !c.from) continue;
        const caller = await resolveJid(sock, c.callerPn || c.from, {});
        const n = numberOf(caller);
        if (rootOwners.includes(n) || n === numberOf(sock.user?.id) || (sock.isJadibot && n === sock.jadibotOwner)) continue;
        try {
            await sock.rejectCall(c.id, c.from);
            await sock.sendMessage(c.from, { text: TEXT.antiCall });
            if (s.antiCallBlock) await sock.updateBlockStatus(c.from, 'block');
            logInfo('ANTICALL', `Panggilan ${c.isVideo ? 'video' : 'suara'} dari +${n} ditolak${s.antiCallBlock ? ' & diblokir' : ''}`);
        } catch (err) { logError('ANTICALL', err); }
    }
}

module.exports = { onCall };
