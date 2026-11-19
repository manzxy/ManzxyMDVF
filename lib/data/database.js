/**
 * DATABASE JSON — user, group, jadibot, settings, stats.
 * Tanpa dependency native (hemat RAM), penulisan atomik + backup otomatis.
 * Struktur lengkap ada di README bagian "Struktur Database".
 */
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { dateKey, numberOf, isPlainObject } = require('../core/utils');
const { logInfo, logWarn, logError, logDebug } = require('../core/logger');

const SCHEMA_VERSION = 3;
const DB_PATH = path.resolve(__dirname, '..', '..', config.database.path);
const BAK_PATH = DB_PATH + '.bak';

/* ───────────────────────── TEMPLATE DEFAULT ───────────────────────── */

const templates = {
    user: (number) => ({
        number,                                 // kunci utama (angka saja)
        jid: '',                                // 62xxx@s.whatsapp.net
        lid: '',                                // xxx@lid (WhatsApp versi baru)
        name: '',                               // pushName terakhir
        names: [],                              // riwayat nama (maks 5)
        registered: false,                      // sudah .daftar?
        regTime: 0,
        regName: '',                            // nama yang didaftarkan
        sn: '',                                 // nomor seri pendaftaran (untuk .unreg)
        age: -1,
        role: 'user',                           // user | premium | owner | banned
        premium: { active: false, expire: 0, since: 0, lastDurationMs: 0 },
        banned: { active: false, reason: '', by: '', time: 0 },
        limit: { max: config.limit.daily, used: 0, lastReset: '' },        // user biasa; Owner & Premium = unlimited
        level: 1,
        exp: 0,
        money: 0,
        bank: 0,
        warn: 0,
        afk: { active: false, since: 0, reason: '' },
        stats: {
            messages: 0,
            commands: 0,
            lastCommand: '',
            lastCommandAt: 0,
            firstSeen: 0,
            lastSeen: 0
        },
        commandUsage: {},                       // { menu: 5, ping: 2 }
        settings: { language: 'id', notify: true },
        jadibot: { owned: [], maxOwned: 1 },    // nomor jadibot milik user ini
        rpg: null,                              // profil RPG (lihat lib/rpg.js); dibuat saat .rpg daftar
        createdAt: 0,
        updatedAt: 0
    }),

    group: (id) => ({
        id,                                     // 1203xxxx@g.us
        name: '',
        owner: '',
        description: '',
        size: 0,
        createdAt: 0,                           // waktu masuk database
        updatedAt: 0,
        banned: { active: false, reason: '', time: 0 },
        rent: { active: false, since: 0, expire: 0, by: '', reminded: false, expiredPending: false, expiredNotified: false, leaveAt: 0, lastDurationMs: 0 },   // sewa bot
        settings: {
            mute: false,                        // bot diam (kecuali owner)
            adminOnly: false,                   // hanya admin yang boleh command
            welcome: false,
            welcomeText: 'Halo @user 👋\nSelamat datang di *@group*!\nKamu member ke-@count.\n\n@desc',
            bye: false,
            byeText: 'Selamat tinggal @user 👋',
            antilink: { enabled: false, mode: 'delete', whitelist: [] },   // delete | warn | kick
            antibadword: { enabled: false, words: [] },
            antispam: { enabled: false, maxPerMinute: 8 },
            antiviewonce: false,
            antidelete: false,
            detect: false,                      // deteksi perubahan grup (nama, deskripsi, admin, dll)
            rules: '',
            language: 'id',
            prefix: ''                          // prefix khusus grup ('' = ikut config)
        },
        disabledCommands: [],                   // command yang dimatikan di grup ini
        warns: {},                              // { '62xxx': 2 }
        stats: {
            messages: 0,
            commands: 0,
            lastActive: 0,
            topUsers: {}                        // { '62xxx': jumlahPesan }
        }
    }),

    jadibot: (number) => ({
        number,
        owner: '',                              // nomor pemilik jadibot (yang mengetik .jadibot)
        requestedBy: '',
        createdAt: 0,
        lastConnected: 0,
        expire: 0,                              // 0 = permanen
        selfMode: true,
        botSettings: {},                        // pengaturan online/mengetik/dll milik jadibot ini
        autoReply: null,                        // { enabled, rules:[{key,reply}], fallback } dari panel web
        status: 'pairing',                      // pairing | open | closed | failed | expired
        reconnects: 0,
        lastDurationMs: 0,                      // durasi pembelian terakhir (untuk tombol Perpanjang)
        tier: 'paid'                           // paid | free | privileged; sesi lama dianggap paid
    }),

    base: () => ({
        meta: { schemaVersion: SCHEMA_VERSION, createdAt: Date.now(), updatedAt: 0 },
        settings: {
            bannedWords: [],
            maintenance: false,
            panic: false,                       // kill switch dari web panel: abaikan semua pesan kecuali root owner
            totalCommandsRun: 0,
            promotions: { freeJadibot: false, freeSlots: 0, discounts: { jadibot: 0, rent: 0, prem: 0 } },
            bot: {}                             // pengaturan bot utama (lib/botSettings.js)
        },
        users: {},
        groups: {},
        jadibots: {},
        guilds: {},                             // guild RPG
        parties: {},                            // party RPG (sesi berburu bersama)
        seasons: {},                            // progres season RPG per kunci bulan
        orders: {},                             // transaksi pembayaran (KiPay)
        reminders: {},                          // status pengingat masa aktif (lib/renewal.js)
        stats: { messages: 0, commands: 0, startCount: 0, commandUsage: {}, traffic: {} }
    })
};

