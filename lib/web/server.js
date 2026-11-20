/**
 * WEB PANEL — backend HTTP server.
 *
 * Disajikan di /panel pada port yang sama dengan keep-alive.
 *
 * Akun web disimpan di database/webpanel.db (SQLite, lib/web/store.js):
 *   • daftar dengan email + password
 *   • login dengan Google / GitHub (OAuth 2.0)
 *
 * Data bot (jadibot, saldo, order) tetap diambil langsung dari lib/database.js
 * supaya angka di panel selalu sama dengan yang dilihat bot.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const config = require('../../config');
const db = require('../data/database');
const jadibot = require('../bot/jadibotManager');
const payment = require('../billing/payment');
const promotions = require('../billing/promotions');
const store = require('./store');
const auth = require('./auth');
const otp = require('./otp');
const referral = require('./referral');
const guard = require('./guard');
const logbus = require('./logbus');
const webhook = require('./webhook');
const dailyReport = require('../billing/notify');
const backup = require('../bot/backup');
const scheduler = require('../bot/jadibotManager');
const chatNotify = require('../billing/notify');
const passkey = require('./passkey');
const runtimeSettings = require('../core/runtimeSettings');
const sysinfo = require('../services/sysinfo');
const { numberOf, rupiah, formatDateTime, runtime, parseDuration } = require('../core/utils');
const { logInfo, logWarn, logError } = require('../core/logger');

const PUBLIC_DIR = path.join(__dirname, 'public');
const JS_DIR = path.join(PUBLIC_DIR, 'js');
const COOKIE = 'mz_session';

/* ───────────────────────── bundle app.js ─────────────────────────
 * Sumber klien dipecah menjadi public/js/*.js (satu modul = satu tanggung
 * jawab) supaya mudah dirawat. Browser tetap memuat SATU file: server
 * menggabungkannya berurutan sesuai awalan angka pada nama file.
 *
 * Hasil gabungan di-cache dan hanya dibangun ulang bila ada modul yang
 * mtime-nya berubah — jadi biaya I/O nol pada request berikutnya.
 */
let _bundle = { mtime: 0, body: null };

function buildAppBundle() {
    let files;
    try {
        files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
    } catch {
        return null;
    }
    if (!files.length) return null;
    let newest = 0;
    const parts = [];
    for (const f of files) {
        const full = path.join(JS_DIR, f);
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        if (st.mtimeMs > newest) newest = st.mtimeMs;
        parts.push(fs.readFileSync(full, 'utf8'));
    }
    if (!parts.length) return null;
    return { mtime: newest, body: Buffer.from(parts.join('\n;\n'), 'utf8') };
}

/** Bundle terbaru, dibangun ulang hanya bila mtime berubah. */
function appBundle() {
    const fresh = buildAppBundle();
    if (!fresh) return _bundle.body;
    if (_bundle.body && fresh.mtime === _bundle.mtime) return _bundle.body;
    _bundle = fresh;
    return _bundle.body;
}

/* ───────────────────────── helpers ───────────────────────── */

const normNumber = (n) => String(n || '').replace(/[^0-9]/g, '');
const isRoot = (number) => (config.ownerNumber || []).map(normNumber).includes(normNumber(number));

function json(res, code, obj) {
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'                  // data API tidak boleh dicache (bisa memuat data pribadi)
    });
    res.end(JSON.stringify(obj));
}

/* ───────────────────────── kompresi (gzip / brotli) ─────────────────────────
 * Panel mengirim ~323 KB HTML+JS+CSS. Tanpa kompresi itu diunduh mentah dan
 * terasa sangat lambat di jaringan seluler. Dengan brotli turun ke ~75 KB.
 *
 * Hasil kompresi disimpan di memori dan dikunci pada mtime file: selama file
 * tidak berubah, tidak ada kompresi ulang (biaya CPU nol setelah request
 * pertama). Cache dibatasi jumlah entri supaya memori tetap kecil.
 */
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.webmanifest', '.txt']);
const COMPRESS_MIN_BYTES = 1024;          // di bawah ini tidak sepadan
const COMPRESS_CACHE_MAX = 64;
const _compCache = new Map();             // key -> { mtime, gzip, br }

/** Pilih encoding terbaik yang didukung klien. */
function pickEncoding(req) {
    const ae = String(req.headers['accept-encoding'] || '').toLowerCase();
    if (/\bbr\b/.test(ae)) return 'br';
    if (/\bgzip\b/.test(ae)) return 'gzip';
    return null;
}

/**
 * Kompres buffer dengan encoding tertentu, memakai cache berbasis mtime.
 * @returns {Buffer|null} null bila tidak perlu/tidak bisa dikompresi.
 */
function compressCached(key, mtime, buf, encoding) {
    let entry = _compCache.get(key);
    if (!entry || entry.mtime !== mtime) {
        entry = { mtime, gzip: null, br: null };
        _compCache.set(key, entry);
        if (_compCache.size > COMPRESS_CACHE_MAX) {
            // buang entri tertua (Map menjaga urutan penyisipan)
            const oldest = _compCache.keys().next().value;
            if (oldest !== undefined && oldest !== key) _compCache.delete(oldest);
        }
    }
    if (entry[encoding]) return entry[encoding];
    try {
        if (encoding === 'br') {
            entry.br = zlib.brotliCompressSync(buf, {
                params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 9,   // 9 = cepat, ukuran hampir sama dengan 11
                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length
                }
            });
            return entry.br;
        }
        entry.gzip = zlib.gzipSync(buf, { level: 9 });
        return entry.gzip;
    } catch {
        return null;
    }
}

/** Kirim buffer dengan kompresi bila layak. Menangani HEAD & Vary dengan benar. */
function sendCompressed(req, res, status, headers, buf, cacheKey, mtime) {
    const ext = path.extname(cacheKey || '');
    const enc = COMPRESSIBLE.has(ext) && buf.length >= COMPRESS_MIN_BYTES ? pickEncoding(req) : null;
    if (!enc) {
        headers['Content-Length'] = buf.length;
        res.writeHead(status, headers);
        return res.end(req.method === 'HEAD' ? undefined : buf);
    }
    const packed = compressCached(cacheKey, mtime, buf, enc);
    if (!packed) {
        headers['Content-Length'] = buf.length;
        res.writeHead(status, headers);
        return res.end(req.method === 'HEAD' ? undefined : buf);
    }
    headers['Content-Encoding'] = enc;
    headers['Content-Length'] = packed.length;
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : packed);
}

/**
 * JSON dengan kompresi. Payload monitor/sistem bisa puluhan KB; di jaringan
 * seluler itu terasa. Data tetap tidak dicache (no-store), hanya dipadatkan.
 * Tidak memakai cache karena isinya selalu berubah.
 */
function sendJson(req, res, code, obj) {
    const buf = Buffer.from(JSON.stringify(obj));
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    };
    const enc = buf.length >= COMPRESS_MIN_BYTES ? pickEncoding(req) : null;
    if (!enc) {
        headers['Content-Length'] = buf.length;
        res.writeHead(code, headers);
        return res.end(buf);
    }
    try {
        const packed = enc === 'br'
            ? zlib.brotliCompressSync(buf, {
                params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 5,   // JSON dinamis: cepat dulu
                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length
                }
            })
            : zlib.gzipSync(buf, { level: 6 });
        headers['Content-Encoding'] = enc;
        headers['Content-Length'] = packed.length;
        headers['Vary'] = 'Accept-Encoding';
        res.writeHead(code, headers);
        return res.end(packed);
    } catch {
        headers['Content-Length'] = buf.length;
        res.writeHead(code, headers);
        return res.end(buf);
    }
}

function parseCookies(req) {
    const raw = req.headers.cookie || '';
    const out = {};
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

function setCookie(res, name, value, maxAgeSec, secure) {
    const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (secure) bits.push('Secure');
    res.setHeader('Set-Cookie', bits.join('; '));
}

/** Token dari header Authorization atau cookie sesi. */
function readToken(req) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
    const c = parseCookies(req);
    return c[COOKIE] || '';
}

function clientIp(req) {
    // X-Forwarded-For hanya dipercaya bila koneksi langsung datang dari loopback/jaringan privat
    // (reverse proxy di mesin yang sama). Dari internet langsung, header itu bisa dipalsukan
    // untuk memutar rate limit & lockout brute-force.
    const ra = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    const privatePeer = !ra || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$)/.test(ra);
    if (privatePeer) {
        const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        if (fwd) return fwd;
    }
    return ra;
}

function bodyParser(req) {
    // impor sesi jadibot membawa kontainer base64 hingga ~11 MB — batas khusus untuk route itu
    const isImport = (req.url || '').startsWith('/api/jadibot/import');
    const max = isImport ? 14e6 : 2e6;
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > max) req.destroy(); });
        req.on('end', () => {
            if (!raw) return resolve({});
            const ct = req.headers['content-type'] || '';
            if (ct.includes('application/json')) {
                try { return resolve(JSON.parse(raw)); } catch { return resolve({}); }
            }
            try { resolve(Object.fromEntries(new URLSearchParams(raw))); } catch { resolve({}); }
        });
    });
}

/* ───────────────────────── data views ───────────────────────── */

function botSelf() {
    return {
        botName: config.botName,
        version: config.version,
        ownerNumbers: (config.ownerNumber || []).map(normNumber),   // tidak dibocorkan ke klien panel
        prefix: config.prefix,
        maxJadibot: runtimeSettings.jadibotMax(),
        maxPerUser: runtimeSettings.jadibotMaxPerUser()
    };
}

function jadibotView(j) {
    const rec = db.data.jadibots?.[j.number] || {};
    return {
        number: j.number,
        owner: j.owner,
        name: j.name,
        state: j.state,
        connected: Boolean(j.connected),
        selfMode: j.selfMode !== false,
        uptime: j.uptime || 0,
        uptimeText: j.uptime ? runtime(j.uptime) : '-',
        attempts: j.attempts || 0,
        pairingCode: j.pairingCode || '',                      // hanya untuk owner yang mengelola
        pairingCustom: Boolean(j.pairingCustom),
        expire: j.expire || 0,
        expireText: j.expire ? formatDateTime(new Date(j.expire)) : 'Permanen',
        tier: rec.tier || 'paid',
        status: rec.status || j.state,
        health: healthScore(j, rec)
    };
}

/**
 * Skor kesehatan 0-100 per jadibot: gabungan status koneksi, riwayat reconnect,
 * usia sesi, dan masa aktif. Ditampilkan sebagai badge di monitor.
 */
function healthScore(j, rec) {
    let score = 100;
    if (!j.connected) score -= 25;
    if (j.attempts > 0) score -= Math.min(20, j.attempts * 5);
    const reconnects = rec.reconnects || 0;
    if (reconnects > 0) score -= Math.min(15, reconnects * 3);
    const st = rec.status || j.state;
    if (st === 'failed' || st === 'expired') score -= 30;
    if (j.expire && j.expire < Date.now() + 3 * 86400000) score -= 10;   // segera habis
    const lastSeen = rec.lastConnected || j.lastConnected || 0;
    if (lastSeen && Date.now() - lastSeen > 7 * 86400000) score -= 15;
    score = Math.max(0, Math.min(100, score));
    const label = score >= 80 ? 'SEHAT' : score >= 60 ? 'CUKUP' : 'RENTAN';
    return { score, label };
}

function userView(waNumber) {
    const n = normNumber(waNumber);
    const u = n ? db.data.users?.[n] : null;
    if (!u) {
        return {
            number: n, name: '', role: 'user', premium: false, premiumText: 'Tidak aktif',
            level: 1, balance: 0, balanceText: rupiah(0),
            limit: { used: 0, max: config.limit.daily },
            stats: { messages: 0, commands: 0 },
            registered: false
        };
    }
    const premium = Boolean(u.premium?.active && (!u.premium.expire || u.premium.expire > Date.now()));
    return {
        number: u.number,
        name: u.name || '',
        role: isRoot(n) ? 'owner' : (u.role || 'user'),
        premium,
        premiumText: premium ? (u.premium.expire ? formatDateTime(new Date(u.premium.expire)) : 'Permanen') : 'Tidak aktif',
        level: u.level || 1,
        balance: u.money || 0,
        balanceText: rupiah(u.money || 0),
        limit: { used: u.limit?.used || 0, max: u.limit?.max || config.limit.daily },
        stats: { messages: u.stats?.messages || 0, commands: u.stats?.commands || 0 },
        registered: Boolean(u.registered)
    };
}

function ordersView(waNumber) {
    const n = normNumber(waNumber);
    if (!n) return [];
    return payment.ownOrders(n).map((o) => ({
        trxId: o.trxId,
        type: o.type,
        kind: o.kind || '',
        target: o.target || o.targetKey || '',
        targetLabel: o.targetLabel || '',
        status: o.status,
        statusLabel: (payment.STATUS_LABEL[o.status] || o.status).replace(/^[^\w]+/, ''),
        amount: o.amount,
        amountText: rupiah(o.amount),
        credit: o.credit || 0,
        durationMs: o.durationMs,
        createdAt: o.createdAt,
        createdText: formatDateTime(new Date(o.createdAt)),
        expiresAt: o.expiresAt
    }));
}

const TOPUP_CUSTOM_MIN = 1000;        // batas nominal topup custom
const TOPUP_CUSTOM_MAX = 5000000;

function topupPackages() {
    return [
        { id: 't5', pay: 5000, credit: 5500, label: 'Rp 5.000' },
        { id: 't10', pay: 10000, credit: 11500, label: 'Rp 10.000' },
        { id: 't25', pay: 25000, credit: 29000, label: 'Rp 25.000' },
        { id: 't50', pay: 50000, credit: 60000, label: 'Rp 50.000' },
        { id: 't100', pay: 100000, credit: 125000, label: 'Rp 100.000' }
    ];
}

function priceTable() {
    const rows = [];
    for (const p of runtimeSettings.packages()) {
        const q = promotions.quote('jadibot', p.price);
        rows.push({ id: String(p.days), label: p.label, days: p.days, price: q.price, priceText: rupiah(q.price), percent: q.percent });
    }
    return {
        rows,
        perDay: runtimeSettings.perDay(),
        perDayText: rupiah(runtimeSettings.perDay()),
        minDays: runtimeSettings.priceConfig().minDays ?? 1,
        maxDays: runtimeSettings.priceConfig().maxDays ?? 3650,
        discount: promotions.discount('jadibot'),
        prem: premView(),
        maxPerUser: runtimeSettings.jadibotMaxPerUser(),
        max: runtimeSettings.jadibotMax(),
        slotsUsed: jadibot.jadibotSessions.size,
        freeForOwner: config.jadibot.freeForOwner,
        freeForPremium: config.jadibot.freeForPremium
    };
}

/* ───────────────────────── premium ───────────────────────── */

/** Harga premium per hari (config.premium). */
const premPerDay = () => Number(config.premium?.price?.perDay) || 2000;

/** Daftar paket premium untuk panel web. */
function premiumPackages() {
    const perDay = premPerDay();
    const disc = promotions.discount('prem');
    return [7, 30, 90, 365].map((days) => {
        const base = perDay * days;
        const q = promotions.quote('prem', base);
        return {
            id: String(days),
            days,
            label: days === 365 ? '1 Tahun' : `${days} Hari`,
            base, baseText: rupiah(base),
            price: q.price, priceText: rupiah(q.price), percent: q.percent
        };
    });
}

/** Status premium akun panel (dibaca dari data user bot milik nomor WA-nya). */
function premView() {
    const perDay = premPerDay();
    return {
        enabled: config.premium?.enabled !== false,
        perDay,
        perDayText: rupiah(perDay),
        discount: promotions.discount('prem'),
        packages: premiumPackages()
    };
}

/** Status premium user bot untuk nomor WA tertentu. */
function myPremium(waNumber) {
    const n = normNumber(waNumber);
    const u = n ? db.data.users?.[n] : null;
    if (!u) return { active: false, activeText: 'Tidak aktif', expire: 0, expireText: '-', unlimited: false };
    const active = db.isPremium(u);
    const expire = u.premium?.expire || 0;
    return {
        active,
        activeText: active ? 'Aktif' : 'Tidak aktif',
        expire,
        expireText: !active ? '-' : (expire ? formatDateTime(new Date(expire)) : 'Selamanya'),
        since: u.premium?.since || 0,
        unlimited: active
    };
}

/**
 * Gratis untuk layanan tertentu? Mengikuti blok config masing-masing layanan:
 *   jadibot → config.jadibot.freeForOwner / freeForPremium
 *   premium → config.premium.freeForOwner / freeForPremium
 * Owner panel selalu gratis kecuali flag-nya dimatikan eksplisit (=== false).
 */
function isFreeFor(kind, acc) {
    const cfg = kind === 'premium' ? config.premium : config.jadibot;
    // role owner panel hanya diberikan lewat verifikasi nomor WA (lib/web/auth.js → confirmWaLink)
    if (acc?.role === 'owner') return cfg?.freeForOwner !== false;
    const wa = normNumber(acc?.wa_number);
    if (!wa || !acc?.wa_verified) return false;
    if (cfg?.freeForPremium) {
        const u = db.data.users?.[wa];
        if (u && db.isPremium(u)) return true;
    }
    return false;
}

/** Alias lama: gratis jadibot (dipakai endpoint jadibot & premium). */
function isFreeAccount(acc) {
    return isFreeFor('jadibot', acc);
}

/** Gerbang admin: hanya role owner panel (diberikan lewat verifikasi nomor root owner) yang boleh lewat. */
function requireOwner(acc) {
    if (acc?.role !== 'owner') throw new Error('Khusus Root Owner.');
    return true;
}

const isAdmin = (acc) => { try { return Boolean(requireOwner(acc)); } catch { return false; } };

