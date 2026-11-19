/**
 * PARSER PESAN — mengenali SEMUA jenis pesan WhatsApp dan mengambil teksnya:
 * teks, caption (gambar/video/dokumen), polling, lokasi, kontak, reaksi, tombol, list, interactive,
 * template, produk, order, undangan grup, event, pembayaran, dll.
 *
 * extractAllText() → { body, mtype, unwrapped, kind, data }
 *   body  = teks utama (dipakai untuk membaca perintah)
 *   mtype = nama tipe mentah dari WhatsApp (mis. 'imageMessage')
 *   kind  = jenis ringkas: text image video gif videonote audio voice document sticker poll pollvote location
 *           contact reaction buttons buttonreply list listreply interactive template product order groupinvite
 *           event call payment invoice album comment newsletterinvite protocol other unknown
 *   data  = detail sesuai jenis (mis. poll → { name, options, selectableCount })
 */
const { jidNormalizedUser } = require('../lib/wa/waCompat');
const config = require('../config');
const { findPlugin } = require('../lib/bot/pluginLoader');

const WRAPPERS = [
    'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'ephemeralMessage', 'documentWithCaptionMessage',
    'botInvokeMessage', 'groupMentionedMessage', 'groupStatusMessage', 'groupStatusMessageV2', 'statusMentionMessage',
    'associatedChildMessage', 'lottieStickerMessage'
];

function unwrapMessage(message) {
    let msg = message;
    for (let i = 0; i < 8 && msg; i++) {
        let next = null;
        for (const w of WRAPPERS) if (msg[w]?.message) { next = msg[w].message; break; }
        if (!next) next = msg.editedMessage?.message?.protocolMessage?.editedMessage || msg.editedMessage?.message || msg.protocolMessage?.editedMessage || null;
        if (!next) break;
        msg = next;
    }
    return msg;
}

const S = (v) => (typeof v === 'string' ? v : '');
const num = (v) => Number(v?.toNumber ? v.toNumber() : v) || 0;
const media = (v) => ({ mimetype: v.mimetype || '', size: num(v.fileLength), seconds: num(v.seconds), width: num(v.width), height: num(v.height) });
const vcardNumber = (vcard) => {
    const v = String(vcard || '');
    return v.match(/waid=(\d+)/)?.[1] || (v.match(/TEL[^:\n]*:([+\d\s-]+)/)?.[1] || '').replace(/[^\d]/g, '');
};
const contactOf = (c) => ({ name: S(c?.displayName), number: vcardNumber(c?.vcard) });
const noteText = (n) => (n ? describeMessage(unwrapMessage(n)).body : '');
const firstText = (v) => {
    if (typeof v === 'string') return v;
    if (!v || typeof v !== 'object') return '';
    return S(v.text) || S(v.caption) || S(v.contentText) || S(v.description) || S(v.title) || S(v.name) || S(v.body?.text) || '';
};