/* ───────────────────────── INTERNAL ───────────────────────── */

let data = null;
let timer = null;
let dirty = false;
let writing = false;

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Lengkapi field yang hilang tanpa menimpa data yang sudah ada. */
function fillDefaults(target, defaults) {
    for (const key of Object.keys(defaults)) {
        if (target[key] === undefined || target[key] === null) target[key] = clone(defaults[key]);
        else if (isPlainObject(defaults[key]) && isPlainObject(target[key])) fillDefaults(target[key], defaults[key]);
    }
    return target;
}

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function load() {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    let loaded = fs.existsSync(DB_PATH) ? readJson(DB_PATH) : null;
    if (!loaded && fs.existsSync(DB_PATH)) {
        logWarn('DATABASE', 'db.json rusak, mencoba memulihkan dari db.json.bak ...');
        loaded = readJson(BAK_PATH);
        if (loaded) logInfo('DATABASE', 'Berhasil dipulihkan dari backup.');
        else {
            fs.copyFileSync(DB_PATH, `${DB_PATH}.corrupt-${Date.now()}`);
            logError('DATABASE', 'Backup juga rusak. File lama disimpan sebagai .corrupt, database baru dibuat.');
        }
    }
    data = fillDefaults(loaded || templates.base(), templates.base());
    migrate();
    data.meta.schemaVersion = SCHEMA_VERSION;
    data.stats.startCount++;
    markDirty();
    logInfo('DATABASE', `Dimuat: ${Object.keys(data.users).length} user, ${Object.keys(data.groups).length} grup`);
    return data;
}

function markDirty() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => { timer = null; save().catch(() => {}); }, config.database.saveDelayMs);
    if (timer.unref) timer.unref();
}

async function save(force = false) {
    if (!data || (!dirty && !force)) return;
    if (writing) { markDirty(); return; }
    writing = true;
    dirty = false;
    try {
        data.meta.updatedAt = Date.now();
        const tmp = DB_PATH + '.tmp';
        
        // FIX: Pastikan direktori selalu ada sebelum menulis file sementara
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        await fs.promises.writeFile(tmp, JSON.stringify(data));
        if (config.database.autoBackup && fs.existsSync(DB_PATH)) await fs.promises.copyFile(DB_PATH, BAK_PATH);
        await fs.promises.rename(tmp, DB_PATH);
        logDebug('DATABASE', 'Tersimpan');
    } catch (err) {
        dirty = true;
        logError('DATABASE', err);
    } finally { writing = false; }
}

