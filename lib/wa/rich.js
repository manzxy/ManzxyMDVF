/**
 * RICH — semua pesan "kaya" WhatsApp dalam satu modul (mantan richHelper.js + richHtml.js).
 *
 * BAGIAN 1 — Rich Response (AIRichResponse ala Meta AI): teks, tabel, kode, gambar,
 *            grid gambar, LaTeX, peta, dinamis, content items — dalam satu balon.
 *            Pemakaian: rich.send(sock, jid, [rich.text('hi'), rich.table(rows)], { quoted })
 *
 * BAGIAN 2 — Helper kirim kaya: button (quick/url/copy/list), kartu dokumen, externalAdReply,
 *            carousel, universal button, reply helper (attachRichHelpers dipasang ke sock).
 *            Pemakaian: const { button, attachRichHelpers } = require('./rich');
 */
const {
    generateMessageID,
    generateWAMessageFromContent,
    jidNormalizedUser,
    prepareWAMessageMedia,
    proto,
} = require('./waCompat');
const config = require('../../config');
const { logError, logInfo, logWarn } = require('../core/logger');
const axios = require('axios');
const messageStore = require('../core/messageStore');
const { attachGuard, hasMedia } = require('./connectionGuard');
const { splitMessage } = require('../core/utils');

/* ═══════════════════ BAGIAN 1: RICH RESPONSE (mantan richHtml.js) ═══════════════════ */

const SUB = proto.AIRichResponseSubMessageType;
const ROOT = proto.AIRichResponseMessageType;
const ALIGN = proto.AIRichResponseInlineImageMetadata?.AIRichResponseImageAlignment || {};
const HIGHLIGHT = proto.AIRichResponseCodeMetadata?.AIRichResponseCodeHighlightType || {};

const isJid = (v) => typeof v === 'string' && /@(s\.whatsapp\.net|g\.us|lid|c\.us|newsletter|broadcast)$/.test(v);
const cleanJid = (v) => String(v ?? '').trim();

/* ───────────────────────── penyusun submessage ───────────────────────── */

/** Teks bebas. Baris baru dan penanda *tebal* / _miring_ / ```kode``` didukung klien. */
function text(content) {
    return { messageType: SUB.AI_RICH_RESPONSE_TEXT, messageText: String(content ?? '') };
}

/**
 * Tabel.
 * @param {Array<Array<string|number>>} rows
 * @param {{title?: string, headerRows?: number}} opts  headerRows bawaan 1 (baris pertama judul kolom)
 */
function table(rows, opts = {}) {
    const safe = (Array.isArray(rows) ? rows : [])
        .map((r) => (Array.isArray(r) ? r : [r]).map((c) => String(c ?? '')));
    const headerRows = Number.isInteger(opts.headerRows) ? opts.headerRows : 1;

    return {
        messageType: SUB.AI_RICH_RESPONSE_TABLE,
        tableMetadata: {
            ...(opts.title ? { title: String(opts.title) } : {}),
            rows: safe.map((items, i) => ({ items, isHeading: i < headerRows }))
        }
    };
}

/**
 * Blok kode.
 * @param {string|string[]} code  satu blok, atau beberapa blok berurutan
 * @param {{language?: string, highlight?: string}} opts  highlight: DEFAULT | KEYWORD | METHOD | STRING | NUMBER | COMMENT
 */
function code(code, opts = {}) {
    const blocks = (Array.isArray(code) ? code : [code]).map((c) => ({
        highlightType: HIGHLIGHT[`AI_RICH_RESPONSE_CODE_HIGHLIGHT_${String(opts.highlight || 'DEFAULT').toUpperCase()}`] ?? 0,
        codeContent: String(c ?? '')
    }));

    return {
        messageType: SUB.AI_RICH_RESPONSE_CODE,
        codeMetadata: {
            ...(opts.language ? { codeLanguage: String(opts.language) } : {}),
            codeBlocks: blocks
        }
    };
}

/**
 * Satu gambar sebaris.
 * @param {string} url
 * @param {{alignment?: 'left'|'right'|'center', caption?: string, tapUrl?: string}} opts
 */
function image(url, opts = {}) {
    const map = {
        left: 'AI_RICH_RESPONSE_IMAGE_LAYOUT_LEADING_ALIGNED',
        right: 'AI_RICH_RESPONSE_IMAGE_LAYOUT_TRAILING_ALIGNED',
        center: 'AI_RICH_RESPONSE_IMAGE_LAYOUT_CENTER_ALIGNED'
    };

    return {
        messageType: SUB.AI_RICH_RESPONSE_INLINE_IMAGE,
        imageMetadata: {
            imageUrl: {
                imagePreviewUrl: String(url),
                imageHighResUrl: String(url),
                ...(opts.sourceUrl ? { sourceUrl: String(opts.sourceUrl) } : {})
            },
            ...(opts.caption ? { imageText: String(opts.caption) } : {}),
            alignment: ALIGN[map[opts.alignment] || map.left] ?? 0,
            ...(opts.tapUrl ? { tapLinkUrl: String(opts.tapUrl) } : {})
        }
    };
}

