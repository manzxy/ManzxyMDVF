/**
 * EVENT SOCKET — SEMUA event bot utama & jadibot dipasang dari satu fungsi: bindEvents(sock).
 *   messages.upsert → message.js • messages.update → poll.js • group-* → groupDetect.js • call → antiCall.js
 * Setiap event juga diteruskan ke plugin (emitPluginEvent) sehingga plugin bisa memakai `events: {...}`.
 */
const botSettings = require('../lib/core/botSettings');
const { emitPluginEvent } = require('../lib/bot/pluginLoader');
const { logError } = require('../lib/core/logger');
const { handleIncomingMessage } = require('./message');
const { onGroupParticipants, onGroupsUpdate, onJoinRequest } = require('./groupDetect');
const { onMessagesUpdate } = require('./poll');
const { onCall } = require('./antiCall');

/**
 * Pasang SEMUA event socket. Dipakai bot utama (index.js) dan tiap jadibot (lib/jadibotManager.js).
 * @param {object} sock
 * @param {{isActive?: () => boolean}} opts  isActive: false → event socket lama diabaikan (mis. setelah reconnect)
 */
function bindEvents(sock, { isActive = () => true } = {}) {
    const on = (name, fn) => sock.ev.on(name, (payload) => {
        if (!isActive()) return;
        Promise.resolve().then(() => fn(payload)).catch((err) => logError(`EVENT:${name}`, err));
    });

    on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return;
        for (const m of messages) {
            try { await handleIncomingMessage(sock, m); } catch (err) { logError('MSG', err); }
        }
    });
    on('messages.update', (updates) => onMessagesUpdate(sock, updates, handleIncomingMessage));

    on('group-participants.update', async (ev) => { emitPluginEvent('group-participants.update', sock, ev); await onGroupParticipants(sock, ev); });
    on('groups.update', async (updates) => { emitPluginEvent('groups.update', sock, updates); await onGroupsUpdate(sock, updates); });
    on('group.join-request', async (ev) => { emitPluginEvent('group.join-request', sock, ev); await onJoinRequest(sock, ev); });
    on('call', async (calls) => { emitPluginEvent('call', sock, calls); await onCall(sock, calls); });
    on('messages.delete', (p) => emitPluginEvent('messages.delete', sock, p));
    on('messages.reaction', (p) => emitPluginEvent('messages.reaction', sock, p));
    on('presence.update', (p) => emitPluginEvent('presence.update', sock, p));

    // Status online (presence) mengikuti koneksi
    sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'open') botSettings.startPresence(sock);
        else if (connection === 'close') botSettings.stopPresence(sock);
    });
}

module.exports = { bindEvents };
