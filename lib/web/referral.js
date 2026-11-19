/**
 * Sistem referral panel web.
 *
 * Aturan:
 *  - Tiap akun punya kode referral sendiri (dibuat otomatis saat pertama dibutuhkan).
 *  - Pendaftar baru boleh mengisi kode referral → bonus masuk ke SALDO WhatsApp
 *    milik pengundang setelah syarat terpenuhi.
 *  - Kunci 1 akun per perangkat (device fingerprint). Perangkat yang sudah punya akun
 *    tidak boleh mendaftar lagi, apalagi memakai referral.
 *  - Bonus dibayar sekali per akun pengundang-pengundang (referee unik), dengan
 *    batas harian supaya tidak bisa dijadikan mesin cetak saldo.
 */
const crypto = require('crypto');
const db = require('../data/database');
const store = require('./store');
const { logInfo, logWarn } = require('../core/logger');

/* ── pengaturan bonus (bisa diubah lewat env) ── */
const BONUS_REFEREE = Number(process.env.REF_BONUS_REFEREE ?? 1000);  // saldo untuk yang mendaftar
const BONUS_REFERRER = Number(process.env.REF_BONUS_REFERRER ?? 1000); // saldo untuk pengundang
const DAILY_LIMIT = Number(process.env.REF_DAILY_LIMIT ?? 10);        // maks undangan berbayar/hari
const REQUIRE_WA_VERIFIED = true;                                     // pendaftar wajib nomor terverifikasi

const normNumber = (n) => String(n || '').replace(/[^0-9]/g, '');
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/* ───────────────────────── kode referral ───────────────────────── */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa I/O/0/1 supaya tidak salah baca

function randomCode(len = 7) {
    let out = '';
    for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
    return out;
}

/** Pastikan akun punya kode referral; dibuat sekali lalu dipakai terus. */
function ensureCode(accountId) {
    const acc = store.getAccountById(accountId);
    if (!acc) throw new Error('Akun tidak ditemukan.');
    if (acc.ref_code) return acc.ref_code;
    for (let i = 0; i < 8; i++) {
        const code = randomCode();
        if (store.getAccountByRefCode(code)) continue;
        try {
            store.setRefCode(accountId, code);
            return code;
        } catch { /* bentrok unik, coba lagi */ }
    }
    throw new Error('Gagal membuat kode referral. Coba lagi.');
}

/* ───────────────────────── perangkat ───────────────────────── */

/**
 * Sidik perangkat: IP + User-Agent (dinormalisasi).
 * Bukan pengaman absolut (IP bisa berubah), tapi cukup untuk menahan
 * pembuatan akun berulang dari HP yang sama demi bonus referral.
 */
function deviceHash(req) {
    const ua = String(req?.headers?.['user-agent'] || '').trim();
    const ip = String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '')
        .split(',')[0].trim();
    if (!ip && !ua) return '';
    return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32);
}

/** Akun lain di perangkat yang sama (null bila belum ada). */
function deviceOwner(hash) {
    if (!hash) return null;
    return store.getAccountByDevice(hash);
}

/* ───────────────────────── bonus ───────────────────────── */

/** Tambah saldo user bot (dibuatkan bila belum ada). */
function addBalance(waNumber, amount, { kind = 'referral', note = '' } = {}) {
    const n = normNumber(waNumber);
    if (!n || !amount) return 0;
    const u = db.getUser(n);
    u.money = (u.money || 0) + Number(amount);
    db.markDirty();
    db.addLedger(n, { kind, amount: Number(amount), balanceAfter: u.money, note: note || 'Bonus referral' });
    return u.money;
}

/**
 * Validasi kode referral sebelum akun dibuat.
 * @returns {{account:object, code:string}}
 */
function resolveCode(code) {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) throw new Error('Kode referral kosong.');
    const acc = store.getAccountByRefCode(clean);
    if (!acc) throw new Error('Kode referral tidak ditemukan. Periksa lagi.');
    return { account: acc, code: clean };
}

/**
 * Catat referral setelah akun baru berhasil dibuat.
 * Mengembalikan { referrer, bonusReferee, bonusReferrer, status, reason }.
 */