/** Kisi gambar (beberapa gambar sekaligus). */
function gridImages(urls) {
    const list = (Array.isArray(urls) ? urls : [urls])
        .filter(Boolean)
        .map((u) => ({ imagePreviewUrl: String(u), imageHighResUrl: String(u) }));

    return {
        messageType: SUB.AI_RICH_RESPONSE_GRID_IMAGE,
        gridImageMetadata: {
            ...(list[0] ? { gridImageUrl: list[0] } : {}),
            imageUrls: list
        }
    };
}

/**
 * Ekspresi LaTeX — persis seperti Meta AI: teks konteks + ekspresi yang dirender
 * sebagai gambar (url + metrik layout supaya ukurannya pas di klien).
 * @param {string|string[]|Array<{expression: string, url?: string, width?: number, height?: number, fontHeight?: number}>} expressions
 * @param {{text?: string}} opts  teks konteks di sekitar rumus (opsional)
 */
function latex(expressions, opts = {}) {
    const list = (Array.isArray(expressions) ? expressions : [expressions]).map((e) => ({
        latexExpression: String(e?.expression ?? e ?? ''),
        ...(e?.url ? { url: String(e.url) } : {}),
        ...(e?.width ? { width: Number(e.width) } : {}),
        ...(e?.height ? { height: Number(e.height) } : {}),
        ...(e?.fontHeight ? { fontHeight: Number(e.fontHeight) } : {})
    }));

    return {
        messageType: SUB.AI_RICH_RESPONSE_LATEX,
        latexMetadata: {
            ...(opts.text ? { text: String(opts.text) } : {}),
            expressions: list
        }
    };
}

/**
 * Konten dinamis (gambar/GIF animasi) — AI_RICH_RESPONSE_DYNAMIC.
 * Dipakai Meta AI untuk hasil gambar yang beranimasi.
 * @param {string} url  URL gambar/GIF
 * @param {{type?: 'image'|'gif', loopCount?: number, version?: number}} opts
 */
function dynamic(url, opts = {}) {
    const typeMap = {
        image: 'AI_RICH_RESPONSE_DYNAMIC_METADATA_TYPE_IMAGE',
        gif: 'AI_RICH_RESPONSE_DYNAMIC_METADATA_TYPE_GIF'
    };

    return {
        messageType: SUB.AI_RICH_RESPONSE_DYNAMIC,
        dynamicMetadata: {
            type: typeMap[opts.type] ? typeMap[opts.type] : typeMap.image,
            ...(opts.loopCount ? { loopCount: Number(opts.loopCount) } : {}),
            ...(opts.version ? { version: Number(opts.version) } : {}),
            url: String(url)
        }
    };
}

/**
 * Carousel reel — AI_RICH_RESPONSE_CONTENT_ITEMS (tampilan "tonton reel" ala Meta AI).
 * @param {Array<{title?: string, profileIconUrl?: string, thumbnailUrl?: string, videoUrl?: string}>} items
 * @param {{contentType?: 'default'|'carousel'}} opts
 */
function contentItems(items, opts = {}) {
    const list = (Array.isArray(items) ? items : [items]).filter(Boolean).map((it) => ({
        ...(it.title ? { title: String(it.title) } : {}),
        ...(it.profileIconUrl ? { profileIconUrl: String(it.profileIconUrl) } : {}),
        ...(it.thumbnailUrl ? { thumbnailUrl: String(it.thumbnailUrl) } : {}),
        ...(it.videoUrl ? { videoUrl: String(it.videoUrl) } : {})
    }));

    return {
        messageType: SUB.AI_RICH_RESPONSE_CONTENT_ITEMS,
        contentItemsMetadata: {
            itemsMetadata: list.map((it) => ({ reelItem: it })),
            contentType: String(opts.contentType || 'carousel').toUpperCase() === 'CAROUSEL' ? 1 : 0
        }
    };
}

/**
 * Peta dengan penanda titik.
 * @param {number} latitude  titik tengah
 * @param {number} longitude
 * @param {Array<{latitude:number, longitude:number, title?:string, body?:string}>} annotations
 */
function map(latitude, longitude, annotations = [], opts = {}) {
    return {
        messageType: SUB.AI_RICH_RESPONSE_MAP,
        mapMetadata: {
            centerLatitude: Number(latitude),
            centerLongitude: Number(longitude),
            ...(opts.latitudeDelta ? { latitudeDelta: Number(opts.latitudeDelta) } : {}),
            ...(opts.longitudeDelta ? { longitudeDelta: Number(opts.longitudeDelta) } : {}),
            ...(opts.showInfoList !== undefined ? { showInfoList: Boolean(opts.showInfoList) } : {}),
            annotations: annotations.map((a, i) => ({
                annotationNumber: i + 1,
                latitude: Number(a.latitude),
                longitude: Number(a.longitude),
                ...(a.title ? { title: String(a.title) } : {}),
                ...(a.body ? { body: String(a.body) } : {})
            }))
        }
    };
}

/* ───────────────────────── pengiriman ───────────────────────── */

/**
 * Susun objek message untuk `richResponseMessage`.
 * @param {Array|object} parts
 * @param {{contextInfo?: object}} opts
 */
