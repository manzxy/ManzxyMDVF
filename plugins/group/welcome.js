/**
 * Welcome & Bye — sambutan member baru / perpisahan dengan gambar canvas.
 * Seluruh kode fitur ini (gambar, penangan event, perintah) ada di file ini.
 *
 * Gambar: @napi-rs/canvas (atau "canvas"/node-canvas), menggunakan desain NEO BRUTALISM.
 * Event : 'group-participants.update' didaftarkan lewat `events`.
 */
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const db = require('../../lib/data/database');
const { button } = require('../../lib/wa/rich');
const { participantJid, resolveJid, isLid } = require('../../lib/core/jid');
const { numberOf, formatDateTime, truncate } = require('../../lib/core/utils');
const { logInfo, logWarn, logError, logDebug } = require('../../lib/core/logger');

const DEFAULT_WELCOME = 'Halo @user 👋\nSelamat datang di *@group*!\nKamu member ke-@count.\n\n@desc';
const DEFAULT_BYE = 'Selamat tinggal @user 👋\nSemoga kita bertemu lagi di *@group*.';
const MAX_TEXT = 1000;

/* ═══════════════════════════ CANVAS ═══════════════════════════ */
let lib;                       // undefined = belum dicoba, null = tidak ada
let fontsRegistered = false;
const FONT = '"Poppins","Inter","Segoe UI","Arial",sans-serif';

// Palet Warna Neo Brutalism
const C = { 
    bg: '#F3F0E6',       // Off-white / Cream background
    black: '#000000',    // Hitam pekat
    white: '#FFFFFF',    // Putih murni
    yellow: '#FFC900',   // Kuning industrial
    cyan: '#00E5FF', 
    pink: '#FF90E8', 
    red: '#FF4D4D',
    purple: '#9D4EDD'
};

function loadCanvas() {
    if (lib !== undefined) return lib;
    for (const name of ['@napi-rs/canvas', 'canvas']) { try { return (lib = require(name)); } catch { /* coba berikutnya */ } }
    return (lib = null);
}

function registerFonts() {
    if (fontsRegistered) return;
    fontsRegistered = true;
    const dir = path.join(__dirname, '..', '..', 'assets', 'fonts');
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
        if (!/\.(ttf|otf)$/i.test(f)) continue;
        const family = f.replace(/\.(ttf|otf)$/i, '').replace(/[-_]?(Regular|Bold|Medium|Light|Italic)$/i, '');
        try {
            if (lib.GlobalFonts?.registerFromPath) lib.GlobalFonts.registerFromPath(path.join(dir, f), family);
            else if (lib.registerFont) lib.registerFont(path.join(dir, f), { family });
        } catch { /* font rusak diabaikan */ }
    }
}

/** Buang emoji/karakter yang tidak bisa digambar canvas. */
const clean = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}\u{0000}-\u{001F}]/gu, '').replace(/\s+/g, ' ').trim();

function fit(ctx, text, maxW, size, weight = '900', min = 20) {
    for (let s = size; s > min; s -= 2) { 
        ctx.font = `${weight} ${s}px ${FONT}`; 
        if (ctx.measureText(text).width <= maxW) return { text, size: s }; 
    }
    ctx.font = `${weight} ${min}px ${FONT}`;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return { text: t === text ? t : t + '…', size: min };
}

// Kotak Brutalist dengan Hard Shadow Offset
function brutalBox(ctx, x, y, w, h, bg, offset = 6, shadow = C.black) {
    // Shadow Offset
    ctx.fillStyle = shadow;
    ctx.fillRect(x + offset, y + offset, w, h);
    // Main Box
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    // Thick Border
    ctx.lineWidth = 5; ctx.strokeStyle = C.black;
    ctx.strokeRect(x, y, w, h);
}

