/**
 * HANDLER — pintu masuk. Struktur folder ini:
 *   texts.js        semua kalimat balasan (TEXT)          parser.js      baca semua jenis pesan + prefix/command
 *   access.js       identitas pengirim, aturan wajib daftar  message.js     alur satu pesan → plugin
 *   events.js       bindEvents(): semua event socket        groupDetect.js deteksi perubahan grup
 *   poll.js         suara polling                           antiCall.js    tolak panggilan
 */
const TEXT = require('./texts');
const messageStore = require('../lib/core/messageStore');
const parser = require('./parser');
const { needsRegister } = require('./access');
const { handleIncomingMessage } = require('./message');
const { bindEvents } = require('./events');

module.exports = {
    handleIncomingMessage, bindEvents,
    parseCommandAndPrefix: parser.parseCommandAndPrefix, extractAllText: parser.extractAllText,
    describeMessage: parser.describeMessage, unwrapMessage: parser.unwrapMessage,
    TEXT, needsRegister, getStoredMessage: messageStore.getMessage
};