function build(parts, opts = {}) {
    const submessages = (Array.isArray(parts) ? parts : [parts]).filter(Boolean);

    return {
        richResponseMessage: {
            messageType: ROOT.AI_RICH_RESPONSE_TYPE_STANDARD,
            submessages,
            ...(opts.contextInfo ? { contextInfo: opts.contextInfo } : {})
        }
    };
}

/**
 * Kirim pesan rich response.
 * @param {object} sock  socket Baileys
 * @param {string} jid   tujuan
 * @param {Array|object} parts
 * @param {{quoted?: object, contextInfo?: object}} opts
 * @returns {Promise<object>} pesan yang dikirim
 */
async function send(sock, jid, parts, opts = {}) {
    // JID wajib valid: relayMessage memanggil jidDecode(jid) dan akan melempar
    // "Cannot destructure property 'user' of 'jidDecode(...)'" bila jid kosong.
    const target = cleanJid(jid);
    if (!isJid(target)) {
        const err = new Error(`JID tujuan tidak valid: ${JSON.stringify(jid)}. Gunakan from atau m.key.remoteJid.`);
        err.code = 'RICH_BAD_JID';
        throw err;
    }

    const fullMessage = proto.Message.fromObject(build(parts, opts));

    const waMessage = generateWAMessageFromContent(target, fullMessage, {
        userJid: sock.user?.id,
        messageId: generateMessageID(),
        quoted: opts.quoted
    });

    // Pengaman: sebagian versi Baileys membuang tipe pesan yang belum dikenal,
    // sehingga relay berakhir dengan payload kosong tanpa error. Deteksi di sini
    // agar pemanggil bisa jatuh ke teks biasa.
    if (!waMessage.message || !waMessage.message.richResponseMessage) {
        const err = new Error('richResponseMessage tidak didukung versi Baileys ini');
        err.code = 'RICH_UNSUPPORTED';
        throw err;
    }

    await sock.relayMessage(target, waMessage.message, { messageId: waMessage.key.id });
    return waMessage;
}

/**
 * Ubah rich response menjadi teks biasa.
 * Dipakai sebagai cadangan bila perangkat penerima tidak mendukung blok kaya.
 */
function toPlainText(parts) {
    const list = Array.isArray(parts) ? parts : [parts];
    const out = [];

    for (const p of list) {
        if (!p) continue;

        switch (p.messageType) {
            case SUB.AI_RICH_RESPONSE_TEXT:
                out.push(p.messageText || '');
                break;

            case SUB.AI_RICH_RESPONSE_TABLE: {
                const meta = p.tableMetadata || {};
                if (meta.title) out.push(`*${meta.title}*`);
                for (const r of meta.rows || []) {
                    out.push((r.items || []).join(' | '));
                }
                break;
            }

            case SUB.AI_RICH_RESPONSE_CODE:
                for (const b of p.codeMetadata?.codeBlocks || []) {
                    out.push('```\n' + (b.codeContent || '') + '\n```');
                }
                break;

            case SUB.AI_RICH_RESPONSE_INLINE_IMAGE:
                if (p.imageMetadata?.imageUrl?.imagePreviewUrl) out.push(p.imageMetadata.imageUrl.imagePreviewUrl);
                break;

            case SUB.AI_RICH_RESPONSE_GRID_IMAGE:
                for (const u of p.gridImageMetadata?.imageUrls || []) {
                    if (u.imagePreviewUrl) out.push(u.imagePreviewUrl);
                }
                break;

            case SUB.AI_RICH_RESPONSE_LATEX:
                for (const e of p.latexMetadata?.expressions || []) {
                    if (e.latexExpression) out.push(e.latexExpression);
                }
                break;

            case SUB.AI_RICH_RESPONSE_MAP: {
                const m = p.mapMetadata || {};
                if (Number.isFinite(m.centerLatitude)) {
                    out.push(`https://maps.google.com/?q=${m.centerLatitude},${m.centerLongitude}`);
                }
                for (const a of m.annotations || []) {
                    out.push(`📍 ${a.title || 'Titik'}: ${a.latitude},${a.longitude}`);
                }
                break;
            }

            case SUB.AI_RICH_RESPONSE_DYNAMIC:
                if (p.dynamicMetadata?.url) out.push(p.dynamicMetadata.url);
                break;

            case SUB.AI_RICH_RESPONSE_CONTENT_ITEMS:
                for (const it of p.contentItemsMetadata?.itemsMetadata || []) {
                    const reel = it.reelItem || {};
                    out.push(`🎬 ${reel.title || 'Reel'}: ${reel.videoUrl || reel.thumbnailUrl || ''}`);
                }
                break;

            default:
                break;
        }
    }

    return out.filter(Boolean).join('\n\n');
}




/* ═══════════════════ BAGIAN 2: HELPER KIRIM KAYA (mantan richHelper.js) ═══════════════════ */

const sentIds = new Map();
function rememberSent(id) {
    if (!id) return;
    sentIds.set(id, Date.now() + 120000);
    if (sentIds.size > 3000) { const now = Date.now(); for (const [k, v] of sentIds) if (v < now) sentIds.delete(k); }
}