/** Ringkasan monitor untuk dashboard (/api/me) & halaman monitor — angka selalu sama. */
/** Nomor WA efektif: sub-akun memakai nomor induknya. */
function effectiveWa(acc) {
    if (acc.parent_id) {
        const parent = store.getAccountById(acc.parent_id);
        return normNumber(parent?.wa_number || '');
    }
    return normNumber(acc.wa_number);
}

function monitorFor(acc) {
    const all = jadibot.listAllJadibots();
    const mine = acc.role === 'owner' ? all : all.filter((j) => normNumber(j.owner) === effectiveWa(acc));
    const views = mine.map(jadibotView);
    return {
        summary: {
            total: views.length,
            online: views.filter((v) => v.connected).length,
            pairing: views.filter((v) => v.state === 'pairing').length,
            offline: views.filter((v) => !v.connected && v.state !== 'pairing').length,
            slotsUsed: jadibot.jadibotSessions.size,
            slotsMax: runtimeSettings.jadibotMax(),
            uptime: Math.floor(process.uptime()),
            uptimeText: runtime(Math.floor(process.uptime())),
            botMessages: db.data.stats?.messages || 0,
            botCommands: db.data.stats?.commands || 0,
            serviceEnabled: payment.isEnabled()
        },
        bots: views
    };
}

/** Jadibot milik akun web (lewat nomor WA yang tertaut). */
function myJadibots(acc) {
    const wa = effectiveWa(acc);
    const all = jadibot.listAllJadibots();
    if (acc.role === 'owner') return all.map(jadibotView);
    if (!wa) return [];
    return all.filter((j) => normNumber(j.owner) === wa).map(jadibotView);
}

/* ───────────────────────── routes ───────────────────────── */

const routes = {};

const route = (method, path, handler) => { routes[`${method} ${path}`] = handler; };

/* ── kesehatan & konfigurasi publik ── */

route('GET', '/api/health', async () => ({
    json: { status: 'online', botName: config.botName, version: config.version, uptime: Math.floor(process.uptime()) }
}));

route('GET', '/api/auth/providers', async () => ({
    json: { providers: auth.providerStatus(), localEnabled: Boolean(store.init()) }
}));

/* ── registrasi & login lokal ── */

/** Label akun untuk log console: email (+nomor WA). */
const accLabel = (acc) => `${acc?.email || '?'}${acc?.wa_number ? ` (+${normNumber(acc.wa_number)})` : ''}`;

