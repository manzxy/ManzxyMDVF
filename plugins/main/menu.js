/**
 * Menu — gaya lama, isi baru.
 *
 *   .menu                introduction + info bot/user + daftar kategori ringkas
 *   .menu <kategori>     isi satu kategori
 *   .menu cari <kata>    cari command / fitur
 *   .menuall             menampilkan SELURUH fitur dari semua kategori sekaligus
 */
const os = require('os');
const config = require('../../config');
const { jadibotSessions } = require('../../lib/bot/jadibotManager');
const { button } = require('../../lib/wa/rich');
const { runtime, getGreeting } = require('../../lib/core/utils');

// Trik karakter Readmore WhatsApp (disimpan di memori sekali saja)
const READMORE = String.fromCharCode(8206).repeat(4000);

// Helper UI: Membuat kotak bergaya klasik ╭─「 TITLE 」... ╰───
const createBox = (title, lines) => {
    return [
        `╭─「 *${title}* 」`,
        ...lines.map(line => (line.startsWith('│') ? line : `│ ${line}`)),
        `╰──────────────`
    ].join('\n');
};

const meta = (cat) => config.categoryMeta[cat] || { icon: '📁', label: String(cat).toUpperCase(), order: 99 };

const TIPS = [
    'Ketik *.menu <kategori>* untuk melihat satu kategori saja.',
    'Ingin limit tanpa batas? Coba *.buyprem* — bisa per jam sampai tahunan.',
    'Mau bot sendiri? Coba *.jadibot <nomor> <durasi>*.',
    'Cek status & sisa limitmu kapan saja dengan *.profile*.'
];
const getRandomTip = () => TIPS[Math.floor(Date.now() / 60000) % TIPS.length];

// Helper Ukuran RAM
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Pengurutan & Penghitungan Fitur
const sortedCategories = (grouped) => Object.keys(grouped).sort((a, b) => meta(a).order - meta(b).order || a.localeCompare(b));
const nameOf = (plugin) => String(plugin?.name || plugin?.commands?.[0] || 'tanpa-nama');
const cmdOf = (plugin) => (Array.isArray(plugin?.commands) ? plugin.commands[0] : '');
const sortFeatures = (list) => [...(list || [])].sort((a, b) => (a.order || 50) - (b.order || 50) || nameOf(a).localeCompare(nameOf(b)));
const featureTotal = (grouped) => Object.values(grouped).reduce((n, list) => n + list.length, 0);
const cmdCountOf = (list) => list.reduce((count, plugin) => count + (Array.isArray(plugin.commands) ? plugin.commands.length : 0), 0);
const commandTotal = (grouped) => Object.values(grouped).reduce((n, list) => n + cmdCountOf(list), 0);

// --- BAGIAN KOMPONEN TEKS --- //

const header = (ctx) => {
    const greet = getGreeting().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
    return createBox('INTRODUCTION', [
        `Hai, *${ctx.pushname || 'User'}* 👋`,
        greet,
        ``,
        `Selamat datang di layanan`,
        `otomatis *${config.botName}*.`
    ]);
};

const limitLine = (ctx, user) => {
    if (ctx.isUnlimited) return '∞ Unlimited';
    const max = Number(user?.limit?.max);
    const used = Number(user?.limit?.used) || 0;
    return (!Number.isFinite(max) || max <= 0) ? '∞ Unlimited' : `${Math.max(0, max - used)} / ${max}`;
};

const infoBlock = (ctx, grouped) => {
    const user = ctx.user;
    const mem = process.memoryUsage();
    const prefixStr = config.multiPrefix ? `[ ${config.prefixes.join(' ')} ]` : config.prefix;

    const botBox = createBox('INFO BOT 🤖', [
        `⬡ *Mode:* ${ctx.isSelfMode ? 'Self' : 'Public'}`,
        `⬡ *Prefix:* ${prefixStr}`,
        `⬡ *Uptime:* ${runtime(process.uptime())}`,
        `⬡ *Jadibot:* ${jadibotSessions.size} Aktif`,
        `⬡ *RAM:* ${formatBytes(mem.rss)} / ${formatBytes(os.totalmem())}`,
        `⬡ *Total:* ${featureTotal(grouped)} Fitur | ${commandTotal(grouped)} Cmds`
    ]);

    if (!user) return botBox;

    const status = ctx.isRootOwner ? 'Root Owner' : ctx.isOwner ? 'Owner' : ctx.isPremium ? 'Premium' : 'User';
    const userBox = createBox('INFO USER 👤', [
        `⬡ *Nama:* ${ctx.pushname || 'User'}`,
        `⬡ *Status:* ${status}`,
        `⬡ *Limit:* ${limitLine(ctx, user)}`,
        `⬡ *Saldo:* $${user.money || 0}`
    ]);

    return `${botBox}\n\n${userBox}`;
};

