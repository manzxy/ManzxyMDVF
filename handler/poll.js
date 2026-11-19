/**
 * POLLING — suara polling terdekripsi (event `messages.update`).
 *  • diteruskan ke plugin sebagai event `poll.vote` ({ chat, pollId, pollName, options, voter, selected, byBot })
 *  • polling BUATAN BOT yang pilihannya berawalan prefix (mis. ".menu") dijalankan sebagai perintah oleh pemberi suara
 * `dispatch` = handleIncomingMessage (diberikan oleh events.js agar tidak ada import melingkar).
 */
const crypto = require('crypto');
const wa = require('../lib/wa/waCompat');
const { jidNormalizedUser } = wa;
const config = require('../config');
const messageStore = require('../lib/core/messageStore');
const { isLid, resolveJid } = require('../lib/core/jid');
const { emitPluginEvent } = require('../lib/bot/pluginLoader');
const { getCachedGroupMetadata } = require('../lib/core/jid');
const { logError } = require('../lib/core/logger');
const { numberOf } = require('../lib/core/utils');
const { describeMessage, unwrapMessage, parseCommandAndPrefix } = require('./parser');

const voteSeen = new Map();

async function handlePollUpdate(sock, { key, update }, dispatch) {
    const creation = messageStore.get(key?.id);
    if (!creation) return;
    const pollUpdates = update.pollUpdates;
    const last = pollUpdates[pollUpdates.length - 1];
    const vk = last?.pollUpdateMessageKey || {};
    const chat = key.remoteJid || vk.remoteJid;
    const isGroup = String(chat).endsWith('@g.us');
    const botJid = sock.getBotJid ? sock.getBotJid() : jidNormalizedUser(sock.user?.id || '');

    let voter = vk.fromMe ? botJid : (vk.participant || (isGroup ? '' : chat));
    if (isLid(voter)) voter = await resolveJid(sock, voter, { groupJid: isGroup ? chat : '', getMetadata: (g) => getCachedGroupMetadata(sock, g) });
    if (!voter) return;

    if (typeof wa.getAggregateVotesInPollMessage !== 'function') return;
    const agg = wa.getAggregateVotesInPollMessage({ message: creation.message, pollUpdates }, sock.user?.id);
    const voterNum = numberOf(voter);
    const selected = agg.filter((o) => (o.voters || []).some((v) => numberOf(v) === voterNum)).map((o) => o.name);

    const dupKey = `${key.id}:${voterNum}:${selected.join('|')}`;
    const now = Date.now();
    for (const [k, t] of voteSeen) if (now - t > 15000) voteSeen.delete(k);
    if (voteSeen.has(dupKey)) return;
    voteSeen.set(dupKey, now);

    const desc = describeMessage(unwrapMessage(creation.message));
    const payload = {
        chat, pollKey: key, pollId: key.id, pollName: desc.data?.name || '', options: desc.data?.options || [],
        voter, voterNumber: voterNum, selected, byBot: messageStore.isBotPoll(key.id)
    };
    emitPluginEvent('poll.vote', sock, payload);

    // Polling buatan bot: pilihan berawalan prefix dijalankan sebagai perintah oleh pemberi suara
    if (config.poll?.voteAsCommand === false || !payload.byBot || !selected.length) return;
    const choice = selected[0];
    if (!parseCommandAndPrefix(choice)) return;
    const fake = {
        key: { remoteJid: chat, fromMe: Boolean(vk.fromMe), id: 'POLL' + crypto.randomBytes(6).toString('hex').toUpperCase(), ...(isGroup ? { participant: voter } : {}) },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: choice }
    };
    await dispatch(sock, fake);
}

async function onMessagesUpdate(sock, updates, dispatch) {
    for (const u of updates || []) {
        if (!u?.update?.pollUpdates?.length) continue;
        try { await handlePollUpdate(sock, u, dispatch); } catch (err) { logError('POLL', err); }
    }
}

/**
 * Pasang SEMUA event socket. Dipakai bot utama (index.js) dan tiap jadibot (lib/jadibotManager.js).
 * @param {object} sock
 * @param {{isActive?: () => boolean}} opts  isActive: false → event socket lama diabaikan (mis. setelah reconnect)
 */

module.exports = { onMessagesUpdate };