/** Simpan sinkron (dipakai saat proses akan berhenti). */
function saveSync() {
    if (!data) return;
    try {
        data.meta.updatedAt = Date.now();
        
        // FIX: Pastikan direktori selalu ada sebelum menulis sinkron
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(DB_PATH + '.tmp', JSON.stringify(data));
        fs.renameSync(DB_PATH + '.tmp', DB_PATH);
        dirty = false;
    } catch (err) { logError('DATABASE', err); }
}

/* ───────────────────────── API ───────────────────────── */

function getUser(idOrJid, info = {}) {
    const number = numberOf(idOrJid);
    if (!number) return null;
    const now = Date.now();
    let u = data.users[number];
    if (!u) {
        u = data.users[number] = templates.user(number);
        u.createdAt = now;
        u.stats.firstSeen = now;
    } else fillDefaults(u, templates.user(number));

    if (info.jid && info.jid.endsWith('@s.whatsapp.net')) u.jid = info.jid;
    if (info.lid) u.lid = info.lid;
    if (info.name && info.name !== u.name) {
        u.name = info.name;
        if (!u.names.includes(info.name)) { u.names.push(info.name); if (u.names.length > 5) u.names.shift(); }
    }

    u.limit.max = config.limit.daily;                                  // selalu ikut config (mis. 50)
    const today = dateKey();
    if (u.limit.lastReset !== today) { u.limit.used = 0; u.limit.lastReset = today; }
    if (u.premium.active && u.premium.expire && u.premium.expire < now) { u.premium.active = false; u.role = 'user'; }

    u.stats.lastSeen = now;
    u.updatedAt = now;
    markDirty();
    return u;
}

function getGroup(jid, info = {}) {
    if (!jid || !jid.endsWith('@g.us')) return null;
    const now = Date.now();
    let g = data.groups[jid];
    if (!g) {
        g = data.groups[jid] = templates.group(jid);
        g.createdAt = now;
    } else fillDefaults(g, templates.group(jid));

    if (info.name) g.name = info.name;
    if (info.owner) g.owner = info.owner;
    if (info.description !== undefined) g.description = info.description || '';
    if (info.size) g.size = info.size;
    if (g.rent.active && g.rent.expire && g.rent.expire < now) { g.rent.active = false; g.rent.expiredPending = true; }   // diproses lib/rental.js (pamit & keluar)
    g.updatedAt = now;
    markDirty();
    return g;
}

function getJadibot(number) {
    let j = data.jadibots[number];
    if (!j) { j = data.jadibots[number] = templates.jadibot(number); j.createdAt = Date.now(); }
    else fillDefaults(j, templates.jadibot(number));
    markDirty();
    return j;
}

function removeJadibot(number) { delete data.jadibots[number]; markDirty(); }

/**
 * Catat trafik ke bucket per jam (kunci "YYYY-MM-DD HH").
 * Hanya angka agregat — tidak menyimpan siapa pengirimnya.
 * Disimpan maksimal 96 jam (~4 hari) supaya file database tidak membengkak.
 */
const TRAFFIC_KEEP_HOURS = 192;   // 8 hari — cukup untuk heatmap 7×24

function bumpTraffic(kind) {
    const st = data.stats;
    if (!st.traffic) st.traffic = {};
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}`;
    const row = st.traffic[key] || (st.traffic[key] = { messages: 0, commands: 0 });
    row[kind]++;

    const keys = Object.keys(st.traffic);
    if (keys.length > TRAFFIC_KEEP_HOURS) {
        keys.sort();
        for (const k of keys.slice(0, keys.length - TRAFFIC_KEEP_HOURS)) delete st.traffic[k];
    }
}

/** Riwayat trafik per jam, urut lama → baru, maksimal `hours` jam terakhir. */
function trafficSeries(hours = 24) {
    const rows = data.stats?.traffic || {};
    const out = [];
    const now = new Date();
    const start = new Date(now.getTime());
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() - (hours - 1));

    for (let i = 0; i < hours; i++) {
        const d = new Date(start.getTime() + i * 3600_000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}`;
        const r = rows[key] || {};
        out.push({
            key,
            label: `${String(d.getHours()).padStart(2, '0')}:00`,
            messages: r.messages || 0,
            commands: r.commands || 0
        });
    }
    return out;
}