const EXTRACT = {
    conversation: (v) => ({ body: S(v), kind: 'text' }),
    extendedTextMessage: (v) => ({ body: S(v.text), kind: 'text', data: { url: v.canonicalUrl || v.matchedText || '', title: S(v.title), description: S(v.description) } }),
    imageMessage: (v) => ({ body: S(v.caption), kind: 'image', data: media(v) }),
    videoMessage: (v) => ({ body: S(v.caption), kind: v.gifPlayback ? 'gif' : 'video', data: media(v) }),
    ptvMessage: (v) => ({ body: S(v.caption), kind: 'videonote', data: media(v) }),
    audioMessage: (v) => ({ body: '', kind: v.ptt ? 'voice' : 'audio', data: media(v) }),
    documentMessage: (v) => ({ body: S(v.caption), kind: 'document', data: { ...media(v), fileName: S(v.fileName) } }),
    stickerMessage: (v) => ({ body: '', kind: 'sticker', data: { ...media(v), animated: Boolean(v.isAnimated) } }),
    locationMessage: (v) => ({
        body: [S(v.name), S(v.address)].filter(Boolean).join(' - ') || S(v.comment), kind: 'location',
        data: { latitude: v.degreesLatitude, longitude: v.degreesLongitude, name: S(v.name), address: S(v.address), url: S(v.url), live: false }
    }),
    liveLocationMessage: (v) => ({ body: S(v.caption), kind: 'location', data: { latitude: v.degreesLatitude, longitude: v.degreesLongitude, live: true } }),
    contactMessage: (v) => ({ body: S(v.displayName), kind: 'contact', data: { contacts: [contactOf(v)] } }),
    contactsArrayMessage: (v) => ({ body: S(v.displayName) || (v.contacts || []).map((c) => S(c.displayName)).filter(Boolean).join(', '), kind: 'contact', data: { contacts: (v.contacts || []).map(contactOf) } }),
    reactionMessage: (v) => ({ body: S(v.text), kind: 'reaction', data: { emoji: S(v.text), targetId: v.key?.id || '' } }),
    pollUpdateMessage: (v) => ({ body: '', kind: 'pollvote', data: { pollId: v.pollCreationMessageKey?.id || '' } }),
    pollResultSnapshotMessage: (v) => ({ body: S(v.name), kind: 'poll', data: { name: S(v.name), results: (v.pollVotes || []).map((x) => ({ name: S(x.optionName), votes: num(x.optionVoteCount) })) } }),
    buttonsMessage: (v) => ({ body: S(v.contentText) || S(v.text), kind: 'buttons', data: { footer: S(v.footerText), buttons: (v.buttons || []).map((b) => ({ id: b.buttonId, text: S(b.buttonText?.displayText) })) } }),
    buttonsResponseMessage: (v) => ({ body: S(v.selectedButtonId) || S(v.selectedDisplayText), kind: 'buttonreply', data: { id: S(v.selectedButtonId), text: S(v.selectedDisplayText) } }),
    templateMessage: (v) => {
        const h = v.hydratedTemplate || v.hydratedFourRowTemplate || {};
        return { body: S(h.hydratedContentText) || S(h.hydratedTitleText) || S(v.fourRowTemplate?.content?.namespace), kind: 'template', data: { footer: S(h.hydratedFooterText) } };
    },
    templateButtonReplyMessage: (v) => ({ body: S(v.selectedId) || S(v.selectedDisplayText), kind: 'buttonreply', data: { id: S(v.selectedId), text: S(v.selectedDisplayText) } }),
    listMessage: (v) => ({ body: S(v.description) || S(v.title), kind: 'list', data: { title: S(v.title), buttonText: S(v.buttonText) } }),
    listResponseMessage: (v) => ({ body: S(v.singleSelectReply?.selectedRowId) || S(v.title), kind: 'listreply', data: { id: S(v.singleSelectReply?.selectedRowId), title: S(v.title) } }),
    interactiveMessage: (v) => ({ body: S(v.body?.text) || S(v.header?.title), kind: 'interactive', data: { footer: S(v.footer?.text) } }),
    interactiveResponseMessage: (v) => {
        let body = '';
        const flow = v.nativeFlowResponseMessage;
        if (flow?.paramsJson) { try { const p = JSON.parse(flow.paramsJson); body = p.id || p.selectedId || p.rowId || ''; } catch { body = ''; } }
        if (!body) body = S(v.body?.text);
        return { body: S(body), kind: 'buttonreply', data: { name: S(flow?.name) } };
    },
    productMessage: (v) => ({ body: S(v.product?.title), kind: 'product', data: { description: S(v.product?.description), price: num(v.product?.priceAmount1000) / 1000, currency: S(v.product?.currencyCode), seller: S(v.businessOwnerJid) } }),
    orderMessage: (v) => ({ body: S(v.orderTitle) || S(v.message), kind: 'order', data: { itemCount: num(v.itemCount), total: num(v.totalAmount1000) / 1000, currency: S(v.totalCurrencyCode) } }),
    groupInviteMessage: (v) => ({ body: S(v.caption) || S(v.groupName), kind: 'groupinvite', data: { groupJid: S(v.groupJid), inviteCode: S(v.inviteCode), groupName: S(v.groupName) } }),
    eventMessage: (v) => ({ body: S(v.name), kind: 'event', data: { name: S(v.name), description: S(v.description), location: S(v.location?.name), startTime: num(v.startTime), endTime: num(v.endTime), canceled: Boolean(v.isCanceled) } }),
    scheduledCallCreationMessage: (v) => ({ body: S(v.title), kind: 'call', data: { callType: v.callType, scheduledAt: num(v.scheduledTimestampMs) } }),
    requestPaymentMessage: (v) => ({ body: noteText(v.noteMessage), kind: 'payment', data: { amount: num(v.amount1000) / 1000, currency: S(v.currencyCodeIso4217) } }),
    sendPaymentMessage: (v) => ({ body: noteText(v.noteMessage), kind: 'payment', data: {} }),
    invoiceMessage: (v) => ({ body: S(v.note), kind: 'invoice', data: { token: S(v.token) } }),
    newsletterAdminInviteMessage: (v) => ({ body: S(v.caption) || S(v.newsletterName), kind: 'newsletterinvite', data: { newsletterJid: S(v.newsletterJid), name: S(v.newsletterName) } }),
    albumMessage: (v) => ({ body: '', kind: 'album', data: { images: num(v.expectedImageCount), videos: num(v.expectedVideoCount) } }),
    commentMessage: (v) => ({ body: noteText(v.message), kind: 'comment', data: {} }),
    stickerPackMessage: (v) => ({ body: S(v.name), kind: 'stickerpack', data: { publisher: S(v.publisher) } }),
    protocolMessage: () => ({ body: '', kind: 'protocol' }),
    keepInChatMessage: () => ({ body: '', kind: 'other' }),
    pinInChatMessage: () => ({ body: '', kind: 'other' })
};