/* ───────────────────────── HELPER TOMBOL (NATIVE FLOW zapo) ─────────────────────────
 * Semua tombol native-flow yang dikenal WhatsApp / zapo-js. Tiap helper menghasilkan
 * { name, buttonParamsJson } yang siap dimasukkan ke nativeFlowMessage.buttons[].
 *
 *   const { button } = require('../../lib/wa/rich');
 *   button.quick('Menu', '.menu')
 *   button.url('Web', 'https://..')
 *   button.copy('Salin', 'KODE')
 *   button.list('Pilih', [{ title:'Menu', rows:[{ title:'Home', id:'.menu' }] }])
 *
 * CATATAN addon (zapo resolveNativeFlowAddonKind): tombol PERTAMA menentukan node biz:
 *   payment_info → 'payment_info', review_and_pay → 'order_details',
 *   form_message → 'form_message', selainnya → 'interactive'.
 * Jadi jangan campur payment/form dengan tombol biasa dalam satu pesan.
 */
const btn = (name, params) => ({ name, buttonParamsJson: JSON.stringify(params) });
const button = {
    /** Balas cepat: kirim `id` sebagai perintah saat diklik. */
    quick: (text, id) => btn('quick_reply', { display_text: String(text), id: String(id) }),
    /** Buka URL (merchant_url + opsional webview). */
    url: (text, url, webview = false) => btn('cta_url', {
        display_text: String(text), url: String(url), merchant_url: String(url),
        ...(webview ? { webview_interaction: true } : {})
    }),
    /** Salin kode ke clipboard. */
    copy: (text, code) => btn('cta_copy', { display_text: String(text), id: 'copy', copy_code: String(code) }),
    /** Dropdown pilihan (single_select). sections = [{ title, rows:[{header,title,description,id}] }]. */
    list: (title, sections) => btn('single_select', { title: String(title), sections }),
    /** Ajakan telepon. */
    call: (text, phone) => btn('cta_call', { display_text: String(text), phone_number: String(phone) }),
    /** Simpan kontak (vCard). */
    contact: (text, name, phone) => btn('cta_save_contact', {
        display_text: String(text), name: String(name), phone_number: String(phone)
    }),
    /** Bagikan nomor telepon pengguna (butuh akun Bisnis). */
    sharePhone: (text = 'Bagikan Nomor') => btn('share_phone_number', { display_text: String(text) }),
    /** Buka katalog bisnis. */
    catalog: (text = 'Lihat Katalog') => btn('cta_catalog', { display_text: String(text) }),
    /** Ingatkan (CTA reminder). */
    reminder: (text, id) => btn('cta_reminder', { display_text: String(text), id: String(id) }),
    /** Detail pembayaran (addon payment_info — jadikan tombol pertama). */
    paymentInfo: (currency, amount) => btn('payment_info', {
        currency: String(currency || 'IDR'), amount: Number(amount) || 0
    }),
    /** Review & bayar (addon order_details — jadikan tombol pertama). */
    reviewAndPay: (currency, amount, orderId) => btn('review_and_pay', {
        currency: String(currency || 'IDR'), amount: Number(amount) || 0,
        ...(orderId ? { order_id: String(orderId) } : {})
    }),
    /** Form input (addon form_message — jadikan tombol pertama). */
    form: (name, title, fields) => btn('form_message', {
        name: String(name), title: String(title),
        fields: fields || [],
        submit_text: 'Kirim'
    }),
    /** Tombol native-flow mentah (escape hatch untuk nama baru). */
    raw: btn,
};

