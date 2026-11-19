/**
 * PING & RUNTIME — kartu status bergambar (canvas) bergaya NEO BRUTALISM.
 *   .ping (.status .server) → dashboard lengkap
 *   .runtime (.uptime)      → kartu runtime
 * Seluruh kode gambar ada di file ini. Butuh @napi-rs/canvas (atau canvas).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { groupCache } = require('../../lib/core/jid');
const { getActiveJadibots } = require('../../lib/bot/jadibotManager');
const { button } = require('../../lib/wa/rich');
const { runtime, formatBytes, clock, formatDateTime, sleep } = require('../../lib/core/utils');
const { logWarn } = require('../../lib/core/logger');

/* ═══════════════════════════ CANVAS ═══════════════════════════ */
let lib;
let fontsRegistered = false;
let cachedLogo = null; // Cache untuk logo agar tidak didownload berulang kali
const FONT = '"Poppins","Inter","Segoe UI","Arial",sans-serif';

// Palet Warna Neo Brutalism
const C = { 
    bg: '#F3F0E6',       // Off-white / Cream
    black: '#000000',    // Hitam pekat
    white: '#FFFFFF',    // Putih murni
    cyan: '#00E5FF',     // Aksen
    pink: '#FF90E8', 
    green: '#23CE6B', 
    yellow: '#FFC900', 
    red: '#FF4D4D', 
    muted: '#4A4A4A',    // Abu-abu gelap untuk teks sekunder
    cardBg: '#FFFFFF'
};

function loadCanvas() {
    if (lib !== undefined) return lib;
    for (const name of ['@napi-rs/canvas', 'canvas']) { try { return (lib = require(name)); } catch { /* next */ } }
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
        } catch { }
    }
}

async function getLogo(L) {
    if (cachedLogo) return cachedLogo;
    try {
        // Mengunduh dan meload logo ke canvas memory
        cachedLogo = await L.loadImage(config.thumbnailUrl);
    } catch (e) {
        cachedLogo = 'error'; // Set error agar tidak nyepam fetch jika gagal
    }
    return cachedLogo;
}

const clean = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}\u{0000}-\u{001F}]/gu, '').replace(/\s+/g, ' ').trim();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pctColor = (p) => (p < 60 ? C.green : p < 85 ? C.yellow : C.red);

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

function text(ctx, str, x, y, { size = 18, weight = 'normal', color = C.black, align = 'left', base = 'alphabetic', max = 0 } = {}) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
    let s = clean(str);
    if (max) { while (s.length > 1 && ctx.measureText(s).width > max) s = s.slice(0, -2) + '…'; }
    ctx.fillText(s, x, y);
}

// Kotak bergaya Brutalist dengan offset shadow keras (tanpa blur)
function brutalBox(ctx, x, y, w, h, bgColor, radius = 8, offset = 6) {
    // Hard Shadow Offset Hitam
    ctx.fillStyle = C.black;
    roundRect(ctx, x + offset, y + offset, w, h, radius);
    ctx.fill();
    // Kotak Utama
    ctx.fillStyle = bgColor;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
    // Tepi Hitam Tebal
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.black;
    ctx.stroke();
}

function background(ctx, W, H) {
    ctx.fillStyle = C.bg; 
    ctx.fillRect(0, 0, W, H);
    // Grid pattern bergaya industrial
    ctx.fillStyle = '#D6D3C5';
    for (let x = 20; x < W; x += 40) for (let y = 20; y < H; y += 40) ctx.fillRect(x, y, 3, 3);
    // Outer border super tebal
    ctx.lineWidth = 16;
    ctx.strokeStyle = C.black;
    ctx.strokeRect(0, 0, W, H);
}