const limitCost = (plugin) => plugin.limit !== undefined ? Number(plugin.limit) : (config.limit.freeCategories.includes(plugin.category) ? 0 : 1);

const marksOf = (plugin) => {
    const marks = [];
    const cost = limitCost(plugin);
    if (!plugin.rootOwner && !plugin.owner && !plugin.premium && cost > 0) marks.push(`Ⓛ ${cost}`);
    if (plugin.premium) marks.push('Ⓟ');
    if (plugin.owner || plugin.rootOwner) marks.push('Ⓞ');
    if (plugin.register) marks.push('Ⓡ');
    return marks.length ? ` ${marks.join(' ')}` : '';
};

// Merender list command per kategori dengan cantik
const categoryBlock = (cat, list, prefix) => {
    const m = meta(cat);
    const items = sortFeatures(list);
    
    const lines = items.map((plugin) => {
        const cmd = cmdOf(plugin);
        const name = cmd ? `${prefix}${cmd}` : nameOf(plugin);
        const desc = plugin.description || 'Tanpa deskripsi';
        return `│ ⬡ *${name}*${marksOf(plugin)}\n│   └ ${desc}`;
    });

    // Menambahkan Ikon di judul agar lebih hidup
    return createBox(`${m.icon} ${m.label} ( ${items.length} )`, lines);
};

const visibleGrouped = (ctx, grouped) => {
    const out = {};
    for (const [cat, list] of Object.entries(grouped)) {
        const shown = list.filter((p) => !(p.rootOwner && !ctx.isRootOwner) && !((p.owner || p.category === 'owner') && !ctx.isOwner));
        if (shown.length) out[cat] = shown;
    }
    return out;
};

const legend = () => `\n_💡 Tip: ${getRandomTip()}_\n_Keterangan: Ⓛ Limit, Ⓟ Premium, Ⓞ Owner, Ⓡ Daftar_\n_${config.footerText}_`;

// --- BAGIAN HALAMAN & PENCARIAN --- //

const paginate = (items, page, size) => {
    const total = Math.max(1, Math.ceil(items.length / size));
    const asked = Number.parseInt(page, 10);
    const now = Math.min(Math.max(1, Number.isFinite(asked) ? asked : 1), total);
    return { slice: items.slice((now - 1) * size, now * size), page: now, total };
};
const pageOf = (args, skip = 0) => {
    const last = args[args.length - 1];
    return args.length > skip && /^\d+$/.test(String(last)) ? last : 1;
};
const pageHint = (prefix, base, page, total) => total > 1 
    ? `_Halaman ${page} dari ${total} — \`${prefix}${base} ${page < total ? page + 1 : 1}\` untuk lanjut_` 
    : '';

const searchPlugins = (grouped, keyword) => {
    const needle = String(keyword || '').toLowerCase().trim();
    if (!needle) return [];
    
    const hits = [];
    for (const [cat, list] of Object.entries(grouped)) {
        for (const plugin of list) {
            const cmds = (plugin.commands || []).map(c => String(c).toLowerCase());
            const name = nameOf(plugin).toLowerCase();
            const desc = String(plugin.description || '').toLowerCase();
            let score = 0;
            if (cmds.includes(needle)) score = 4;
            else if (cmds.some(c => c.startsWith(needle))) score = 3;
            else if (name.includes(needle)) score = 2;
            else if (desc.includes(needle)) score = 1;
            else if (cat.includes(needle)) score = 1;
            if (score) hits.push({ plugin, cat, score });
        }
    }
    return hits.sort((a, b) => b.score - a.score || nameOf(a.plugin).localeCompare(nameOf(b.plugin)));
};