function createReplyV1Quoted(options = {}) {
    const displayName = String(options?.displayName || config.botName || 'ManzxyMD').slice(0, 80);
    const owner = String(config.ownerNumber[0] || '6281234567890');
    return {
        key: { participant: '0@s.whatsapp.net', remoteJid: 'status@broadcast', fromMe: false, id: 'MANZXY' + Date.now().toString(16).toUpperCase() },
        message: {
            contactMessage: {
                displayName,
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;${displayName};;;\nFN:${displayName}\nitem1.TEL;waid=${owner}:+${owner}\nEND:VCARD`
            }
        }
    };
}

/** Node tambahan agar WhatsApp merender native flow (tombol) di chat biasa, bisnis, dan clone. */
function bizNodes(jid) {
    const nodes = [{
        tag: 'biz',
        attrs: {},
        content: [{
            tag: 'interactive',
            attrs: { type: 'native_flow', v: '1' },
            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
        }]
    }];
    const isPrivate = !String(jid).endsWith('@g.us') && !String(jid).endsWith('@newsletter');
    if (isPrivate && config.button?.botNode !== false) nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
    return nodes;
}

/** Ubah daftar tombol menjadi teks biasa (cadangan jika tombol gagal dikirim). */
function buttonsToText(buttons = []) {
    const lines = [];
    buttons.forEach((btn) => {
        let p = {};
        try { p = JSON.parse(btn.buttonParamsJson || '{}'); } catch {}
        if (btn.name === 'single_select') {
            (p.sections || []).forEach((s) => (s.rows || []).forEach((r) => lines.push(`▫️ ${r.title}${r.id ? `  ➜  ${r.id}` : ''}`)));
        } else if (btn.name === 'quick_reply') lines.push(`▫️ ${p.display_text}  ➜  ${p.id}`);
        else if (btn.name === 'cta_url') lines.push(`🔗 ${p.display_text}: ${p.url}`);
        else if (btn.name === 'cta_copy') lines.push(`📋 ${p.display_text}: ${p.copy_code}`);
        else if (btn.name === 'cta_call') lines.push(`📞 ${p.display_text}: ${p.phone_number}`);
        else if (btn.name === 'cta_save_contact') lines.push(`👤 ${p.display_text}: ${p.name} (${p.phone_number})`);
        else if (btn.name === 'share_phone_number') lines.push(`📱 ${p.display_text || 'Bagikan Nomor'}`);
        else if (btn.name === 'cta_catalog') lines.push(`🛍️ ${p.display_text || 'Lihat Katalog'}`);
        else if (btn.name === 'cta_reminder') lines.push(`⏰ ${p.display_text}  ➜  ${p.id}`);
        else if (btn.name === 'payment_info') lines.push(`💳 Bayar ${p.currency} ${p.amount}`);
        else if (btn.name === 'review_and_pay') lines.push(`💳 Review & Bayar ${p.currency} ${p.amount}`);
        else if (btn.name === 'form_message') lines.push(`📝 ${p.title || 'Form'}`);
        else if (p.display_text) lines.push(`▫️ ${p.display_text}`);
    });
    return lines.join('\n');
}

/** Upload media dengan aman: gagal upload TIDAK menggagalkan seluruh pesan. */
async function safeMedia(sock, content) {
    if (sock.mediaOk && !sock.mediaOk() && (content.image || content.video)) return { media: {}, has: false };     // media sedang pulih → jangan coba upload
    try {
        if (content.image) return { media: await prepareWAMessageMedia({ image: content.image }, { upload: sock.waUploadToServer }), has: true };
        if (content.video) return { media: await prepareWAMessageMedia({ video: content.video }, { upload: sock.waUploadToServer }), has: true };
    } catch (err) {
        logWarn('MEDIA', `Upload header gagal, kirim tanpa gambar: ${err.message}`);
        sock.reportMediaFailure?.(err);          // upload "keracunan" → socket disambung ulang otomatis
    }
    return { media: {}, has: false };
}

/* ───────────── externalAdReply (kartu kecil di atas pesan) ─────────────
 * Dikirim sebagai contextInfo.externalAdReply pada pesan teks biasa → tampil di WhatsApp biasa,
 * WhatsApp Bisnis, dan clone (tanpa node khusus). Thumbnail diunduh sekali lalu disimpan sebagai
 * buffer (`thumbnail`) supaya tetap muncul di klien yang tidak mau memuat `thumbnailUrl`.
 */
const thumbCache = new Map();        // url -> { buf, until }
const THUMB_OK_MS = 6 * 3600 * 1000, THUMB_FAIL_MS = 5 * 60 * 1000;

/**
 * Thumbnail KECIL untuk disematkan di pesan (maks ±300px, JPEG ≤ 40 KB).
 * Penting: thumbnail besar (mis. 800x450 ratusan KB) membuat kartu TIDAK tampil di WhatsApp orang lain;
 * karena itu gambar selalu diperkecil dulu, dan bila gagal diperkecil buffer dibuang (hanya thumbnailUrl yang dikirim).
 */
const MAX_THUMB_BYTES = 40 * 1024;

async function shrink(buf) {
    let sharp = null;
    try { sharp = require('sharp'); } catch { return buf.length <= MAX_THUMB_BYTES ? buf : null; }
    for (const [size, quality] of [[300, 70], [240, 55], [160, 45]]) {
        try {
            const out = await sharp(buf).resize({ width: size, height: size, fit: 'cover' }).jpeg({ quality, mozjpeg: true }).toBuffer();
            if (out.length <= MAX_THUMB_BYTES) return out;
        } catch (err) { logWarn('ADREPLY', `Gagal memperkecil thumbnail: ${err.message}`); return null; }
    }
    return null;
}

async function fetchThumb(url) {
    if (!url || config.adReply?.inlineThumbnail === false) return null;
    const hit = thumbCache.get(url);
    if (hit && hit.until > Date.now()) return hit.buf;
    let buf = null;
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 6000, maxContentLength: 3 * 1024 * 1024, maxRedirects: 5 });
        buf = await shrink(Buffer.from(res.data));
    } catch (err) { logWarn('ADREPLY', `Thumbnail gagal diunduh (${err.message}), dikirim tanpa buffer`); }
    if (thumbCache.size > 50) thumbCache.delete(thumbCache.keys().next().value);
    thumbCache.set(url, { buf, until: Date.now() + (buf ? THUMB_OK_MS : THUMB_FAIL_MS) });
    return buf;
}

/** Susun objek externalAdReply dari config.adReply + opsi per-panggilan. */
async function buildAdReply(info = {}) {
    const ad = config.adReply || {};
    const thumbnailUrl = info.thumbnailUrl || ad.thumbnailUrl || config.thumbnailUrl;
    let thumbnail = info.thumbnail ? await shrink(Buffer.from(info.thumbnail)) : await fetchThumb(thumbnailUrl);
    return {
        title: String(info.title || ad.title || config.botName).slice(0, 100),
        body: String(info.body || ad.body || config.footerText).slice(0, 150),
        thumbnailUrl,
        ...(thumbnail ? { thumbnail } : {}),
        sourceUrl: info.sourceUrl || ad.sourceUrl || config.sourceUrl,
        mediaType: 1,
        renderLargerThumbnail: info.renderLargerThumbnail ?? ad.largeThumbnail ?? false,
        showAdAttribution: false
    };
}


/* ───────────── KARTU BALASAN "FORWARD + SALURAN" ─────────────
 * Tampilan: dokumen kecil bergambar (thumbnail, "777 TB • PNG") + teks sebagai caption, ditandai
 * "Diteruskan berkali-kali" + nama saluran (tombol "Lihat saluran") lewat forwardedNewsletterMessageInfo.
 * Dokumen diunggah SEKALI lalu dipakai ulang tiap balasan → balasan cepat dan tidak bergantung pada upload.
 * Isi saluran di config.channel (jid bisa dicek dengan .cekidch).
 */
const MAX_CAPTION = 2800;
const isNewsletter = (jid) => String(jid).endsWith('@newsletter');
const isStatus = (jid) => String(jid) === 'status@broadcast';
const docCache = new WeakMap();      // sock -> { promise, until }

function channelInfo() {
    let saved = null;
    try { saved = require('../data/database').data?.settings?.channel; } catch {}
    const ch = saved?.jid ? saved : (config.channel || {});      // .setch (tersimpan di database) lebih utama dari config.channel
    if (!ch.jid || !String(ch.jid).endsWith('@newsletter')) return null;
    return { newsletterJid: ch.jid, newsletterName: String(ch.name || config.botName).slice(0, 100), serverMessageId: Number(ch.serverMessageId ?? -1) };
}

async function cardContext(extra = {}) {
    const ctx = { forwardingScore: 999, isForwarded: true, ...extra };
    const ch = channelInfo();
    if (ch) ctx.forwardedNewsletterMessageInfo = ch;
    if (config.card?.externalAd) ctx.externalAdReply = await buildAdReply({});
    return ctx;
}

function getFakeDoc(sock) {
    const hit = docCache.get(sock);
    if (hit && hit.until > Date.now()) return hit.promise;
    const card = config.card || {};
    const fileName = card.fileName || config.botName;
    const promise = prepareWAMessageMedia(
        { document: Buffer.from(fileName), mimetype: card.mimetype || 'image/png', fileName },
        { upload: sock.waUploadToServer }
    ).then((r) => r.documentMessage);
    docCache.set(sock, { promise, until: Date.now() + 6 * 3600 * 1000 });
    promise.catch((err) => { docCache.delete(sock); sock.reportMediaFailure?.(err); });
    return promise;
}

function attachRichHelpers(sock) {
    attachGuard(sock);
    sock.getBotJid = () => (sock.user?.id ? jidNormalizedUser(sock.user.id) : '');

    // Catat ID setiap pesan keluar (lihat catatan "sentIds" di atas)
    const origSend = sock.sendMessage.bind(sock);
    const origRelay = sock.relayMessage.bind(sock);
    sock.sendMessage = async (jid, content, options = {}) => {
        const opts = { ...(options || {}) };
        if (!opts.messageId && typeof generateMessageID === 'function') { try { opts.messageId = generateMessageID(); } catch {} }
        rememberSent(opts.messageId);
        let res;
        try { res = await origSend(jid, content, opts); }
        catch (err) { if (hasMedia(content)) sock.reportMediaFailure?.(err); throw err; }
        rememberSent(res?.key?.id);
        if (content?.poll) { messageStore.remember(res); messageStore.markBotPoll(res?.key?.id); }     // agar suara polling bisa didekripsi
        return res;
    };
    sock.relayMessage = async (jid, message, opts = {}) => {
        rememberSent(opts?.messageId);
        return await origRelay(jid, message, opts);
    };
    sock.isOwnSent = (id) => { const e = sentIds.get(id); return Boolean(e && e > Date.now()); };

    /**
     * externalAdReply: teks + kartu kecil (judul, deskripsi, thumbnail, link).
     *   sock.externalAdReply(jid, text, { title, body, thumbnailUrl, sourceUrl, renderLargerThumbnail, mentions }, quoted)
     * Alias: externalAddReply, externallAddReply, sendExternalAdReply.
     */
    sock.externalAdReply = async (jid, text, adInfo = {}, quoted = null) => {
        const { mentions, contextInfo, ...ad } = adInfo || {};
        try {
            return await sock.sendMessage(jid, {
                text: String(text),
                ...(mentions?.length ? { mentions } : {}),
                contextInfo: { ...(contextInfo || {}), externalAdReply: await buildAdReply(ad) }
            }, { quoted });
        } catch (err) {
            logError('ADREPLY', err);
            return await sock.sendMessage(jid, { text: String(text), ...(mentions?.length ? { mentions } : {}) }, { quoted });
        }
    };
    sock.externalAddReply = sock.externalAdReply;
    sock.externallAddReply = sock.externalAdReply;
    sock.sendExternalAdReply = sock.externalAdReply;

    /** Balasan teks polos (tanpa kartu). */
    sock.replyPlain = async (jid, text, quoted = null, options = {}) => await sock.sendMessage(jid, { text: String(text), ...options }, { quoted });

    /**
     * Kartu "forward + saluran" (lihat catatan di atas). Satu pesan; teks ≤ ±2800 karakter.
     *   sock.sendCard(jid, text, { mentions, fileName, thumbnailUrl, contextInfo }, quoted)
     */
    sock.sendCard = async (jid, text, info = {}, quoted = null) => {
        const { mentions, contextInfo, fileName, thumbnailUrl } = info || {};
        const card = config.card || {};
        const base = await getFakeDoc(sock);
        const thumb = await fetchThumb(thumbnailUrl || card.thumbnailUrl || config.thumbnailUrl);
        const doc = proto.Message.DocumentMessage.create({
            ...base,
            fileName: fileName || card.fileName || config.botName,
            mimetype: card.mimetype || 'image/png',
            fileLength: Math.round(Number(card.sizeTB ?? 777) * 1000 ** 4),
            pageCount: Number(card.pageCount ?? 0),
            ...(thumb ? { jpegThumbnail: thumb } : {}),
            caption: String(text).slice(0, MAX_CAPTION),
            contextInfo: await cardContext({ ...(mentions?.length ? { mentionedJid: mentions } : {}), ...(contextInfo || {}) })
        });
        const msg = generateWAMessageFromContent(jid, { documentMessage: doc }, { quoted: quoted || undefined, userJid: sock.user?.id });
        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
        return msg;
    };

    /**
     * Balasan standar bot (config.replyStyle):
     *   'forward' (bawaan) → kartu dokumen + forward + saluran  •  'ad' → externalAdReply  •  'plain' → teks polos
     * Aman untuk chat pribadi, grup, SALURAN (@newsletter → teks polos) dan STATUS (dialihkan ke chat bot sendiri).
     * Teks panjang dipecah: bagian pertama berupa kartu, sisanya teks biasa. Opsi: `noAd: true`, `ad: {...}`.
     */
    sock.reply = async (jid, text, quoted = null, options = {}) => {
        const { noAd, ad, ...rest } = options || {};
        if (isStatus(jid)) { jid = sock.getBotJid(); quoted = null; }
        const style = noAd ? 'plain' : (config.replyStyle || 'forward');
        if (style === 'plain' || isNewsletter(jid) || config.adReply?.enabled === false && style === 'ad') {
            return await sock.replyPlain(jid, text, isNewsletter(jid) ? null : quoted, rest);
        }
        if (style === 'forward') {
            const chunks = splitMessage(String(text), MAX_CAPTION);
            try {
                const first = await sock.sendCard(jid, chunks[0], { ...(ad || {}), mentions: rest.mentions, contextInfo: rest.contextInfo }, quoted);
                for (const extra of chunks.slice(1)) await sock.sendMessage(jid, { text: extra, ...(rest.mentions?.length ? { mentions: rest.mentions } : {}) });
                return first;
            } catch (err) { logWarn('CARD', `Kartu gagal (${err.message}), kirim externalAdReply`); }
        }
        return await sock.externalAdReply(jid, text, { ...(ad || {}), mentions: rest.mentions, contextInfo: rest.contextInfo }, quoted);
    };

    /** POLLING: sock.sendPoll(jid, 'Judul', ['A', 'B'], { selectableCount: 1 }, quoted) */
    sock.sendPoll = async (jid, name, values = [], opts = {}, quoted = null) => {
        const list = [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].slice(0, 12);
        if (list.length < 2) throw new Error('Polling butuh minimal 2 pilihan');
        return await sock.sendMessage(jid, { poll: { name: String(name).slice(0, 200), values: list, selectableCount: opts.selectableCount ?? 1 } }, { quoted });
    };

    /**
     * UNIVERSAL NATIVE FLOW BUTTON (WA biasa, bisnis, clone).
     * content: { title, subtitle, body, footer, image, video, mentionedJid, fallback }
     */
    sock.sendUniversalButton = async (jid, content = {}, buttons = [], quoted = null) => {
        // Reply HARUS memakai pesan asli (m). Reply palsu (0@s.whatsapp.net /
        // status@broadcast) tidak dikenali WA biasa/Bisnis/clone dan membuat
        // pesan tombol ditolak dengan "versi wa ga mendukung".
        const quotedMsg = quoted || null;
        try {
            const { media, has } = await safeMedia(sock, content);
            // messageParamsJson HANYA boleh diisi JSON valid. String kosong ('') membuat
            // klien WA menganggap native-flow tidak dikenal → fallback "versi wa ga mendukung".
            const msgParams = content.params ? JSON.stringify(content.params) : undefined;

            if (content.requireMedia && !has) throw new Error('Upload gambar gagal');
            const bodyText = String(content.body || ' ');

            const interactiveMessage = proto.Message.InteractiveMessage.create({
                header: proto.Message.InteractiveMessage.Header.create({
                    title: content.title || '',
                    subtitle: content.subtitle || '',
                    hasMediaAttachment: has,
                    ...media
                }),
                body: proto.Message.InteractiveMessage.Body.create({ text: bodyText }),
                footer: proto.Message.InteractiveMessage.Footer.create({ text: content.footer || config.footerText }),
                contextInfo: content.mentionedJid?.length ? { mentionedJid: content.mentionedJid } : undefined,
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    ...(msgParams ? { messageParamsJson: msgParams } : {}),
                    buttons,
                    messageVersion: 1
                })
            });

            // Kirim sebagai interactiveMessage mentah. Jangan bungkus dengan
            // viewOnceMessage: zapo akan menandai stanza view_once="true" dan
            // WhatsApp menyembunyikan tombolnya (WA biasa/bisnis/clone).
            // button-addon node dibangun otomatis oleh zapo dari nativeFlowMessage.
            const generated = generateWAMessageFromContent(jid, { interactiveMessage }, { ...(quotedMsg ? { quoted: quotedMsg } : {}), userJid: sock.user?.id });

            await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });
            return generated;
        } catch (err) {
            logError('BUTTON', err);
            if (content.fallback === false || config.button?.fallbackText === false) throw err;
            const text = `${content.title ? `*${content.title}*\n\n` : ''}${content.body || ''}\n\n${buttonsToText(buttons)}\n\n_${content.footer || config.footerText}_`;
            return await sock.sendMessage(jid, { text: text.trim() }, { quoted });
        }
    };
    sock.sendInteractiveButton = sock.sendUniversalButton;

    /**
     * CAROUSEL — kartu geser dengan gambar + tombol.
     * cardsData: [{ title, body, footer, image: {url}, buttons: [...] }]  (1–10 kartu)
     */
    sock.sendCarousel = async (jid, mainContent = {}, cardsData = [], quoted = null) => {
        const quotedMsg = quoted || null;
        try {
            if (!cardsData.length) throw new Error('Carousel butuh minimal 1 kartu');
            const cards = [];
            for (const item of cardsData.slice(0, 10)) {
                const { media, has } = await safeMedia(sock, item);
                const buttons = item.buttons?.length ? item.buttons : [button.quick('Menu', `${config.prefix}menu`)];
                cards.push(proto.Message.InteractiveMessage.create({
                    header: proto.Message.InteractiveMessage.Header.create({
                        title: item.title || '',
                        subtitle: item.subtitle || '',
                        hasMediaAttachment: has,
                        ...media
                    }),
                    body: proto.Message.InteractiveMessage.Body.create({ text: String(item.body || ' ') }),
                    footer: proto.Message.InteractiveMessage.Footer.create({ text: item.footer || config.footerText }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons, messageVersion: 1 })
                }));
            }

            const generated = generateWAMessageFromContent(jid, {
                interactiveMessage: proto.Message.InteractiveMessage.create({
                    body: proto.Message.InteractiveMessage.Body.create({ text: mainContent.body || 'Geser kartu di bawah ini:' }),
                    footer: proto.Message.InteractiveMessage.Footer.create({ text: mainContent.footer || config.footerText }),
                    header: proto.Message.InteractiveMessage.Header.create({ title: mainContent.title || '', hasMediaAttachment: false }),
                    carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({ cards, messageVersion: 1 })
                })
            }, { ...(quotedMsg ? { quoted: quotedMsg } : {}), userJid: sock.user?.id });

            await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });
            return generated;
        } catch (err) {
            logError('CAROUSEL', err);
            if (config.button?.fallbackText === false) throw err;
            const text = `${mainContent.body || 'Carousel'}\n\n` + cardsData.map((c, i) => `*${i + 1}. ${c.title || 'Kartu'}*\n${c.body || ''}\n${buttonsToText(c.buttons)}`).join('\n\n');
            return await sock.sendMessage(jid, { text: text.trim() }, { quoted });
        }
    };

    /** Teks + kartu kecil externalAdReply (kartu forward + saluran HANYA untuk sock.reply). */
    sock.sendAdText = async (jid, text, adInfo = {}, quoted = null) =>
        await sock.externalAdReply(jid, text, { ...adInfo, renderLargerThumbnail: false }, quoted);

    /** Teks + kartu BESAR (thumbnail lebar), ditandai diteruskan. */
    sock.sendRichText = async (jid, text, adInfo = {}, quoted = null) =>
        await sock.externalAdReply(jid, text, {
            ...adInfo,
            renderLargerThumbnail: adInfo.renderLargerThumbnail !== false,
            contextInfo: { forwardingScore: 999, isForwarded: true }
        }, quoted || null);
}

module.exports = {
    // rich response builders
// penyusun blok (9 tipe submessage, sama seperti Meta AI)
    text, table, code, image, gridImages, latex, map, dynamic, contentItems,
    // pengiriman
    build, send, toPlainText,
    // konstanta enum
    SUB, ROOT,
    // helper kirim kaya
attachRichHelpers, createReplyV1Quoted, button, buttonsToText, bizNodes, buildAdReply, fetchThumb, channelInfo
};
