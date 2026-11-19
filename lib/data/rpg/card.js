/**
 * PROFILE CARD — kartu profil RPG bergaya NEO BRUTALISM.
 * Memakai @napi-rs/canvas (fallback ke node-canvas bila ada).
 *
 * Dipakai oleh plugins/main/profile.js. Kalau canvas tidak tersedia, pemanggil
 * harus punya fallback teks — render() melempar error dengan code 'NO_CANVAS'.
 *
 * Tata letak (grid tetap, tanpa tumpang tindih):
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ header: nama bot + chip season / event                    │
 *   ├──────────┬────────────────────────────────────────────────┤
 *   │ avatar   │ nama, nomor, kelas, title, EXP/HP/MP, stat     │
 *   ├──────────┴──────────────────┬─────────────────────────────┤
 *   │ PROGRESS (kiri)             │ WEALTH / STREAK / COMBO      │
 *   ├─────────────────────────────┴─────────────────────────────┤
 *   │ footer: pet • guild • rank • set                          │
 *   └───────────────────────────────────────────────────────────┘
 */
const fs = require('fs');
const path = require('path');

const FONT = '"Poppins","Inter","Segoe UI","Arial",sans-serif';
const C = {
    bg: '#F3F0E6',
    paper: '#FFFFFF',
    black: '#000000',
    yellow: '#FFC900',
    cyan: '#00E5FF',
    pink: '#FF90E8',
    red: '#FF4D4D',
    green: '#3DDC84',
    purple: '#9D4EDD',
    orange: '#FF8A3D',
    mute: '#555555'
};

/* ── Tata letak: semua angka di satu tempat agar mudah diubah ── */
const W = 1000;
const H = 640;
const PAD = 24;              // jarak dari tepi kanvas
const STRIPE_W = 34;         // stripe kiri
const CONTENT_X = STRIPE_W + PAD;   // 58
const CONTENT_W = W - CONTENT_X - PAD;
const FOOTER_H = 52;

let lib;
let fontsDone = false;

function loadCanvas() {
    if (lib !== undefined) return lib;
    for (const name of ['@napi-rs/canvas', 'canvas']) {
        try { return (lib = require(name)); } catch { /* coba berikutnya */ }
    }
    return (lib = null);
}