function attachReferral({ code, refereeAccount, refereeWa, deviceHash: device }) {
    const { account: referrer, code: clean } = resolveCode(code);
    if (referrer.id === refereeAccount.id) throw new Error('Tidak bisa memakai kode referral sendiri.');

    // --- kunci 1 akun per perangkat ---
    if (device) {
        const other = store.getAccountByDevice(device, refereeAccount.id);
        if (other) {
            store.createReferral({
                referrerId: referrer.id, refereeId: refereeAccount.id, code: clean,
                status: 'rejected', reason: 'perangkat sudah punya akun lain'
            });
            logWarn('REFERRAL', `Ditolak: perangkat sudah dipakai akun #${other.id}`);
            return { referrer, status: 'rejected', reason: 'Perangkat ini sudah punya akun. Bonus referral tidak berlaku.', bonusReferee: 0, bonusReferrer: 0 };
        }
    }

    // --- nomor penerima bonus harus terverifikasi ---
    if (REQUIRE_WA_VERIFIED && !refereeWa) {
        store.createReferral({
            referrerId: referrer.id, refereeId: refereeAccount.id, code: clean,
            status: 'rejected', reason: 'nomor WA belum terverifikasi'
        });
        return { referrer, status: 'rejected', reason: 'Nomor WhatsApp belum terverifikasi.', bonusReferee: 0, bonusReferrer: 0 };
    }

    // --- batas harian pengundang ---
    const today = store.countReferralsSince(referrer.id, dayStart());
    const overLimit = today >= DAILY_LIMIT;

    store.createReferral({
        referrerId: referrer.id, refereeId: refereeAccount.id, code: clean,
        status: overLimit ? 'pending' : 'pending',
        reason: overLimit ? `batas harian (${DAILY_LIMIT}) tercapai — bonus menyusul` : ''
    });

    return {
        referrer, code: clean,
        status: overLimit ? 'limited' : 'pending',
        reason: overLimit ? `Pengundang sudah mencapai batas ${DAILY_LIMIT} undangan hari ini.` : '',
        bonusReferee: overLimit ? 0 : BONUS_REFEREE,
        bonusReferrer: overLimit ? 0 : BONUS_REFERRER
    };
}

/**
 * Bayar bonus referral untuk seorang referee (dipanggil setelah akun aktif).
 * Aman dipanggil berkali-kali: hanya membayar sekali.
 */
function payout(refereeAccountId) {
    const ref = store.getReferral(refereeAccountId);
    if (!ref || ref.status === 'paid' || ref.status === 'rejected') return null;

    const referee = store.getAccountById(refereeAccountId);
    const referrer = store.getAccountById(ref.referrer_id);
    if (!referee || !referrer) return null;

    const today = store.countReferralsSince(referrer.id, dayStart());
    if (today > DAILY_LIMIT) {
        store.db.prepare("UPDATE referrals SET status = 'pending', reason = ? WHERE id = ?")
            .run(`batas harian (${DAILY_LIMIT}) tercapai — bonus menyusul`, ref.id);
        return null;
    }

    const waReferee = normNumber(referee.wa_number);
    const waReferrer = normNumber(referrer.wa_number);
    if (!waReferee || !waReferrer) return null;

    // bonus untuk pendaftar
    if (!referee.ref_paid) {
        addBalance(waReferee, BONUS_REFEREE);
        store.markReferralPaid(refereeAccountId, BONUS_REFEREE);
    }
    // bonus untuk pengundang (sekali per referee — dijaga status paid)
    addBalance(waReferrer, BONUS_REFERRER);

    try {
        const sock = global.__mainSock;
        if (sock) {
            sock.sendMessage(`${waReferrer}@s.whatsapp.net`, {
                text: `🎉 *Bonus Referral!*\n\nAkun baru memakai kode *${ref.code}*.\n💰 Saldo masuk: *Rp ${BONUS_REFERRER.toLocaleString('id-ID')}*\n\nTerus undang teman untuk tambah saldo!`
            }).catch(() => {});
        }
    } catch {}

    logInfo('REFERRAL', `Bonus dibayar: pengundang #${referrer.id} +Rp${BONUS_REFERRER}, pendaftar #${referee.id} +Rp${BONUS_REFEREE}`);
    return { bonusReferee: BONUS_REFEREE, bonusReferrer: BONUS_REFERRER };
}

/** Ringkasan referral untuk halaman web. */
function summary(account) {
    const code = ensureCode(account.id);
    const list = store.listReferrals(account.id);
    const wa = normNumber(account.wa_number);
    return {
        code,
        // alamat panel aktif (owner bisa mengubahnya dari web) — selalu dinormalkan tanpa path
        link: `${(() => { try { return require('./auth').baseUrl(null); } catch { return 'https://panel.manzxy.biz.id'; } })()}/panel?ref=${code}`,
        bonusReferee: BONUS_REFEREE,
        bonusReferrer: BONUS_REFERRER,
        dailyLimit: DAILY_LIMIT,
        dailyUsed: store.countReferralsSince(account.id, dayStart()),
        total: list.total,
        paid: list.paid,
        pending: list.pending,
        balance: wa ? (db.data.users?.[wa]?.money || 0) : 0,
        rows: list.rows.map((r) => ({
            name: r.display_name || (r.email ? String(r.email).split('@')[0] : 'Pengguna'),
            status: r.status,
            bonus: r.bonus,
            bonusText: r.bonus ? `Rp${Number(r.bonus).toLocaleString('id-ID')}` : '-',
            reason: r.reason || '',
            at: r.created_at,
            atText: require('../core/utils').formatDateTime(new Date(r.created_at))
        }))
    };
}

module.exports = {
    ensureCode, randomCode, resolveCode, attachReferral, payout, summary,
    deviceHash, deviceOwner, addBalance,
    BONUS_REFEREE, BONUS_REFERRER, DAILY_LIMIT
};