/** Uraikan satu pesan (sudah di-unwrap) → { body, mtype, kind, data }. */
function describeMessage(msg) {
    if (!msg || typeof msg !== 'object') return { body: '', mtype: 'unknown', kind: 'unknown', data: {} };
    const keys = Object.keys(msg).filter((k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage');
    const type = keys[0] || 'unknown';
    const v = msg[type];
    let r;
    try {
        if (type === 'unknown') r = { body: '', kind: 'unknown' };
        else if (/^pollCreationMessage/.test(type)) {
            r = { body: S(v?.name), kind: 'poll', data: { name: S(v?.name), options: (v?.options || []).map((o) => S(o.optionName)), selectableCount: num(v?.selectableOptionsCount) || 1 } };
        } else if (EXTRACT[type]) r = EXTRACT[type](v ?? {});
        else r = { body: firstText(v), kind: 'other' };
    } catch { r = { body: '', kind: 'other' }; }
    return { body: S(r.body).trim(), mtype: type, kind: r.kind || 'other', data: r.data || {} };
}

function extractAllText(m) {
    if (!m?.message) return { body: '', mtype: 'unknown', kind: 'unknown', data: {}, unwrapped: null };
    const msg = unwrapMessage(m.message);
    if (!msg) return { body: '', mtype: 'unknown', kind: 'unknown', data: {}, unwrapped: null };
    return { ...describeMessage(msg), unwrapped: msg };
}

function extractQuotedInfo(unwrappedMsg) {
    if (!unwrappedMsg) return null;
    const type = Object.keys(unwrappedMsg).find((k) => unwrappedMsg[k]?.contextInfo?.quotedMessage);
    if (!type) return null;
    const ctx = unwrappedMsg[type].contextInfo;
    const quotedRaw = unwrapMessage(ctx.quotedMessage);
    if (!quotedRaw) return null;
    const d = describeMessage(quotedRaw);
    const qType = Object.keys(quotedRaw).find((k) => k !== 'messageContextInfo') || Object.keys(quotedRaw)[0];
    return {
        id: ctx.stanzaId,
        sender: ctx.participant ? jidNormalizedUser(ctx.participant) : '',
        mtype: qType,
        kind: d.kind,
        data: d.data,
        text: d.body,
        message: quotedRaw
    };
}

/**
 * Pisahkan prefix, command, args. `text` mempertahankan baris baru
 * (penting untuk .svplug / .editplug / .hidetag), `args` dipecah per spasi.
 */
function parseCommandAndPrefix(body, groupPrefix = '') {
    if (!body) return null;
    const prefixes = groupPrefix ? [groupPrefix] : (config.multiPrefix ? config.prefixes : [config.prefix]);
    const attempt = (usedPrefix, content) => {
        const m = content.match(/^(\S+)([\s\S]*)$/);
        if (!m) return null;
        const rest = m[2].replace(/^\s+/, '').replace(/\s+$/, '');
        return { usedPrefix, command: m[1].toLowerCase(), args: rest ? rest.split(/\s+/) : [], text: rest };
    };
    for (const p of prefixes) {
        if (body.startsWith(p)) {
            const res = attempt(p, body.slice(p.length).replace(/^[ \t]+/, ''));
            if (res) return res;
        }
    }
    if (config.noPrefix) {
        const res = attempt('', body);
        if (res && findPlugin(res.command)) return res;
    }
    return null;
}


module.exports = { unwrapMessage, describeMessage, extractAllText, extractQuotedInfo, parseCommandAndPrefix };