function registerFonts() {
    if (fontsDone) return;
    fontsDone = true;
    const dir = path.join(__dirname, '..', '..', '..', 'assets', 'fonts');
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
const clean = (s) => String(s ?? '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}\u{0000}-\u{001F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const fmtNum = (n) => {
    const v = Number(n || 0);
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
    return String(Math.floor(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

/**
 * Potong/persempit teks agar muat `maxW`.
 * @returns {{text:string,size:number}}
 */
function fit(ctx, text, maxW, size, weight = '900', min = 11) {
    const t = String(text ?? '');
    let s = size;
    for (; s > min; s -= 1) {
        ctx.font = `${weight} ${s}px ${FONT}`;
        if (ctx.measureText(t).width <= maxW) return { text: t, size: s };
    }
    ctx.font = `${weight} ${min}px ${FONT}`;
    let cut = t;
    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
    return { text: cut === t ? cut : `${cut}…`, size: min };
}

/** Gambar teks yang dipotong otomatis pada lebar tertentu. */
function text(ctx, str, x, y, maxW, size, weight = '900', color = C.black, align = 'left') {
    const f = fit(ctx, str, maxW, size, weight, 9);
    ctx.font = `${weight} ${f.size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(f.text, x, y);
    ctx.textAlign = 'left';
    return f;
}

/** Kotak brutalist dengan hard shadow. */
function box(ctx, x, y, w, h, bg, { offset = 5, border = 4 } = {}) {
    ctx.fillStyle = C.black;
    ctx.fillRect(x + offset, y + offset, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = border;
    ctx.strokeStyle = C.black;
    ctx.strokeRect(x, y, w, h);
}

/** Bar progres dengan gaya blok. */
function bar(ctx, x, y, w, h, pct, color = C.cyan) {
    const p = Math.max(0, Math.min(1, Number(pct) || 0));
    ctx.fillStyle = '#D8D4C8';
    ctx.fillRect(x, y, w, h);
    if (p > 0) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, Math.max(2, w * p), h);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.black;
    ctx.strokeRect(x, y, w, h);
}

/** Bintang tajam untuk lencana level. */
function burst(ctx, cx, cy, points, outer, inner, bg) {
    const draw = (dx, dy) => {
        ctx.beginPath();
        for (let i = 0; i <= points * 2; i++) {
            const r = i % 2 === 0 ? outer : inner;
            const a = (i * Math.PI) / points - Math.PI / 2;
            const px = cx + dx + r * Math.cos(a);
            const py = cy + dy + r * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
    };
    ctx.fillStyle = C.black; draw(5, 5);
    ctx.fillStyle = bg; draw(0, 0);
    ctx.lineWidth = 4; ctx.strokeStyle = C.black; ctx.stroke();
}

/** Chip kecil berwarna (label + nilai). */
function chip(ctx, x, y, label, bg, { h = 30, fontSize = 13, padX = 12, maxW = null } = {}) {
    const t = clean(label);
    ctx.font = `900 ${fontSize}px ${FONT}`;
    const tw = ctx.measureText(t).width;
    const w = Math.min(maxW || Infinity, tw + padX * 2);
    box(ctx, x, y, w, h, bg, { offset: 3, border: 3 });
    text(ctx, t, x + padX, y + h / 2 + fontSize * 0.36, w - padX * 2, fontSize, '900', C.black);
    return w;
}

/**
 * Render kartu profil.
 * @param {object} o {
 *   name, number, avatar (Buffer|path|URL), 
 *   cls: {name,emoji,title,color}, level, expNow, expNeed, hp,hpMax, mp,mpMax,
 *   atk, matk, def, power, crit, gold, dust, kills, bossKills, dungeons,
 *   title, prestige, achievements, achTotal, chapter, chapterTotal,
 *   streak, combo, season{name}, event{name},
 *   items, pet{name,level}, guild, rank, rankTotal,
 *   set{name,count}, daily{done,total}
 * }
 * @returns {Promise<Buffer>} PNG
 */
async function render(o = {}) {
    const L = loadCanvas();
    if (!L) {
        const e = new Error('Modul canvas belum terpasang');
        e.code = 'NO_CANVAS';
        throw e;
    }
    registerFonts();

    const canvas = L.createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const accent = o.cls?.color || C.cyan;

    /* ── latar & pola titik ── */
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 16; y < H; y += 26) for (let x = CONTENT_X + 6; x < W - PAD; x += 26) ctx.fillRect(x, y, 3, 3);

    /* ── stripe kiri ── */
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, STRIPE_W, H); ctx.clip();
    ctx.fillStyle = C.yellow; ctx.fillRect(0, 0, STRIPE_W, H);
    ctx.lineWidth = 18; ctx.strokeStyle = C.black;
    for (let i = -H; i < H + 60; i += 36) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(STRIPE_W, i + STRIPE_W); ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 5; ctx.strokeStyle = C.black; ctx.strokeRect(1.5, 0, STRIPE_W - 3, H);

    /* ── header ── */
    text(ctx, 'AETHERIA', CONTENT_X, 44, 200, 26, '900', C.black);
    text(ctx, 'ADVENTURER CARD', CONTENT_X, 64, 220, 13, '700', C.mute);

    // chip kanan atas: season + event (disusun dari kanan, tanpa tumpang tindih)
    let chipRight = W - PAD;
    if (o.event) {
        const label = `EVENT: ${clean(o.event.name)}`;
        ctx.font = `900 13px ${FONT}`;
        const w = Math.min(260, ctx.measureText(label).width + 24);
        chipRight -= w;
        chip(ctx, chipRight, 26, label, C.orange, { h: 30, fontSize: 13, padX: 12, maxW: w });
        chipRight -= 10;
    }
    if (o.season) {
        ctx.font = `900 14px ${FONT}`;
        const w = Math.min(240, ctx.measureText(clean(o.season.name)).width + 26);
        chipRight -= w;
        chip(ctx, chipRight, 26, clean(o.season.name), C.purple, { h: 30, fontSize: 14, padX: 13, maxW: w });
    }

    /* ═══════════════ BAGIAN ATAS: avatar + identitas ═══════════════ */
    const topY = 86;
    const avSize = 168;
    const ax = CONTENT_X, ay = topY;

    // bayangan + avatar
    ctx.fillStyle = C.black; ctx.fillRect(ax + 8, ay + 8, avSize, avSize);
    let drewAvatar = false;
    if (o.avatar) {
        try {
            const img = await L.loadImage(o.avatar);
            ctx.save();
            ctx.beginPath(); ctx.rect(ax, ay, avSize, avSize); ctx.clip();
            const sc = Math.max(avSize / img.width, avSize / img.height);
            ctx.drawImage(img, ax - (img.width * sc - avSize) / 2, ay - (img.height * sc - avSize) / 2, img.width * sc, img.height * sc);
            ctx.restore();
            drewAvatar = true;
        } catch { /* jatuh ke inisial */ }
    }
    if (!drewAvatar) {
        ctx.fillStyle = accent; ctx.fillRect(ax, ay, avSize, avSize);
        ctx.fillStyle = C.black; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `900 84px ${FONT}`;
        ctx.fillText((clean(o.name)[0] || '#').toUpperCase(), ax + avSize / 2, ay + avSize / 2 + 4);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    ctx.lineWidth = 5; ctx.strokeStyle = C.black; ctx.strokeRect(ax, ay, avSize, avSize);

    // lencana level: di pojok KIRI-BAWAH avatar agar tidak menyentuh teks identitas
    burst(ctx, ax, ay + avSize, 12, 42, 30, C.yellow);
    ctx.fillStyle = C.black; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${String(o.level ?? 1).length > 3 ? 17 : 20}px ${FONT}`;
    ctx.fillText(String(o.level ?? 1), ax, ay + avSize + 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    /* ── identitas (kanan avatar) ── */
    const tx = ax + avSize + 30;
    const txW = W - PAD - tx;
    let cy = topY + 34;

    // nama
    const nm = fit(ctx, clean(o.name) || 'Adventurer', txW, 36, '900', 18);
    ctx.font = `900 ${nm.size}px ${FONT}`;
    ctx.fillStyle = C.black;
    ctx.textAlign = 'left';
    ctx.fillText(nm.text, tx, cy);
    cy += Math.max(18, nm.size * 0.62) + 8;

    // nomor + gelar (satu baris, masing-masing punya jatah lebar sendiri)
    const numW = Math.min(150, txW * 0.35);
    text(ctx, `+${clean(o.number)}`, tx, cy, numW, 14, '700', C.mute);
    if (o.title) {
        text(ctx, clean(o.title).toUpperCase(), tx + numW + 14, cy, txW - numW - 14, 13, '900', C.mute);
    }
    cy += 14;

    // baris chip: kelas • prestise • rank
    let cx = tx;
    const rowW = txW;
    if (o.cls) {
        const label = `${clean(o.cls.name).toUpperCase()}${o.prestige ? `  ★P${o.prestige}` : ''}`;
        const w = chip(ctx, cx, cy, label, accent, { h: 32, fontSize: 16, padX: 14, maxW: rowW * 0.5 });
        cx += w + 10;
    }
    if (o.rank) {
        const w = chip(ctx, cx, cy, `RANK #${o.rank}${o.rankTotal ? `/${o.rankTotal}` : ''}`, C.yellow, { h: 32, fontSize: 14, padX: 12, maxW: Math.max(80, tx + rowW - cx) });
        cx += w + 10;
    }
    if (o.prestige && !o.cls) chip(ctx, cx, cy, `★P${o.prestige}`, C.yellow, { h: 32, fontSize: 14 });
    cy += 32 + 16;

    /* ── EXP / HP / MP ── */
    const barLabelW = 46;
    const barW = Math.min(430, rowW - barLabelW - 96);
    const barX = tx + barLabelW;
    const valueX = barX + barW + 10;

    const rows = [
        ['EXP', o.expNow || 0, o.expNeed || 1, C.green, `${fmtNum(o.expNow)} / ${fmtNum(o.expNeed)}`],
        ['HP', o.hp || 0, o.hpMax || 1, C.red, `${fmtNum(o.hp)} / ${fmtNum(o.hpMax)}`],
        ['MP', o.mp || 0, o.mpMax || 1, C.cyan, `${fmtNum(o.mp)} / ${fmtNum(o.mpMax)}`]
    ];
    for (const [label, cur, max, color, valTxt] of rows) {
        text(ctx, label, tx, cy + 15, barLabelW - 6, 13, '900', C.black);
        bar(ctx, barX, cy + 2, barW, 16, cur / Math.max(1, max), color);
        text(ctx, valTxt, valueX, cy + 15, rowW - barW - barLabelW - 14, 12, '700', C.mute);
        cy += 30;
    }

    /* ── stat ringkas ── */
    cy += 6;
    const stats = [
        ['ATK', fmtNum(o.atk), C.red],
        ['MATK', fmtNum(o.matk), C.purple],
        ['DEF', fmtNum(o.def), C.cyan],
        ['POWER', fmtNum(o.power), C.yellow],
        ['CRIT', `${Math.round((o.crit || 0) * 100)}%`, C.green]
    ];
    const gap = 8;
    const sw = Math.min(88, (rowW - gap * (stats.length - 1)) / stats.length);
    stats.forEach(([label, val, color], i) => {
        const x = tx + i * (sw + gap);
        box(ctx, x, cy, sw, 50, color, { offset: 4, border: 3 });
        text(ctx, val, x + sw / 2, cy + 25, sw - 12, 18, '900', C.black, 'center');
        text(ctx, label, x + sw / 2, cy + 41, sw - 10, 10, '700', C.black, 'center');
    });

    const topBottom = Math.max(ay + avSize, cy + 50);

    /* ═══════════════ BAGIAN BAWAH: panel ═══════════════ */
    const panelTop = topBottom + 26;
    const panelBottom = H - FOOTER_H - 14;
    const panelH = panelBottom - panelTop;

    // grid: kolom kiri (progress) lebih lebar, kanan dua baris
    const gapX = 16;
    const leftW = Math.round(CONTENT_W * 0.44);
    const rightW = CONTENT_W - leftW - gapX;
    const leftX = CONTENT_X;
    const rightX = leftX + leftW + gapX;

    /* ── PROGRESS ── */
    box(ctx, leftX, panelTop, leftW, panelH, C.paper, { offset: 5, border: 4 });
    text(ctx, 'PROGRESS', leftX + 16, panelTop + 30, leftW - 32, 17, '900', C.black);

    const progLines = [
        ['Chapter', `${o.chapter || 0}/${o.chapterTotal || 20}`],
        ['Achievements', `${o.achievements || 0}/${o.achTotal || 12}`],
        ['Monster Kills', fmtNum(o.kills)],
        ['Boss Kills', fmtNum(o.bossKills)],
        ['Dungeons', fmtNum(o.dungeons)],
        ['Daily Quest', `${o.daily?.done || 0}/${o.daily?.total || 4}`]
    ];
    const lineH = Math.min(28, (panelH - 56) / progLines.length);
    progLines.forEach(([label, val], i) => {
        const y = panelTop + 56 + i * lineH;
        const vw = 78;
        text(ctx, label, leftX + 16, y, leftW - 32 - vw, 13, '700', C.mute);
        text(ctx, val, leftX + leftW - 16, y, vw, 14, '900', C.black, 'right');
    });

    /* ── WEALTH ── */
    // Tinggi mengikuti isi (3 baris teks), bukan rasio, agar sub-baris tidak terpotong border.
    const wH = 92;
    box(ctx, rightX, panelTop, rightW, wH, C.yellow, { offset: 5, border: 4 });
    text(ctx, 'WEALTH', rightX + 16, panelTop + 26, rightW - 32, 15, '900', C.black);
    text(ctx, `${fmtNum(o.gold)} GOLD`, rightX + 16, panelTop + 54, rightW - 32, 24, '900', C.black);
    text(ctx, `DUST ${fmtNum(o.dust)}   •   ITEMS ${o.items || 0}`, rightX + 16, panelTop + 74, rightW - 32, 12, '700', C.black);

    /* ── STREAK & COMBO (dua kotak berdampingan) ── */
    const sTop = panelTop + wH + 14;
    const sH = Math.max(74, panelBottom - sTop);
    const halfW = (rightW - 14) / 2;
    const boxes = [
        { x: rightX, bg: C.pink, label: 'STREAK', value: `${o.streak || 0}`, sub: 'hari berturut' },
        {
            x: rightX + halfW + 14, bg: C.cyan, label: 'COMBO', value: `${o.combo || 0}x`,
            sub: o.combo > 1 ? `+${Math.round((o.combo - 1) * 8)}% reward` : 'berburu lagi!'
        }
    ];
    for (const b of boxes) {
        box(ctx, b.x, sTop, halfW, sH, b.bg, { offset: 5, border: 4 });
        // Posisi teks relatif tinggi kotak supaya tetap rapi walau kotak memendek.
        const inner = sH - 16;
        text(ctx, b.label, b.x + 14, sTop + 20, halfW - 28, 12, '900', C.black);
        text(ctx, b.value, b.x + 14, sTop + 20 + Math.max(24, inner * 0.48), halfW - 28, 28, '900', C.black);
        text(ctx, b.sub, b.x + 14, sTop + sH - 12, halfW - 28, 11, '700', C.black);
    }

    /* ═══════════════ FOOTER ═══════════════ */
    const fy = H - FOOTER_H + 10;
    ctx.fillStyle = C.black;
    ctx.fillRect(CONTENT_X, fy - 4, CONTENT_W, 3);

    const foot = [
        o.pet ? `PET ${clean(o.pet.name)} Lv${o.pet.level}` : 'PET —',
        o.guild ? `GUILD ${clean(o.guild)}` : 'GUILD —',
        o.rank ? `RANK #${o.rank}${o.rankTotal ? `/${o.rankTotal}` : ''}` : 'RANK —',
        o.set ? `SET ${clean(o.set.name)} ${o.set.count}/3` : 'SET —'
    ].join('     •     ');
    text(ctx, foot, CONTENT_X, H - 20, CONTENT_W, 12, '700', C.black);

    return canvas.toBuffer('image/png');
}

module.exports = { render, loadCanvas, clean, fmtNum, C, FONT, W, H };
