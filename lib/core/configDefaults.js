/**
 * NILAI BAWAAN config. Dipakai untuk melengkapi config.js lama milikmu: saat bot diperbarui,
 * kunci baru (mis. `kipay`, `renewal`) otomatis tersedia tanpa harus menyalin config.js baru.
 * Nilai yang sudah ada di config.js TIDAK pernah ditimpa.
 */
const DEFAULTS = {
    botName: 'ManzxyMD',
    version: '8.11.1',
    ownerName: 'Manzxy',
    ownerNumber: ['6281234567890'],
    timezone: 'Asia/Jakarta',
    prefix: '.', multiPrefix: true, prefixes: ['.', '!', '#', '/', '~'], noPrefix: false,
    sessionName: 'session', selfMode: true, usePairingCode: true, pairingNumber: '', // free: pairing-only (QR dimatikan)
    pairingPrefix: 'MANZKENZ', customPairingCode: 'MANZKENZ',
    jadibot: {
        enabled: true, max: 10, autoRestore: true, restoreDelayMs: 2500, pairingTimeoutSec: 180, maxReconnect: 10,
        maxPerUser: 2, botAccountIsOwner: false, freeForOwner: true, freeForPremium: true,
        price: { perDay: 1000, minDays: 1, maxDays: 90, packages: { '7d': 5000, '30d': 15000, '90d': 35000 } },
        welcomeMessage: true
    },
    renewal: { enabled: true, checkIntervalMin: 10, remindAt: ['3d', '1d', '3h'], graceHours: 24, notifyGroup: true, maxSendPerCycle: 30, defaultPackage: { prem: '30d', jadibot: '30d' } },
    yt: { searchLimit: 10 },
    welcome: { enabled: true, maxIndividual: 5, width: 1000, height: 420, accent: ['#ff4de1', '#00e5ff'], byeAccent: ['#ffa36c', '#ff5e8a'] },
    limit: { daily: 50, freeCategories: ['main', 'jadibot', 'premium', 'owner', 'plugin'] },
    // Sama dengan edisi Premium — pembeda ada di full update + fitur langka (plugin premium: true).
    premium: { enabled: true, freeForOwner: true, freeForPremium: true, price: { perDay: 2000, perHour: 1000, minHours: 1, maxDays: 3650 } },
    hotReload: true,
    cleaner: { auto: true, intervalHours: 6, orphanSessionDays: 3, senderKeyHours: 24 },
    exec: { timeoutSec: 120 },
    kipay: { api_key: '', pollIntervalSec: 5 },
    database: { path: './database/db.json', saveDelayMs: 3000, autoBackup: true },
    button: { botNode: true, fallbackText: true },
    console: { clear: true, logCommands: true, logAllMessages: false, stack: true, debug: false },
    groupCacheTTL: 300, queueConcurrency: 3, queueMaxSize: 30, ignoreOldSeconds: 90,
    enableKeepAliveServer: true, port: process.env.PORT || 3000,
    waVersion: null, statusCommand: true, channelCommand: true,
    upsw: { maxViewers: 1500 },
    replyStyle: 'forward',
    channel: { jid: '', name: 'ManzxyMD', serverMessageId: -1 },
    card: { fileName: 'ManzxyMD', mimetype: 'image/png', sizeTB: 777, pageCount: 0, thumbnailUrl: '', externalAd: false },
    guard: { enabled: true, intervalMin: 5, maxFailures: 2, mediaCheckEvery: 3, minReconnectGapSec: 90 },
    menu: { useButtons: true },
    adReply: { enabled: true, title: '', body: '', thumbnailUrl: '', sourceUrl: '', largeThumbnail: false, inlineThumbnail: true },
    register: { enabled: true, enforce: false, exemptCategories: ['main', 'premium', 'jadibot', 'owner', 'plugin'], minAge: 5, maxAge: 100 },
    botSettings: { online: false, typing: false, recording: false, autoRead: false, autoReadStatus: false, antiCall: false, antiCallBlock: false },
    groupDetect: { enabled: true, cooldownSec: 20 },
    poll: { voteAsCommand: true },
    footerText: 'ManzxyMD • Button & Rich Engine',
    thumbnailUrl: 'https://lunara.softbotz.my.id/f/NfVzyYdyvwQ5.jpeg',
    sourceUrl: 'https://github.com/WhiskeySockets/Baileys',
    categoryMeta: {
        main:        { icon: '🏠', label: 'MAIN',        order: 1 },
        jadibot:     { icon: '🤖', label: 'JADIBOT',     order: 2 },
        premium:     { icon: '⭐', label: 'PREMIUM',     order: 2.7 },
        interactive: { icon: '🎛️', label: 'INTERACTIVE', order: 3 },
        game:        { icon: '🎮', label: 'GAME',        order: 3.5 },
        rpg:         { icon: '🗡️', label: 'RPG',         order: 3.7 },
        group:       { icon: '👥', label: 'GROUP',       order: 4 },
        anime:       { icon: '🎌', label: 'ANIME',       order: 4.5 },
        downloader:  { icon: '📥', label: 'DOWNLOADER',  order: 4.6 },
        ai:          { icon: '🧠', label: 'AI',          order: 4.8 },
        tools:       { icon: '🛠️', label: 'TOOLS',       order: 5 },
        info:        { icon: 'ℹ️', label: 'INFO',        order: 5.5 },
        plugin:      { icon: '🧩', label: 'PLUGIN',      order: 6 },
        owner:       { icon: '👑', label: 'OWNER',       order: 7 }
    }
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(target, defaults, path, added) {
    for (const key of Object.keys(defaults)) {
        const here = path ? `${path}.${key}` : key;
        if (target[key] === undefined || target[key] === null) {
            target[key] = JSON.parse(JSON.stringify(defaults[key]));
            added.push(here);
        } else if (isObj(defaults[key]) && isObj(target[key])) merge(target[key], defaults[key], here, added);
    }
}

/** Lengkapi `config` yang dimuat. Aman dipanggil berkali-kali. Mengembalikan daftar kunci yang ditambahkan. */
function apply(config) {
    const added = [];
    merge(config, DEFAULTS, '', added);
    if (added.length) {
        const prev = config.__addedDefaults || [];
        Object.defineProperty(config, '__addedDefaults', { value: [...prev, ...added], enumerable: false, writable: true, configurable: true });
    }
    return added;
}

module.exports = { DEFAULTS, apply };