function header(ctx, W, title, subtitle, logoImg) {
    // Avatar Bot
    if (logoImg && logoImg !== 'error') {
        // Shadow (Hard Offset)
        ctx.fillStyle = C.black;
        ctx.beginPath(); ctx.arc(75 + 6, 70 + 6, 35, 0, Math.PI * 2); ctx.fill();
        
        // Image Canvas Clip
        ctx.save();
        ctx.beginPath(); ctx.arc(75, 70, 35, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(logoImg, 40, 35, 70, 70);
        ctx.restore();
        
        // Border Luar
        ctx.lineWidth = 4; ctx.strokeStyle = C.black;
        ctx.beginPath(); ctx.arc(75, 70, 35, 0, Math.PI * 2); ctx.stroke();
    } else {
        // Fallback jika logo gagal dimuat (tetap huruf Inisial)
        brutalBox(ctx, 40, 35, 70, 70, C.pink, 35);
        text(ctx, (clean(config.botName)[0] || 'M').toUpperCase(), 75, 75, { size: 42, weight: 'bold', color: C.black, align: 'center', base: 'middle' });
    }
    
    // Teks Header
    text(ctx, title.toUpperCase(), 135, 63, { size: 40, weight: '900', max: W - 380 });
    text(ctx, subtitle, 138, 91, { size: 16, weight: 'bold', color: C.muted, max: W - 380 });
    
    // Pil Status "ONLINE"
    const label = 'ONLINE';
    ctx.font = `900 16px ${FONT}`;
    const pw = ctx.measureText(label).width + 60;
    const px = W - 40 - pw;
    brutalBox(ctx, px, 40, pw, 44, C.green, 22, 4);
    
    // Titik Hitam di Pil (menggantikan glowing dot)
    ctx.beginPath(); ctx.arc(px + 24, 62, 7, 0, Math.PI * 2); ctx.fillStyle = C.black; ctx.fill();
    text(ctx, label, px + 42, 62, { size: 16, weight: '900', color: C.black, base: 'middle' });
    
    text(ctx, clock(), W - 44, 107, { size: 15, weight: 'bold', color: C.black, align: 'right' });
}

function gauge(ctx, cx, cy, r, ms) {
    const start = Math.PI * 0.75, full = Math.PI * 1.5;
    const frac = clamp(1 - ms / 1500, 0.04, 1);
    const color = ms < 300 ? C.green : ms < 800 ? C.yellow : C.red;
    
    ctx.lineCap = 'butt'; // Potongan ujung tegas

    // Hard Shadow Arc
    ctx.lineWidth = 26; ctx.strokeStyle = C.black;
    ctx.beginPath(); ctx.arc(cx + 6, cy + 6, r, start, start + full * frac); ctx.stroke();

    // Track Base
    ctx.lineWidth = 26; ctx.strokeStyle = C.white;
    ctx.beginPath(); ctx.arc(cx, cy, r, start, start + full); ctx.stroke();
    // Border Track
    ctx.lineWidth = 4; ctx.strokeStyle = C.black;
    ctx.beginPath(); ctx.arc(cx, cy, r + 13, start, start + full); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r - 13, start, start + full); ctx.stroke();

    // Value Arc
    ctx.lineWidth = 26; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, r, start, start + full * frac); ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = C.black;
    ctx.beginPath(); ctx.arc(cx, cy, r + 13, start, start + full * frac); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r - 13, start, start + full * frac); ctx.stroke();

    // Tanda Skala
    ctx.strokeStyle = C.black; ctx.lineWidth = 4;
    for (let i = 0; i <= 10; i++) {
        const a = start + (full * i) / 10;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 18), cy + Math.sin(a) * (r - 18)); ctx.lineTo(cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28)); ctx.stroke();
    }

    // Teks tengah
    text(ctx, String(Math.round(ms)), cx, cy + 10, { size: 68, weight: '900', align: 'center', base: 'middle' });
    text(ctx, 'ms', cx, cy + 55, { size: 20, weight: 'bold', color: C.muted, align: 'center' });
    
    // Status box di bawah gauge
    const q = ms < 150 ? 'SANGAT CEPAT' : ms < 400 ? 'CEPAT' : ms < 900 ? 'NORMAL' : 'LAMBAT';
    ctx.font = `900 17px ${FONT}`;
    const qw = ctx.measureText(q).width + 30;
    brutalBox(ctx, cx - qw / 2, cy + r + 24, qw, 38, color, 8, 4);
    text(ctx, q, cx, cy + r + 49, { size: 17, weight: '900', color: C.black, align: 'center' });
}

