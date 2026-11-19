/**
 * Plugin: Total Fitur (Canvas Neo Brutalism)
 * Fungsi: Menampilkan statistik jumlah command/fitur berdasarkan kategori.
 */
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { formatDateTime } = require('../../lib/core/utils');
const { logWarn } = require('../../lib/core/logger');

/* ═══════════════════════════ CANVAS & DESIGN ═══════════════════════════ */
let canvasLib;
let fontsRegistered = false;
let cachedLogo = null; // Cache logo
const FONT = '"Poppins","Inter","Segoe UI","Arial",sans-serif';

const C = { 
    bg: '#F3F0E6', black: '#000000', white: '#FFFFFF', 
    yellow: '#FFC900', cyan: '#00E5FF', pink: '#FF90E8', 
    green: '#23CE6B', red: '#FF4D4D', purple: '#9D4EDD',
    muted: '#4A4A4A'
};

const PALETTE = [C.cyan, C.pink, C.yellow, C.green, C.purple, C.red, C.white];

function loadCanvas() {
    if (canvasLib !== undefined) return canvasLib;
    for (const name of ['@napi-rs/canvas', 'canvas']) { 
        try { return (canvasLib = require(name)); } catch { /* next */ } 
    }
    return (canvasLib = null);
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
            if (canvasLib.GlobalFonts?.registerFromPath) canvasLib.GlobalFonts.registerFromPath(path.join(dir, f), family);
            else if (canvasLib.registerFont) canvasLib.registerFont(path.join(dir, f), { family });
        } catch { }
    }
}

async function getLogo(L) {
    if (cachedLogo) return cachedLogo;
    try {
        cachedLogo = await L.loadImage('https://lunara.softbotz.my.id/f/8cwLEer2Fget.jpeg');
    } catch (e) {
        cachedLogo = 'error';
    }
    return cachedLogo;
}