// Lencana Bintang Tajam
function brutalBurst(ctx, cx, cy, points, outer, inner, bg) {
    ctx.fillStyle = C.black; // shadow
    ctx.beginPath();
    for (let i = 0; i <= points * 2; i++) {
        let r = i % 2 === 0 ? outer : inner;
        let a = (i * Math.PI) / points;
        ctx.lineTo(cx + 8 + r * Math.cos(a), cy + 8 + r * Math.sin(a));
    }
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = bg; // fill
    ctx.beginPath();
    for (let i = 0; i <= points * 2; i++) {
        let r = i % 2 === 0 ? outer : inner;
        let a = (i * Math.PI) / points;
        ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = C.black; ctx.stroke();
}

/**
 * Gambar WELCOME / GOODBYE bergaya NEO BRUTALISM
 */
async function render(o) {
    const L = loadCanvas();
    if (!L) throw new Error('Modul canvas belum terpasang');
    registerFonts();

    const W = 1000, H = 420;
    const isW = o.type !== 'bye';
    
    // Palet berdasarkan tipe
    const a1 = isW ? C.cyan : C.red;
    const a2 = isW ? C.pink : C.yellow;
    
    const canvas = L.createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    /* 1. Latar Belakang & Pola Grid */
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 20; y < H; y += 30) for (let x = 20; x < W; x += 30) ctx.fillRect(x, y, 4, 4);

    /* 2. Border "Hazard Stripe" di Sisi Kiri */
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, 46, H); ctx.clip();
    ctx.fillStyle = C.yellow; ctx.fillRect(0, 0, 46, H);
    ctx.lineWidth = 24; ctx.strokeStyle = C.black;
    for (let i = -H; i < H + 50; i += 46) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(46, i + 46); ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 8; ctx.strokeStyle = C.black; ctx.strokeRect(0, 0, 46, H);

    /* 3. Avatar Persegi Brutalist */
    const avSize = 270, ax = 95, ay = 75;
    ctx.fillStyle = C.black; ctx.fillRect(ax + 12, ay + 12, avSize, avSize); // shadow
    
    if (o.avatar) {
        try {
            const img = await L.loadImage(o.avatar);
            ctx.save();
            ctx.beginPath(); ctx.rect(ax, ay, avSize, avSize); ctx.clip();
            const sc = Math.max(avSize / img.width, avSize / img.height);
            ctx.drawImage(img, ax - (img.width * sc - avSize) / 2, ay - (img.height * sc - avSize) / 2, img.width * sc, img.height * sc);
            ctx.restore();
        } catch {
            ctx.fillStyle = a2; ctx.fillRect(ax, ay, avSize, avSize);
            ctx.fillStyle = C.black; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = `900 140px ${FONT}`;
            ctx.fillText((clean(o.username)[0] || '#').toUpperCase(), ax + avSize / 2, ay + avSize / 2 + 10);
        }
    } else {
        ctx.fillStyle = a2; ctx.fillRect(ax, ay, avSize, avSize);
        ctx.fillStyle = C.black; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `900 140px ${FONT}`;
        ctx.fillText((clean(o.username)[0] || '#').toUpperCase(), ax + avSize / 2, ay + avSize / 2 + 10);
    }
    // Border Avatar
    ctx.lineWidth = 6; ctx.strokeStyle = C.black; ctx.strokeRect(ax, ay, avSize, avSize);

    // Lencana Starburst menempel di avatar
    brutalBurst(ctx, ax + avSize - 10, ay + avSize - 20, 10, 48, 34, a1);
    ctx.fillStyle = C.black; ctx.font = `900 24px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(isW ? "HI!" : "BYE", ax + avSize - 10, ay + avSize - 17);

    /* 4. Tipografi & Konten Kanan */
    const tx = 415; // Starting X for texts
    
    // Tag Status (NEW MEMBER / MEMBER LEFT)
    const topTag = isW ? 'NEW MEMBER' : 'USER DEPARTED';
    ctx.font = `900 22px ${FONT}`;
    const ttw = ctx.measureText(topTag).width + 30;
    brutalBox(ctx, tx, 75, ttw, 40, a1, 5);
    ctx.fillStyle = C.black; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(topTag, tx + ttw / 2, 75 + 22);

    // Username (Huge & Bold dengan Hard Offset Shadow Text)
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const nameData = fit(ctx, clean(o.username) || `+${o.number}`, W - tx - 40, 72, '900', 36);
    ctx.font = `900 ${nameData.size}px ${FONT}`;
    ctx.fillStyle = a2; // Text Shadow
    ctx.fillText(nameData.text, tx + 6, 135 + 6);
    ctx.fillStyle = C.black; // Text Main
    ctx.fillText(nameData.text, tx, 135);

    // Label Group
    const grpLbl = isW ? 'DESTINATION:' : 'DEPARTED FROM:';
    ctx.font = `900 16px ${FONT}`;
    ctx.fillStyle = '#4A4A4A'; // Muted dark
    ctx.fillText(grpLbl, tx, 235);

    // Group Name (Pill Box)
    const grp = clean(o.groupName) || 'Group';
    ctx.font = `900 32px ${FONT}`;
    const gw = Math.min(ctx.measureText(grp).width + 40, W - tx - 40);
    brutalBox(ctx, tx, 258, gw, 56, C.white, 6);
    
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const grpFit = fit(ctx, grp, gw - 20, 28, '900', 16);
    ctx.font = `900 ${grpFit.size}px ${FONT}`;
    ctx.fillStyle = C.black;
    ctx.fillText(grpFit.text, tx + gw / 2, 258 + 30);

    /* 5. Footer / Bottom Row */
    // Member Count
    const countTxt = isW ? `ID: #${o.memberCount}` : `REMAINING: ${o.memberCount}`;
    ctx.font = `900 18px ${FONT}`;
    const cw = ctx.measureText(countTxt).width + 26;
    brutalBox(ctx, tx, 335, cw, 36, C.yellow, 4);
    ctx.fillStyle = C.black; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(countTxt, tx + cw / 2, 335 + 20);

    // Bot Brand & Waktu
    const btmRightTxt = `${o.brand || config.botName} // ${o.time || ''}`.toUpperCase();
    ctx.font = `900 14px ${FONT}`;
    ctx.fillStyle = C.black; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(btmRightTxt, W - 35, H - 30);

    /* 6. Outer Canvas Border Terluar */
    ctx.lineWidth = 14; ctx.strokeStyle = C.black; ctx.strokeRect(0, 0, W, H);

    return canvas.toBuffer('image/png');
}