function bar(ctx, x, y, w, label, value, pct, detail) {
    const p = clamp(Number.isFinite(pct) ? pct : 0, 0, 100), color = pctColor(p);
    
    text(ctx, label, x, y, { size: 16, weight: '900' });
    text(ctx, detail, x + w, y, { size: 15, weight: 'bold', color: C.muted, align: 'right', max: w - 120 });
    
    const by = y + 10, bh = 14;
    
    // Bar Background
    brutalBox(ctx, x, by, w, bh, C.white, 4, 3);
    
    // Bar Fill (jika ada nilai progress)
    const fw = Math.max(14, (w * p) / 100);
    if (fw > 0) {
        ctx.beginPath(); roundRect(ctx, x, by, fw, bh, 4); 
        ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = C.black; ctx.stroke();
    }
    
    if (value) text(ctx, value, x, by + bh + 18, { size: 13, weight: 'bold', color: C.muted, max: w - 80 });
    text(ctx, `${Math.round(p)}%`, x + w, by + bh + 18, { size: 15, weight: '900', color: C.black, align: 'right' });
}

function brutalSparkline(ctx, x, y, w, h, values) {
    if (values.length < 2) { text(ctx, 'Menunggu data (kirim .ping berulang)', x + w / 2, y + h / 2, { size: 14, weight: 'bold', color: C.muted, align: 'center', base: 'middle' }); return; }
    
    const max = Math.max(...values, 100), min = 0;
    const px = (i) => x + (w * i) / (values.length - 1);
    const py = (v) => y + h - ((v - min) / (max - min)) * h;
    
    // Shadow keras
    ctx.beginPath(); values.forEach((v, i) => (i ? ctx.lineTo(px(i) + 4, py(v) + 4) : ctx.moveTo(px(i) + 4, py(v) + 4)));
    ctx.lineWidth = 5; ctx.lineJoin = 'miter'; ctx.strokeStyle = C.black; ctx.stroke();
    
    // Garis Utama
    ctx.beginPath(); values.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
    ctx.lineWidth = 4; ctx.strokeStyle = C.pink; ctx.stroke();
    
    // Titik Akhir Besar
    const last = values.length - 1;
    ctx.beginPath(); ctx.arc(px(last), py(values[last]), 6, 0, Math.PI * 2); 
    ctx.fillStyle = C.cyan; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = C.black; ctx.stroke();
}

function chip(ctx, x, y, w, h, label, value, color) {
    brutalBox(ctx, x, y, w, h, C.white, 8, 4);
    
    // Strip Aksen Warna
    ctx.beginPath(); roundRect(ctx, x, y, w, 12, 8); // Atasnya aja (approx)
    ctx.fillStyle = color; ctx.fill();
    // Tutup overlap rounded rect kasar
    ctx.fillRect(x, y + 6, w, 6);
    // Garis batas internal
    ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x + w, y + 12); 
    ctx.lineWidth = 3; ctx.strokeStyle = C.black; ctx.stroke();
    // Ulangi outline utama untuk menutupi tepian
    ctx.beginPath(); roundRect(ctx, x, y, w, h, 8); ctx.stroke();
    
    text(ctx, label, x + w / 2, y + 35, { size: 13, weight: 'bold', color: C.muted, align: 'center', max: w - 10 });
    text(ctx, value, x + w / 2, y + 64, { size: 24, weight: '900', align: 'center', max: w - 10 });
}

function toPng(canvas) { return canvas.toBuffer ? canvas.toBuffer('image/png') : canvas.encode('png'); }

