/**
 * ZAPO COMPAT — jembatan Baileys -> zapo-js.
 *
 * STATUS: lapisan transport. Dipakai hanya bila WA_ENGINE=zapo.
 * Tujuan: index.js / handler / 100 plugin tetap memakai bentuk `sock` ala Baileys
 *         (sock.ev, sock.user, sock.sendMessage, sock.groupMetadata, ...),
 *         sementara koneksi, auth, dan pengiriman aktual dijalankan WaClient zapo-js.
 *
 * Catatan wire: proto Message zapo-js dan Baileys byte-identik (terverifikasi),
 * sehingga helper statis Baileys (proto, jid, generateWAMessageFromContent,
 * downloadContentFromMessage) tetap dipakai oleh rich.js / waWrapper.js / plugin.
 *
 * Modul ini sengaja tidak mengubah file lain. Cutover dilakukan lewat flag.
 */
'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path');
const {
    WaClient,
    createStore,
    WA_VERSION,
    isGroupJid,
    isNewsletterJid,
    isBroadcastJid,
    isStatusBroadcastJid,
    isBotJid,
    isUserJid,
    toUserJid,
    normalizeRecipientJid,
    downloadMediaMessage,
} = require('zapo-js');
const { createSqliteStore } = require('@zapo-js/store-sqlite');
const { createNoopLogger, createPinoLogger } = require('zapo-js');

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const idKey = (j) => String(j || '').split('@')[0].split(':')[0];
const STATUS_JID = 'status@broadcast';
/** '#1F2C34' -> 0xFF1F2C34 (field backgroundArgb di extendedTextMessage zapo). */
const hexToArgb = (hex) => {
    if (hex == null || hex === '') return undefined;
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
    return m ? (0xff000000 | parseInt(m[1], 16)) >>> 0 : undefined;
};

/** Cache PN -> LID per session (status fanout butuh LID; PN bikin ack error=400). */
const lidCache = new Map();
const isLid = (j) => String(j || '').endsWith('@lid');

/**
 * Ubah daftar penerima status ke LID. JID yang sudah @lid dipakai apa adanya.
 * PN (@s.whatsapp.net) di-resolve lewat client.profile.getLidsByPhoneNumbers
 * (USYNC). Jika gagal, JID PN tetap dipakai sebagai fallback (lebih baik coba
 * kirim daripada langsung gagal), tapi ini biasanya berujung nack 400.
 */
async function resolveStatusRecipients(client, jids) {
    const out = [];
    const pnToResolve = [];
    for (const j of jids) {
        if (isLid(j)) { out.push(j); continue; }
        const key = idKey(j);
        if (lidCache.has(key)) {
            const lid = lidCache.get(key);
            if (lid) out.push(lid);
            continue;
        }
        pnToResolve.push(j);
    }
    if (pnToResolve.length && client.profile?.getLidsByPhoneNumbers) {
        try {
            const results = await client.profile.getLidsByPhoneNumbers(pnToResolve);
            const byQuery = new Map();
            for (const r of results || []) {
                if (!r) continue;
                const qKey = idKey(r.queriedJid || r.phoneJid);
                if (r.lidJid) byQuery.set(qKey, r.lidJid);
                lidCache.set(qKey, r.lidJid || null);
            }
            for (const j of pnToResolve) {
                const lid = byQuery.get(idKey(j));
                if (lid) out.push(lid);
            }
        } catch (err) {
            // fallback: pakai PN apa adanya
            for (const j of pnToResolve) out.push(j);
        }
    } else {
        for (const j of pnToResolve) out.push(j);
    }
    return [...new Set(out)];
}
const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined));

/**
 * Opsi kirim yang dikenal zapo 1.12.0 (WaSendMessageOptions).
 * Apa pun di luar daftar ini dibuang supaya tidak ada properti asing yang
 * ikut terkirim ke publish dan membuat stanza ditolak.
 */
const WA_SEND_OPTION_KEYS = [
    'expectedIdentity', 'contextInfo', 'quote', 'forward', 'mentions',
    'expirationSeconds', 'ephemeralSettingTimestamp', 'disappearingModeTrigger',
    'disableGroupEphemeralAutoInject', 'disableDirectEphemeralAutoInject',
    'customNodes', 'viewOnce', 'editKey', 'messageSecret', 'additionalAttributes',
    'ackTimeoutMs', 'maxAttempts', 'retryDelayMs',
];