/* ═══════════════════════════ SAMBUTAN ═══════════════════════════ */
const sentRecently = new Map();
let warnedNoCanvas = false;

function fill(template, v) {
    return String(template || '').replace(/@user/gi, v.user).replace(/@group/gi, v.group).replace(/@desc/gi, v.desc)
        .replace(/@count/gi, String(v.count)).replace(/@time/gi, v.time).replace(/@date/gi, v.date).trim();
}

async function fetchAvatar(sock, jid) {
    try {
        const url = await sock.profilePictureUrl(jid, 'image');
        if (!url) return null;
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
        try { const res = await fetch(url, { signal: ctrl.signal }); return res.ok ? Buffer.from(await res.arrayBuffer()) : null; }
        finally { clearTimeout(t); }
    } catch { return null; }
}

async function toParticipant(sock, p, gid) {
    let jid = participantJid(p);
    if (isLid(jid)) jid = await resolveJid(sock, jid, { groupJid: gid });
    return { jid, number: numberOf(jid), lid: typeof p === 'object' ? (p.lid || '') : '' };
}

async function sendOne(sock, gid, p, action, meta, group, { quoted = null } = {}) {
    const isWelcome = action === 'add';
    const s = group.settings;
    const count = meta.participants?.length || meta.size || 0;
    const now = new Date();
    const caption = fill(isWelcome ? (s.welcomeText || DEFAULT_WELCOME) : (s.byeText || DEFAULT_BYE), {
        user: `@${p.number}`, group: meta.subject || group.name || 'grup',
        desc: truncate(meta.desc || group.description || '', 400) || '-', count,
        time: now.toLocaleTimeString('id-ID', { timeZone: config.timezone, hour12: false, hour: '2-digit', minute: '2-digit' }).replace('.', ':'),
        date: now.toLocaleDateString('id-ID', { timeZone: config.timezone, dateStyle: 'long' })
    });

    let image = null;
    if (loadCanvas()) {
        try {
            image = await render({
                type: isWelcome ? 'welcome' : 'bye', username: db.data.users[p.number]?.name || '', number: p.number,
                groupName: meta.subject || group.name, memberCount: count, avatar: await fetchAvatar(sock, p.jid), time: formatDateTime(now)
            });
        } catch (err) { logError('WELCOME', `Render canvas gagal: ${err.message}`); }
    } else if (!warnedNoCanvas) {
        warnedNoCanvas = true;
        logWarn('WELCOME', 'Modul canvas belum terpasang → sambutan dikirim teks saja. Pasang: npm i @napi-rs/canvas');
    }

    const opts = quoted ? { quoted } : undefined;
    if (image) await sock.sendMessage(gid, { image, caption, mentions: [p.jid] }, opts);
    else await sock.sendMessage(gid, { text: caption, mentions: [p.jid] }, opts);
}