/** Dashboard .ping */
async function renderPing(s) {
    const L = loadCanvas();
    if (!L) throw new Error('Modul canvas belum terpasang');
    registerFonts();
    const W = 1000, H = 850;
    const canvas = L.createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const logoImg = await getLogo(L); // Load Logo URL
    
    background(ctx, W, H);
    header(ctx, W, `SYSTEM MONITOR`, `v${config.version} • ${s.mode.toUpperCase()} MODE • ${formatDateTime(new Date()).toUpperCase()}`, logoImg);

    // Kartu Kiri Atas: Gauge (Waktu Respon) - Tinggi disesuaikan
    brutalBox(ctx, 40, 130, 360, 340, C.cardBg);
    text(ctx, 'WAKTU RESPON SERVER', 56, 165, { size: 16, weight: '900' });
    ctx.beginPath(); ctx.moveTo(40, 180); ctx.lineTo(400, 180); ctx.lineWidth = 3; ctx.strokeStyle = C.black; ctx.stroke(); // Divider
    gauge(ctx, 220, 275, 95, s.latency); // Jari-jari 95 agar muat dan teks proses bisa naik
    text(ctx, `PROSES ${s.proc} MS`, 220, 445, { size: 14, weight: 'bold', color: C.muted, align: 'center' });

    // Kartu Kanan Atas: Sumber Daya
    brutalBox(ctx, 430, 130, 530, 340, C.cardBg);
    text(ctx, 'SUMBER DAYA SISTEM', 446, 165, { size: 16, weight: '900' });
    ctx.beginPath(); ctx.moveTo(430, 180); ctx.lineTo(960, 180); ctx.stroke(); // Divider
    const bx = 456, bw = 478;
    // Jarak Y diubah (205, 272, 339, 406) => Gap stabil 67px agar teks bebas tabrakan
    bar(ctx, bx, 205, bw, 'RAM BOT', `${formatBytes(s.rss)} terpakai`, (s.rss / s.memTotal) * 100, `${formatBytes(s.rss)} dari ${formatBytes(s.memTotal)} VPS`);
    bar(ctx, bx, 272, bw, 'RAM VPS', `${formatBytes(s.memUsed)} terpakai`, (s.memUsed / s.memTotal) * 100, `${formatBytes(s.memUsed)} / ${formatBytes(s.memTotal)}`);
    bar(ctx, bx, 339, bw, 'CPU', `${s.cores} CORE • ${clean(s.cpuModel).toUpperCase()}`, s.cpu, `LOAD ${s.load.map((v) => v.toFixed(2)).join(' ')}`);
    bar(ctx, bx, 406, bw, 'DISK', s.disk ? `${formatBytes(s.disk.free)} bebas` : 'N/A', s.disk ? (s.disk.used / s.disk.total) * 100 : 0, s.disk ? `${formatBytes(s.disk.used)} / ${formatBytes(s.disk.total)}` : '-');

    // Kartu Kiri Bawah: Riwayat Respon - Y dan Height disesuaikan
    brutalBox(ctx, 40, 495, 360, 255, C.cardBg);
    text(ctx, 'RIWAYAT RESPON', 56, 530, { size: 16, weight: '900' });
    if (s.history.length) text(ctx, `AVG ${Math.round(s.history.reduce((a, b) => a + b, 0) / s.history.length)} MS`, 384, 530, { size: 15, weight: 'bold', color: C.muted, align: 'right' });
    ctx.beginPath(); ctx.moveTo(40, 545); ctx.lineTo(400, 545); ctx.stroke();
    brutalSparkline(ctx, 60, 570, 320, 150, s.history);

    // Kartu Kanan Bawah: Statistik - Height disesuaikan agar chips tidak keluar
    brutalBox(ctx, 430, 495, 530, 255, C.cardBg);
    text(ctx, 'STATISTIK', 446, 530, { size: 16, weight: '900' });
    ctx.beginPath(); ctx.moveTo(430, 545); ctx.lineTo(960, 545); ctx.stroke();
    const cw = 150, ch = 80, gx = 450, gy = 565; // Grid spacing diatur lagi
    const chips = [
        ['RUNTIME BOT', runtime(s.uptime), C.cyan], ['UPTIME VPS', runtime(s.osUptime), C.pink], ['JADIBOT AKTIF', String(s.jadibot), C.green],
        ['PENGGUNA DB', String(s.users), C.yellow], ['GRUP TERSIMPAN', String(s.groups), C.cyan], ['TOTAL PERINTAH', String(s.commands), C.pink]
    ];
    chips.forEach(([l, v, col], i) => chip(ctx, gx + (i % 3) * (cw + 20), gy + Math.floor(i / 3) * (ch + 16), cw, ch, l, v, col));

    // Strip Info Bawah (Marquee style)
    brutalBox(ctx, -10, 775, 1020, 75, C.yellow, 0, 0); 
    ctx.beginPath(); ctx.moveTo(0, 775); ctx.lineTo(1000, 775); ctx.stroke(); 
    const info = `NODE ${s.node}  •  ${s.platform.toUpperCase()}/${s.arch.toUpperCase()}  •  PID ${s.pid}  •  PLUGINS: ${s.plugins}  •  CACHE: ${s.cache}  •  HOST: ${s.host.toUpperCase()}`;
    text(ctx, info, 500, 815, { size: 16, weight: '900', align: 'center', base: 'middle', max: 960 });

    return toPng(canvas);
}