// --- BAGIAN TOMBOL --- //

const buildSections = (ctx, grouped) => {
    const p = ctx.prefix;
    const cats = sortedCategories(grouped);
    const sections = [{
        title: 'Akses Cepat',
        rows: [
            { title: 'Semua Menu', description: `Lihat seluruh fitur sekaligus`, id: `${p}menuall` },
            { title: 'Profil', description: 'Cek status, level, dan saldo', id: `${p}profile` }
        ]
    }];

    const ROWS_PER_SECTION = 10;
    for (let i = 0; i < cats.length; i += ROWS_PER_SECTION) {
        sections.push({
            title: i === 0 ? 'Kategori Fitur' : `Kategori (${i + 1}-${Math.min(i + ROWS_PER_SECTION, cats.length)})`,
            rows: cats.slice(i, i + ROWS_PER_SECTION).map((c) => ({
                title: `${meta(c).icon} ${meta(c).label}`.slice(0, 24),
                description: `${grouped[c].length} fitur`.slice(0, 72),
                id: `${p}menu ${c}`
            }))
        });
    }
    return sections;
};

// --- EKSEKUSI UTAMA --- //

module.exports = {
    name: 'Menu',
    command: ['menu', 'help', 'start', 'menuall'],
    category: 'main',
    order: 1,
    description: 'Menampilkan daftar kategori dan seluruh fitur bot',
    usage: '.menu [kategori|nomor] • .menu cari <kata> • .menuall',

    async execute(sock, m, ctx) {
        const { from, command, args, prefix } = ctx;
        const grouped = visibleGrouped(ctx, ctx.getPluginsByCategory());
        const cats = sortedCategories(grouped);
        const useButtons = Boolean(config.menu?.useButtons);

        // Helper pengirim pesan (Tombol -> Gambar -> Teks Biasa)
        const sendMsg = async (body, btns) => {
            const finalBody = body + legend();
            const mediaOk = typeof sock.mediaOk === 'function' ? sock.mediaOk() : true;

            if (useButtons) {
                try {
                    const btnPayload = { body: finalBody, footer: config.footerText };
                    if (mediaOk && config.thumbnailUrl) btnPayload.image = { url: config.thumbnailUrl };
                    return await sock.sendUniversalButton(from, btnPayload, btns, m);
                } catch (err) {
                    sock.reportMediaFailure?.(err);
                }
            }

            if (mediaOk && config.thumbnailUrl) {
                try {
                    return await sock.sendMessage(from, { image: { url: config.thumbnailUrl }, caption: finalBody }, { quoted: m });
                } catch (err) {
                    sock.reportMediaFailure?.(err);
                }
            }
            return await sock.reply(from, finalBody, m);
        };

        const rawArg = (args[0] || '').trim().toLowerCase();
        let bodyLines = [];
        let buttons = [];

        // ==========================================
        // 1. SEMUA FITUR UTUH (.menuall) - TANPA HALAMAN
        // ==========================================
        if (command === 'menuall' || rawArg === 'all' || rawArg === 'menuall') {
            bodyLines = [header(ctx), infoBlock(ctx, grouped), READMORE];
            
            // Loop seluruh kategori dan langsung cetak semua fiturnya
            cats.forEach(cat => {
                bodyLines.push(categoryBlock(cat, grouped[cat], prefix));
            });

            // Kotak penutup yang estetik
            bodyLines.push(createBox('SELESAI 🏁', [
                `⬡ Total keseluruhan: *${featureTotal(grouped)} Fitur*`,
                `⬡ Ketik \`${prefix}menu\` untuk tampilan ringkas.`
            ]));

            buttons = [
                button.list('Navigasi Kategori', buildSections(ctx, grouped)), 
                button.quick('Menu Utama', `${prefix}menu`)
            ];
            
            return await sendMsg(bodyLines.join('\n\n'), buttons);
        }

        // ==========================================
        // 2. PENCARIAN (.menu cari <kata>)
        // ==========================================
        if (['cari', 'search', 'find', '?'].includes(rawArg)) {
            const parts = args.slice(1);
            if (parts.length > 1 && /^\d+$/.test(String(parts[parts.length - 1]))) parts.pop();
            const keyword = parts.join(' ').trim();

            if (!keyword) {
                return await sock.reply(from, createBox('CARI FITUR 🔍', [
                    `⬡ *Contoh:* \`${prefix}menu cari sticker\``,
                    `⬡ *Indeks:* \`${prefix}menu\``
                ]), m);
            }

            const hits = searchPlugins(grouped, keyword);
            if (!hits.length) {
                return await sock.reply(from, createBox('CARI FITUR 🔍', [
                    `⬡ Tidak ada yang cocok dengan *${keyword}*`,
                    `  └ Coba kata lain, atau buka \`${prefix}menu\``
                ]), m);
            }

            const { slice, page, total } = paginate(hits, pageOf(args, 1), 12);
            bodyLines = [
                header(ctx),
                createBox(`HASIL PENCARIAN ( ${hits.length} )`, [
                    `⬡ *Kata kunci:* ${keyword}`,
                    ...slice.map(({ plugin, cat }) => {
                        const cmd = cmdOf(plugin);
                        const label = cmd ? `*${prefix}${cmd}*` : `*${nameOf(plugin)}*`;
                        return `│ ⬡ ${label}${marksOf(plugin)} · ${meta(cat).label}\n│   └ ${plugin.description || 'Tanpa deskripsi'}`;
                    }),
                    pageHint(prefix, `menu cari ${keyword}`, page, total)
                ].filter(Boolean))
            ];

            buttons = [button.quick('Menu Utama', `${prefix}menu`)];
            if (total > 1) buttons.unshift(button.quick(page < total ? 'Halaman Berikutnya' : 'Kembali', `${prefix}menu cari ${keyword} ${page < total ? page + 1 : 1}`));
            
            return await sendMsg(bodyLines.join('\n\n'), buttons);
        }

        // ==========================================
        // 3. SATU KATEGORI SAJA
        // ==========================================
        let targetCat = grouped[rawArg] ? rawArg : null;
        if (!targetCat && /^\d+$/.test(rawArg)) {
            const idx = Number.parseInt(rawArg, 10) - 1;
            if (idx >= 0 && idx < cats.length) targetCat = cats[idx];
        }

        if (targetCat) {
            const list = grouped[targetCat];
            const m0 = meta(targetCat);

            // Karena user cuma buka 1 kategori, tidak perlu dipaginasi lagi, langsung keluarkan semuanya!
            bodyLines = [
                header(ctx),
                categoryBlock(targetCat, list, prefix),
                createBox('NAVIGASI 🧭', [
                    `⬡ Ketik \`${prefix}menu\` untuk kategori lain`
                ])
            ];

            buttons = [button.quick('Menu Utama', `${prefix}menu`), button.quick('Semua Menu', `${prefix}menuall`)];
            return await sendMsg(bodyLines.join('\n\n'), buttons);
        }

        // ==========================================
        // 4. ERROR KATEGORI TIDAK DIKENAL
        // ==========================================
        if (rawArg) {
            return await sock.reply(from, createBox('KATEGORI ❌', [
                `⬡ *${rawArg}* tidak ditemukan`,
                `  └ Tersedia: ${cats.join(', ')}`
            ]), m);
        }

        // ==========================================
        // 5. MENU UTAMA (Tampilan Ringkas)
        // ==========================================
        const catLines = cats.map((c, i) => {
            const list = grouped[c];
            const m = meta(c);
            const no = String(i + 1).padStart(2, '0');
            return `│ ${no} ${m.icon} *${m.label}* — ${list.length} fitur\n│   └ \`${prefix}menu ${c}\``;
        });

        bodyLines = [
            header(ctx),
            infoBlock(ctx, grouped),
            READMORE + createBox(`DAFTAR KATEGORI ( ${cats.length} )`, [
                ...catLines.map(l => l.substring(2)),
                ``,
                `⬡ \`${prefix}menu <nomor>\` — buka isi kategori`,
                `⬡ \`${prefix}menuall\` — tampilkan semua fitur bot`
            ])
        ];

        buttons = [
            button.list('Daftar Kategori', buildSections(ctx, grouped)),
            button.quick('Semua Menu', `${prefix}menuall`),
            button.url('Chat Owner', `https://wa.me/${config.ownerNumber[0]}`)
        ];

        return await sendMsg(bodyLines.join('\n\n'), buttons);
    }
};
