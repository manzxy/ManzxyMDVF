/** Kumpulkan ID yang disebut (@mention) atau di-reply dalam satu pesan. */
const { unwrapMessage } = require('../../handler/parser');

function getMentions(m, quoted) {
    const msg = unwrapMessage(m?.message) || {};
    const ci = Object.values(msg).find((v) => v && typeof v === 'object' && v.contextInfo)?.contextInfo || {};
    return [...new Set([...(ci.mentionedJid || []), quoted?.sender].filter(Boolean))];
}

module.exports = { getMentions };