async function onParticipantsUpdate(sock, ev) {
    const { id: gid, action } = ev || {};
    if ((action !== 'add' && action !== 'remove') || !gid || !config.welcome?.enabled) return;
    const group = db.getGroup(gid);
    if (!group) return;
    const s = group.settings;
    if (action === 'add' ? !s.welcome : !s.bye) return;
    if (group.banned.active || s.mute) return;

    let meta = {};
    try { meta = (await sock.groupMetadata(gid)) || {}; } catch (err) { logDebug('WELCOME', `groupMetadata: ${err.message}`); }
    if (meta.subject) db.getGroup(gid, { name: meta.subject, description: meta.desc, size: meta.participants?.length });

    const botNumber = numberOf(sock.user?.id), botLid = numberOf(sock.user?.lid);
    const list = [];
    for (const raw of ev.participants || []) {
        const p = await toParticipant(sock, raw, gid);
        if (!p.number || p.number === botNumber || (botLid && (p.number === botLid || numberOf(p.lid) === botLid))) continue;
        list.push(p);
    }
    const now = Date.now();
    for (const [k, t] of sentRecently) if (now - t > 60000) sentRecently.delete(k);
    const fresh = list.filter((p) => { const k = `${gid}:${p.number}:${action}`; if (sentRecently.has(k)) return false; sentRecently.set(k, now); return true; });
    if (!fresh.length) return;

    const max = Math.max(1, config.welcome.maxIndividual || 5);
    for (const p of fresh.slice(0, max)) {
        try { await sendOne(sock, gid, p, action, meta, group); }
        catch (err) { logError('WELCOME', `Gagal kirim ${action} untuk +${p.number}: ${err.message}`); }
    }
    const rest = fresh.slice(max);
    if (rest.length) {
        const text = `${action === 'add' ? '👋 Selamat datang' : '👋 Sampai jumpa'} ${rest.map((p) => '@' + p.number).join(' ')}${action === 'add' ? `\nSelamat bergabung di *${meta.subject || 'grup'}*!` : ''}`;
        try { await sock.sendMessage(gid, { text, mentions: rest.map((p) => p.jid) }); } catch { /* abaikan */ }
    }
    logInfo('WELCOME', `${action === 'add' ? 'Welcome' : 'Bye'} → ${meta.subject || gid}: ${fresh.length} orang`);
}