route('POST', '/api/auth/register', async (ctx) => {
    if (!store.init()) return { status: 503, json: { error: 'Database panel tidak tersedia. Butuh Node 22+.' } };
    const { email, password, displayName, waNumber, otp: otpCode, refCode } = ctx.body || {};
    try {
        // Nomor WA wajib & harus lolos OTP — supaya akun langsung terhubung ke bot
        const number = otp.normalizeWa(waNumber);
        if (!number) throw new Error('Nomor WhatsApp wajib diisi.');
        if (!otp.isValidNumber(number)) throw new Error('Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.');

        // ── Kunci 1 akun per perangkat ──
        const device = referral.deviceHash(ctx.req);
        const existing = store.getAccountByWa(number);
        if (existing) throw new Error('Nomor WhatsApp itu sudah terdaftar. Silakan login.');
        const sameDevice = referral.deviceOwner(device);
        if (sameDevice) {
            throw new Error(
                'Perangkat (HP) ini sudah memiliki akun. Satu perangkat hanya boleh 1 akun — ' +
                'silakan login memakai akun yang sudah ada, atau hubungi owner bila ini keliru.'
            );
        }

        // validasi kode referral lebih dulu supaya tidak bayar/verifikasi OTP sia-sia
        let refInfo = null;
        if (refCode) refInfo = referral.resolveCode(refCode);

        if (!otpCode) throw new Error('Masukkan kode OTP yang dikirim ke WhatsApp-mu.');
        otp.verifyOtp(number, otpCode);

        const acc = auth.register({
            email, password, displayName,
            waNumber: number, waVerified: true,
            ownerList: config.ownerNumber
        });
        store.setDeviceHash(acc.id, device);
        referral.ensureCode(acc.id);

        // ── Referral: bonus saldo ──
        let refResult = null;
        if (refInfo) {
            try {
                refResult = referral.attachReferral({
                    code: refInfo.code, refereeAccount: acc,
                    refereeWa: number, deviceHash: device
                });
                if (refResult.status !== 'rejected') referral.payout(acc.id);
            } catch (e) { logWarn('REFERRAL', `Gagal proses referral: ${e.message}`); }
        }

        const token = auth.issueSession(acc, { ip: clientIp(ctx.req), ua: ctx.req.headers['user-agent'] });
        setCookie(ctx.res, COOKIE, token, Math.floor(auth.SESSION_TTL / 1000), ctx.secure);
        store.log(acc.id, 'register', `email+otp${refInfo ? ` ref=${refInfo.code}` : ''}`, clientIp(ctx.req));
        logInfo('WEB', `Registrasi panel: ${accLabel(acc)} dari IP ${clientIp(ctx.req)}${refInfo ? ` (ref ${refInfo.code})` : ''}`);
        return {
            json: {
                token, account: publicMe(store.getAccountById(acc.id) || acc),
                referral: refResult ? { status: refResult.status, reason: refResult.reason || '' } : null
            }
        };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* ── OTP WhatsApp untuk pendaftaran ── */

route('POST', '/api/auth/otp/send', async (ctx) => {
    const { waNumber } = ctx.body || {};
    try {
        const r = await otp.requestOtp(waNumber, { purpose: 'register' });
        return { json: { ok: true, number: r.number, ttlSec: r.ttlSec } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/** Cek kode tanpa mendaftar (opsional; daftar sendiri melakukan verifikasi). */
route('POST', '/api/auth/otp/verify', async (ctx) => {
    const { waNumber, otp: code } = ctx.body || {};
    try {
        const r = otp.verifyOtp(waNumber, code);
        return { json: { ok: true, number: r.number } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

route('POST', '/api/auth/login', async (ctx) => {
    if (!store.init()) return { status: 503, json: { error: 'Database panel tidak tersedia.' } };
    const { email, password, totp } = ctx.body || {};
    const ip = clientIp(ctx.req);
    const emailKey = String(email || '').toLowerCase().trim();

    // Lapis 2: lockout brute-force (5x salah → terkunci 15 menit, per email+IP)
    const locked = guard.lockedFor('login', emailKey, ip);
    if (locked) {
        store.log(null, 'login_locked', `${emailKey} (${Math.ceil(locked / 60)} menit)`, ip);
        return { status: 429, json: { error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(locked / 60)} menit.` } };
    }

    try {
        const { account, token } = auth.login({ email, password, totp, ip, ua: ctx.req.headers['user-agent'] });
        guard.clearFailures('login', emailKey, ip);
        logInfo('WEB', `Login panel: ${accLabel(account)} dari IP ${ip}`);
        setCookie(ctx.res, COOKIE, token, Math.floor(auth.SESSION_TTL / 1000), ctx.secure);
        return { json: { token, account: publicMe(account) } };
    } catch (err) {
        const lockedSec = guard.recordFailure('login', emailKey, ip);
        logWarn('WEB', `Login gagal: ${emailKey} dari IP ${ip} — ${err.message}`);
        const out = { error: err.message };
        if (err.needs2fa) out.needs2fa = true;
        if (lockedSec) out.error += ` (Akun terkunci ${Math.ceil(lockedSec / 60)} menit setelah ini.)`;
        // 422 untuk butuh-2FA supaya tidak kena cabang auto-logout 401 di app.js.
        return { status: err.needs2fa ? 422 : 401, json: out };
    }
});

/* ── lupa password: reset lewat OTP WhatsApp ke nomor terdaftar ── */

route('POST', '/api/auth/forgot', async (ctx) => {
    try {
        const number = otp.normalizeWa((ctx.body || {}).waNumber);
        if (!number) throw new Error('Nomor WhatsApp wajib diisi.');
        const acc = store.getAccountByWa(number);
        if (!acc || !acc.wa_verified) throw new Error('Nomor WhatsApp tidak terdaftar di panel.');
        const r = await otp.requestOtp(number, { purpose: 'reset' });
        store.log(acc.id, 'password_reset_request', `+${number}`, clientIp(ctx.req));
        return { json: { ok: true, number: r.number, ttlSec: r.ttlSec } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

route('POST', '/api/auth/reset', async (ctx) => {
    try {
        const { waNumber, otp: code, newPassword } = ctx.body || {};
        const number = otp.normalizeWa(waNumber);
        if (!number) throw new Error('Nomor WhatsApp wajib diisi.');
        if (!code) throw new Error('Masukkan kode OTP dari WhatsApp.');
        otp.verifyOtp(number, code, 'reset');
        const acc = auth.resetPassword(number, newPassword);
        // langsung loginkan setelah reset — pengguna tidak perlu mengetik ulang
        const token = auth.issueSession(acc, { ip: clientIp(ctx.req), ua: ctx.req.headers['user-agent'] });
        setCookie(ctx.res, COOKIE, token, Math.floor(auth.SESSION_TTL / 1000), ctx.secure);
        store.log(acc.id, 'login', 'password_reset', clientIp(ctx.req));
        return { json: { ok: true, token, account: publicMe(acc) } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

route('POST', '/api/auth/logout', async (ctx) => {
    const token = readToken(ctx.req);
    if (ctx.account) logInfo('WEB', `Logout panel: ${accLabel(ctx.account)}`);
    if (token) auth.revoke(token);
    setCookie(ctx.res, COOKIE, '', 0, ctx.secure);
    return { json: { ok: true } };
});

/* ── OAuth ── */

route('GET', '/api/auth/:provider/start', async (ctx) => {
    const provider = ctx.params.provider;
    try {
        const url = auth.authorizeUrl(ctx.req, provider, ctx.query.get('next') || '/panel');
        return { raw: { status: 302, headers: { Location: url } } };
    } catch (err) {
        return { raw: { status: 302, headers: { Location: `/panel?oauth_error=${encodeURIComponent(err.message)}` } } };
    }
});

route('GET', '/api/auth/:provider/callback', async (ctx) => {
    const provider = ctx.params.provider;
    const code = ctx.query.get('code') || '';
    const state = ctx.query.get('state') || '';
    if (!code) {
        return { raw: { status: 302, headers: { Location: `/panel?oauth_error=${encodeURIComponent('Login dibatalkan.')}` } } };
    }
    try {
        const { account, token } = await auth.handleCallback(provider, ctx.req, {
            code, state, ip: clientIp(ctx.req), ua: ctx.req.headers['user-agent']
        });
        setCookie(ctx.res, COOKIE, token, Math.floor(auth.SESSION_TTL / 1000), ctx.secure);
        return { raw: { status: 302, headers: { Location: '/panel?oauth_ok=1' } } };
    } catch (err) {
        logWarn('WEBAUTH', `OAuth ${provider}: ${err.message}`);
        return { raw: { status: 302, headers: { Location: `/panel?oauth_error=${encodeURIComponent(err.message)}` } } };
    }
});

/* ── profil ── */

function publicMe(acc) {
    const p = auth.publicAccount(acc);
    const uv = userView(acc.wa_number);
    return {
        ...p,
        wa: uv,
        jadibots: myJadibots(acc),
        canWrite: Boolean(acc.wa_verified && normNumber(acc.wa_number)),
        isRootOwner: acc.role === 'owner',
        isAdmin: acc.role === 'owner',
        // dipakai halaman Profil untuk menjelaskan sumber kredensial OAuth
        oauth: auth.providerStatus(),
        jadibotFree: isFreeFor('jadibot', acc),
        premFree: isFreeFor('premium', acc),
        apiKey: String(acc.api_key || ''),         // personal API key (tampil di Profil)
        isSub: Boolean(acc.parent_id),
        parentName: acc.parent_id ? (store.getAccountById(acc.parent_id)?.display_name || 'akun induk') : ''
    };
}

/**
 * Masa aktif yang mendekati habis (≤ 7 hari): jadibot, premium.
 * Dipakai banner dashboard supaya user ingat memperpanjang sebelum bot berhenti.
 */
function expiringSoon(acc) {
    const now = Date.now();
    const HORIZON = 7 * 86400000;
    const wa = normNumber(acc.wa_number);
    const rows = [];
    const push = (kind, label, expire, extra = {}) => {
        const left = expire - now;
        if (left <= 0 || left > HORIZON) return;
        rows.push({ kind, label, expire, expireText: formatDateTime(new Date(expire)), daysLeft: Math.ceil(left / 86400000), ...extra });
    };

    for (const b of myJadibots(acc)) if (b.expire) push('jadibot', `+${b.number}`, b.expire, { page: 'monitor' });

    const u = wa ? db.data.users?.[wa] : null;
    if (u?.premium?.active && u.premium.expire) push('premium', 'Premium', u.premium.expire, { page: 'premium' });

    return rows.sort((a, b) => a.expire - b.expire);
}

route('GET', '/api/me', async (ctx) => ({
    json: {
        account: publicMe(ctx.account),
        providers: auth.providerStatus(),          // untuk tombol "tautkan Google/GitHub" di Profil
        panelUrl: auth.baseUrl(ctx.req),            // untuk tautan undangan referral
        bot: botSelf(),
        prices: priceTable(),
        topup: topupPackages(),
        paymentEnabled: payment.isEnabled(),
        monitor: monitorFor(ctx.account).summary,      // supaya dashboard langsung punya uptime & statistik
        expiring: expiringSoon(ctx.account),           // banner masa aktif di dashboard
        orders: ordersView(ctx.account.wa_number),
        stats: store.stats(),
        panic: Boolean(db.data.settings?.panic),
        prefs: {
            lang: store.getSetting(ctx.account.id, 'lang', 'id') || 'id'
        },
        logs: store.listLogs(ctx.account.id, 20).map((l) => ({
            action: l.action, detail: l.detail, at: l.at, atText: formatDateTime(new Date(l.at))
        }))
    }
}));

/**
 * Simpan profil. Nomor WA baru harus lolos OTP WhatsApp lebih dulu
 * (`/api/profile/wa/otp`) — bukan lagi lewat perintah `.verifweb`.
 */
route('POST', '/api/profile', async (ctx) => {
    const { displayName, avatar, waNumber, otp: waOtp } = ctx.body || {};
    try {
        let cleared = false;
        if (waNumber !== undefined) {
            const number = otp.normalizeWa(waNumber);
            const current = normNumber(ctx.account.wa_number);
            if (!number) {
                // kosongkan nomor: lepas tautan
                auth.requestWaLink(ctx.account.id, '');
                cleared = true;
            } else if (number !== current || !ctx.account.wa_verified) {
                const other = store.getAccountByWa(number);
                if (other && other.id !== Number(ctx.account.id)) throw new Error('Nomor WhatsApp itu sudah dipakai akun lain.');
                if (!waOtp) throw new Error('Nomor WhatsApp berubah — kirim & masukkan kode OTP dulu.');
                otp.verifyOtp(number, waOtp);
                const role = isRoot(number) ? 'owner' : (ctx.account.role === 'owner' ? 'user' : (ctx.account.role || 'user'));
                store.updateAccount(ctx.account.id, { wa_number: number, wa_verified: 1, role });
                store.log(ctx.account.id, 'wa_verified_otp', `+${number}${role === 'owner' ? ' (owner)' : ''}`, clientIp(ctx.req));
                logInfo('WEBAUTH', `Nomor +${number} terverifikasi via OTP untuk akun panel #${ctx.account.id}`);
            }
        }
        const acc = auth.updateProfile(ctx.account.id, { displayName, avatar });
        const fresh = store.getAccountById(ctx.account.id) || acc;
        return { json: { ok: true, account: publicMe(fresh), cleared } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/** Kirim OTP WhatsApp untuk ganti / verifikasi nomor di halaman Profil. */
route('POST', '/api/profile/wa/otp', async (ctx) => {
    try {
        const number = otp.normalizeWa((ctx.body || {}).waNumber);
        if (!number) throw new Error('Nomor WhatsApp wajib diisi.');
        const other = store.getAccountByWa(number);
        if (other && other.id !== Number(ctx.account.id)) throw new Error('Nomor WhatsApp itu sudah dipakai akun lain.');
        const r = await otp.requestOtp(number, { purpose: 'profile' });
        store.log(ctx.account.id, 'wa_otp_request', `+${number}`, clientIp(ctx.req));
        return { json: { ok: true, number: r.number, ttlSec: r.ttlSec } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/** Alias lama: kini hanya memicu OTP (kompatibilitas tombol lama). */
route('POST', '/api/profile/wa/verify', async (ctx) => {
    try {
        const r = auth.requestWaLink(ctx.account.id, (ctx.body || {}).waNumber);
        if (r.cleared) return { json: { ok: true, cleared: true, account: publicMe(store.getAccountById(ctx.account.id)) } };
        if (r.already) return { json: { ok: true, already: true, account: publicMe(ctx.account) } };
        return { json: { ok: true, verifyRequired: true, verify: { number: r.number, code: r.code, ttlSec: r.ttlSec } } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

route('POST', '/api/profile/password', async (ctx) => {
    const { currentPassword, newPassword } = ctx.body || {};
    try {
        auth.changePassword(ctx.account.id, currentPassword, newPassword, ctx.token);   // sesi lain dicabut
        return { json: { ok: true } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* ── 2FA TOTP (lapis keamanan akun) ── */

route('POST', '/api/profile/2fa/setup', async (ctx) => {
    try {
        const s = auth.setupTotp(ctx.account.id);
        let qrDataUrl = '';
        try {
            const QR = require('qrcode');
            qrDataUrl = await QR.toDataURL(s.otpauth, { width: 320, margin: 1 });
        } catch { /* QR opsional — secret manual tetap bisa dipakai */ }
        return { json: { secret: s.secret, otpauth: s.otpauth, qrDataUrl } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

route('POST', '/api/profile/2fa/enable', async (ctx) => {
    try {
        auth.enableTotp(ctx.account.id, (ctx.body || {}).token);
        return { json: { ok: true, totpEnabled: true } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

route('POST', '/api/profile/2fa/disable', async (ctx) => {
    try {
        auth.disableTotp(ctx.account.id, (ctx.body || {}).token);
        return { json: { ok: true, totpEnabled: false } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

route('POST', '/api/profile/unlink', async (ctx) => {
    const { provider } = ctx.body || {};
    if (!provider) return { status: 400, json: { error: 'Provider wajib diisi.' } };
    const acc = store.getAccountById(ctx.account.id);
    const links = store.listOauth(acc.id);
    const remaining = links.filter((l) => l.provider !== provider).length;
    if (!acc.password_hash && remaining === 0) {
        return { status: 400, json: { error: 'Tidak bisa memutus semua login. Buat password dulu.' } };
    }
    store.unlinkOauth(acc.id, provider);
    store.log(acc.id, 'oauth_unlink', provider);
    return { json: { ok: true, account: publicMe(store.getAccountById(acc.id)) } };
});

route('POST', '/api/profile/delete', async (ctx) => {
    const { confirm } = ctx.body || {};
    if (confirm !== 'HAPUS') return { status: 400, json: { error: 'Ketik HAPUS untuk konfirmasi.' } };
    const id = ctx.account.id;
    const token = readToken(ctx.req);
    auth.revoke(token);
    auth.deleteAccount(id);
    setCookie(ctx.res, COOKIE, '', 0, ctx.secure);
    return { json: { ok: true } };
});

/* ── monitor ── */

route('GET', '/api/monitor', async (ctx) => ({ json: monitorFor(ctx.account) }));

/* ── jadibot ── */

/** Pastikan akun punya nomor WA yang SUDAH TERVERIFIKASI sebelum mengelola jadibot. */
function requireWa(acc) {
    const wa = normNumber(acc.wa_number);
    if (!wa || !acc.wa_verified) throw new Error('Hubungkan & verifikasi nomor WhatsApp dulu di halaman Profil (kode lewat .verifweb).');
    return wa;
}

function assertCanManage(acc, target) {
    const owner = jadibot.getJadibotOwner(target) || db.data.jadibots?.[target]?.owner || '';
    if (acc.role === 'owner') return true;
    const wa = effectiveWa(acc);
    // jadibot tanpa owner tercatat hanya boleh dielola root owner panel (bukan diklaim sembarang akun)
    if (!normNumber(owner)) throw new Error('Jadibot itu belum punya owner tercatat. Hubungi owner bot.');
    if (!acc.wa_verified) throw new Error('Jadibot itu bukan milikmu.');
    if (normNumber(owner) === wa) return true;
    // multi-admin: nomor yang terdaftar sebagai admin bot juga boleh mengelola
    const admins = Array.isArray(db.data.jadibots?.[target]?.admins) ? db.data.jadibots[target].admins : [];
    if (admins.includes(wa)) return true;
    throw new Error('Jadibot itu bukan milikmu.');
}

/** Selain root owner panel: nomor jadibot yang dikelola harus nomor terverifikasi milik sendiri. */
function assertOwnTarget(acc, target, wa) {
    if (acc.role === 'owner') return;
    if (target !== wa) throw new Error('Kamu hanya bisa mengelola jadibot untuk nomormu sendiri.');
}

route('POST', '/api/jadibot/start', async (ctx) => {
    const { number } = ctx.body || {};
    try {
        const wa = requireWa(ctx.account);
        const target = normNumber(number);
        if (!target) throw new Error('Nomor wajib diisi.');
        assertOwnTarget(ctx.account, target, wa);
        assertCanManage(ctx.account, target);
        const handleIncomingMessage = global.__handleIncomingMessage || null;
        if (!handleIncomingMessage) throw new Error('Bot utama belum siap. Coba lagi sebentar.');
        const r = await jadibot.launchAndDeliver({
            parentSock: global.__mainSock, targetNumber: target, ownerNumber: wa,
            chatFrom: `${wa}@s.whatsapp.net`, expireMs: 0, tier: 'paid', handleIncomingMessage,
            deliver: false                                  // kode pairing tampil di web, bukan dikirim ke WA
        });
        store.log(ctx.account.id, 'jadibot_start', `+${target}`, clientIp(ctx.req));
        logInfo('WEB', `Jadibot start +${target} oleh ${accLabel(ctx.account)}`);
        webhook.emit(target, 'jadibot_created', { number: target, owner: wa });
        return { json: { ok: true, registered: Boolean(r.registered), deliveredTo: r.deliveredTo, code: r.code || '', number: target } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/** Jadibot GRATIS untuk owner root / premium — tanpa saldo, tanpa pembayaran. */
route('POST', '/api/jadibot/free', async (ctx) => {
    const { number, days } = ctx.body || {};
    try {
        if (!isFreeAccount(ctx.account)) throw new Error('Jadibot gratis hanya untuk Owner.');
        const wa = requireWa(ctx.account);
        const target = normNumber(number);
        if (!target) throw new Error('Nomor wajib diisi.');
        assertOwnTarget(ctx.account, target, wa);
        const expireMs = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.round(Number(days)) * 86400000 : 0;
        if (!expireMs) throw new Error('Durasi tidak valid. Pilih paket atau isi durasi custom (hari).');   // cegah tak sengaja permanen
        assertCanManage(ctx.account, target);
        const handleIncomingMessage = global.__handleIncomingMessage || null;
        if (!handleIncomingMessage) throw new Error('Bot utama belum siap. Coba lagi sebentar.');
        const r = await jadibot.launchAndDeliver({
            parentSock: global.__mainSock, targetNumber: target, ownerNumber: wa,
            chatFrom: `${wa}@s.whatsapp.net`, expireMs, tier: 'paid', handleIncomingMessage,
            deliver: false
        });
        store.log(ctx.account.id, 'jadibot_free', `+${target}${expireMs ? ` ${Math.round(expireMs / 86400000)}d` : ' permanen'} (gratis)`, clientIp(ctx.req));
        logInfo('WEB', `Jadibot gratis +${target}${expireMs ? ` ${Math.round(expireMs / 86400000)}d` : ' permanen'} oleh ${accLabel(ctx.account)}`);
        return { json: { ok: true, registered: Boolean(r.registered), deliveredTo: r.deliveredTo, code: r.code || '', number: target } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/** Status pairing real-time untuk satu nomor (dipakai modal pairing di web). */
route('GET', '/api/jadibot/status', async (ctx) => {
    const target = normNumber(ctx.query.get('number'));
    if (!target) return { status: 400, json: { error: 'Nomor wajib diisi.' } };
    try {
        assertCanManage(ctx.account, target);
        const bot = jadibot.listAllJadibots().find((b) => b.number === target);
        if (!bot) return { status: 404, json: { error: 'Jadibot tidak ditemukan.' } };
        const v = jadibotView(bot);
        return { json: { number: v.number, state: v.state, connected: v.connected, pairingCode: v.pairingCode, pairingCustom: v.pairingCustom } };
    } catch (err) {
        return { status: 403, json: { error: err.message } };
    }
});

route('POST', '/api/jadibot/stop', async (ctx) => {
    const { number, deleteSession } = ctx.body || {};
    try {
        const target = normNumber(number);
        assertCanManage(ctx.account, target);
        const ok = await jadibot.stopJadibot(target, Boolean(deleteSession));
        store.log(ctx.account.id, deleteSession ? 'jadibot_delete' : 'jadibot_stop', `+${target}`, clientIp(ctx.req));
        logInfo('WEB', `Jadibot ${deleteSession ? 'hapus' : 'matikan'} +${target} oleh ${accLabel(ctx.account)}`);
        return { json: { ok } };
    } catch (err) {
        return { status: 403, json: { error: err.message } };
    }
});

route('POST', '/api/jadibot/mode', async (ctx) => {
    const { number, selfMode } = ctx.body || {};
    try {
        const target = normNumber(number);
        assertCanManage(ctx.account, target);
        jadibot.setJadibotMode(target, Boolean(selfMode));
        logInfo('WEB', `Jadibot +${target} mode ${selfMode ? 'SELF' : 'PUBLIC'} oleh ${accLabel(ctx.account)}`);
        return { json: { ok: true, selfMode: Boolean(selfMode) } };
    } catch (err) {
        return { status: 403, json: { error: err.message } };
    }
});

route('POST', '/api/jadibot/buy', async (ctx) => {
    const { number, duration, days } = ctx.body || {};
    try {
        const wa = requireWa(ctx.account);
        const target = normNumber(number);
        if (!target) throw new Error('Nomor wajib diisi.');
        assertOwnTarget(ctx.account, target, wa);
        // durasi: angka hari (dari pilihan paket di web) atau string '7d'
        const expireMs = Number.isFinite(Number(days)) && Number(days) > 0
            ? Math.round(Number(days)) * 86400000
            : (duration ? parseDuration(duration) : 0);
        if (!expireMs) throw new Error('Durasi tidak valid. Pilih paket atau isi durasi custom (hari).');
        // paket yang memang didefinisikan owner selalu boleh, meski lebih lama dari maxDays
        const inPackage = runtimeSettings.packages().some((p) => p.days * 86400000 === expireMs);
        if (!inPackage && expireMs / 86400000 > (runtimeSettings.priceConfig().maxDays || 3650)) throw new Error(`Durasi maksimal ${runtimeSettings.priceConfig().maxDays} hari.`);
        assertCanManage(ctx.account, target);

        const u = db.getUser(wa);
        if (!u) throw new Error('Data pengguna bot tidak ditemukan.');
        // harga dasar + diskon promo (sama dengan alur pembayaran via WA)
        const basePrice = payment.priceFor(expireMs, runtimeSettings.priceConfig());
        const { price, percent: discountPercent } = promotions.quote('jadibot', basePrice);

        /* Owner root & premium (sesuai config) tidak perlu bayar — langsung aktif. */
        if (isFreeAccount(ctx.account)) {
            const handleIncomingMessage = global.__handleIncomingMessage || null;
            if (!handleIncomingMessage) throw new Error('Bot utama belum siap. Coba lagi sebentar.');
            const r = await jadibot.launchAndDeliver({
                parentSock: global.__mainSock, targetNumber: target, ownerNumber: wa,
                chatFrom: `${wa}@s.whatsapp.net`, expireMs, tier: 'paid', handleIncomingMessage,
                deliver: false                                  // kode pairing tampil di web
            });
            store.log(ctx.account.id, 'jadibot_free', `+${target} ${duration} (gratis)`, clientIp(ctx.req));
            return { json: { ok: true, free: true, deliveredTo: r.deliveredTo, code: r.code || '', balance: u.money, price: 0, priceText: 'GRATIS' } };
        }

        if ((u.money || 0) < price) throw new Error(`Saldo kurang. Butuh ${rupiah(price)}, saldomu ${rupiah(u.money || 0)}.`);

        const handleIncomingMessage = global.__handleIncomingMessage || null;
        if (!handleIncomingMessage) throw new Error('Bot utama belum siap. Coba lagi sebentar.');

        u.money -= price;
        db.markDirty();
        db.addLedger(wa, { kind: 'jadibot', amount: -price, balanceAfter: u.money, note: `Sewa jadibot +${target} ${Math.round(expireMs / 86400000)} hari`, ref: '' });
        try {
            const r = await jadibot.launchAndDeliver({
                parentSock: global.__mainSock, targetNumber: target, ownerNumber: wa,
                chatFrom: `${wa}@s.whatsapp.net`, expireMs, tier: 'paid', handleIncomingMessage,
                deliver: false
            });
            store.log(ctx.account.id, 'jadibot_buy', `+${target} ${rupiah(price)}`, clientIp(ctx.req));
            logInfo('WEB', `Jadibot beli +${target} ${rupiah(price)}${discountPercent ? ` (diskon ${discountPercent}%)` : ''} oleh ${accLabel(ctx.account)}`);
            return { json: { ok: true, deliveredTo: r.deliveredTo, code: r.code || '', balance: u.money, price, priceText: rupiah(price), discountPercent } };
        } catch (err) {
            u.money += price;                    // kembalikan saldo bila gagal
            db.markDirty();
            db.addLedger(wa, { kind: 'refund', amount: price, balanceAfter: u.money, note: `Refund — gagal sewa jadibot +${target}` });
            throw err;
        }
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* ── topup ── */

route('GET', '/api/topup/packages', async () => ({ json: { packages: topupPackages(), enabled: payment.isEnabled() } }));

route('POST', '/api/topup/create', async (ctx) => {
    if (!payment.isEnabled()) return { status: 503, json: { error: 'Pembayaran QRIS belum aktif.' } };
    try {
        const { packageId, amount } = ctx.body || {};
        let pack = topupPackages().find((p) => p.id === packageId);
        if (!pack && packageId !== 'custom') return { status: 400, json: { error: 'Paket tidak valid.' } };
        // Nominal custom: saldo masuk 1:1 tanpa bonus paket
        if (!pack) {
            const n = Math.round(Number(amount));
            if (!Number.isFinite(n) || n < TOPUP_CUSTOM_MIN) throw new Error(`Minimal topup custom ${rupiah(TOPUP_CUSTOM_MIN)}.`);
            if (n > TOPUP_CUSTOM_MAX) throw new Error(`Maksimal topup custom ${rupiah(TOPUP_CUSTOM_MAX)}.`);
            pack = { id: 'custom', pay: n, credit: n, label: 'Custom' };
        }
        const wa = requireWa(ctx.account);
        const order = await payment.createTopupOrder({
            target: wa, owner: wa, chat: `${wa}@s.whatsapp.net`,
            credit: pack.credit, packageId: pack.id, price: pack.pay
        });
        store.log(ctx.account.id, 'topup_create', `${pack.id} ${rupiah(pack.pay)}`, clientIp(ctx.req));
        logInfo('WEB', `Topup dibuat: ${pack.id} ${rupiah(pack.pay)} oleh ${accLabel(ctx.account)}`);
        return {
            json: {
                ok: true,
                trxId: order.order.trxId,
                amount: order.order.amount,
                amountText: rupiah(order.order.amount),
                credit: pack.credit,
                creditText: rupiah(pack.credit),
                expiresAt: order.order.expiresAt,
                qrPayload: order.order.qrPayload || ''
            }
        };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

route('GET', '/api/topup/status', async (ctx) => {
    const trxId = ctx.query.get('trxId') || '';
    const o = db.data.orders?.[trxId];
    if (!o) return { status: 404, json: { error: 'Tagihan tidak ditemukan.' } };
    const wa = normNumber(ctx.account.wa_number);
    if (normNumber(o.owner) !== wa && ctx.account.role !== 'owner') return { status: 403, json: { error: 'Bukan milikmu.' } };
    return {
        json: {
            trxId, status: o.status,
            statusLabel: (payment.STATUS_LABEL[o.status] || o.status).replace(/^[^\w]+/, ''),
            amount: o.amount, amountText: rupiah(o.amount),
            credit: o.credit || 0, creditText: rupiah(o.credit || 0),
            balance: db.data.users?.[normNumber(o.owner)]?.money || 0
        }
    };
});

route('GET', '/api/qr', async (ctx) => {
    const trxId = ctx.query.get('trxId') || '';
    const o = db.data.orders?.[trxId];
    if (!o) return { status: 404, json: { error: 'Tagihan tidak ditemukan.' } };
    const wa = normNumber(ctx.account.wa_number);
    if (normNumber(o.owner) !== wa && ctx.account.role !== 'owner') return { status: 403, json: { error: 'Bukan milikmu.' } };
    if (!o.qrPayload) return { status: 404, json: { error: 'QR tidak tersedia.' } };
    try {
        const QR = require('qrcode');
        const buf = await QR.toBuffer(String(o.qrPayload), { width: 480, margin: 1 });
        return { json: { dataUrl: `data:image/png;base64,${buf.toString('base64')}` } };
    } catch (err) {
        return { status: 500, json: { error: err.message } };
    }
});

/* ── order ── */

route('GET', '/api/orders', async (ctx) => ({ json: { orders: ordersView(effectiveWa(ctx.account)) } }));

/* ── riwayat saldo (ledger) ── */

const LEDGER_KIND_LABEL = {
    topup: '💰 Topup', jadibot: '🤖 Sewa jadibot', premium: '⭐ Premium',
    referral: '🎁 Bonus referral', admin: '🛠 Penyesuaian owner', refund: '↩️ Refund'
};

route('GET', '/api/ledger', async (ctx) => {
    const wa = effectiveWa(ctx.account);
    const rows = wa ? db.listLedger(wa, 40) : [];
    return {
        json: {
            linked: Boolean(wa && ctx.account.wa_verified),
            rows: rows.map((l) => ({
                kind: l.kind,
                kindLabel: LEDGER_KIND_LABEL[l.kind] || '• ' + l.kind,
                amount: l.amount,
                amountText: (l.amount > 0 ? '+' : '') + rupiah(l.amount),
                balanceAfter: l.balanceAfter,
                balanceText: l.balanceAfter === null || l.balanceAfter === undefined ? '-' : rupiah(l.balanceAfter),
                note: l.note || '',
                ref: l.ref || '',
                atText: formatDateTime(new Date(l.at))
            }))
        }
    };
});

/* ── trafik pesan/command per jam (semua akun, agregat tanpa identitas) ── */

route('GET', '/api/traffic', async (ctx) => {
    const raw = Number(ctx.query.get('hours') || 24);
    const hours = Number.isFinite(raw) ? Math.min(48, Math.max(6, Math.floor(raw))) : 24;
    const series = db.trafficSeries(hours);
    return {
        json: {
            hours,
            series,
            totals: {
                messages: series.reduce((a, x) => a + x.messages, 0),
                commands: series.reduce((a, x) => a + x.commands, 0)
            }
        }
    };
});

/* Ringkasan "hari ini vs kemarin" untuk kartu dashboard. Data agregat tanpa
 * identitas, aman untuk semua akun. Revenue hanya dihitung dari order paid. */
route('GET', '/api/today', async (ctx) => {
    const now = new Date();
    const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayKey = dayKey(now);
    const yKey = dayKey(new Date(now.getTime() - 86400_000));

    // Traffic: 48 jam terakhir, dipecah per hari.
    const series = db.trafficSeries(48);
    const traffic = { today: { messages: 0, commands: 0 }, yesterday: { messages: 0, commands: 0 } };
    for (const s of series) {
        const k = s.key.slice(0, 10);
        const bucket = k === todayKey ? traffic.today : (k === yKey ? traffic.yesterday : null);
        if (bucket) { bucket.messages += s.messages; bucket.commands += s.commands; }
    }

    // Revenue dari order berstatus paid/fulfilling/done.
    const PAID = new Set(['paid', 'fulfilling', 'done']);
    const revenue = { today: 0, yesterday: 0 };
    for (const o of Object.values(db.data.orders || {})) {
        if (!PAID.has(o.status)) continue;
        const at = o.paidAt || o.doneAt || o.createdAt || 0;
        if (!at) continue;
        const k = dayKey(new Date(at));
        if (k === todayKey) revenue.today += Number(o.amount) || 0;
        else if (k === yKey) revenue.yesterday += Number(o.amount) || 0;
    }

    // User baru: hitung dari tabel accounts (created_at ms).
    let users = { today: 0, yesterday: 0 };
    try {
        const rows = store.db.prepare('SELECT created_at FROM accounts').all();
        for (const r of rows) {
            const k = dayKey(new Date(Number(r.created_at) || 0));
            if (k === todayKey) users.today++;
            else if (k === yKey) users.yesterday++;
        }
    } catch { /* store opsional */ }

    const pct = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : (a > 0 ? 100 : 0);
    return {
        json: {
            revenue: { today: revenue.today, yesterday: revenue.yesterday, text: rupiah(revenue.today), change: pct(revenue.today, revenue.yesterday) },
            commands: { today: traffic.today.commands, yesterday: traffic.yesterday.commands, change: pct(traffic.today.commands, traffic.yesterday.commands) },
            messages: { today: traffic.today.messages, yesterday: traffic.yesterday.messages, change: pct(traffic.today.messages, traffic.yesterday.messages) },
            users: { today: users.today, yesterday: users.yesterday, change: pct(users.today, users.yesterday) }
        }
    };
});

/* ═══════════════════ FITUR WEB LANJUTAN ═══════════════════
   panic mode · audit log + revert · personal API key · live log
   heatmap aktivitas · export/import sesi jadibot
   ═══════════════════════════════════════════════════════ */

/* ── panic mode (kill switch) ── */

route('POST', '/api/admin/panic', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const on = Boolean(ctx.body?.on);
        const before = Boolean(db.data.settings?.panic);
        db.data.settings.panic = on;
        db.markDirty();
        db.addAudit(ctx.account.display_name || ctx.account.email || 'owner', 'panic', before, on);
        logWarn('WEB', `PANIC MODE ${on ? 'AKTIF — bot dijeda' : 'dimatikan'} oleh owner`);
        return { json: { ok: true, panic: on } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/* ── audit log + revert pengaturan ── */

const AUDIT_APPLIERS = {
    slots: (v) => runtimeSettings.setSlots({ max: v.max, maxPerUser: v.maxPerUser }),
    packages: (v) => runtimeSettings.setPackages({ perDay: v.perDay, packages: v.packages }),
    promo_free_jadibot: (v) => promotions.setFreeJadibot(Boolean(v)),
    promo_free_slots: (v) => promotions.setFreeSlots(Number(v)),
    promo_discount: (v) => promotions.setDiscount(String(v.kind), Number(v.percent)),
    panic: (v) => { db.data.settings.panic = Boolean(v); db.markDirty(); },
    user_balance: (v) => {
        const u = db.data.users?.[normNumber(v.number)];
        if (u) { u.money = Math.max(0, Number(v.money) || 0); db.markDirty(); }
    }
};

route('GET', '/api/admin/audit', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const rows = db.listAudit(100).map((a) => ({
            id: a.id,
            atText: formatDateTime(new Date(a.at)),
            actor: a.actor,
            action: a.action,
            before: a.before,
            after: a.after,
            revertable: Boolean(a.revertable && AUDIT_APPLIERS[a.action])
        }));
        return { json: { rows } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

route('POST', '/api/admin/audit/revert', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const entry = db.getAuditEntry(ctx.body?.id);
        if (!entry) throw new Error('Entri audit tidak ditemukan.');
        const apply = AUDIT_APPLIERS[entry.action];
        if (!entry.revertable || !apply) throw new Error('Perubahan ini tidak bisa dikembalikan otomatis.');
        apply(entry.before);
        db.addAudit(ctx.account.display_name || ctx.account.email || 'owner', entry.action, entry.after, entry.before);
        logInfo('WEB', `Revert ${entry.action} → ${JSON.stringify(entry.before).slice(0, 120)}`);
        return { json: { ok: true } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/* ── personal API key (cek saldo/status lewat HTTP sederhana) ── */

route('POST', '/api/profile/apikey', async (ctx) => {
    try {
        const action = String(ctx.body?.action || 'generate');
        if (action === 'revoke') {
            store.setApiKey(ctx.account.id, '');
            store.log(ctx.account.id, 'apikey_revoke', '', clientIp(ctx.req));
            return { json: { ok: true, key: '' } };
        }
        const key = 'mzk_' + require('crypto').randomBytes(24).toString('base64url');
        store.setApiKey(ctx.account.id, key);
        store.log(ctx.account.id, 'apikey_generate', '', clientIp(ctx.req));
        return { json: { ok: true, key } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* Endpoint publik ber-key: dipakai reseller untuk cek saldo/status sendiri.
   Contoh: GET /api/v1/me?key=mzk_xxx */
route('GET', '/api/v1/me', async (ctx) => {
    const key = String(ctx.query.get('key') || '');
    const acc = store.getAccountByApiKey(key);
    if (!acc) return { status: 401, json: { error: 'API key tidak valid.' } };
    const wa = normNumber(acc.wa_number);
    const mine = wa ? myJadibots({ ...acc, wa_number: wa, role: acc.role }) : [];
    const u = wa ? db.data.users?.[wa] : null;
    return {
        json: {
            name: acc.display_name || '(tanpa nama)',
            balance: u?.money || 0,
            balanceText: rupiah(u?.money || 0),
            premium: Boolean(u?.premium?.active && (!u.premium.expire || u.premium.expire > Date.now())),
            premiumUntil: u?.premium?.active && u.premium.expire ? new Date(u.premium.expire).toISOString() : null,
            bots: mine.map((b) => ({ number: b.number, connected: Boolean(b.connected), state: b.state })),
            botsOnline: mine.filter((b) => b.connected).length
        }
    };
});

/* ── live log viewer (khusus owner) ── */

route('GET', '/api/admin/console', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const limit = Number(ctx.query.get('limit') || 200);
        const rows = logbus.recent(limit).map((l) => ({ ...l, atText: formatDateTime(new Date(l.t)) }));
        return { json: { rows, stats: logbus.stats() } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

const LOG_STREAM_MAX = 3;
const logStreamClients = new Set();

route('GET', '/api/admin/console/stream', async (ctx) => {
    try {
        requireOwner(ctx.account);
        if (logStreamClients.size >= LOG_STREAM_MAX) return { status: 429, json: { error: 'Terlalu banyak penonton log. Tutup tab lain.' } };
        const res = ctx.res;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.write('retry: 5000\n\n');
        // kirim 100 baris terakhir sebagai seed
        for (const l of logbus.recent(100)) {
            res.write(`data: ${JSON.stringify(l)}\n\n`);
        }
        const unsub = logbus.subscribe((entry) => {
            try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch { /* ditutup */ }
        });
        logStreamClients.add(res);
        const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
        ctx.req.on('close', () => { clearInterval(ping); unsub(); logStreamClients.delete(res); });
        return { handled: true };                        // respons sudah ditulis manual
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/* ── heatmap aktivitas 7 hari × 24 jam ── */

route('GET', '/api/heatmap', async (ctx) => {
    const series = db.trafficSeries(168);               // 7 × 24 jam terakhir (terlama → terbaru)
    const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    // baris = hari (Sen dulu, hari ini terakhir), kolom = jam 0-23
    const grid = [];
    const labels = [];
    const byKey = new Map(series.map((s) => [s.key, s]));
    const now = new Date();
    for (let d = 6; d >= 0; d--) {
        const day = new Date(now.getTime() - d * 86400000);
        const dayName = days[day.getDay()];
        const isToday = d === 0;
        const row = [];
        for (let h = 0; h < 24; h++) {
            const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')} ${String(h).padStart(2, '0')}`;
            const r = byKey.get(key) || {};
            row.push({ messages: r.messages || 0, commands: r.commands || 0 });
        }
        grid.push(row);
        labels.push(`${dayName}${isToday ? ' (hari ini)' : ''}`);
    }
    const max = Math.max(1, ...grid.flat().map((c) => c.messages + c.commands));
    return { json: { grid, labels, max } };
});

/* ── export / import sesi jadibot (pindah VPS tanpa scan ulang) ── */

route('GET', '/api/jadibot/export', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const data = jadibot.exportSession(target);
        store.log(ctx.account.id, 'jadibot_export', `+${target}`, clientIp(ctx.req));
        return {
            raw: {
                status: 200,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Disposition': `attachment; filename="sesi-${target}.json"`,
                    'Cache-Control': 'no-store'
                },
                body: JSON.stringify(data, null, 2)
            }
        };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 403, json: { error: err.message } };
    }
});

/* ═══════════════════ FITUR WEB LANJUTAN II ═══════════════════
   perangkat login · analitik command · timeline insiden · webhook
   broadcast · leaderboard · CSV · prefs · sub-akun · laporan harian
   ═════════════════════════════════════════════════════════════ */

/* ── manajemen perangkat login ── */

route('GET', '/api/profile/sessions', async (ctx) => {
    const rows = store.listSessions(ctx.account.id).map((x) => ({
        id: x.id,
        ip: x.ip || '-',
        ua: x.ua || '-',
        head: String(x.token || '').slice(0, 6),
        atText: formatDateTime(new Date(x.created_at)),
        expText: formatDateTime(new Date(x.expires_at))
    }));
    return { json: { rows } };
});

route('POST', '/api/profile/sessions/revoke', async (ctx) => {
    try {
        const { id, all } = ctx.body || {};
        if (all) {
            const n = store.revokeAllSessions(ctx.account.id, ctx.token || '');
            store.log(ctx.account.id, 'sessions_revoke_all', `${n} sesi`, clientIp(ctx.req));
            return { json: { ok: true, revoked: n } };
        }
        const ok = store.revokeSessionById(ctx.account.id, id);
        if (!ok) throw new Error('Sesi tidak ditemukan.');
        store.log(ctx.account.id, 'sessions_revoke', `#${id}`, clientIp(ctx.req));
        return { json: { ok: true } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* ── analitik command ── */

route('GET', '/api/commandstats', async (ctx) => {
    const top = db.topCommands(10);
    const total = db.data?.stats?.commands || 0;
    const unique = Object.keys(db.data?.stats?.commandUsage || {}).length;
    return { json: { top, total, unique } };
});

/* ── timeline insiden per jadibot ── */

route('GET', '/api/jadibot/events', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const rows = db.listBotEvents(target, 30).map((e) => ({ ...e, atText: formatDateTime(new Date(e.at)) }));
        return { json: { number: target, rows } };
    } catch (err) {
        return { status: 403, json: { error: err.message } };
    }
});

/* ── passkey / WebAuthn ── */

function rpInfo(ctx) {
    const host = String(ctx.req.headers.host || 'localhost').split(':')[0];
    const proto = ctx.secure ? 'https' : 'http';
    return { rpId: host, origin: `${proto}://${ctx.req.headers.host}` };
}

route('GET', '/api/profile/passkey', async (ctx) => {
    try {
        const rows = passkey.listPasskeys(ctx.account.id).map((p) => ({ id: p.id, name: p.name, atText: formatDateTime(new Date(p.createdAt)) }));
        return { json: { rows, supported: true } };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

route('POST', '/api/profile/passkey/start', async (ctx) => {
    try {
        const info = rpInfo(ctx);
        return { json: passkey.startRegister(ctx.account, { rpId: info.rpId, rpName: 'ManzxyMD' }) };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

route('POST', '/api/profile/passkey/finish', async (ctx) => {
    try {
        const info = rpInfo(ctx);
        return { json: passkey.finishRegister(ctx.account, ctx.body || {}, info) };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

route('POST', '/api/profile/passkey/delete', async (ctx) => {
    try {
        return { json: passkey.removePasskey(ctx.account.id, (ctx.body || {}).id) };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

route('POST', '/api/auth/passkey/start', async (ctx) => {
    try {
        const info = rpInfo(ctx);
        return { json: passkey.startLogin((ctx.body || {}).email, { rpId: info.rpId }) };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

route('POST', '/api/auth/passkey/finish', async (ctx) => {
    try {
        const info = rpInfo(ctx);
        const { account, token } = passkey.finishLogin(ctx.body || {}, { ip: clientIp(ctx.req), ua: ctx.req.headers['user-agent'] });
        setCookie(ctx.res, COOKIE, token, Math.floor(auth.SESSION_TTL / 1000), ctx.secure);
        return { json: { token, account: publicMe(account) } };
    } catch (err) { return { status: 401, json: { error: err.message } }; }
});

/* ── multi-admin per jadibot ── */

route('GET', '/api/jadibot/admins', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const rec = db.data.jadibots?.[target];
        return { json: { number: target, admins: rec?.admins || [] } };
    } catch (err) { return { status: 403, json: { error: err.message } }; }
});

route('POST', '/api/jadibot/admins', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const rec = db.data.jadibots?.[target];
        if (!rec) throw new Error('Jadibot tidak ditemukan.');
        const { add, remove } = ctx.body || {};
        rec.admins = Array.isArray(rec.admins) ? rec.admins : [];
        if (add) {
            const num = normNumber(String(add));
            if (!num || num.length < 8) throw new Error('Nomor admin tidak valid.');
            if (num === target) throw new Error('Nomor bot tidak bisa jadi admin dirinya.');
            if (num === rec.owner) throw new Error('Itu pemilik botnya sendiri.');
            if (!rec.admins.includes(num)) {
                if (rec.admins.length >= 3) throw new Error('Maksimal 3 admin per jadibot.');
                rec.admins.push(num);
            }
        }
        if (remove) rec.admins = rec.admins.filter((n) => n !== normNumber(String(remove)));
        db.markDirty();
        store.log(ctx.account.id, 'jadibot_admins', `${target}: ${(rec.admins || []).join(',') || '(kosong)'}`);
        return { json: { ok: true, admins: rec.admins || [] } };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

/* ── menu & sambutan kustom per jadibot ── */

route('GET', '/api/jadibot/bottext', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const rec = db.data.jadibots?.[target] || {};
        return { json: { number: target, menu: rec.menuText || '', welcome: rec.welcomeText || '' } };
    } catch (err) { return { status: 403, json: { error: err.message } }; }
});

route('POST', '/api/jadibot/bottext', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const rec = db.data.jadibots?.[target];
        if (!rec) throw new Error('Jadibot tidak ditemukan.');
        const { menu, welcome } = ctx.body || {};
        rec.menuText = String(menu || '').slice(0, 4000);
        rec.welcomeText = String(welcome || '').slice(0, 2000);
        db.markDirty();
        store.log(ctx.account.id, 'bottext', `${target} menu=${rec.menuText ? 'custom' : 'default'} welcome=${rec.welcomeText ? 'custom' : 'default'}`);
        return { json: { ok: true } };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

/* ── auto-reply, jadwal & statistik per jadibot ── */

function botSettingsOf(target) {
    const rec = db.data.jadibots?.[target];
    if (!rec) throw new Error('Jadibot tidak ditemukan.');
    rec.autoReply = rec.autoReply || { enabled: false, rules: [], fallback: '' };
    return rec;
}

route('GET', '/api/jadibot/autoreply', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const ar = botSettingsOf(target).autoReply;
        return { json: { number: target, enabled: !!ar.enabled, rules: ar.rules || [], fallback: ar.fallback || '' } };
    } catch (err) { return { status: 403, json: { error: err.message } }; }
});

route('POST', '/api/jadibot/autoreply', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const rec = botSettingsOf(target);
        const { enabled, rules, fallback } = ctx.body || {};
        rec.autoReply = {
            enabled: Boolean(enabled),
            fallback: String(fallback || '').slice(0, 1000),
            rules: (Array.isArray(rules) ? rules : []).slice(0, 20).map((r) => ({
                key: String(r.key || '').trim().toLowerCase().slice(0, 60),
                reply: String(r.reply || '').trim().slice(0, 1000)
            })).filter((r) => r.key && r.reply)
        };
        db.markDirty();
        store.log(ctx.account.id, 'autoreply', `${target} ${rec.autoReply.enabled ? 'ON' : 'OFF'} (${rec.autoReply.rules.length} aturan)`);
        return { json: { ok: true, saved: rec.autoReply } };
    } catch (err) { return { status: 403, json: { error: err.message } }; }
});

route('GET', '/api/jadibot/schedule', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const rows = db.listScheduled(target).map((x) => ({ ...x, atText: formatDateTime(new Date(x.at)) }));
        return { json: { number: target, rows } };
    } catch (err) { return { status: 403, json: { error: err.message } }; }
});

route('POST', '/api/jadibot/schedule', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const { jid, text, at, repeat } = ctx.body || {};
        const textClean = String(text || '').trim();
        if (textClean.length < 1) throw new Error('Isi pesan dulu.');
        const atN = Number(at) || 0;
        if (atN < Date.now() - 60000) throw new Error('Waktujadwal sudah lewat.');
        if (!/^[0-9]+@s\.whatsapp\.net$/.test(String(jid || '')) && !/@g\.us$/.test(String(jid || ''))) throw new Error('Tujuan harus nomor WA (JID) atau grup.');
        const item = db.addScheduled({ number: target, jid: String(jid).trim(), text: textClean, at: atN, repeat, createdBy: ctx.account.email || '' });
        store.log(ctx.account.id, 'schedule_add', `${target} → ${item.jid} ${formatDateTime(new Date(item.at))}`);
        return { json: { ok: true, id: item.id } };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

route('POST', '/api/jadibot/schedule/delete', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        const ok = db.deleteScheduled((ctx.body || {}).id, target);
        if (!ok) throw new Error('Jadwal tidak ditemukan.');
        return { json: { ok: true } };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

route('GET', '/api/jadibot/stats', async (ctx) => {
    try {
        const target = normNumber(ctx.query.get('number'));
        assertCanManage(ctx.account, target);
        return { json: { number: target, days: db.botMessageStats(target, 7) } };
    } catch (err) { return { status: 403, json: { error: err.message } }; }
});

/* ── notifikasi Telegram / Discord ── */

route('GET', '/api/profile/chatnotify', async (ctx) => {
    try {
        requireWa(ctx.account);
        return { json: chatNotify.maskConf(ctx.account.id) };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

route('POST', '/api/profile/chatnotify', async (ctx) => {
    try {
        requireWa(ctx.account);
        const conf = chatNotify.setConf(ctx.account.id, ctx.body || {});
        store.log(ctx.account.id, 'chatnotify', conf.platform);
        return { json: { ok: true, ...chatNotify.maskConf(ctx.account.id) } };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

route('POST', '/api/profile/chatnotify/test', async (ctx) => {
    try {
        requireWa(ctx.account);
        const r = await chatNotify.test(ctx.account.id);
        return { json: { ok: r.ok, status: r.status } };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

/* ── webhook event ── */

route('GET', '/api/profile/webhook', async (ctx) => {
    const conf = webhook.getConf(ctx.account.id);
    return { json: { events: webhook.EVENTS, url: conf.url, hasSecret: Boolean(conf.secret), eventsOn: conf.events } };
});

route('POST', '/api/profile/webhook', async (ctx) => {
    try {
        const { url, secret, events } = ctx.body || {};
        if (url !== undefined && url !== '') {
            const u = new URL(String(url));
            if (!['http:', 'https:'].includes(u.protocol)) throw new Error('URL harus http/https.');
        }
        webhook.setConf(ctx.account.id, { url, secret, events });
        store.log(ctx.account.id, 'webhook_set', String(url || '').slice(0, 80), clientIp(ctx.req));
        return { json: { ok: true } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

route('POST', '/api/profile/webhook/test', async (ctx) => {
    try {
        const r = await webhook.test(ctx.account.id);
        return { json: r };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* ── broadcast manager (owner) ── */

let broadcastState = null;

route('POST', '/api/admin/broadcast', async (ctx) => {
    try {
        requireOwner(ctx.account);
        if (broadcastState?.running) throw new Error('Broadcast masih berjalan. Tunggu atau batalkan dulu.');
        const { target = 'users', text = '', delayMin = 0 } = ctx.body || {};
        const msg = String(text || '').trim();
        if (msg.length < 1 || msg.length > 4000) throw new Error('Pesan 1-4000 karakter.');
        const sock = global.__mainSock;
        if (!sock?.user) throw new Error('Bot utama belum terhubung.');
        const users = Object.keys(db.data.users || {}).filter((n) => !(db.data.users[n]?.banned?.active));
        const groups = Object.keys(db.data.groups || {});
        const toJid = (k) => (String(k).includes('@') ? String(k) : `${k}@s.whatsapp.net`);
        let list = [];
        if (target === 'users') list = users.map(toJid);
        else if (target === 'groups') list = groups.map(toJid);
        else if (target === 'all') list = [...users.map(toJid), ...groups.map(toJid)];
        else throw new Error('Target tidak dikenal.');
        if (!list.length) throw new Error('Tidak ada target.');
        const sendAt = Date.now() + Math.max(0, Math.min(1440, Number(delayMin) || 0)) * 60000;
        broadcastState = { total: list.length, sent: 0, failed: 0, running: true, cancel: false, target, sendAt, doneAt: 0 };
        const actor = ctx.account.id;
        (async () => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            while (Date.now() < sendAt) {
                if (broadcastState.cancel) break;
                await wait(5000);
            }
            const personalize = (jid) => {
                const num = String(jid).split('@')[0];
                const isGroup = String(jid).endsWith('@g.us');
                const u = !isGroup ? db.getUser(num) : null;
                const gname = isGroup ? (db.data.groups?.[jid]?.name || '') : '';
                return msg
                    .replace(/{nama}/gi, u?.name || gname || (isGroup ? 'grup ini' : 'kak'))
                    .replace(/{saldo}/gi, u ? rupiah(u.money || 0) : '-')
                    .replace(/{tanggal}/gi, formatDateTime(new Date()));
            };
            for (const jid of list) {
                if (broadcastState.cancel) break;
                try {
                    await sock.sendMessage(jid, { text: personalize(jid) });
                    broadcastState.sent++;
                } catch { broadcastState.failed++; }
                await wait(1500);                      // throttle anti-spam
            }
            broadcastState.running = false;
            broadcastState.doneAt = Date.now();
            try { store.log(actor, 'broadcast', `target=${target} terkirim=${broadcastState.sent} gagal=${broadcastState.failed}`); } catch {}
            logInfo('WEB', `Broadcast selesai: ${broadcastState.sent}/${broadcastState.total}`);
        })();
        return { json: { ok: true, total: list.length, sendAt } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

route('GET', '/api/admin/broadcast/status', async (ctx) => {
    try {
        requireOwner(ctx.account);
        return { json: { state: broadcastState || null } };
    } catch (err) {
        return { status: 403, json: { error: err.message } };
    }
});

route('POST', '/api/admin/broadcast/cancel', async (ctx) => {
    try {
        requireOwner(ctx.account);
        if (broadcastState?.running) broadcastState.cancel = true;
        return { json: { ok: true } };
    } catch (err) {
        return { status: 403, json: { error: err.message } };
    }
});

/* ── voucher topup ── */

route('GET', '/api/admin/voucher', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const rows = db.listVouchers(100).map((v) => ({
            code: v.code, amount: v.amount, amountText: rupiah(v.amount),
            uses: v.uses, maxUses: v.maxUses,
            expiresText: v.expiresAt ? formatDateTime(new Date(v.expiresAt)) : 'Tanpa kadaluarsa',
            habis: v.uses >= v.maxUses || (v.expiresAt && Date.now() > v.expiresAt)
        }));
        return { json: { rows } };
    } catch (err) { return { status: 403, json: { error: err.message } }; }
});

route('POST', '/api/admin/voucher', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const { code, amount, maxUses, expiresDays } = ctx.body || {};
        const v = db.createVoucher({ code, amount, maxUses, expiresDays, createdBy: ctx.account.email || 'owner' });
        store.log(ctx.account.id, 'voucher_create', `${v.code} ${rupiah(v.amount)} x${v.maxUses}`);
        return { json: { ok: true, code: v.code, amountText: rupiah(v.amount) } };
    } catch (err) { return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } }; }
});

route('POST', '/api/admin/voucher/delete', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const ok = db.deleteVoucher((ctx.body || {}).code);
        if (!ok) throw new Error('Voucher tidak ditemukan.');
        store.log(ctx.account.id, 'voucher_delete', String((ctx.body || {}).code || ''));
        return { json: { ok: true } };
    } catch (err) { return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } }; }
});

route('POST', '/api/topup/voucher', async (ctx) => {
    try {
        requireWa(ctx.account);
        const wa = effectiveWa(ctx.account);
        const r = db.redeemVoucher((ctx.body || {}).code, wa);
        if (!r.ok) throw new Error(r.error);
        const u = db.getUser(wa);
        u.money = (u.money || 0) + r.amount;
        db.markDirty();
        db.addLedger(wa, { kind: 'voucher', amount: r.amount, balanceAfter: u.money, note: 'Voucher ' + r.code, ref: r.code });
        webhook.emit(wa, 'topup', { amount: r.amount, balance: u.money, ref: r.code });
        store.log(ctx.account.id, 'voucher_redeem', `${r.code} +${rupiah(r.amount)}`);
        logInfo('WEB', `Voucher ${r.code} +${rupiah(r.amount)} ditukar oleh ${accLabel(ctx.account)}`);
        return { json: { ok: true, amountText: rupiah(r.amount), balanceText: rupiah(u.money) } };
    } catch (err) { return { status: 400, json: { error: err.message } }; }
});

/* ── backup database ── */

route('GET', '/api/admin/backup/list', async (ctx) => {
    try {
        requireOwner(ctx.account);
        return { json: { rows: backup.list() } };
    } catch (err) { return { status: 403, json: { error: err.message } }; }
});

route('GET', '/api/admin/backup', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const f = backup.create();
        store.log(ctx.account.id, 'backup_download', path.basename(f));
        const buf = backup.read(f);
        return { raw: { status: 200, headers: { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${path.basename(f)}"`, 'Cache-Control': 'no-store' }, body: buf } };
    } catch (err) { return { status: 403, json: { error: err.message } }; }
});

/* ── widget embed publik (SVG badge, auth via API key) ── */

function widgetSvg(label, value, color) {
    const lw = 8 + label.length * 7.2;
    const vw = 8 + value.length * 7.2;
    const w = lw + vw;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28" role="img" aria-label="${label}: ${value}">
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="28" rx="4" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${lw}" height="28" fill="#2b2b33"/>
<rect x="${lw}" width="${vw}" height="28" fill="${color}"/>
<rect width="${w}" height="28" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="12">
<text x="${lw / 2}" y="18" fill="#fff">${label}</text>
<text x="${lw + vw / 2}" y="18" fill="#16161a" font-weight="bold">${value}</text>
</g>
</svg>`;
}

route('GET', '/api/widget/saldo.svg', async (ctx) => {
    const key = String(ctx.query.get('key') || '');
    const acc = store.getAccountByApiKey(key);
    if (!acc) return { status: 401, json: { error: 'API key tidak valid.' } };
    const wa = effectiveWa(acc);
    const u = db.getUser(wa);
    return { raw: { status: 200, headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=60' }, body: widgetSvg('SALDO', rupiah(u?.money || 0), '#4ADE80') } };
});

route('GET', '/api/widget/bots.svg', async (ctx) => {
    const key = String(ctx.query.get('key') || '');
    const acc = store.getAccountByApiKey(key);
    if (!acc) return { status: 401, json: { error: 'API key tidak valid.' } };
    const bots = myJadibots(acc);
    const online = bots.filter((b) => b.connected).length;
    return { raw: { status: 200, headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=60' }, body: widgetSvg('BOT', `${online}/${bots.length} ONLINE`, online ? '#4ADE80' : '#F87171') } };
});

/* ── leaderboard referral ── */

route('GET', '/api/referral/leaderboard', async (ctx) => {
    const rows = store.topReferrers(10).map((r, i) => ({
        rank: i + 1,
        name: r.display_name || '(tanpa nama)',
        masked: r.wa_number ? '+' + String(r.wa_number).slice(0, 4) + '••••' + String(r.wa_number).slice(-3) : '-',
        total: r.total
    }));
    return { json: { rows } };
});

/* ── export CSV ── */

const csvEscape = (v) => {
    const t = String(v ?? '');
    return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
const csvResponse = (name, header, rows) => ({
    raw: {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${name}"`,
            'Cache-Control': 'no-store'
        },
        body: '\uFEFF' + [header.join(';'), ...rows.map((r) => r.map(csvEscape).join(';'))].join('\n')
    }
});

route('GET', '/api/export/:kind', async (ctx) => {
    try {
        const kind = ctx.params.kind.replace('.csv', '');
        if (kind === 'orders') {
            const rows = ordersView(effectiveWa(ctx.account)).map((o) => [o.trxId, o.type, o.status, o.amountText || o.priceText || '', o.atText || '']);
            return csvResponse('transaksi.csv', ['trx', 'jenis', 'status', 'nominal', 'waktu'], rows);
        }
        if (kind === 'ledger') {
            const wa = effectiveWa(ctx.account);
            const rows = (wa ? db.listLedger(wa, 60) : []).map((l) => [l.at, l.kind, l.amount, l.balanceAfter ?? '', l.note || '', l.ref || '']);
            return csvResponse('riwayat-saldo.csv', ['waktu', 'jenis', 'perubahan', 'saldo_akhir', 'catatan', 'ref'], rows);
        }
        if (kind === 'users') {
            requireOwner(ctx.account);
            const rows = Object.entries(db.data.users || {}).map(([n, u]) => [
                n, u.money || 0, u.premium?.active ? new Date(u.premium.expire || 0).toISOString().slice(0, 10) : '',
                u.stats?.messages || 0, u.stats?.commands || 0
            ]);
            return csvResponse('users.csv', ['nomor', 'saldo', 'premium_hingga', 'pesan', 'command'], rows);
        }
        return { status: 404, json: { error: 'Jenis export tidak dikenal.' } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/* ── preferensi tampilan (tema aksen & bahasa) ── */

route('POST', '/api/profile/prefs', async (ctx) => {
    try {
        const { lang } = ctx.body || {};
        if (lang !== undefined) {
            if (!['id', 'en'].includes(lang)) throw new Error('Bahasa tidak dikenal.');
            store.setSetting(ctx.account.id, 'lang', lang);
        }
        return { json: { ok: true } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* ── sub-akun reseller (mode pantau) ── */

const SUB_MAX = 3;

route('GET', '/api/profile/subs', async (ctx) => {
    const rows = store.listSubAccounts(ctx.account.id).map((r) => ({
        id: r.id, email: r.email, name: r.display_name || '-',
        atText: formatDateTime(new Date(r.created_at)),
        lastText: r.last_login_at ? formatDateTime(new Date(r.last_login_at)) : 'belum pernah login'
    }));
    return { json: { rows, max: SUB_MAX } };
});

route('POST', '/api/profile/subs', async (ctx) => {
    try {
        requireWa(ctx.account);
        const { email, password, displayName } = ctx.body || {};
        const em = String(email || '').toLowerCase().trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new Error('Email tidak valid.');
        if (store.getAccountByEmail(em)) throw new Error('Email sudah terdaftar.');
        const existing = store.listSubAccounts(ctx.account.id);
        if (existing.length >= SUB_MAX) throw new Error(`Maksimal ${SUB_MAX} sub-akun.`);
        auth.validatePassword(String(password || ''));
        const { hash, salt } = auth.hashPassword(String(password));
        const sub = store.createSubAccount({ parentId: ctx.account.id, email: em, passwordHash: hash, passwordSalt: salt, displayName: String(displayName || '').slice(0, 40) });
        store.log(ctx.account.id, 'sub_create', em, clientIp(ctx.req));
        return { json: { ok: true, id: sub.id } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

route('POST', '/api/profile/subs/delete', async (ctx) => {
    try {
        const ok = store.deleteSubAccount(ctx.account.id, Number(ctx.body?.id));
        if (!ok) throw new Error('Sub-akun tidak ditemukan.');
        store.log(ctx.account.id, 'sub_delete', String(ctx.body?.id), clientIp(ctx.req));
        return { json: { ok: true } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* ── laporan harian ke WA owner ── */

route('GET', '/api/admin/dailyreport', async (ctx) => {
    try {
        requireOwner(ctx.account);
        return { json: dailyReport.status() };
    } catch (err) {
        return { status: 403, json: { error: err.message } };
    }
});

route('POST', '/api/admin/dailyreport', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const r = dailyReport.setEnabled(Boolean(ctx.body?.on));
        db.addAudit(ctx.account.display_name || 'owner', 'dailyreport', !r.enabled, r.enabled);
        return { json: { ok: true, ...r } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/* ── API publik v1 (untuk orang banyak — auth via ?key=) ── */

function v1Account(ctx) {
    const key = String(ctx.query.get('key') || '');
    if (!guard.rateLimit(`v1:${key}`, 60, 60_000).ok) throw new Error('Terlalu banyak permintaan. Tunggu sebentar.');
    const acc = store.getAccountByApiKey(key);
    if (!acc) throw new Error('API key tidak valid. Buat di panel web → Profil.');
    return acc;
}

const v1Err = (err) => ({ status: err.message.includes('Terlalu banyak') ? 429 : 401, json: { error: err.message } });

route('GET', '/api/v1/bots', async (ctx) => {
    try {
        const acc = v1Account(ctx);
        const bots = myJadibots(acc).map((b) => {
            const view = jadibotView(b);
            const out = { number: view.number, connected: view.connected, state: view.state, health: view.health, expireText: view.expireText, selfMode: view.selfMode };
            return out;
        });
        const single = normNumber(ctx.query.get('number') || '');
        if (single) {
            const one = bots.find((b) => b.number === single);
            if (!one) return { status: 404, json: { error: 'Bot itu bukan milikmu / tidak ada.' } };
            one.events = db.listBotEvents(single, 10).map((e) => ({ type: e.type, note: e.note, at: new Date(e.at).toISOString() }));
            return { json: { bot: one } };
        }
        return { json: { bots, online: bots.filter((b) => b.connected).length } };
    } catch (err) {
        return v1Err(err);
    }
});

route('GET', '/api/v1/ledger', async (ctx) => {
    try {
        const acc = v1Account(ctx);
        const wa = effectiveWa(acc);
        const rows = (wa ? db.listLedger(wa, 20) : []).map((l) => ({
            kind: l.kind, amount: l.amount, balanceAfter: l.balanceAfter ?? null,
            note: l.note || '', at: new Date(l.at).toISOString()
        }));
        return { json: { rows } };
    } catch (err) {
        return v1Err(err);
    }
});

route('POST', '/api/jadibot/import', async (ctx) => {
    try {
        const target = normNumber(ctx.body?.number);
        const files = ctx.body?.files;
        if (!target) throw new Error('Nomor tujuan wajib diisi.');
        // hanya boleh impor ke nomor WA akun sendiri (atau root owner ke mana pun)
        if (!isRoot(normNumber(ctx.account.wa_number)) && target !== normNumber(ctx.account.wa_number)) {
            throw new Error('Hanya boleh impor sesi ke nomor WhatsApp akunmu sendiri.');
        }
        const count = jadibot.importSession(target, files);
        store.log(ctx.account.id, 'jadibot_import', `+${target} (${count} file)`, clientIp(ctx.req));
        // langsung nyalakan sesi hasil impor (butuh handler pesan dari bot utama)
        let started = false;
        try {
            const handleIncomingMessage = global.__handleIncomingMessage || null;
            if (handleIncomingMessage) {
                await jadibot.startJadibot({ targetNumber: target, ownerNumber: target, expireMs: 0, tier: 'paid', handleIncomingMessage, restored: true });
                started = true;
            }
        } catch { /* biarkan user start manual */ }
        return { json: { ok: true, files: count, started } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* ── referral ── */

route('GET', '/api/referral', async (ctx) => {
    try {
        return { json: referral.summary(ctx.account) };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/** Pastikan akun punya kode referral (dipanggil ringan saat buka halaman). */
route('POST', '/api/referral/ensure', async (ctx) => {
    try {
        const code = referral.ensureCode(ctx.account.id);
        return { json: { ok: true, code } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/** Cek kode referral valid sebelum mendaftar (tanpa login). */
route('GET', '/api/referral/check', async (ctx) => {
    const code = ctx.query.get('code') || '';
    try {
        const r = referral.resolveCode(code);
        const name = r.account.display_name || (r.account.email ? String(r.account.email).split('@')[0] : 'Pengguna');
        return { json: { ok: true, code: r.code, referrer: name.slice(0, 20), bonus: referral.BONUS_REFEREE } };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* ── premium ── */

route('GET', '/api/premium', async (ctx) => ({
    json: {
        ...premView(),
        me: myPremium(ctx.account.wa_number),
        balance: db.data.users?.[normNumber(ctx.account.wa_number)]?.money || 0,
        free: isFreeFor('premium', ctx.account),
        paymentEnabled: payment.isEnabled()
    }
}));

/** Beli premium pakai saldo — target = nomor WA akun sendiri atau nomor lain (kado). */
route('POST', '/api/premium/buy', async (ctx) => {
    try {
        const wa = requireWa(ctx.account);
        const { days, target } = ctx.body || {};
        const d = Math.round(Number(days));
        if (!Number.isFinite(d) || d < 1) throw new Error('Pilih paket durasi premium dulu.');
        if (d > 3650) throw new Error('Durasi maksimal 3650 hari.');
        const penerima = target ? normNumber(target) : wa;
        if (penerima.length < 8 || penerima.length > 15) throw new Error('Nomor penerima tidak valid.');

        const u = db.getUser(wa);
        if (!u) throw new Error('Data pengguna bot tidak ditemukan. Pastikan nomor WhatsApp sudah terverifikasi.');
        const penerimaUser = db.getUser(penerima);
        if (!penerimaUser) throw new Error('Nomor penerima belum terdaftar di bot. Penerima harus pernah memakai bot ini.');

        const base = premPerDay() * d;
        const { price, percent: discountPercent } = promotions.quote('prem', base);

        // Owner & Premium (sesuai config.premium) tidak perlu bayar
        if (isFreeFor('premium', ctx.account)) {
            const pr = payment.grantPremium(penerima, d * 86400000);
            store.log(ctx.account.id, 'premium_free', `+${penerima} ${d}d (gratis)`, clientIp(ctx.req));
            return { json: { ok: true, free: true, days: d, target: penerima, expireText: pr.expire ? formatDateTime(new Date(pr.expire)) : 'Selamanya', balance: u.money, price: 0, priceText: 'GRATIS' } };
        }

        if ((u.money || 0) < price) throw new Error(`Saldo kurang. Butuh ${rupiah(price)}, saldomu ${rupiah(u.money || 0)}. Topup dulu di tab TOPUP SALDO.`);

        u.money -= price;
        db.markDirty();
        db.addLedger(wa, { kind: 'premium', amount: -price, balanceAfter: u.money, note: `Premium ${d} hari${penerima !== wa ? ` → +${penerima}` : ''}` });
        try {
            const pr = payment.grantPremium(penerima, d * 86400000);
            store.log(ctx.account.id, 'premium_buy', `+${penerima} ${d}d ${rupiah(price)}`, clientIp(ctx.req));
            logInfo('PAYMENT', `Premium ${d} hari untuk +${penerima} via web panel (${rupiah(price)})`);
            return {
                json: {
                    ok: true, days: d, target: penerima,
                    expireText: pr.expire ? formatDateTime(new Date(pr.expire)) : 'Selamanya',
                    balance: u.money, price, priceText: rupiah(price), discountPercent
                }
            };
        } catch (err) {
            u.money += price;
            db.markDirty();
            db.addLedger(wa, { kind: 'refund', amount: price, balanceAfter: u.money, note: 'Refund — gagal aktifkan premium' });
            throw err;
        }
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/** Beli premium lewat QRIS (bayar, lalu otomatis aktif setelah dibayar). */
route('POST', '/api/premium/qris', async (ctx) => {
    if (!payment.isEnabled()) return { status: 503, json: { error: 'Pembayaran QRIS belum aktif.' } };
    try {
        const wa = requireWa(ctx.account);
        const { days } = ctx.body || {};
        const d = Math.round(Number(days));
        if (!Number.isFinite(d) || d < 1) throw new Error('Pilih paket durasi premium dulu.');
        if (d > 3650) throw new Error('Durasi maksimal 3650 hari.');

        const base = premPerDay() * d;
        const { price } = promotions.quote('prem', base);
        if (price < 1) throw new Error('Harga premium tidak valid.');

        const order = await payment.createPremOrder({
            target: wa, owner: wa, chat: `${wa}@s.whatsapp.net`,
            durationMs: d * 86400000, price
        });
        store.log(ctx.account.id, 'premium_qris', `+${wa} ${d}d ${rupiah(price)}`, clientIp(ctx.req));
        return {
            json: {
                ok: true,
                trxId: order.order.trxId,
                amount: order.order.amount,
                amountText: rupiah(order.order.amount),
                days: d,
                target: wa,
                expiresAt: order.order.expiresAt,
                qrPayload: order.order.qrPayload || ''
            }
        };
    } catch (err) {
        return { status: 400, json: { error: err.message } };
    }
});

/* ───────────────────────── katalog command ───────────────────────── */

/** Label kategori plugin untuk tampilan (kunci = folder di plugins/). */
const CATEGORY_LABEL = {
    main: 'Utama', info: 'Info', tools: 'Tools', ai: 'AI', downloader: 'Downloader',
    anime: 'Anime', game: 'Game', rpg: 'RPG', group: 'Grup', interactive: 'Interaktif',
    premium: 'Premium', owner: 'Owner', jadibot: 'Jadibot', plugin: 'Plugin'
};

/**
 * Katalog seluruh command bot, dikelompokkan per kategori.
 * Sumbernya plugin yang benar-benar termuat (bukan hasil scan file), jadi yang
 * tampil di panel = yang benar-benar bisa dipakai di WhatsApp.
 */
route('GET', '/api/commands', async () => {
    const loader = require('../bot/pluginLoader');
    const usage = db.data?.stats?.commandUsage || {};
    const groups = new Map();
    for (const plugin of loader.plugins.values()) {
        const cmds = plugin.commands || [];
        if (!cmds.length) continue;
        const cat = plugin.category || 'lain';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push({
            name: plugin.name || cmds[0],
            commands: cmds,
            description: plugin.description || '',
            usage: plugin.usage || '',
            limit: Number(plugin.limit) || 0,
            premium: Boolean(plugin.premium),
            owner: Boolean(plugin.owner || plugin.rootOwner),
            admin: Boolean(plugin.admin),
            groupOnly: Boolean(plugin.group),
            hits: cmds.reduce((n, c) => n + (Number(usage[c]) || 0), 0)
        });
    }
    const categories = [...groups.entries()]
        .map(([id, items]) => ({
            id,
            label: CATEGORY_LABEL[id] || id,
            count: items.length,
            commands: items.sort((a, b) => a.name.localeCompare(b.name))
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return {
        json: {
            prefix: config.prefix,
            total: categories.reduce((n, c) => n + c.count, 0),
            totalCommands: categories.reduce((n, c) => n + c.commands.reduce((m, p) => m + p.commands.length, 0), 0),
            categories
        }
    };
});

/* ───────────────────────── admin (khusus root owner) ───────────────────────── */

/** Ringkasan slot + promo + statistik untuk halaman Owner. */
route('GET', '/api/admin/overview', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const users = Object.values(db.data.users || {});
        const jadibots = Object.values(db.data.jadibots || {});
        const now = Date.now();
        return {
            json: {
                slots: {
                    max: runtimeSettings.jadibotMax(),
                    maxPerUser: runtimeSettings.jadibotMaxPerUser(),
                    used: jadibot.jadibotSessions.size,
                    registered: jadibots.length,
                    online: jadibot.getActiveJadibots().filter((b) => b.connected).length
                },
                packages: {
                    perDay: runtimeSettings.perDay(),
                    list: runtimeSettings.packages()
                },
                promo: {
                    freeJadibot: promotions.freeJadibot(),
                    freeSlots: promotions.freeSlots(),
                    freeUsage: promotions.freeUsage(),
                    discounts: {
                        jadibot: promotions.discount('jadibot'),
                        prem: promotions.discount('prem')
                    }
                },
                stats: {
                    users: users.length,
                    premium: users.filter((u) => db.isPremium(u)).length,
                    banned: users.filter((u) => u.banned?.active).length,
                    registered: users.filter((u) => u.registered).length,
                    balanceTotal: users.reduce((n, u) => n + (u.money || 0), 0),
                    messages: db.data.stats?.messages || 0,
                    commands: db.data.stats?.commands || 0,
                    orders: Object.keys(db.data.orders || {}).length
                },
                panel: store.stats()
            }
        };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/**
 * Laporan pendapatan: total bulan berjalan, tren 12 bulan, dan rincian per jenis.
 * Hanya menghitung order yang uangnya benar-benar masuk (paid/fulfilling/done).
 */
route('GET', '/api/admin/revenue', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const PAID = new Set(['paid', 'fulfilling', 'done']);
        const orders = Object.values(db.data.orders || {}).filter((o) => PAID.has(o.status));
        const now = new Date();
        const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

        // 12 bulan terakhir, termasuk bulan berjalan
        const months = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({ key: monthKey(d), label: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }), total: 0, count: 0 });
        }
        const byMonth = new Map(months.map((m) => [m.key, m]));

        const byType = {};
        let totalAll = 0;
        for (const o of orders) {
            const at = o.paidAt || o.doneAt || o.createdAt || 0;
            if (!at) continue;
            const amount = Number(o.amount) || 0;
            totalAll += amount;
            const bucket = byMonth.get(monthKey(new Date(at)));
            if (bucket) { bucket.total += amount; bucket.count += 1; }
            const t = o.type || 'lain';
            byType[t] = byType[t] || { type: t, label: payment.TYPE_LABEL?.[t] || t, total: 0, count: 0 };
            byType[t].total += amount;
            byType[t].count += 1;
        }

        const thisMonth = byMonth.get(monthKey(now)) || { total: 0, count: 0 };
        const lastMonth = byMonth.get(monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))) || { total: 0, count: 0 };
        const growth = lastMonth.total > 0 ? Math.round(((thisMonth.total - lastMonth.total) / lastMonth.total) * 100) : null;

        // proyeksi sederhana: laju harian bulan ini × jumlah hari dalam bulan
        const dayOfMonth = now.getDate();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const projection = dayOfMonth > 0 ? Math.round((thisMonth.total / dayOfMonth) * daysInMonth) : 0;

        return {
            json: {
                thisMonth: { total: thisMonth.total, totalText: rupiah(thisMonth.total), count: thisMonth.count },
                lastMonth: { total: lastMonth.total, totalText: rupiah(lastMonth.total), count: lastMonth.count },
                totalAll: { total: totalAll, totalText: rupiah(totalAll), count: orders.length },
                growth,
                projection: { total: projection, totalText: rupiah(projection), daysInMonth, dayOfMonth },
                months,
                byType: Object.values(byType).sort((a, b) => b.total - a.total)
            }
        };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/** Ubah slot server & slot per user (runtime, tanpa restart). */
route('POST', '/api/admin/slots', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const { max, maxPerUser } = ctx.body || {};
        const beforeSlots = { max: runtimeSettings.jadibotMax(), maxPerUser: runtimeSettings.jadibotMaxPerUser() };
        const slots = runtimeSettings.setSlots({ max, maxPerUser });
        db.addAudit(ctx.account.display_name || ctx.account.email || 'owner', 'slots', beforeSlots, { max: slots.max, maxPerUser: slots.maxPerUser });
        store.log(ctx.account.id, 'admin_slots', `max=${slots.max} perUser=${slots.maxPerUser}`, clientIp(ctx.req));
        return { json: { ok: true, slots } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/** Ubah paket durasi & harga sewa jadibot (tampil di web & WA). */
route('POST', '/api/admin/packages', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const { perDay, packages } = ctx.body || {};
        const beforePackages = { perDay: runtimeSettings.perDay(), packages: runtimeSettings.packages() };
        const result = runtimeSettings.setPackages({ perDay, packages });
        db.addAudit(ctx.account.display_name || ctx.account.email || 'owner', 'packages', beforePackages, { perDay: result.perDay, packages: result.packages });
        store.log(ctx.account.id, 'admin_packages', `${result.packages.length} paket, per hari ${result.perDay}`, clientIp(ctx.req));
        return { json: { ok: true, packages: result } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/** Ubah promo slot gratis & diskon. */
route('POST', '/api/admin/promo', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const { freeJadibot, freeSlots, discounts } = ctx.body || {};
        const actor = ctx.account.display_name || ctx.account.email || 'owner';
        if (freeJadibot !== undefined) {
            const prev = Boolean(promotions.getFreeJadibot?.() ?? db.data.settings?.promotions?.freeJadibot);
            promotions.setFreeJadibot(freeJadibot === true || freeJadibot === 'true');
            db.addAudit(actor, 'promo_free_jadibot', prev, freeJadibot === true || freeJadibot === 'true');
        }
        if (freeSlots !== undefined) {
            const prev = Number(db.data.settings?.promotions?.freeSlots || 0);
            promotions.setFreeSlots(Number(freeSlots));
            db.addAudit(actor, 'promo_free_slots', prev, Number(freeSlots));
        }
        if (discounts && typeof discounts === 'object') {
            for (const [kind, percent] of Object.entries(discounts)) {
                if (percent === '' || percent === null) continue;
                const prev = Number(db.data.settings?.promotions?.discounts?.[kind] || 0);
                promotions.setDiscount(kind, Number(percent));
                db.addAudit(actor, 'promo_discount', { kind, percent: prev }, { kind, percent: Number(percent) });
            }
        }
        store.log(ctx.account.id, 'admin_promo', JSON.stringify({ freeJadibot, freeSlots, discounts }), clientIp(ctx.req));
        return {
            json: {
                ok: true,
                promo: {
                    freeJadibot: promotions.freeJadibot(),
                    freeSlots: promotions.freeSlots(),
                    freeUsage: promotions.freeUsage(),
                    discounts: {
                        jadibot: promotions.discount('jadibot'),
                        prem: promotions.discount('prem')
                    }
                }
            }
        };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/** Daftar pengguna bot (cari dengan ?q=nomor/nama). */
route('GET', '/api/admin/users', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const q = String(ctx.query.get('q') || '').replace(/[^0-9A-Za-z ]/g, '').toLowerCase();
        const now = Date.now();
        let users = Object.values(db.data.users || {});
        if (q) {
            users = users.filter((u) =>
                u.number.includes(q) || (u.name || '').toLowerCase().includes(q) || (u.regName || '').toLowerCase().includes(q)
            );
        }
        users.sort((a, b) => (b.stats?.lastSeen || 0) - (a.stats?.lastSeen || 0));
        const list = users.slice(0, 100).map((u) => ({
            number: u.number,
            name: u.name || '',
            role: isRoot(u.number) ? 'owner' : (u.role || 'user'),
            premium: Boolean(db.isPremium(u)),
            premiumExpire: u.premium?.expire || 0,
            premiumText: u.premium?.active ? (u.premium.expire ? formatDateTime(new Date(u.premium.expire)) : 'Permanen') : '-',
            banned: Boolean(u.banned?.active),
            balance: u.money || 0,
            balanceText: rupiah(u.money || 0),
            level: u.level || 1,
            messages: u.stats?.messages || 0,
            commands: u.stats?.commands || 0,
            lastSeen: u.stats?.lastSeen || 0,
            lastSeenText: u.stats?.lastSeen ? formatDateTime(new Date(u.stats.lastSeen)) : '-',
            online: (now - (u.stats?.lastSeen || 0)) < 10 * 60 * 1000
        }));
        return { json: { total: users.length, users: list } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/** Kelola satu pengguna bot: saldo, premium, ban, role. */
route('POST', '/api/admin/user', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const { number, action, amount, days } = ctx.body || {};
        const target = normNumber(number);
        if (!target) throw new Error('Nomor wajib diisi.');
        const u = db.getUser(target);
        if (!u) throw new Error('Pengguna tidak ditemukan.');
        if (isRoot(target) && ['ban', 'setRole'].includes(action)) throw new Error('Root owner tidak bisa diubah.');

        let detail = '';
        switch (action) {
            case 'addBalance': {
                const amt = Math.round(Number(amount));
                if (!Number.isSafeInteger(amt) || amt === 0) throw new Error('Nominal saldo tidak valid (boleh minus untuk mengurangi).');
                const before = u.money || 0;
                u.money = Math.max(0, before + amt);
                db.addLedger(target, { kind: 'admin', amount: u.money - before, balanceAfter: u.money, note: 'Penyesuaian saldo oleh owner' });
                db.addAudit(ctx.account.display_name || ctx.account.email || 'owner', 'user_balance', { number: target, money: before }, { number: target, money: u.money });
                detail = `${amt > 0 ? '+' : ''}${rupiah(amt)} → ${rupiah(u.money)}`;
                break;
            }
            case 'setPremium': {
                const d = Math.round(Number(days));
                if (!Number.isSafeInteger(d) || d <= 0 || d > 3650) throw new Error('Durasi premium 1–3650 hari.');
                payment.grantPremium(target, d * 86400000);
                detail = `premium ${d} hari`;
                break;
            }
            case 'removePremium': {
                u.premium = { active: false, expire: 0, since: 0, lastDurationMs: 0 };
                if (u.role === 'premium') u.role = 'user';
                detail = 'premium dicabut';
                break;
            }
            case 'ban': {
                u.banned = { active: true, reason: String(ctx.body?.reason || '').slice(0, 200), by: normNumber(ctx.account.wa_number), time: Date.now() };
                detail = 'dibanned';
                break;
            }
            case 'unban': {
                u.banned = { active: false, reason: '', by: '', time: 0 };
                detail = 'dibuka ban';
                break;
            }
            case 'setRole': {
                const role = String(ctx.body?.role || '');
                if (!['user', 'premium', 'owner'].includes(role)) throw new Error('Role tidak valid (user/premium/owner).');
                u.role = role;
                detail = `role → ${role}`;
                break;
            }
            default:
                throw new Error('Aksi tidak dikenal.');
        }
        u.updatedAt = Date.now();
        db.markDirty();
        store.log(ctx.account.id, `admin_user_${action}`, `+${target} ${detail}`, clientIp(ctx.req));
        return { json: { ok: true, detail } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/** Daftar akun panel web. */
route('GET', '/api/admin/accounts', async (ctx) => {
    try {
        requireOwner(ctx.account);
        if (!store.init()) return { status: 503, json: { error: 'Database panel tidak tersedia.' } };
        const rows = store.db.prepare(
            'SELECT id, email, display_name, wa_number, role, plan, created_at, last_login_at FROM accounts ORDER BY created_at DESC LIMIT 200'
        ).all();
        return {
            json: {
                accounts: rows.map((a) => ({
                    id: a.id,
                    email: a.email || '',
                    displayName: a.display_name || '',
                    waNumber: a.wa_number || '',
                    role: a.role || 'user',
                    plan: a.plan || 'free',
                    createdText: formatDateTime(new Date(a.created_at)),
                    lastLoginText: a.last_login_at ? formatDateTime(new Date(a.last_login_at)) : '-'
                }))
            }
        };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/** Kelola akun panel: jadikan owner panel / turunkan / hapus. */
route('POST', '/api/admin/account', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const { id, action, role } = ctx.body || {};
        const acc = store.getAccountById(id);
        if (!acc) throw new Error('Akun panel tidak ditemukan.');
        if (acc.id === ctx.account.id && action === 'delete') throw new Error('Tidak bisa menghapus akunmu sendiri.');

        if (action === 'setRole') {
            const r = String(role || '');
            if (!['user', 'owner'].includes(r)) throw new Error('Role panel tidak valid.');
            store.updateAccount(acc.id, { role: r });
            store.log(ctx.account.id, 'admin_account_role', `#${acc.id} → ${r}`, clientIp(ctx.req));
        } else if (action === 'delete') {
            store.db.prepare('DELETE FROM accounts WHERE id = ?').run(Number(acc.id));
            store.log(ctx.account.id, 'admin_account_delete', `#${acc.id} ${acc.email || ''}`, clientIp(ctx.req));
        } else throw new Error('Aksi tidak dikenal.');
        return { json: { ok: true } };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/* ── pengaturan login OAuth & alamat panel (dari web, tanpa edit .env) ── */

/** Status konfigurasi OAuth + URL panel yang sedang dipakai. */
route('GET', '/api/admin/oauth', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const base = auth.baseUrl(ctx.req);
        const providers = auth.providerStatus();
        const savedBaseUrl = (() => { try { return auth.getPanelSetting('web_panel_url', ''); } catch { return ''; } })();
        return {
            json: {
                baseUrl: base,
                savedBaseUrl,
                envBaseUrl: process.env.WEB_PANEL_URL || '',
                providers: Object.fromEntries(Object.entries(providers).map(([id, p]) => [id, {
                    label: p.label,
                    enabled: p.enabled,
                    clientId: p.clientId,
                    hasSecret: Boolean(auth.clientSecret(id)),
                    redirectUri: `${base}/api/auth/${id}/callback`
                }]))
            }
        };
    } catch (err) { return dbGuard(err); }
});

/** Simpan URL panel + kredensial OAuth. Body: { baseUrl?, google?:{clientId,clientSecret}, github?:{...} } */
route('POST', '/api/admin/oauth', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const { baseUrl, google, github } = ctx.body || {};
        const out = {};
        if (baseUrl !== undefined) out.baseUrl = auth.saveBaseUrl(baseUrl);
        for (const [prov, payload] of [['google', google], ['github', github]]) {
            if (!payload) continue;
            if (!store.init()) throw new Error('Database panel tidak tersedia.');
            out[prov] = auth.saveProviderConfig(prov, payload);
            store.log(ctx.account.id, 'oauth_config', prov, clientIp(ctx.req));
        }
        logInfo('WEBAUTH', `Konfigurasi OAuth diperbarui oleh akun #${ctx.account.id}`);
        return { json: { ok: true, ...out, baseUrl: auth.baseUrl(ctx.req), providers: auth.providerStatus() } };
    } catch (err) { return dbGuard(err); }
});

/** Log aktivitas panel (semua akun, terbaru dulu). */
route('GET', '/api/admin/logs', async (ctx) => {
    try {
        requireOwner(ctx.account);
        if (!store.init()) return { status: 503, json: { error: 'Database panel tidak tersedia.' } };
        const rows = store.db.prepare(
            'SELECT l.action, l.detail, l.ip, l.at, a.email, a.display_name FROM logs l LEFT JOIN accounts a ON a.id = l.account_id ORDER BY l.at DESC LIMIT 150'
        ).all();
        return {
            json: {
                logs: rows.map((l) => ({
                    action: l.action,
                    detail: l.detail || '',
                    ip: l.ip || '',
                    who: l.display_name || l.email || '(terhapus)',
                    atText: formatDateTime(new Date(l.at))
                }))
            }
        };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/* ───────────── spesifikasi server (khusus root owner) ───────────── */

/**
 * Spek mesin tempat bot berjalan untuk halaman SISTEM.
 *
 * PRIVASI: memakai sysinfo.publicSnapshot() yang sengaja membuang IP, nama host,
 * PID, cwd, mount path, nama device disk, daftar port, dan SELURUH data pengguna.
 * Yang tersisa hanya spek perangkat + angka agregat (jumlah user/grup, tanpa isi).
 */
route('GET', '/api/admin/sysinfo', async (ctx) => {
    try {
        requireOwner(ctx.account);
        return { json: sysinfo.publicSnapshot() };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/**
 * Riwayat metrik untuk grafik (maks ~1 jam, sampel tiap 15 detik).
 * Hanya angka: load CPU, %RAM, RSS bot, %disk, suhu. Tanpa identitas apa pun.
 */
route('GET', '/api/admin/sysinfo/history', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const points = sysinfo.historySeries();
        return {
            json: {
                intervalMs: 15_000,
                points: points.map((p) => ({
                    t: p.t,
                    loadPct: Math.round(p.loadPct * 10) / 10,
                    load1: Math.round(p.load1 * 100) / 100,
                    memPct: Math.round(p.memPct * 10) / 10,
                    botRssKB: Math.round(p.botRss / 1024),
                    diskPct: p.diskPct,
                    temp: p.temp
                }))
            }
        };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/**
 * Trafik pesan & command per jam (agregat, non-pribadi).
 * Hanya jumlah — tidak ada nomor, nama grup, atau isi pesan.
 * Query: ?hours=24 (1–96, default 24)
 */
route('GET', '/api/admin/sysinfo/traffic', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const raw = Number(ctx.query.get('hours') || 24);
        const hours = Number.isFinite(raw) ? Math.min(96, Math.max(1, Math.floor(raw))) : 24;
        const series = db.trafficSeries(hours);
        return {
            json: {
                hours,
                series,
                totals: {
                    messages: series.reduce((a, x) => a + x.messages, 0),
                    commands: series.reduce((a, x) => a + x.commands, 0)
                },
                allTime: {
                    messages: db.data.stats?.messages || 0,
                    commands: db.data.stats?.commands || 0
                }
            }
        };
    } catch (err) {
        return { status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } };
    }
});

/* ── penjelajah database (khusus root owner) ── */

const DB_COLLECTION_NOTES = {
    meta: 'Info database (versi skema, waktu simpan)',
    settings: 'Pengaturan bot, promo, slot, channel',
    users: 'Semua pengguna bot',
    groups: 'Semua grup yang pernah/bot masuk',
    jadibots: 'Data sewa & status jadibot',
    orders: 'Tagihan / transaksi QRIS',
    reminders: 'Pengingat aktif',
    stats: 'Statistik global bot',
    guilds: 'Guild RPG',
    parties: 'Party RPG',
    seasons: 'Season RPG'
};

const dbGuard = (err) => ({ status: err.message === 'Khusus Root Owner.' ? 403 : 400, json: { error: err.message } });

/** Daftar koleksi di database + jumlah isi & ukuran. */
route('GET', '/api/admin/db', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const collections = Object.entries(db.data || {}).map(([key, val]) => {
            const count = Array.isArray(val) ? val.length : (val && typeof val === 'object') ? Object.keys(val).length : 1;
            const size = (JSON.stringify(val ?? null) || '').length;
            return { key, count, sizeKB: Math.round(size / 102.4) / 10, note: DB_COLLECTION_NOTES[key] || 'Data bot' };
        });
        const upd = db.data.meta?.updatedAt || 0;
        return { json: { collections, updatedAtText: upd ? formatDateTime(new Date(upd)) : '-', totalKB: Math.round(collections.reduce((n, c) => n + c.sizeKB, 0) * 10) / 10 } };
    } catch (err) { return dbGuard(err); }
});

/** Isi satu koleksi: cari (?q=), pagination (?page=&limit=). */
route('GET', '/api/admin/db/view', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const col = ctx.query.get('col') || '';
        const data = db.data?.[col];
        if (data === undefined) return { status: 404, json: { error: 'Koleksi tidak ditemukan.' } };
        const q = String(ctx.query.get('q') || '').toLowerCase();
        const page = Math.max(1, Number(ctx.query.get('page')) || 1);
        const limit = Math.min(200, Math.max(1, Number(ctx.query.get('limit')) || 25));
        let entries = Array.isArray(data)
            ? data.map((v, i) => ({ key: String(i), value: v }))
            : Object.entries(data || {}).map(([k, v]) => ({ key: k, value: v }));
        if (q) entries = entries.filter((e) => e.key.toLowerCase().includes(q) || JSON.stringify(e.value ?? '').toLowerCase().includes(q));
        entries.sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
        const total = entries.length;
        const start = (page - 1) * limit;
        const items = entries.slice(start, start + limit).map((e) => ({ key: e.key, json: JSON.stringify(e.value ?? null) }));
        return { json: { col, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), items } };
    } catch (err) { return dbGuard(err); }
});

/** JSON mentah satu koleksi (atau seluruh database dengan ?col=all), maks 2MB. */
route('GET', '/api/admin/db/raw', async (ctx) => {
    try {
        requireOwner(ctx.account);
        const col = ctx.query.get('col') || '';
        const data = col === 'all' ? db.data : db.data?.[col];
        if (data === undefined) return { status: 404, json: { error: 'Koleksi tidak ditemukan.' } };
        const text = JSON.stringify(data ?? null, null, 2);
        if (text.length > 2e6) return { status: 413, json: { error: `Terlalu besar (${(text.length / 1024 / 1024).toFixed(1)} MB). Pakai pencarian/pagination.` } };
        return { json: { col, json: text } };
    } catch (err) { return dbGuard(err); }
});

/* ───────────────────────── SSE (realtime ringan) ───────────────────────── */

/**
 * Server-Sent Events untuk halaman MONITOR: status jadibot didorong server
 * tiap 10 detik, jadi tidak perlu polling manual. Auth lewat cookie sesi
 * (EventSource tidak bisa memakai header Authorization).
 */
const sseClients = new Map();          // res → { accountId, timer }
const SSE_INTERVAL_MS = 10_000;
const SSE_MAX_PER_ACCOUNT = 3;

/* Live Activity Feed — teruskan event store.log ke SSE client milik akun itu.
 * Feed 20 entri terakhir juga dikirim saat koneksi dibuka supaya timeline
 * langsung terisi tanpa menunggu aktivitas baru. */
function sseWrite(res, event, payload) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); } catch { /* koneksi mati */ }
}
function broadcastActivity(entry) {
    for (const [res, c] of sseClients) {
        if (c.accountId === entry.accountId) sseWrite(res, 'activity', entry);
    }
}
try { store.onActivity(broadcastActivity); } catch { /* store belum siap saat modul dimuat */ }

function handleEvents(req, res, account) {
    // batasi koneksi: 6/menit per IP & 3 per akun — cukup untuk beberapa tab
    if (!guard.rateLimit(`sse:${clientIp(req)}`, 6, 60_000).ok) {
        return json(res, 429, { error: 'Terlalu banyak koneksi realtime. Tunggu sebentar.' });
    }
    let mine = 0;
    for (const c of sseClients.values()) if (c.accountId === account.id) mine++;
    if (mine >= SSE_MAX_PER_ACCOUNT) return json(res, 429, { error: 'Koneksi realtime akun ini sudah maksimal.' });

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'                  // matikan buffering reverse proxy (nginx)
    });
    res.write('retry: 5000\n\n');

    const entry = { accountId: account.id, timer: null };
    sseClients.set(res, entry);

    const push = () => {
        try {
            const m = monitorFor(account);
            const payload = JSON.stringify({ summary: m.summary, bots: m.bots });
            res.write(`event: monitor\ndata: ${payload}\n\n`);
        } catch { /* koneksi mati — dibersihkan oleh handler close */ }
    };
    push();                                        // kirim snapshot pertama segera
    // Isi awal timeline aktivitas (20 terakhir) untuk akun ini.
    try {
        const logs = store.listLogs(account.id, 20)
            .filter((l) => store.FEED_ACTIONS.has(l.action))
            .map((l) => ({ accountId: account.id, action: l.action, detail: l.detail, at: l.at }));
        sseWrite(res, 'activity:init', { items: logs });
    } catch { /* feed opsional */ }
    entry.timer = setInterval(push, SSE_INTERVAL_MS);

    req.on('close', () => {
        clearInterval(entry.timer);
        sseClients.delete(res);
    });
}

/* ───────────────────────── static ───────────────────────── */

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
};

/* ───────────────────────── status page publik + badge ───────────────────────── */

/** Data agregat untuk status page — tanpa nomor/nama user (privasi). */
function statusData() {
    const all = jadibot.listAllJadibots();
    const online = all.filter((j) => j.connected).length;
    return {
        botName: config.botName || 'Bot',
        version: config.version || '-',
        uptime: Math.floor(process.uptime()),
        uptimeText: runtime(Math.floor(process.uptime())),
        total: all.length,
        online,
        ok: online > 0,
        panic: Boolean(db.data?.settings?.panic),
        maintenance: Boolean(db.data?.settings?.maintenance),
        messages: db.data?.stats?.messages || 0,
        commands: db.data?.stats?.commands || 0,
        atText: formatDateTime(new Date())
    };
}

function serveStatus(req, res) {
    fs.readFile(path.join(PUBLIC_DIR, 'status.html'), (err, buf) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        const s = statusData();
        const state = s.panic ? 'DIJEDA (panic mode)' : s.maintenance ? 'MAINTENANCE' : s.ok ? 'ONLINE' : 'OFFLINE';
        const cls = s.panic || s.maintenance ? 'warn' : s.ok ? 'ok' : 'bad';
        const html = String(buf)
            .replace(/<!--NAMA-->/g, escHtml(s.botName))
            .replace(/<!--VERSI-->/g, escHtml(s.version))
            .replace(/<!--STATUS-->/g, state)
            .replace(/<!--CLS-->/g, cls)
            .replace(/<!--UPTIME-->/g, escHtml(s.uptimeText))
            .replace(/<!--BOTON-->/g, String(s.online))
            .replace(/<!--BOTTOT-->/g, String(s.total))
            .replace(/<!--PESAN-->/g, s.messages.toLocaleString('id-ID'))
            .replace(/<!--COMMAND-->/g, s.commands.toLocaleString('id-ID'))
            .replace(/<!--WAKTU-->/g, escHtml(s.atText));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
    });
}

/** Badge SVG ala shields.io: /status/badge.svg — bisa ditempel di README/GitHub. */
function serveStatusBadge(req, res) {
    const s = statusData();
    const label = s.panic ? 'paused' : s.maintenance ? 'maintenance' : s.ok ? 'online' : 'offline';
    const value = s.ok ? `${s.online}/${s.total} bot` : '0 bot';
    const color = s.panic || s.maintenance ? '#f59e0b' : s.ok ? '#22c55e' : '#ef4444';
    const w1 = 42 + label.length * 6.2;
    const w2 = 34 + value.length * 6.2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w1 + w2)}" height="20" role="img" aria-label="${label}: ${value}">` +
        `<linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
        `<clipPath id="r"><rect width="${Math.round(w1 + w2)}" height="20" rx="3"/></clipPath>` +
        `<g clip-path="url(#r)"><rect width="${Math.round(w1)}" height="20" fill="#555"/><rect x="${Math.round(w1)}" width="${Math.round(w2)}" height="20" fill="${color}"/><rect width="${Math.round(w1 + w2)}" height="20" fill="url(#g)"/></g>` +
        `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
        `<text x="${Math.round(w1 / 2)}" y="14">${label}</text><text x="${Math.round(w1 + w2 / 2)}" y="14">${value}</text></g></svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=60' });
    res.end(svg);
}

function serveStatic(req, res, urlPath, query = null) {
    let rel = urlPath.replace(/^\/panel\/?/, '');
    if (!rel) rel = 'index.html';
    if (rel.includes('..')) { res.writeHead(403); return res.end('Forbidden'); }
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

    const isHtml = path.extname(file) === '.html';

    /* app.js bukan file tunggal lagi: digabung dari public/js/*.js. */
    const isBundle = rel === 'app.js';

    /* HTML di-inject saat runtime (versi aset + harga landing), jadi selalu
     * dibaca ulang. Aset statis memakai stat() dulu supaya bisa menjawab 304
     * tanpa membaca file sama sekali. */
    const finish = (buf, mtime) => {
        const versioned = Boolean(query && query.get('v'));
        const cacheControl = isHtml
            ? 'no-store'
            : versioned
                ? 'public, max-age=31536000, immutable'
                : 'public, max-age=3600';
        const headers = {
            'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': cacheControl,
            'X-Content-Type-Options': 'nosniff'
        };
        if (isHtml) { headers['Pragma'] = 'no-cache'; headers['Expires'] = '0'; }
        else {
            /* ETag dari mtime+size: browser bisa revalidate murah (304 tanpa body). */
            const etag = `W/"${Math.floor(mtime).toString(36)}-${buf.length.toString(36)}"`;
            headers['ETag'] = etag;
            const inm = req.headers['if-none-match'];
            if (inm && inm.split(',').some((t) => t.trim() === etag)) {
                res.writeHead(304, { 'ETag': etag, 'Cache-Control': cacheControl, 'Vary': 'Accept-Encoding' });
                return res.end();
            }
        }
        const body = isHtml
            ? Buffer.from(rel === 'landing.html' ? injectLandingPrices(buf) : injectAssetVersion(buf))
            : buf;
        sendCompressed(req, res, 200, headers, body, file, mtime);
    };

    fs.stat(file, (serr, st) => {
        if (serr || !st.isFile()) {
            /* app.js dilayani dari bundle public/js/*.js */
            if (isBundle) {
                const body = appBundle();
                if (!body) { res.writeHead(404); return res.end('Not found'); }
                return finish(body, _bundle.mtime || Date.now());
            }
            if (!path.extname(rel)) {
                return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
                    if (e2) { res.writeHead(404); return res.end('Not found'); }
                    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
                    res.end(rel === 'landing.html' ? injectLandingPrices(html) : injectAssetVersion(html));
                });
            }
            res.writeHead(404); return res.end('Not found');
        }
        fs.readFile(file, (err, buf) => {
            if (err) { res.writeHead(404); return res.end('Not found'); }
            finish(buf, st.mtimeMs);
        });
    });
}

/* ───────────────────────── landing page (harga real) ───────────────────────── */

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Tabel harga jadibot untuk landing page — dari pengaturan owner saat runtime. */
function landingPricesHtml() {
    let rows;
    try { rows = runtimeSettings.packages(); } catch { rows = []; }
    const perDay = (() => { try { return runtimeSettings.perDay(); } catch { return 0; } })();
    if (!rows.length) {
        return '<p class="land-empty">Daftar harga menyusul — hubungi owner lewat panel.</p>';
    }
    return rows.map((p, i) =>
        `<div class="land-price${i === 0 ? ' hot' : ''}"><span>${escHtml(p.label)} · ${Number(p.days)} hari</span><strong>${rupiah(p.price)}</strong></div>`
    ).join('') +
    `<div class="land-price"><span>Durasi lain</span><strong>${rupiah(perDay)}/hari</strong></div>`;
}

/** Angka nyata untuk strip statistik di landing: jumlah command, kategori, plugin. */
function landingStatsHtml() {
    let pluginCount = 0;
    let commandCount = 0;
    let categoryCount = 0;
    try {
        const cats = new Set();
        const pluginLoader = require('../bot/pluginLoader');
        for (const plugin of pluginLoader.plugins.values()) {
            pluginCount++;
            commandCount += (plugin.commands || []).length;
            if (plugin.category) cats.add(plugin.category);
        }
        categoryCount = cats.size;
    } catch { /* loader belum siap → pakai angka 0, jangan gagal render */ }

    const cells = [
        { value: commandCount ? `${commandCount}+` : '—', label: 'Command' },
        { value: categoryCount || '—', label: 'Kategori' },
        { value: pluginCount || '—', label: 'Plugin' },
        { value: '24/7', label: 'Uptime' }
    ];
    return `<div class="stats">${cells.map((c) =>
        `<div class="stat"><b>${escHtml(c.value)}</b><span>${escHtml(c.label)}</span></div>`
    ).join('')}</div>`;
}

/** Sisipkan harga & statistik real ke landing.html (tanpa JS — aman CSP). */
function injectLandingPrices(buf) {
    return String(buf)
        .replace('<!--HARGA-->', () => landingPricesHtml())
        .replace('<!--STATS-->', () => landingStatsHtml());
}

/* ───────────────────────── dispatcher ───────────────────────── */

/**
 * Tempelkan ?v=<mtime> pada referensi app.js & css/*.css di HTML.
 * Kalau file aset berubah, URL-nya ikut berubah sehingga browser wajib
 * mengambil versi baru — mencegah HTML lama berpasangan dengan JS baru.
 */
const _assetVerCache = new Map();
function assetVersion(name) {
    /* app.js adalah bundle: versinya diambil dari modul terbaru di public/js/ */
    if (name === 'app.js') {
        const body = appBundle();
        if (!body) return '0';
        const key = '__bundle__';
        const mtime = _bundle.mtime || 0;
        if (!_assetVerCache.has(key) || _assetVerCache.get(key).mtime !== mtime) {
            _assetVerCache.set(key, { mtime, v: Math.floor(mtime).toString(36) });
        }
        return _assetVerCache.get(key).v;
    }
    const file = path.join(PUBLIC_DIR, name);
    try {
        const mtime = fs.statSync(file).mtimeMs;
        if (!_assetVerCache.has(file) || _assetVerCache.get(file).mtime !== mtime) {
            _assetVerCache.set(file, { mtime, v: Math.floor(mtime).toString(36) });
        }
        return _assetVerCache.get(file).v;
    } catch {
        return '0';
    }
}

function injectAssetVersion(buf) {
    const jsV = assetVersion('app.js');
    const cssV = assetVersion(path.join('css', 'base.css'));
    const auroraV = assetVersion(path.join('css', 'aurora.css'));
    const shellV = assetVersion(path.join('css', 'shell.css'));
    const themeV = assetVersion('theme.js');
    return String(buf)
        .replace(/(src="[^"]*?)app\.js(?:\?v=[^"]*)?(")/g, `$1app.js?v=${jsV}$2`)
        .replace(/(src="[^"]*?)theme\.js(?:\?v=[^"]*)?(")/g, `$1theme.js?v=${themeV}$2`)
        .replace(/(href="[^"]*?)base\.css(?:\?v=[^"]*)?(")/g, `$1base.css?v=${cssV}$2`)
        .replace(/(href="[^"]*?)aurora\.css(?:\?v=[^"]*)?(")/g, `$1aurora.css?v=${auroraV}$2`)
        .replace(/(href="[^"]*?)shell\.css(?:\?v=[^"]*)?(")/g, `$1shell.css?v=${shellV}$2`);
}

/** Cocokkan path dinamis: /api/auth/:provider/start */
function matchRoute(method, pathname) {
    const exact = routes[`${method} ${pathname}`];
    if (exact) return { handler: exact, params: {} };
    for (const key of Object.keys(routes)) {
        const [m, pat] = key.split(' ');
        if (m !== method) continue;
        if (!pat.includes(':')) continue;
        const patParts = pat.split('/');
        const pathParts = pathname.split('/');
        if (patParts.length !== pathParts.length) continue;
        const params = {};
        let ok = true;
        for (let i = 0; i < patParts.length; i++) {
            if (patParts[i].startsWith(':')) params[patParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
            else if (patParts[i] !== pathParts[i]) { ok = false; break; }
        }
        if (ok) return { handler: routes[key], params };
    }
    return null;
}

const PUBLIC_ROUTES = new Set([
    'GET /api/health',
    'GET /api/auth/providers',
    'POST /api/auth/register',
    'GET /api/referral/check',
    'GET /api/v1/me',
    'GET /api/v1/bots',
    'GET /api/v1/ledger',
    'GET /api/widget/saldo.svg',
    'GET /api/widget/bots.svg',
    'POST /api/auth/passkey/start',
    'POST /api/auth/passkey/finish',
    'POST /api/auth/otp/send',
    'POST /api/auth/otp/verify',
    'POST /api/auth/login',
    'POST /api/auth/forgot',
    'POST /api/auth/reset',
    'POST /api/auth/logout'
]);

/** Endpoint publik: daftar tetap di atas + pola dinamis provider OAuth. */
function isPublicPath(method, pathname) {
    if (PUBLIC_ROUTES.has(`${method} ${pathname}`)) return true;
    // /api/auth/<provider>/start dan /callback terbuka (callback diverifikasi lewat state)
    if (method === 'GET' && /^\/api\/auth\/[a-z]+\/(start|callback)$/.test(pathname)) return true;
    return false;
}

async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const secure = (req.headers['x-forwarded-proto'] || '').includes('https');

    // Lapis 4: security headers pada SEMUA respons (API, panel, redirect)
    guard.applyHeaders(res, secure);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    if (pathname.startsWith('/api/')) {
        // Lapis 1: rate limit per-IP — auth lebih ketat, API biasa longgar
        const isAuthRoute = /^\/api\/auth\/(login|register|forgot|reset)$/.test(pathname);
        const rl = isAuthRoute
            ? guard.rateLimit(`auth:${clientIp(req)}`, 10, 60_000)         // 10/menit untuk login/register
            : guard.rateLimit(`api:${clientIp(req)}`, 120, 60_000);        // 120/menit untuk API lain
        if (!rl.ok) {
            res.writeHead(429, { 'Retry-After': String(rl.retryAfterSec) });
            return res.end(JSON.stringify({ error: `Terlalu banyak permintaan. Tunggu ${rl.retryAfterSec} detik.` }));
        }

        // Lapis 3: CSRF — request ubah data wajib dari origin yang sama
        if (!guard.sameOrigin(req, secure)) {
            logWarn('WEBGUARD', `Origin ditolak: ${req.headers.origin || req.headers.referer} → ${pathname}`);
            return json(res, 403, { error: 'Origin tidak diizinkan.' });
        }

        // ── SSE realtime (sebelum matchRoute — respons mengalir terus, bukan JSON) ──
        if (pathname === '/api/events' && req.method === 'GET') {
            const evToken = readToken(req);
            const evAccount = evToken ? auth.sessionAccount(evToken) : null;
            if (!evAccount) return json(res, 401, { error: 'Belum login. Silakan masuk kembali.' });
            return handleEvents(req, res, evAccount);
        }

        const matched = matchRoute(req.method, pathname);
        if (!matched) return json(res, 404, { error: 'Endpoint tidak ada.' });

        const token = readToken(req);
        // Rotasi sesi: token berumur > 7 hari diganti token baru (lihat lib/web/auth.js).
        let activeToken = token;
        const account = token ? auth.rotateSessionIfNeeded(token) : null;
        if (account?.newToken) {
            activeToken = account.newToken;
            res.setHeader('X-Session-Token', account.newToken);          // klien Bearer menyimpan yang baru
            setCookie(res, COOKIE, account.newToken, Math.floor(auth.SESSION_TTL / 1000), secure);
        }
        const acc = account?.account || null;
        const isPublic = isPublicPath(req.method, pathname);

        if (!acc && !isPublic) return json(res, 401, { error: 'Belum login. Silakan masuk kembali.' });

        // Sub-akun reseller = mode pantau: hanya boleh membaca data induknya.
        if (acc?.parent_id && req.method !== 'GET' && pathname !== '/api/auth/logout') {
            return json(res, 403, { error: 'Akun sub hanya bisa melihat (mode pantau). Minta akun induk untuk aksi lain.' });
        }

        const ctx = {
            req, res, url,
            params: matched.params,
            query: url.searchParams,
            body: req.method === 'POST' ? await bodyParser(req) : {},
            account: acc,
            token: activeToken,
            secure
        };

        try {
            const out = await matched.handler(ctx);
            if (out.handled) return;                    // respons sudah ditulis manual (SSE)
            if (out.raw) {
                res.writeHead(out.raw.status, out.raw.headers || {});
                return res.end(out.raw.body || '');
            }
            return sendJson(req, res, out.status || 200, out.json);
        } catch (err) {
            logError('WEB', err);
            return sendJson(req, res, 500, { error: err.message });
        }
    }

    if (pathname === '/panel' || pathname.startsWith('/panel/')) return serveStatic(req, res, pathname, url.searchParams);

    // Landing page publik di root — panel tetap di /panel.
    if (pathname === '/') return serveStatic(req, res, '/panel/landing.html', url.searchParams);

    // Status page publik + badge uptime (tanpa login — hanya data agregat non-sensitif)
    if (pathname === '/docs') return serveStatic(req, res, '/panel/docs.html', url.searchParams);
    if (pathname === '/status') return serveStatus(req, res);
    if (pathname === '/status/badge.svg') return serveStatusBadge(req, res);

    // Halaman pendek lain tetap diarahkan ke panel.
    if (pathname === '/login' || pathname === '/dashboard' || pathname === '/profile') {
        res.writeHead(302, { Location: '/panel' });
        return res.end();
    }

    // Health check tetap JSON untuk monitoring (uptime robot, dsb.)
    if (pathname === '/health' || pathname === '/healthz') {
        return sendJson(req, res, 200, {
            status: 'online', botName: config.botName, version: config.version,
            uptime: Math.floor(process.uptime()), panel: '/panel'
        });
    }

    return json(res, 404, { error: 'Not found', panel: '/panel' });
}

/* ───────────────────────── lifecycle ───────────────────────── */

let server = null;

/** Path yang ditangani panel web. Sisanya diteruskan ke handler lama (keep-alive). */
const PANEL_PATHS = ['/panel', '/api/', '/login', '/dashboard', '/profile', '/health', '/healthz', '/status', '/docs'];

function attachTo(existingServer) {
    const prev = existingServer.listeners('request');
    existingServer.removeAllListeners('request');
    existingServer.on('request', (req, res) => {
        const p = (req.url || '').split('?')[0];
        // '/' juga diambil panel (redirect ke /panel); keep-alive kini di /health.
        const mine = p === '/' || PANEL_PATHS.some((x) => p === x || p.startsWith(x));
        if (mine) {
            handle(req, res).catch((err) => {
                logError('WEB', err);
                try { json(res, 500, { error: 'Internal error' }); } catch {}
            });
            return;
        }
        if (!prev.length) { res.writeHead(404); return res.end('Not found'); }
        for (const fn of prev) fn.call(existingServer, req, res);
    });
    server = existingServer;
    logInfo('WEB', 'Panel web aktif di /panel (root / dialihkan ke sana)');
    return true;
}

function start(port = config.port) {
    if (server) return server;
    logbus.install();                               // live log viewer (web panel)
    dailyReport.start();                            // laporan harian ke WA owner
    backup.start();                                 // snapshot database harian
    jadibot.startScheduler();                              // pesan terjadwal jadibot
    const http = require('http');
    server = http.createServer((req, res) => handle(req, res).catch(() => { try { json(res, 500, {}); } catch {} }));
    server.on('error', (e) => logWarn('WEB', `Port ${port}: ${e.message}`));
    server.listen(port, () => logInfo('WEB', `Panel web: http://localhost:${port}/panel`));
    if (server.unref) server.unref();
    return server;
}

function stop() { try { server?.close(); } catch {} server = null; }

function bindBot({ sock, handleIncomingMessage }) {
    global.__mainSock = sock;
    global.__handleIncomingMessage = handleIncomingMessage;
}

/* pembersihan sesi kedaluwarsa tiap jam */
const purgeTimer = setInterval(() => { try { store.purgeExpiredSessions(); } catch {} }, 3600 * 1000);
if (purgeTimer.unref) purgeTimer.unref();

/* sampling metrik server untuk grafik halaman SISTEM (agregat, non-pribadi) */
sysinfo.startHistory();

module.exports = { attachTo, start, stop, bindBot, PUBLIC_DIR, routes, isRoot, store, auth };