// Brutalist Box Generator
function brutalBox(ctx, x, y, w, h, bg, offset = 6, shadow = C.black) {
    ctx.fillStyle = shadow;
    ctx.fillRect(x + offset, y + offset, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 5; ctx.strokeStyle = C.black;
    ctx.strokeRect(x, y, w, h);
}

// Hazard Stripes Generator
function drawHazard(ctx, x, y, w, h) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = C.yellow; ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 20; ctx.strokeStyle = C.black;
    for (let i = -h; i < w + h; i += 40) {
        ctx.beginPath(); ctx.moveTo(i, y); ctx.lineTo(i - h, y + h); ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 5; ctx.strokeStyle = C.black; ctx.strokeRect(x, y, w, h);
}

function fitText(ctx, text, maxW, size, weight = '900') {
    ctx.font = `${weight} ${size}px ${FONT}`;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t === text ? t : t + '…';
}

async function renderTotalFitur(data, logoImg) {
    const L = loadCanvas();
    if (!L) throw new Error('Modul canvas belum terpasang');
    registerFonts();

    // Kalkulasi layout baru: 3 kolom, hemat tinggi vertikal
    const cols = 3;
    const gap = 20;
    const margin = 40;
    const rows = Math.ceil(data.categories.length / cols);
    const rowHeight = 75;
    const gridYStart = 370; 
    
    const W = 1000;
    const contentW = W - (margin * 2); 
    const colWidth = Math.floor((contentW - (gap * (cols - 1))) / cols);
    const H = Math.max(600, gridYStart + (rows * (rowHeight + gap)) + 100);

    const canvas = L.createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    /* 1. Latar Belakang */
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    for (let y = 20; y < H; y += 30) for (let x = 20; x < W; x += 30) ctx.fillRect(x, y, 4, 4);

    /* 2. Header Banner */
    brutalBox(ctx, margin, margin, contentW, 120, C.white, 8);
    
    // Logo
    if (logoImg && logoImg !== 'error') {
        ctx.fillStyle = C.black;
        ctx.fillRect(55 + 6, 55 + 6, 90, 90);
        ctx.save();
        ctx.beginPath(); ctx.rect(55, 55, 90, 90); ctx.clip();
        ctx.drawImage(logoImg, 55, 55, 90, 90);
        ctx.restore();
        ctx.lineWidth = 5; ctx.strokeStyle = C.black; ctx.strokeRect(55, 55, 90, 90);
    } else {
        drawHazard(ctx, margin, margin, 120, 120);
        ctx.fillStyle = C.white; ctx.fillRect(55, 55, 90, 90);
        ctx.lineWidth = 5; ctx.strokeRect(55, 55, 90, 90);
        ctx.fillStyle = C.black; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `900 60px ${FONT}`;
        ctx.fillText('⚡', 100, 100);
    }

    // Teks Header
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.black;
    ctx.font = `900 50px ${FONT}`;
    ctx.fillText('DATABASE FITUR', 180, 95);
    ctx.font = `900 18px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(`BOT VERSION: ${config.version}  //  REQUESTED BY: ${data.userName.toUpperCase()}`, 184, 135);

    /* 3. Kotak Total Fitur (Banner Horizontal Full Width) */
    const totalBoxY = 190;
    const totalBoxH = 140;
    brutalBox(ctx, margin, totalBoxY, contentW, totalBoxH, C.cyan, 8);
    drawHazard(ctx, margin, totalBoxY, 80, totalBoxH); // Aksen kiri
    
    ctx.fillStyle = C.black;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `900 42px ${FONT}`;
    ctx.fillText('TOTAL PERINTAH AKTIF', margin + 110, totalBoxY + (totalBoxH / 2));
    
    // Chip angka total (Kanan)
    const countW = 180;
    const countX = W - margin - countW - 20;
    brutalBox(ctx, countX, totalBoxY + 20, countW, 100, C.black, 5, C.white);
    ctx.fillStyle = C.white;
    ctx.textAlign = 'center';
    ctx.font = `900 65px ${FONT}`;
    ctx.fillText(data.total, countX + (countW / 2), totalBoxY + 74);

    /* 4. Grid Kategori (3 Kolom) */
    ctx.textBaseline = 'alphabetic';
    data.categories.forEach((cat, index) => {
        const c = index % cols;
        const r = Math.floor(index / cols);
        
        const x = margin + (c * (colWidth + gap));
        const y = gridYStart + (r * (rowHeight + gap));
        const color = PALETTE[index % PALETTE.length];
        
        brutalBox(ctx, x, y, colWidth, rowHeight, color, 5);
        
        // Kotak angka (Count) di dalam box kategori
        const innerCountW = 60;
        ctx.fillStyle = C.black;
        ctx.fillRect(x + colWidth - innerCountW, y, innerCountW, rowHeight);
        ctx.fillStyle = C.white;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `900 28px ${FONT}`;
        ctx.fillText(cat.count, x + colWidth - (innerCountW / 2), y + (rowHeight / 2) + 2);
        
        // Garis pemisah dalam count box
        ctx.beginPath(); ctx.moveTo(x + colWidth - innerCountW, y); ctx.lineTo(x + colWidth - innerCountW, y + rowHeight); ctx.stroke();

        // Nama Kategori
        ctx.fillStyle = C.black;
        ctx.textAlign = 'left';
        const catName = fitText(ctx, cat.name.toUpperCase(), colWidth - innerCountW - 20, 20, '900');
        ctx.fillText(catName, x + 15, y + (rowHeight / 2) + 2);
    });

    /* 5. Footer (Waktu & Info) */
    brutalBox(ctx, -10, H - 70, W + 20, 70, C.black, 0, 0); // Banner nabrak pinggir
    ctx.fillStyle = C.white;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 18px ${FONT}`;
    ctx.fillText(`${config.botName.toUpperCase()} SYSTEM  •  ${data.time.toUpperCase()}  •  SECURE CONNECTION`, W / 2, H - 35 + 2);

    // Outer Border
    ctx.lineWidth = 14; ctx.strokeStyle = C.black; ctx.strokeRect(0, 0, W, H);

    return canvas.toBuffer('image/png');
}

/* ═══════════════════════════ COMMAND LOGIC ═══════════════════════════ */
module.exports = {
    name: 'Total Fitur',
    command: ['totalfitur', 'fitur', 'listfitur', 'stats'],
    category: 'info',
    description: 'Menampilkan total fitur dan kategori bot dalam format gambar',
    usage: '.totalfitur',
    
    async execute(sock, m, { getPluginsByCategory, reply, pushname }) {
        await reply('⏳ Sedang memuat database fitur...');

        try {
            // Mengambil data plugin
            const pluginMap = getPluginsByCategory();
            const entries = pluginMap instanceof Map ? Array.from(pluginMap.entries()) : Object.entries(pluginMap);
            
            let totalCmd = 0;
            let categories = [];

            for (const [catName, plugins] of entries) {
                // Jangan tampilkan kategori hidden jika ada
                if (catName.toLowerCase() === 'hidden') continue;

                let cmdCount = 0;
                plugins.forEach(p => {
                    // Hitung jumlah alias command di dalam satu file plugin
                    cmdCount += (Array.isArray(p.command) ? p.command.length : 1);
                });

                if (cmdCount > 0) {
                    totalCmd += cmdCount;
                    categories.push({ name: catName, count: cmdCount });
                }
            }

            // Urutkan dari jumlah command terbanyak
            categories.sort((a, b) => b.count - a.count);

            const data = {
                total: totalCmd,
                categories: categories,
                botName: config.botName,
                userName: pushname || 'USER',
                time: formatDateTime(new Date())
            };

            let png = null;
            if (loadCanvas()) {
                try {
                    const L = loadCanvas();
                    const logoImg = await getLogo(L); // Ambil Logo
                    png = await renderTotalFitur(data, logoImg);
                } catch (err) {
                    logWarn('TOTALFITUR', `Canvas gagal dirender: ${err.message}`);
                }
            }

            // Jika canvas gagal atau belum diinstall, kirim mode Teks
            if (!png) {
                let textRes = `📊 *TOTAL FITUR ${config.botName.toUpperCase()}*\n\n`;
                textRes += `Total: *${totalCmd} Command*\n\n`;
                categories.forEach(c => {
                    textRes += `📁 *${c.name.toUpperCase()}* : ${c.count} cmd\n`;
                });
                textRes += `\n_Modul Canvas belum terpasang, dikirim sebagai teks._`;
                
                return await reply(textRes);
            }

            // Kirim Canvas Image
            await sock.sendMessage(m.key.remoteJid, {
                image: png,
                caption: `⚡ *DATABASE FITUR ${config.botName.toUpperCase()}*\nTotal: *${totalCmd} Command* aktif yang siap digunakan!`
            }, { quoted: m });

        } catch (err) {
            await reply(`❌ *Terjadi kesalahan saat memuat fitur:*\n${err.message}`);
        }
    }
};