/**
 * Petakan opsi gaya Baileys → WaSendMessageOptions zapo.
 * Alias yang ditangani: quoted→quote, ephemeral→expirationSeconds,
 * additionalNodes→customNodes (Baileys memakai node biz manual; zapo
 * membangun addon sendiri, tapi customNodes tetap diteruskan bila ada).
 */
function mapSendOptions(options = {}) {
    const src = options || {};
    const out = {};
    for (const k of WA_SEND_OPTION_KEYS) {
        if (src[k] !== undefined) out[k] = src[k];
    }
    if (out.quote === undefined) out.quote = src.quoted;
    if (out.expirationSeconds === undefined) out.expirationSeconds = src.ephemeral;
    if (out.customNodes === undefined) out.customNodes = src.additionalNodes;
    return clean(out);
}
const toJid = (x) => {
    if (!x) throw new Error('jid kosong');
    const s = String(x);
    if (s.includes('@')) return s;
    const d = digits(s);
    if (!d) throw new Error('jid tidak valid: ' + s);
    return d + '@s.whatsapp.net';
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newMsgId = () => '3EB0' + require('node:crypto').randomBytes(8).toString('hex').toUpperCase();

/* ───────────────────────────── STORE ───────────────────────────── */

/**
 * Store zapo berbasis sqlite, satu file per sessionId.
 * providers messages/threads/contacts dimatikan supaya hemat RAM (multi-session).
 */
function createZapoStore(dbPath) {
    return createStore({
        backends: { sqlite: createSqliteStore({ path: dbPath, driver: 'auto' }) },
        providers: {
            auth: 'sqlite', signal: 'sqlite', preKey: 'sqlite', session: 'sqlite',
            identity: 'sqlite', senderKey: 'sqlite', appState: 'sqlite', privacyToken: 'sqlite',
            messages: 'none', threads: 'none', contacts: 'none',
        },
    });
}

/* ───────────────────────────── EVENT TRANSLATION ───────────────────────────── */

/**
 * Terjemahkan event zapo menjadi bentuk event Baileys yang dikonsumsi handler/.
 * - message            -> messages.upsert { messages:[m], type:'notify' }
 * - connection         -> connection.update { connection, lastDisconnect, qr }
 * - group              -> groups.update | group-participants.update | group.join-request
 * - call               -> call [ ... ]
 * - message_addon      -> messages.update (poll vote) bila relevan
 *
 * Fungsi ini murni (tanpa efek samping) supaya bisa di-unit-test offline.
 */
function translateEvent(name, payload, ctx = {}) {
    const out = [];
    if (name === 'message') {
        const ev = payload && payload.event ? payload.event : payload;
        if (!ev || !ev.message) return out;
        const m = Object.assign({}, ev, {
            messageTimestamp: ev.messageTimestamp ?? longLike(ev.timestampSeconds),
        });
        out.push(['messages.upsert', { messages: [m], type: 'notify' }]);
        return out;
    }

    if (name === 'connection') {
        const ev = payload || {};
        const status = ev.status || ev.connection;
        if (status === 'open' || status === 'connecting') {
            out.push(['connection.update', { connection: status === 'open' ? 'open' : 'connecting' }]);
        } else if (status === 'close') {
            const code = ev.code ?? ev.reason ?? null;
            out.push(['connection.update', {
                connection: 'close',
                lastDisconnect: {
                    error: {
                        output: { statusCode: typeof code === 'number' ? code : undefined },
                        data: { attrs: { code } },
                        message: String(ev.reason || 'closed'),
                    },
                },
            }]);
        }
        return out;
    }

    if (name === 'auth_qr') {
        out.push(['connection.update', { qr: payload?.qr }]);
        return out;
    }

    if (name === 'group') {
        const ev = payload?.event ?? payload;
        if (!ev) return out;
        const action = String(ev.action || ev.type || '').toLowerCase();
        if (/join|request|approval/.test(action)) {
            // zapo membership request: { jid, phoneJid, username }.
            // handler/groupDetect.js membaca participantPn/participant.
            const req = ev.participant || ev.membershipRequest || ev;
            out.push(['group.join-request', {
                ...ev,
                participant: ev.participant ?? req.jid ?? req.lidJid,
                participantPn: ev.participantPn ?? req.phoneJid ?? req.jid,
            }]);
        } else if (ev.participants || /add|remove|promote|demote|kick/.test(action)) {
            out.push(['group-participants.update', normalizeParticipants(ev)]);
        } else {
            out.push(['groups.update', [normalizeGroup(ev)]]);
        }
        return out;
    }

    if (name === 'call') {
        const ev = payload?.event ?? payload;
        const list = Array.isArray(ev) ? ev : [ev];
        out.push(['call', list.map((c) => {
            // zapo: callCreatorJid (isi stanza) / callerPnJid / senderLidJid.
            // `from` disiapkan untuk handler/antiCall.js (c.from, rejectCall).
            const from = c.callCreatorJid ?? c.callerPnJid ?? c.senderLidJid
                ?? c.from ?? c.fromJid ?? c.peerJid ?? '';
            return {
                id: c.callId ?? c.id,
                from,
                callerPn: c.callerPnJid ?? c.callerPn ?? from,
                isVideo: !!c.isVideo,
                status: c.status || 'offer',
            };
        })]);
        return out;
    }

    if (name === 'message_addon' || name === 'message_protocol') {
        const ev = payload?.event ?? payload;
        if (ev?.pollUpdate || ev?.vote) {
            out.push(['messages.update', [{
                key: ev.key || ev.target,
                update: { pollUpdates: ev.pollUpdates || [ev.pollUpdate || ev.vote] },
            }]]);
        }
        return out;
    }

    if (name === 'presence' || name === 'chatstate') {
        const ev = payload?.event ?? payload;
        out.push(['presence.update', ev]);
        return out;
    }

    return out;
}

function longLike(seconds) {
    if (seconds == null) return undefined;
    return { toNumber: () => Number(seconds), toString: () => String(seconds) };
}

function normalizeParticipants(ev) {
    const author = ev.authorJid ?? ev.author ?? ev.authorPn;
    return {
        id: ev.id ?? ev.groupJid ?? ev.jid,
        action: ev.action || ev.type,
        author,
        authorPn: ev.authorPn ?? author,
        participants: (ev.participants || []).map((p) => {
            if (typeof p === 'string') return p;
            // zapo: { jid, lidJid, phoneJid } — jadikan satu jid + alt untuk
            // handler/access.js participantMatches (butuh phoneNumber & lid).
            const jid = p.jid ?? p.lidJid ?? p.phoneJid ?? p.id ?? '';
            return {
                ...p,
                jid,
                id: p.id ?? jid,
                phoneNumber: p.phoneNumber ?? p.phoneJid,
                lid: p.lid ?? p.lidJid,
            };
        }),
    };
}

function normalizeGroup(ev) {
    const author = ev.authorJid ?? ev.author;
    return {
        id: ev.id ?? ev.groupJid ?? ev.jid,
        subject: ev.subject ?? ev.name,
        desc: ev.desc ?? ev.description,
        announce: ev.announce,
        restrict: ev.restrict,
        ephemeralDuration: ev.ephemeralDuration,
        inviteCode: ev.inviteCode,
        joinApprovalMode: ev.joinApprovalMode,
        memberAddMode: ev.memberAddMode,
        author,
        authorPn: ev.authorPn ?? author,
    };
}

/* ───────────────────────────── CONTENT TRANSLATION ───────────────────────────── */

/**
 * Terjemahkan content object ala Baileys (sock.sendMessage) menjadi
 * typed-content zapo (client.message.send). Mengembalikan { content, options }.
 *
 * Yang tidak dikenal dilewatkan apa adanya sebagai Proto.IMessage — zapo
 * menerima Proto.IMessage langsung, dan wire-nya kompatibel.
 */
function translateContent(content, options = {}) {
    const opts = mapSendOptions(options);
    const msgId = options.messageId || options.id;
    if (msgId !== undefined) opts.id = msgId;

    // Baileys menaruh contextInfo (externalAdReply, forward, mentions, ...)
    // di dalam content. zapo membacanya dari options.contextInfo.raw, jadi
    // gabungkan di sini supaya kartu/reply tidak kehilangan konteksnya.
    if (content && typeof content === 'object') {
        const contentMentions = content.mentions || content.mentionedJid;
        if (!opts.mentions && contentMentions?.length) opts.mentions = contentMentions;
        const ci = content.contextInfo;
        if (ci && typeof ci === 'object') {
            const raw = { ...ci };
            // zapo punya field khusus untuk ini; jangan dobol di raw.
            delete raw.stanzaId; delete raw.participant; delete raw.quotedMessage;
            delete raw.mentionedJid; delete raw.forwardingScore; delete raw.isForwarded;
            opts.contextInfo = {
                ...(opts.contextInfo || {}),
                raw: { ...(opts.contextInfo?.raw || {}), ...raw },
            };
        }
    }

    if (typeof content === 'string') return { content, options: opts };

    // Pesan "aksi" ala Baileys
    if (content.react) {
        return { content: { type: 'reaction', emoji: content.react.text, target: content.react.key }, options: opts };
    }
    if (content.delete) {
        return { content: { type: 'revoke', target: content.delete }, options: opts };
    }
    if (content.edit) {
        return { content: String(content.text ?? ''), options: { ...opts, editKey: content.edit } };
    }
    if (content.pin) {
        return { content: { type: content.pin.type === 'unpin' ? 'unpin' : 'pin', target: content.pin.key, durationSecs: content.pin.time }, options: opts };
    }
    if (content.forward) {
        return { content: content.forward, options: { ...opts, forward: true } };
    }
    if (content.poll) {
        const p = content.poll;
        return {
            content: { type: 'poll', name: p.name, options: (p.values || p.options || []).map((v) => (typeof v === 'string' ? v : v.optionName)), selectableCount: p.selectableCount || 1 },
            options: opts,
        };
    }
    if (content.location) {
        const l = content.location;
        return { content: { locationMessage: clean({
            degreesLatitude: l.degreesLatitude ?? l.lat,
            degreesLongitude: l.degreesLongitude ?? l.lng,
            name: l.name, address: l.address,
            isLive: l.isLive,
        }) }, options: opts };
    }
    if (content.contacts) {
        return { content: content.contacts, options: opts };
    }

    // Media
    const mediaMap = { image: 'image', video: 'video', audio: 'audio', document: 'document', sticker: 'sticker' };
    for (const key of Object.keys(mediaMap)) {
        if (!content[key]) continue;
        const src = content[key];
        const typed = {
            type: mediaMap[key],
            media: src.url ? src.url : src,
            mimetype: content.mimetype,
            caption: content.caption,
            fileName: content.fileName,
        };
        // zapo voice note = { type:'audio', ptt:true } → audioMessage dengan
        // flag ptt. Memakai 'ptv' salah: itu video note, bukan pesan suara.
        if (key === 'audio' && content.ptt) { typed.type = 'audio'; typed.ptt = true; }
        if (content.gifPlayback) typed.gifPlayback = true;
        if (content.viewOnce) opts.viewOnce = true;
        return { content: clean(typed), options: opts };
    }

    // Teks / extendedText (dengan contextInfo) — lewatkan apa adanya
    if (content.text != null) {
        return { content: String(content.text), options: opts };
    }

    // Proto.IMessage mentah (rich.js, tombol, kartu) — zapo menerima langsung
    return { content, options: opts };
}

/* ───────────────────────────── SOCK FACADE ───────────────────────────── */

/**
 * Bangun objek `sock` ala Baileys di atas WaClient.
 * @param {object} o { client, store, sessionId, logger, getMessage }
 */
function buildSock(o) {
    const { client, store, sessionId } = o;
    const ev = new EventEmitter();
    const sentIds = new Set();

    const sock = {
        client,
        store,
        sessionId,
        ev,

        get user() {
            const c = client.getCredentials() || {};
            return {
                id: c.meJid || c.jid,
                lid: c.meLid,
                name: c.pushName || c.name || '',
            };
        },
        get authState() {
            const c = client.getCredentials() || {};
            return { creds: { registered: !!c.meJid, ...c } };
        },
        get ws() {
            const st = client.getState ? client.getState() : {};
            return { isClosed: !st.connected, isClosing: false, close: () => client.disconnect() };
        },

        async sendMessage(jid, content, options = {}) {
            /* ── Status WhatsApp ──────────────────────────────────────────────
             * Plugin (upsw) memakai API Baileys: kirim ke `status@broadcast`
             * dengan `statusJidList` di options, hapus lewat `content.delete`.
             * zapo punya coordinator khusus (client.status) yang melakukan
             * sender-key fanout ke tiap penerima. Kirim via client.message.send
             * ke status@broadcast tidak akan mendistribusikan status sama sekali.
             */
            if (isStatusBroadcastJid(jid)) {
                const rawRecipients = [...new Set((options.statusJidList || []).map(toJid))];
                if (!rawRecipients.length) throw new Error('statusJidList kosong: tidak ada penerima status');

                /* Status zapo WAJIB pakai LID (@lid), bukan PN (@s.whatsapp.net).
                 * Kirim PN bikin server balas negative ack error=400. Plugin
                 * (upsw) memberi PN dari DB, jadi konversi dulu lewat USYNC.
                 * Cache hasilnya agar tidak query berulang tiap upload status. */
                const recipients = await resolveStatusRecipients(client, rawRecipients);
                if (!recipients.length) throw new Error('tidak ada penerima status yang valid setelah resolusi LID');

                if (content?.delete) {
                    const id = content.delete.id || content.delete.key?.id;
                    if (!id) throw new Error('id status tidak ditemukan');
                    if (!client.status?.revokeStatus) throw new Error('hapus status tidak didukung engine');
                    const res = await client.status.revokeStatus({ messageId: id, recipients });
                    return { key: { remoteJid: STATUS_JID, fromMe: true, id: res?.id || id } };
                }

                if (!client.status?.send) throw new Error('kirim status tidak didukung engine');
                const t = translateContent(content, options);
                let message = t.content;

                // Warna latar & font di zapo ada di extendedTextMessage
                // (backgroundArgb / font), bukan di options ala Baileys.
                if (typeof message === 'string' || (message && message.text != null && !message.type)) {
                    const text = typeof message === 'string' ? message : String(message.text);
                    message = {
                        extendedTextMessage: clean({
                            text,
                            backgroundArgb: hexToArgb(options.backgroundColor),
                            font: options.font,
                        }),
                    };
                }

                const res = await client.status.send({
                    content: message,
                    recipients,
                    options: clean({ id: t.options.id || options.messageId }),
                });
                if (t.options.id) sentIds.add(t.options.id);
                return { key: { remoteJid: STATUS_JID, fromMe: true, id: res?.id || t.options.id } };
            }

            const t = translateContent(content, options);
            if (t.options.id) sentIds.add(t.options.id);
            const res = await client.message.send(toJid(jid), t.content, t.options);
            return res;
        },

        async relayMessage(jid, message, opts = {}) {
            // zapo otomatis menyisipkan button-addon / biz node dari isi
            // interactiveMessage (lihat resolveOutboundMessageAttrs), sehingga
            // `additionalNodes` ala Baileys tidak dipakai dan sengaja dibuang.
            // Yang diteruskan: id, quote, mentions, dan opsi kirim lain yang dikenal zapo.
            //
            // Tempelkan field media dari cache upload hasil waUploadToServer supaya
            // dokumen/gambar kartu bisa didekripsi penerima. Cache dicari lebih dulu
            // berdasarkan directPath, lalu fallback ke entri terakhir (kartu dokumen
            // sering dibuat sekali lalu dipakai berulang dengan directPath identik).
            const msg = message && typeof message === 'object' ? { ...message } : message;
            const mediaKey = ['documentMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage']
                .find((k) => msg?.[k]);
            if (mediaKey && sock._uploadCache.size) {
                const desc = msg[mediaKey];
                const all = [...sock._uploadCache.values()];
                const cached = all.find((u) => u.directPath && desc?.directPath && u.directPath === desc.directPath)
                    || all[all.length - 1];
                if (cached && !desc?.mediaKey) {
                    msg[mediaKey] = {
                        ...desc,
                        mediaKey: cached.mediaKey,
                        mediaKeyTimestamp: cached.mediaKeyTimestamp,
                        fileEncSha256: cached.fileEncSha256 || desc.fileEncSha256,
                        fileSha256: cached.fileSha256 || desc.fileSha256,
                    };
                }
            }
            // Teruskan seluruh opsi kirim yang dikenal zapo (viewOnce, forward,
            // editKey, messageSecret, customNodes, expirationSeconds, ack tuning,
            // additionalAttributes), bukan hanya id/quote/mentions.
            const sendOpts = mapSendOptions(opts);
            const relayId = opts.messageId || opts.id;
            if (relayId !== undefined) sendOpts.id = relayId;
            return client.message.send(toJid(jid), msg, sendOpts);
        },

        readMessages(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            return client.message.sendReceipt(list.map((k) => ({
                remoteJid: k.remoteJid, id: k.id, participant: k.participant, fromMe: k.fromMe,
            })), { type: 'read' }).catch(() => {});
        },

        sendPresenceUpdate(type, jid) {
            if (jid && (type === 'composing' || type === 'recording' || type === 'paused')) {
                return client.presence.sendChatstate(toJid(jid), { state: type });
            }
            return client.presence.send(type === 'available' ? 'available' : 'unavailable');
        },
        presenceSubscribe(jid) { return client.presence.subscribe(toJid(jid)); },

        async groupMetadata(jid) {
            const meta = await client.group.queryGroupMetadata(toJid(jid));
            if (!meta) return meta;
            // zapo: participant { jid, isAdmin, isSuperAdmin, lid, phoneNumber }
            // plugin/handler mengharapkan bentuk Baileys { id, admin, jid, lid }.
            const participants = (meta.participants || []).map((p) => ({
                ...p,
                id: p.id || p.jid || p.phoneNumber || p.lid,
                admin: p.isSuperAdmin ? 'superadmin' : (p.isAdmin ? 'admin' : undefined),
            }));
            return { ...meta, participants };
        },
        groupFetchAllParticipating() { return client.group.queryAllGroups(); },
        groupInviteCode(jid) { return client.group.queryInviteCode(toJid(jid)); },
        groupLeave(jid) { return client.group.leaveGroup([].concat(jid).map(toJid)); },
        groupParticipantsUpdate(jid, jids, action) {
            const fn = {
                add: 'addParticipants', remove: 'removeParticipants',
                promote: 'promoteParticipants', demote: 'demoteParticipants',
            }[action];
            if (!fn || !client.group[fn]) return Promise.resolve();
            return client.group[fn](toJid(jid), [].concat(jids).map(toJid));
        },
        groupSettingUpdate(jid, setting, value) { return client.group.setSetting(toJid(jid), setting, value); },
        groupUpdateSubject(jid, subject) { return client.group.setSubject(toJid(jid), subject); },
        groupUpdateDescription(jid, desc) { return client.group.setDescription(toJid(jid), desc); },
        groupGetInviteInfo(code) { return client.group.queryGroupInviteInfo(String(code).replace(/^.*chat\.whatsapp\.com\//i, '').trim()); },
        groupAcceptInvite(code) { return client.group.joinGroupViaInvite(String(code).replace(/^.*chat\.whatsapp\.com\//i, '').trim()); },

        profilePictureUrl(jid, type = 'image') { return client.profile.getProfilePicture(toJid(jid), type); },
        updateProfilePicture(jid, buffer) { return client.profile.setProfilePicture(buffer, jid ? toJid(jid) : undefined); },
        // getLidsByPhoneNumbers = usync 'lid' query: hasilnya mengandung exists/jid/lid
        // (sama dengan onWhatsApp Baileys). Map ke bentuk Baileys agar pemanggil
        // (jadibotManager, waWrapper.onWa) tidak perlu tahu detail zapo.
        async onWhatsApp(jids) {
            const list = [].concat(jids).map(digits);
            const res = await client.profile.getLidsByPhoneNumbers(list);
            return (Array.isArray(res) ? res : []).map((r) => ({
                jid: r.phoneJid || r.queriedJid,
                lid: r.lidJid || undefined,
                exists: !!r.exists,
                name: undefined,
            }));
        },
        updateBlockStatus(jid, action) {
            return action === 'block' ? client.privacy.blockUser(toJid(jid)) : client.privacy.unblockUser(toJid(jid));
        },
        // fetchStatus ala Baileys dipakai waWrapper.fetchStatusOf (belum ada plugin
        // yang memanggil). zapo: profile.getStatus(jid) -> { status }. Kembalikan
        // array dari satu objek agar bentuknya tetap kompatibel.
        async fetchStatus(jid) {
            try {
                const r = await client.profile.getStatus(toJid(jid));
                return [{ jid: toJid(jid), status: r?.status || '', setAt: null }];
            } catch { return []; }
        },
        // zapo tidak punya coordinator panggilan; tolak dengan node call/reject
        // lewat lowlevel sendNode (protokol WA standar, WA_CALL_PAYLOAD_TAGS.REJECT).
        async rejectCall(callId, from) {
            if (!callId || !from) return;
            const node = {
                tag: 'call',
                attrs: { id: callId, to: toJid(from) },
                content: [{ tag: 'reject', attrs: { 'call-id': callId, 'call-creator': toJid(from) }, content: null }],
            };
            return client.lowlevel.sendNode(node);
        },
        // chatModify dipakai waWrapper.setPushName. zapo menangani lewat
        // profile.setPushName / appState mutations. Terjemahkan varian yang dipakai.
        async chatModify(modification, jid) {
            if (modification?.pushNameSetting !== undefined) {
                return client.profile.setPushName(String(modification.pushNameSetting));
            }
            const m = client.chat;
            const j = jid ? toJid(jid) : null;
            if (modification?.mute !== undefined && j) return m.setChatMute(j, !!modification.mute.action, modification.mute.endTime);
            if (modification?.pin !== undefined && j) return m.setChatPin(j, !!modification.pin);
            if (modification?.archive !== undefined && j) return m.setChatArchive(j, !!modification.archive);
            if (modification?.read !== undefined && j) return m.setChatRead(j, !!modification.read);
            return Promise.resolve();
        },
        requestPairingCode(phone, custom) {
            return client.auth.requestPairingCode(digits(phone), custom || undefined);
        },
        newsletterMetadata(source, value) {
            return source === 'jid'
                ? client.newsletter.fetch(value)
                : client.newsletter.fetchByInvite(value);
        },

        // connectionGuard / ping.js: queryWithContext(context, node, ...).
        // Sebelumnya argumen tertukar (node dilewatkan sebagai context), sehingga
        // ping & health check selalu gagal di mode zapo.
        query(node, timeoutMs) {
            if (client.lowlevel?.query) return client.lowlevel.query(node, timeoutMs);
            return client.queryWithContext('bot.query', node, timeoutMs);
        },
        end() { return client.disconnect(); },
        mediaOk() { return !!(client.getState && client.getState().connected); },
        reportMediaFailure() {},
        getBotJid() { return sock.user?.id; },
        isOwnSent(id) { return sentIds.has(id); },
        // LID -> PN: baca dari contact store zapo. Fallback identitas bila
        // mapping belum tersimpan (lib/jid.js sudah punya cache + fallback grup).
        signalRepository: {
            lidMapping: {
                getPNForLID: async (lid) => {
                    try {
                        const s = store.session(sessionId);
                        const rec = await s.contacts.getByJid(String(lid));
                        return rec?.phoneNumber || lid;
                    } catch { return lid; }
                },
            },
        },

        downloadMediaMessage(msg, type, options) {
            return downloadMediaMessage(msg, type, options);
        },

        /**
         * Shim upload ala Baileys: prepareWAMessageMedia() memanggil
         *   upload(filePath, { fileEncSha256B64, mediaType, timeoutMs })
         * dan mengharapkan { mediaUrl, directPath }.
         * Zapo: client.message.upload(bytes, { type, mimetype }) ->
         *   { url, directPath, mediaKey, fileSha256, fileEncSha256, fileLength, mediaKeyTimestamp }.
         * Kita simpan hasil lengkap di WeakMap agar relayMessage bisa memakai
         * field media yang benar (bukan cuma URL).
         */
        waUploadToServer: async (filePath, opts = {}) => {
            const fs = require('node:fs/promises');
            const bytes = Buffer.isBuffer(filePath) || filePath instanceof Uint8Array
                ? filePath
                : await fs.readFile(filePath);
            const type = opts.mediaType || 'document';
            const mimeByType = {
                image: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg',
                document: 'application/octet-stream', sticker: 'image/webp',
            };
            const result = await client.message.upload(bytes, {
                type,
                mimetype: opts.mimetype || mimeByType[type] || 'application/octet-stream',
            });
            // Simpan descriptor untuk dipakai relayMessage (lihat _uploadCache)
            sock._uploadCache.set(String(opts.fileEncSha256B64 || ''), result);
            return {
                mediaUrl: result.url,
                directPath: result.directPath,
                mediaKey: result.mediaKey,
                fileSha256: result.fileSha256,
                fileEncSha256: result.fileEncSha256,
                fileLength: result.fileLength,
                mediaKeyTimestamp: result.mediaKeyTimestamp,
                mimetype: result.mimetype || opts.mimetype,
            };
        },
        _uploadCache: new Map(),
    };

    // Teruskan event zapo -> event Baileys
    const FORWARD = ['message', 'connection', 'auth_qr', 'group', 'call', 'message_addon', 'message_protocol', 'presence', 'chatstate'];
    const bound = [];
    for (const name of FORWARD) {
        const fn = (payload) => {
            for (const [evt, data] of translateEvent(name, payload, { sessionId })) {
                ev.emit(evt, data);
            }
        };
        client.on(name, fn);
        bound.push([name, fn]);
    }
    sock._unbind = () => { for (const [n, f] of bound) { try { client.off(n, f); } catch {} } };

    return sock;
}

/* ───────────────────────────── SESSION MIGRATION ───────────────────────────── */

/**
 * Migrasi auth Baileys (folder multi-file) -> sqlite zapo tanpa pairing ulang.
 * Memakai wa-store-migrate. Ditulis ke file dbPath yang dipakai createZapoStore.
 *
 * CATATAN: ini hanya konversi auth/signal. Perlu dijalankan sekali, dengan bot
 *         dalam keadaan STOP, sebelum start dengan WA_ENGINE=zapo.
 */
async function migrateBaileysSessionToZapo({ authDir, dbPath, sessionId = 'main' }) {
    const fs = require('node:fs/promises');
    const { createStore } = require('zapo-js');
    const { createSqliteStore } = require('@zapo-js/store-sqlite');
    const { snapshot, bufferJsonReviver } = require('wa-store-migrate');

    const readJson = async (p) => {
        try { return JSON.parse(await fs.readFile(p, 'utf8'), bufferJsonReviver); }
        catch { return null; }
    };

    const creds = await readJson(path.join(authDir, 'creds.json'));
    if (!creds) throw new Error('creds.json tidak ditemukan di ' + authDir);

    // Pola nama file multi-file Baileys: <type>-<id>.json
    // fixFileName: ':' -> '-', '/' -> '__'  (dibalik di sini)
    const keys = {};
    for (const f of await fs.readdir(authDir)) {
        if (f === 'creds.json') continue;
        const m = /^([a-z-]+)-(.+)\.json$/i.exec(f);
        if (!m) continue;
        const id = m[2].replace(/__/g, '/').replace(/-/g, ':');
        const value = await readJson(path.join(authDir, f));
        if (value == null) continue;
        (keys[m[1]] ??= {})[id] = value;
    }

    const { data: zapoData, losses } = snapshot.migrate
        ? snapshot.migrate('baileys', 'zapo', { creds, keys })
        : { data: snapshot.to('zapo', snapshot.from('baileys', { creds, keys })), losses: [] };

    // Tulis ke store sqlite zapo (resep resmi wa-store-migrate)
    const store = createStore({
        backends: { sqlite: createSqliteStore({ path: dbPath, driver: 'auto' }) },
        providers: {
            auth: 'sqlite', signal: 'sqlite', preKey: 'sqlite', session: 'sqlite',
            identity: 'sqlite', senderKey: 'sqlite', appState: 'sqlite',
            messages: 'sqlite', threads: 'sqlite', contacts: 'sqlite', privacyToken: 'sqlite',
        },
    });
    const s = store.session(sessionId);
    if (zapoData.credentials) await s.auth.save(zapoData.credentials);
    for (const k of zapoData.preKeys ?? []) await s.preKey.putPreKey(k);
    if (zapoData.identities?.length) {
        await s.identity.setRemoteIdentities(zapoData.identities.map((i) => ({
            address: i.address, identityKey: i.identityKey,
        })));
    }
    if (zapoData.sessions) {
        await s.session.setSessionsBatch(zapoData.sessions.map((x) => ({
            address: x.address, session: x.record,
        })));
    }
    for (const sk of zapoData.senderKeys ?? []) await s.senderKey.upsertSenderKey(sk.record);
    if (typeof store.destroy === 'function') await store.destroy();

    return { authDir, dbPath, sessionId, losses, keyTypes: Object.keys(keys) };
}

module.exports = {
    createZapoStore,
    translateEvent,
    translateContent,
    buildSock,
    migrateBaileysSessionToZapo,
    toJid,
    WA_VERSION,
};