function recordCommand({ user, group, command }) {
    const now = Date.now();
    data.stats.commands++;
    bumpTraffic('commands');
    data.stats.commandUsage[command] = (data.stats.commandUsage[command] || 0) + 1;
    if (user) {
        user.stats.commands++;
        user.stats.lastCommand = command;
        user.stats.lastCommandAt = now;
        user.commandUsage[command] = (user.commandUsage[command] || 0) + 1;
        user.exp += 5;
        const need = user.level * 100;
        if (user.exp >= need) { user.exp -= need; user.level++; }
    }
    if (group) group.stats.commands++;
    markDirty();
}

function recordMessage({ user, group }) {
    data.stats.messages++;
    bumpTraffic('messages');
    if (user) user.stats.messages++;
    if (group) {
        group.stats.messages++;
        group.stats.lastActive = Date.now();
        const n = user?.number;
        if (n) group.stats.topUsers[n] = (group.stats.topUsers[n] || 0) + 1;
    }
    markDirty();
}

/** Premium aktif? (belum lewat masa berlaku) */
const isPremium = (user) => Boolean(user?.premium?.active && (!user.premium.expire || user.premium.expire > Date.now()));

/* ───────────────────────── timeline insiden jadibot ───────────────────────── */

const BOT_EVENTS_MAX = 40;

/** Catat satu kejadian jadibot (online/offline/pairing/expired/error/deleted). */
function addBotEvent(number, type, note = '') {
    if (!number) return;
    data.botEvents = data.botEvents || {};
    const key = String(number);
    const list = data.botEvents[key] || (data.botEvents[key] = []);
    list.unshift({ at: Date.now(), type: String(type || 'info'), note: String(note || '').slice(0, 200) });
    if (list.length > BOT_EVENTS_MAX) list.length = BOT_EVENTS_MAX;
    markDirty();
}

function listBotEvents(number, limit = 30) {
    const list = (data.botEvents || {})[String(number)] || [];
    return list.slice(0, Math.max(1, Math.min(BOT_EVENTS_MAX, limit)));
}

/* ───────────────────────── analitik command ───────────────────────── */