/** Kartu .runtime */
async function renderRuntime(s) {
    const L = loadCanvas();
    if (!L) throw new Error('Modul canvas belum terpasang');
    registerFonts();
    const W = 900, H = 460;
    const canvas = L.createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const logoImg = await getLogo(L); // Load Logo URL
    
    background(ctx, W, H);
    header(ctx, W, `RUNTIME SYSTEM`, `AKTIF SEJAK: ${formatDateTime(new Date(Date.now() - s.uptime * 1000)).toUpperCase()}`, logoImg);

    let sec = Math.floor(s.uptime);
    const d = Math.floor(sec / 86400); sec -= d * 86400;
    const h = Math.floor(sec / 3600); sec -= h * 3600;
    const m = Math.floor(sec / 60); sec -= m * 60;
    
    const boxes = [['HARI', d, C.pink], ['JAM', h, C.cyan], ['MENIT', m, C.green], ['DETIK', sec, C.yellow]];
    const bw = 180, gap = 20, x0 = (W - (bw * 4 + gap * 3)) / 2;
    
    boxes.forEach(([label, val, col], i) => {
        const x = x0 + i * (bw + gap);
        brutalBox(ctx, x, 140, bw, 180, col, 8, 8);
        
        ctx.beginPath(); ctx.moveTo(x, 270); ctx.lineTo(x + bw, 270); 
        ctx.lineWidth = 4; ctx.strokeStyle = C.black; ctx.stroke();
        
        text(ctx, String(val).padStart(2, '0'), x + bw / 2, 215, { size: 92, weight: '900', color: C.black, align: 'center', base: 'middle' });
        text(ctx, label, x + bw / 2, 300, { size: 18, weight: '900', color: C.black, align: 'center' });
    });

    brutalBox(ctx, 40, 360, 820, 60, C.white, 6, 5);
    const items = [['UPTIME VPS', runtime(s.osUptime)], ['RESTART DB', String(s.startCount)], ['JADIBOT', String(s.jadibot)], ['NODE', s.node]];
    items.forEach(([l, v], i) => {
        const x = 70 + i * 205;
        text(ctx, `${l}:`, x, 396, { size: 14, weight: 'bold', color: C.muted });
        text(ctx, v, x + ctx.measureText(`${l}: `).width, 396, { size: 16, weight: '900', max: 120 });
    });

    return toPng(canvas);
}

/* ═══════════════════════════ DATA & LOGIC COMMAND ═══════════════════════════ */
const history = [];                         
const CPU_SAMPLE_MS = 200;

function cpuSnapshot() {
    let idle = 0, total = 0;
    for (const c of os.cpus()) { for (const k of Object.keys(c.times)) total += c.times[k]; idle += c.times.idle; }
    return { idle, total };
}
async function cpuPercent(ms = CPU_SAMPLE_MS) {
    const a = cpuSnapshot(); await sleep(ms); const b = cpuSnapshot();
    const dt = b.total - a.total;
    return dt > 0 ? clamp(Math.round((1 - (b.idle - a.idle) / dt) * 100), 0, 100) : 0;
}
function diskInfo() {
    try {
        const s = fs.statfsSync(process.cwd());
        const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
        return total ? { total, free, used: total - free } : null;
    } catch { return null; }
}