/* ═══════════════════════════ PERINTAH ═══════════════════════════ */
module.exports = {
    name: 'Welcome & Bye',
    command: ['welcome', 'bye', 'setwelcome', 'setbye', 'testwelcome', 'testbye'],
    category: 'group',
    description: 'Atur sambutan member baru & perpisahan dengan gambar Neo Brutalism',
    usage: '.welcome [on|off]',
    group: true,
    admin: true,
    limit: 0,
    events: { 'group-participants.update': onParticipantsUpdate },

    async execute(sock, m, ctx) {
        const { from, command, args, text, group, db: dbx, prefix, reply, groupMetadata, sender, senderNumber, pushname } = ctx;
        const s = group.settings;
        const isBye = command === 'bye' || command === 'setbye' || command === 'testbye';
        const key = isBye ? 'bye' : 'welcome';
        const label = isBye ? 'Bye' : 'Welcome';

        if ((command === 'welcome' || command === 'bye') && /^(on|off)$/i.test(args[0] || '')) {
            s[key] = args[0].toLowerCase() === 'on';
            dbx.markDirty();
            return await reply(`${s[key] ? '🟢' : '🔴'} *${label}* ${s[key] ? 'diaktifkan' : 'dimatikan'} di grup ini.` +
                (s[key] && !loadCanvas() ? '\n\n⚠️ Modul canvas belum terpasang di server, jadi sambutan dikirim sebagai teks. Pasang: `npm i @napi-rs/canvas`' : ''));
        }

        if (command === 'setwelcome' || command === 'setbye') {
            if (!text) return await reply(`*✏️ UBAH TEKS ${label.toUpperCase()}*\nFormat: *${prefix}${command} <teks>*\n\nVariabel:\n• *@user* — mention member\n• *@group* — nama grup\n• *@count* — jumlah member\n• *@desc* — deskripsi grup\n• *@time* / *@date* — jam / tanggal\n\nContoh:\n${prefix}${command} Halo @user! Selamat datang di *@group* 🎉\n\nKembalikan bawaan: *${prefix}${command} reset*`);
            if (text.toLowerCase() === 'reset') s[isBye ? 'byeText' : 'welcomeText'] = isBye ? DEFAULT_BYE : DEFAULT_WELCOME;
            else {
                if (text.length > MAX_TEXT) return await reply(`❌ Teks terlalu panjang (maks ${MAX_TEXT} karakter).`);
                s[isBye ? 'byeText' : 'welcomeText'] = text;
            }
            dbx.markDirty();
            return await reply(`✅ Teks *${label}* diperbarui.\nCoba: *${prefix}test${key}*`);
        }

        if (command === 'testwelcome' || command === 'testbye') {
            try {
                const meta = groupMetadata || (await sock.groupMetadata(from));
                dbx.getUser(senderNumber, { name: pushname });
                await sendOne(sock, from, { jid: sender, number: senderNumber }, isBye ? 'remove' : 'add', meta, group, { quoted: m });
            } catch (err) { await reply(`❌ Gagal membuat contoh: ${err.message}`); }
            return;
        }

        const state = (v) => (v ? '🟢 ON' : '🔴 OFF');
        const rows = [
            { header: 'WELCOME', title: '🟢 Welcome ON', description: 'Sambut member baru', id: `${prefix}welcome on` },
            { header: 'WELCOME', title: '🔴 Welcome OFF', description: 'Matikan sambutan', id: `${prefix}welcome off` },
            { header: 'BYE', title: '🟢 Bye ON', description: 'Pamit saat member keluar', id: `${prefix}bye on` },
            { header: 'BYE', title: '🔴 Bye OFF', description: 'Matikan perpisahan', id: `${prefix}bye off` },
            { header: 'TES', title: '🖼️ Tes Welcome', description: 'Lihat contoh gambar', id: `${prefix}testwelcome` },
            { header: 'TES', title: '🖼️ Tes Bye', description: 'Lihat contoh gambar', id: `${prefix}testbye` },
            { header: 'TEKS', title: '✏️ Ubah Teks Welcome', description: 'Cara mengubah teks', id: `${prefix}setwelcome` },
            { header: 'TEKS', title: '✏️ Ubah Teks Bye', description: 'Cara mengubah teks', id: `${prefix}setbye` }
        ];
        await sock.sendUniversalButton(from, {
            title: '🖼️ WELCOME & BYE (NEO BRUTALISM)',
            body: `*Grup:* ${ctx.groupName}\n\n*Welcome:* ${state(s.welcome)}\n_${truncate(s.welcomeText, 90)}_\n\n*Bye:* ${state(s.bye)}\n_${truncate(s.byeText, 90)}_\n\nGambar dibuat otomatis dengan gaya brutalist!${loadCanvas() ? '' : '\n⚠️ Modul canvas belum terpasang → teks saja.'}`,
            footer: config.footerText
        }, [button.list('⚙️ Pengaturan', [{ title: 'Pengaturan Sambutan', rows }]), button.quick('🖼️ Tes Welcome', `${prefix}testwelcome`)], m);
    },

    // Hook untuk pengujian
    _setCanvas: (v) => { lib = v; },
    _defaults: { DEFAULT_WELCOME, DEFAULT_BYE }
};