/** Top command paling dipakai (dari stats.commandUsage). */
function topCommands(limit = 10) {
    const usage = data.stats?.commandUsage || {};
    return Object.entries(usage)
        .map(([command, count]) => ({ command, count: Number(count) || 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, Math.max(1, Math.min(25, Number(limit) || 10)));
}

/* ───────────────────────── audit log (riwayat pengaturan) ───────────────────────── */

const AUDIT_MAX = 200;

/** Catat satu perubahan pengaturan. before/after harus JSON-able agar bisa di-revert. */
function addAudit(actor, action, before, after, { revertable = true } = {}) {
    data.audit = data.audit || [];
    data.auditSeq = data.auditSeq || 0;
    data.audit.unshift({
        id: ++data.auditSeq,
        at: Date.now(),
        actor: String(actor || '-'),
        action: String(action || '-'),
        before: before === undefined ? null : before,
        after: after === undefined ? null : after,
        revertable: Boolean(revertable)
    });
    if (data.audit.length > AUDIT_MAX) data.audit.length = AUDIT_MAX;
    markDirty();
}

function listAudit(limit = 100) {
    return (data.audit || []).slice(0, Math.max(1, Math.min(AUDIT_MAX, limit)));
}

function getAuditEntry(id) {
    return (data.audit || []).find((a) => a.id === Number(id)) || null;
}

/* ───────────────────────── riwayat saldo (ledger) ───────────────────────── */

const LEDGER_MAX = 60;               // maks entri riwayat per nomor

/**
 * Catat satu perubahan saldo ke riwayat (data.ledger[nomor]).
 * @param {string} waNumber nomor pemilik saldo (62xxx)
 * @param {{kind:string, amount:number, balanceAfter?:number, note?:string, ref?:string}} e
 *   kind: topup | jadibot | premium | referral | admin | refund
 */
function addLedger(waNumber, { kind, amount, balanceAfter = null, note = '', ref = '' }) {
    const n = numberOf(waNumber);
    if (!n || !Number.isFinite(Number(amount)) || Number(amount) === 0) return null;
    data.ledger = data.ledger || {};
    const list = data.ledger[n] || (data.ledger[n] = []);
    list.push({
        kind: String(kind || 'lain'),
        amount: Math.round(Number(amount)),
        balanceAfter: balanceAfter === null ? null : Math.round(Number(balanceAfter)),
        note: String(note || '').slice(0, 120),
        ref: String(ref || '').slice(0, 40),
        at: Date.now()
    });
    if (list.length > LEDGER_MAX) list.splice(0, list.length - LEDGER_MAX);
    markDirty();
    return true;
}

/** Riwayat saldo satu nomor, terbaru dulu. */
function listLedger(waNumber, limit = 40) {
    const n = numberOf(waNumber);
    const list = (n && data.ledger?.[n]) || [];
    return list.slice(-Math.max(1, Math.min(LEDGER_MAX, Number(limit) || 40))).reverse();
}

/**
 * Migrasi ringan antar versi skema. Dipanggil saat load(); aman diulang
 * dan tidak pernah menghapus data yang sudah ada.
 */
function migrate() {
    const from = Number(data.meta.schemaVersion) || 1;
    if (from >= SCHEMA_VERSION) return;

    // v1 -> v2: pastikan setiap user punya slot rpg (null = belum mendaftar RPG)
    for (const u of Object.values(data.users)) {
        if (u.rpg === undefined) u.rpg = null;
    }

    // v2 -> v3: lengkapi profil RPG lama dengan field sistem baru
    // (party, guild, pet, craft, enchant, buffs, achievements, prestige, dll.)
    if (from < 3) {
        let rpg = null;
        try { rpg = require('./rpg/core'); } catch { rpg = null; }
        if (rpg) {
            for (const u of Object.values(data.users)) {
                if (u.rpg) u.rpg = rpg.syncProfile(u.rpg);
            }
        }
        // pastikan koleksi global ada
        data.guilds = data.guilds || {};
        data.parties = data.parties || {};
        data.seasons = data.seasons || {};
    }

    data.meta.schemaVersion = SCHEMA_VERSION;
    logInfo('DATABASE', `Migrasi skema v${from} -> v${SCHEMA_VERSION} selesai.`);
    markDirty();
}

/**
 * Ambil profil RPG user, membuatnya bila belum ada.
 * @param {object} user  objek user dari getUser()
 * @param {object} create  nilai awal profil (dari lib/rpg.js createProfile)
 */
function ensureRpg(user, create) {
    if (!user) return null;
    if (!user.rpg) {
        user.rpg = typeof create === 'function' ? create(user) : (create || null);
        markDirty();
    }
    return user.rpg;
}

function summary() {
    return {
        users: Object.keys(data.users).length,
        groups: Object.keys(data.groups).length,
        jadibots: Object.keys(data.jadibots).length,
        commands: data.stats.commands,
        messages: data.stats.messages
    };
}

const api = {
    load, save, saveSync, markDirty, getUser, getGroup, getJadibot, removeJadibot,
    recordCommand, recordMessage, summary, trafficSeries, templates, isPremium, ensureRpg, migrate,
    addLedger, listLedger,
    addAudit, listAudit, getAuditEntry,
    addBotEvent, listBotEvents, topCommands, createVoucher, listVouchers, deleteVoucher, redeemVoucher, recordBotMessage, botMessageStats, addScheduled, listScheduled, deleteScheduled,
    get data() { return data; }
};

process.on('exit', () => saveSync());

/* ───────────────────────── statistik pesan per jadibot ───────────────────────── */

/** Catat pesan masuk/keluar per jadibot, per hari (simpan 14 hari terakhir). */
function recordBotMessage(number, dir) {
    const rec = data.jadibots?.[number];
    if (!rec) return;
    rec.msgStats = rec.msgStats || {};
    const k = dateKey();
    rec.msgStats[k] = rec.msgStats[k] || { in: 0, out: 0 };
    rec.msgStats[k][dir] = (rec.msgStats[k][dir] || 0) + 1;
    // buang hari > 14
    const keys = Object.keys(rec.msgStats).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - 14))) delete rec.msgStats[old];
    markDirty();
}