async function waRtt(sock) {
    if (typeof sock?.query !== 'function') return null;
    const t = Date.now();
    try {
        await Promise.race([
            sock.query({ tag: 'iq', attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:p' }, content: [{ tag: 'ping', attrs: {} }] }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
        ]);
        return Math.max(1, Date.now() - t);
    } catch { return null; }
}

async function collect(sock, isSelfMode, db, t0) {
    const [cpu, rtt] = await Promise.all([cpuPercent(), waRtt(sock)]);
    const proc = Math.max(1, Date.now() - t0 - CPU_SAMPLE_MS);
    const total = os.totalmem(), free = os.freemem(), mem = process.memoryUsage(), s = db.summary();
    const latency = Math.max(1, rtt ?? proc);
    history.push(latency); if (history.length > 20) history.shift();
    let plugins = 0; try { plugins = require('../../lib/bot/pluginLoader').plugins?.size || 0; } catch {}
    return {
        mode: isSelfMode ? 'Self' : 'Public', latency, rtt, proc, render: null, history: [...history],
        rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, memTotal: total, memUsed: total - free,
        cpu, cores: os.cpus().length, cpuModel: os.cpus()[0]?.model || 'CPU', load: os.loadavg(), disk: diskInfo(),
        uptime: process.uptime(), osUptime: os.uptime(), jadibot: getActiveJadibots().filter((j) => j.connected).length,
        users: s.users, groups: s.groups, commands: s.commands, startCount: db.data?.stats?.startCount || 0,
        node: process.version, platform: os.platform(), arch: os.arch(), pid: process.pid, host: os.hostname(), plugins, cache: groupCache.keys().length
    };
}

function textStatus(s) {
    return `*STATUS ${config.botName.toUpperCase()} (NEO BRUTALISM)*\n\n` +
        `• *Mode:* ${s.mode}\n• *Respon:* ${s.latency} ms (proses ${s.proc} ms)\n` +
        `• *RAM Bot:* ${formatBytes(s.rss)} (tanpa batas)\n• *RAM VPS:* ${formatBytes(s.memUsed)} / ${formatBytes(s.memTotal)}\n` +
        `• *CPU:* ${s.cpu}% • ${s.cores} core • load ${s.load[0].toFixed(2)}\n` +
        (s.disk ? `• *Disk:* ${formatBytes(s.disk.used)} / ${formatBytes(s.disk.total)}\n` : '') +
        `• *Cache Grup:* ${s.cache}\n• *Jadibot Aktif:* ${s.jadibot}\n• *Database:* ${s.users} user • ${s.groups} grup\n` +
        `• *Command Dijalankan:* ${s.commands}\n• *Runtime Bot:* ${runtime(s.uptime)}\n• *Uptime VPS:* ${runtime(s.osUptime)}`;
}

module.exports = {
    name: 'Status Server',
    command: ['ping', 'status', 'server', 'runtime', 'uptime'],
    category: 'tools',
    limit: 0,
    description: 'Ping bergambar (Neo Brutalism) dan runtime bot',
    usage: '.ping  •  .runtime',
    async execute(sock, m, { from, command, prefix, isSelfMode, db }) {
        const t0 = Date.now();
        const isRuntime = command === 'runtime' || command === 'uptime';
        const s = await collect(sock, isSelfMode, db, t0);

        const caption = isRuntime
            ? `⏱️ *RUNTIME ${config.botName.toUpperCase()}*\nAktif: *${runtime(s.uptime)}*\nVPS: ${runtime(s.osUptime)}`
            : `🏓 *PONG!* ${s.latency} ms\n⏱️ Runtime: *${runtime(s.uptime)}*\n💾 RAM Bot: ${formatBytes(s.rss)} • CPU ${s.cpu}%\n🤖 Jadibot aktif: ${s.jadibot}`;

        // Gambar hanya dicoba bila upload media sedang sehat (penjaga koneksi: lib/connectionGuard.js)
        const mediaOk = sock.mediaOk ? sock.mediaOk() : true;
        let png = null;
        if (mediaOk && loadCanvas()) {
            try {
                png = isRuntime ? await renderRuntime(s) : await renderPing(s);
            } catch (err) { logWarn('PING', `Canvas gagal (${err.message}), kirim teks`); png = null; }
        }

        if (png) {
            const buttons = [button.quick('🔄 Refresh', `${prefix}${command}`), button.quick(isRuntime ? 'Ping' : 'Runtime', `${prefix}${isRuntime ? 'ping' : 'runtime'}`)];
            try { return void await sock.sendUniversalButton(from, { body: caption, footer: config.footerText, image: png, requireMedia: true, fallback: false }, buttons, m); }
            catch (err) { logWarn('PING', `Tombol+gambar gagal (${err.message}), kirim gambar biasa`); }
            try { return void await sock.sendMessage(from, { image: png, caption }, { quoted: m }); }
            catch (err) { logWarn('PING', `Kirim gambar gagal (${err.message}), kirim teks`); }
        }

        // Cadangan: teks lengkap dalam kartu balasan (tidak butuh upload, tidak pernah melempar error upload)
        const note = !loadCanvas() ? '\n\n_Gambar nonaktif: jalankan `npm i @napi-rs/canvas`._' : (!mediaOk ? '\n\n_Koneksi media sedang disambung ulang otomatis, coba lagi sebentar untuk versi gambar._' : '');
        await sock.reply(from, (isRuntime ? caption : textStatus(s)) + note, m);
    }
};