/** Statistik 7 hari terakhir: [{date, in, out}] lama → baru. */
function botMessageStats(number, days = 7) {
    const rec = data.jadibots?.[number];
    const rows = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const k = dateKey(d);
        rows.push({ date: k, in: rec?.msgStats?.[k]?.in || 0, out: rec?.msgStats?.[k]?.out || 0 });
    }
    return rows;
}

/* ───────────────────────── pesan terjadwal ───────────────────────── */

function addScheduled({ number, jid, text, at, repeat = 'none', createdBy = '' }) {
    data.scheduled = data.scheduled || [];
    const item = {
        id: (data.schedSeq = (data.schedSeq || 0) + 1),
        number: String(number || '').replace(/[^0-9]/g, ''),
        jid: String(jid || ''),
        text: String(text || '').slice(0, 4000),
        at: Number(at) || Date.now(),
        repeat: repeat === 'daily' ? 'daily' : 'none',
        createdBy: String(createdBy || ''),
        status: 'pending',                      // pending | sent | missed
        sentAt: 0,
        tries: 0,
        createdAt: Date.now()
    };
    data.scheduled.unshift(item);
    if (data.scheduled.length > 100) data.scheduled.length = 100;
    markDirty();
    return item;
}

function listScheduled(number) {
    const rows = (data.scheduled || []).filter((x) => !number || x.number === String(number).replace(/[^0-9]/g, ''));
    return rows.slice(0, 50);
}

function deleteScheduled(id, number) {
    const before = (data.scheduled || []).length;
    data.scheduled = (data.scheduled || []).filter((x) => !(x.id === Number(id) && (!number || x.number === String(number).replace(/[^0-9]/g, ''))));
    markDirty();
    return (data.scheduled || []).length < before;
}

/* ───────────────────────── voucher topup ───────────────────────── */

function createVoucher({ code, amount, maxUses = 1, expiresDays = 0, createdBy = '' }) {
    data.vouchers = data.vouchers || [];
    const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
    if (clean.length < 4) throw new Error('Kode voucher minimal 4 karakter (huruf/angka).');
    if (data.vouchers.some((v) => v.code === clean)) throw new Error('Kode voucher sudah dipakai.');
    const amountN = Math.floor(Number(amount) || 0);
    if (amountN < 1000 || amountN > 5000000) throw new Error('Nominal voucher Rp1.000 – Rp5.000.000.');
    const v = {
        code: clean,
        amount: amountN,
        maxUses: Math.max(1, Math.min(999, Math.floor(Number(maxUses) || 1))),
        uses: 0,
        expiresAt: expiresDays > 0 ? Date.now() + expiresDays * 86400000 : 0,
        createdBy: String(createdBy || ''),
        createdAt: Date.now()
    };
    data.vouchers.unshift(v);
    if (data.vouchers.length > 200) data.vouchers.length = 200;
    markDirty();
    return v;
}

function listVouchers(limit = 50) {
    return (data.vouchers || []).slice(0, Math.max(1, Math.min(200, limit)));
}

function deleteVoucher(code) {
    const clean = String(code || '').toUpperCase().trim();
    const before = (data.vouchers || []).length;
    data.vouchers = (data.vouchers || []).filter((v) => v.code !== clean);
    markDirty();
    return (data.vouchers || []).length < before;
}

function redeemVoucher(code, waNumber) {
    data.vouchers = data.vouchers || [];
    const clean = String(code || '').toUpperCase().trim();
    const v = data.vouchers.find((x) => x.code === clean);
    if (!v) return { ok: false, error: 'Kode voucher tidak ditemukan.' };
    if (v.expiresAt && Date.now() > v.expiresAt) return { ok: false, error: 'Voucher sudah kadaluarsa.' };
    if (v.uses >= v.maxUses) return { ok: false, error: 'Voucher sudah habis dipakai.' };
    v.uses++;
    markDirty();
    return { ok: true, amount: v.amount, code: v.code };
}

module.exports = api;
