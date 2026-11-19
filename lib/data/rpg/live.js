/**
 * RPG ENGINE — rpg/live.js
 * Sistem "tetap hidup" untuk membuat pemain betah: quest harian, login streak,
 * combo berburu, world event yang berotasi, bounty, dan misi mingguan.
 *
 * Semua data disimpan di profil pemain (`p.daily`, `p.combo`, `p.streak`) atau
 * di koleksi global db (`db.data.worldEvents`). Modul ini murni logika.
 */

const core = require('./core');
const items = require('./items');

const DAY = 86400000;

/** Tanggal lokal dalam format YYYY-MM-DD (basis "hari ini"). */
function dayKey(date = new Date()) {
    const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Selisih hari antara dua dayKey. */
function daysBetween(a, b) {
    if (!a || !b) return Infinity;
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY);
}

/* ───────────────────────── DAILY QUEST ───────────────────────── */

/**
 * Pool quest harian. `kind` menentukan cara progres dihitung:
 *  - 'kills'  : total kill monster
 *  - 'boss'   : kill boss
 *  - 'gold'   : gold didapat
 *  - 'dungeon': selesai dungeon
 *  - 'raid'   : ikut raid
 * Empat quest dipilih tiap hari secara deterministik dari tanggal + nomor user,
 * jadi semua orang beda tapi konsisten sepanjang hari.
 */
const QUEST_POOL = [
    { id: 'kills_10', kind: 'kills', need: 10, name: 'Bersihkan Padang', desc: 'Kalahkan 10 monster', gold: 800, exp: 400, dust: 10 },
    { id: 'kills_25', kind: 'kills', need: 25, name: 'Sapu Bersih', desc: 'Kalahkan 25 monster', gold: 2000, exp: 1000, dust: 25 },
    { id: 'kills_50', kind: 'kills', need: 50, name: 'Pembantaian', desc: 'Kalahkan 50 monster', gold: 4500, exp: 2200, dust: 60 },
    { id: 'boss_1', kind: 'boss', need: 1, name: 'Tumbangkan Boss', desc: 'Kalahkan 1 boss', gold: 2500, exp: 1500, dust: 30, item: 'potion_l' },
    { id: 'boss_3', kind: 'boss', need: 3, name: 'Pemburu Boss', desc: 'Kalahkan 3 boss', gold: 7000, exp: 4000, dust: 90, item: 'elixir' },
    { id: 'gold_5000', kind: 'gold', need: 5000, name: 'Kantong Tebal', desc: 'Kumpulkan 5.000 gold', gold: 1200, exp: 600, dust: 15 },
    { id: 'gold_20000', kind: 'gold', need: 20000, name: 'Sultan Sehari', desc: 'Kumpulkan 20.000 gold', gold: 5000, exp: 2500, dust: 70 },
    { id: 'dungeon_1', kind: 'dungeon', need: 1, name: 'Penjelajah Ruang', desc: 'Selesaikan 1 dungeon', gold: 3000, exp: 1800, dust: 40, item: 'scroll_exp' },
    { id: 'raid_1', kind: 'raid', need: 1, name: 'Kekuatan Bersama', desc: 'Ikut 1 raid', gold: 4000, exp: 2000, dust: 50 },
    { id: 'kills_15', kind: 'kills', need: 15, name: 'Rutinitas', desc: 'Kalahkan 15 monster', gold: 1100, exp: 550, dust: 12 }
];

/** Pilih 4 quest harian untuk user (deterministik per tanggal + nomor). */
function dailyQuests(userNumber, date = new Date()) {
    const key = dayKey(date);
    let seed = 0;
    const s = `${key}:${userNumber}`;
    for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
    const pool = [...QUEST_POOL];
    const picked = [];
    for (let i = 0; i < 4 && pool.length; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        picked.push(pool.splice(seed % pool.length, 1)[0]);
    }
    return picked;
}

/** Pastikan struktur quest harian user untuk hari ini sudah dibuat. */
function ensureDaily(p, userNumber, date = new Date()) {
    const key = dayKey(date);
    p.daily = p.daily || {};
    if (p.daily.key !== key) {
        p.daily = {
            key,
            quests: dailyQuests(userNumber, date).map((q) => ({ id: q.id, prog: 0, claimed: false })),
            streak: p.daily.streak || 0
        };
    }
    return p.daily;
}

const questDef = (id) => QUEST_POOL.find((q) => q.id === id);

/** Tambah progres untuk semua quest harian yang cocok dengan `kind`. */
function addDailyProgress(p, userNumber, kind, amount = 1) {
    const d = ensureDaily(p, userNumber);
    let changed = false;
    for (const st of d.quests) {
        const def = questDef(st.id);
        if (!def || def.kind !== kind || st.claimed) continue;
        const before = st.prog;
        st.prog = Math.min(def.need, st.prog + amount);
        if (st.prog !== before) changed = true;
    }
    return changed;
}

/** Status lengkap quest harian untuk ditampilkan. */
function dailyStatus(p, userNumber) {
    const d = ensureDaily(p, userNumber);
    return d.quests.map((st) => {
        const def = questDef(st.id);
        return {
            ...def,
            prog: st.prog,
            claimed: st.claimed,
            done: st.prog >= def.need
        };
    });
}

/** Klaim satu quest harian. Mengembalikan {ok, reward} atau {error}. */
function claimDaily(p, userNumber, questId) {
    const d = ensureDaily(p, userNumber);
    const st = d.quests.find((q) => q.id === questId);
    if (!st) return { error: 'Quest itu tidak ada di daftar hari ini.' };
    const def = questDef(questId);
    if (!def) return { error: 'Quest tidak dikenal.' };
    if (st.claimed) return { error: 'Quest itu sudah diklaim.' };
    if (st.prog < def.need) return { error: `Belum selesai (${st.prog}/${def.need}).` };

    st.claimed = true;
    p.gold += def.gold;
    p.stats.goldEarned += def.gold;
    p.enchant = p.enchant || { dust: 0 };
    p.enchant.dust = (p.enchant.dust || 0) + (def.dust || 0);
    if (def.item) items.addItem(p, def.item, 1);
    const lvl = core.addExp(p, def.exp);

    const allDone = d.quests.every((q) => q.claimed);
    let bonus = null;
    if (allDone) {
        // Bonus menyelesaikan semua quest: hadiah besar sekali per hari
        const bGold = 5000, bDust = 100;
        p.gold += bGold;
        p.enchant.dust += bDust;
        bonus = { gold: bGold, dust: bDust };
    }
    return { ok: true, def, levelUp: lvl.levelUp, levels: lvl.levels, allDone, bonus };
}

/* ───────────────────────── LOGIN STREAK ───────────────────────── */

/**
 * Streak login harian. Semakin panjang streak, semakin besar bonus.
 * Dihitung saat pemain pertama kali berburu/klaim hari itu.
 */
const STREAK_MILESTONES = {
    3: { name: 'Konsisten', emoji: '🔥', item: 'potion_m' },
    7: { name: 'Seminggu Penuh', emoji: '💎', item: 'scroll_exp' },
    14: { name: 'Dua Minggu', emoji: '🏆', item: 'elixir' },
    30: { name: 'Sebulan Tanpa Putus', emoji: '👑', item: 'phoenix_tear' }
};

/**
 * Catat kehadiran hari ini. `p.streak = { last, days }`.
 * @returns {{ isNew, days, bonus, milestone }}
 */
function touchStreak(p, date = new Date()) {
    p.streak = p.streak || { last: null, days: 0 };
    const today = dayKey(date);
    if (p.streak.last === today) return { isNew: false, days: p.streak.days, bonus: null, milestone: null };

    const gap = daysBetween(p.streak.last, today);
    p.streak.days = gap === 1 ? p.streak.days + 1 : 1;
    p.streak.last = today;

    // Bonus streak: gold + exp naik sampai hari ke-7, lalu tetap
    const mult = Math.min(p.streak.days, 7);
    const gold = 200 * mult;
    const exp = 100 * mult;
    p.gold += gold;
    p.stats.goldEarned += gold;
    const lvl = core.addExp(p, exp);

    const milestone = STREAK_MILESTONES[p.streak.days] || null;
    if (milestone?.item) items.addItem(p, milestone.item, 1);

    return { isNew: true, days: p.streak.days, bonus: { gold, exp }, milestone, levelUp: lvl.levelUp, levels: lvl.levels };
}

/* ───────────────────────── COMBO ───────────────────────── */

/**
 * Combo: berburu berturut-turut dalam waktu singkat menaikkan pengali reward.
 * Reset bila jeda terlalu lama (COMBO_WINDOW).
 */
const COMBO_WINDOW = 90000;       // 90 detik
const COMBO_MAX = 10;

/** Perbarui combo setelah satu kemenangan. */
function bumpCombo(p, date = Date.now()) {
    p.combo = p.combo || { count: 0, last: 0, best: 0 };
    const gap = date - (p.combo.last || 0);
    p.combo.count = gap <= COMBO_WINDOW ? Math.min(COMBO_MAX, p.combo.count + 1) : 1;
    p.combo.last = date;
    p.combo.best = Math.max(p.combo.best || 0, p.combo.count);
    return p.combo.count;
}

/** Reset combo (misal saat kalah). */
function resetCombo(p) {
    p.combo = p.combo || { count: 0, last: 0, best: 0 };
    p.combo.count = 0;
    p.combo.last = 0;
    return 0;
}

/** Pengali reward dari combo berjalan. */
function comboMultiplier(p, date = Date.now()) {
    const c = p.combo || { count: 0, last: 0 };
    if (!c.count || date - (c.last || 0) > COMBO_WINDOW) return 1;
    // +8% per combo, maksimal +72% di combo 10
    return 1 + Math.min(c.count, COMBO_MAX) * 0.08;
}

/** Sisa waktu combo dalam milidetik. */
function comboRemaining(p, date = Date.now()) {
    const c = p.combo || {};
    if (!c.count) return 0;
    return Math.max(0, (c.last || 0) + COMBO_WINDOW - date);
}

/* ───────────────────────── WORLD EVENT ───────────────────────── */

/**
 * World event global: berotasi tiap 4 jam dan berlaku untuk semua pemain.
 * Disimpan di db.data.worldEvents agar antar-sesi konsisten.
 */
const WORLD_EVENTS = [
    { id: 'none', name: 'Tenang', emoji: '🌤️', desc: 'Tidak ada kejadian khusus.', mul: {} },
    { id: 'blood_moon', name: 'Bulan Darah', emoji: '🌕', desc: 'Monster lebih kuat, tapi gold berlimpah.', mul: { gold: 1.5, monsterAtk: 1.2 } },
    { id: 'mana_surge', name: 'Lonjakan Mana', emoji: '💠', desc: 'EXP melimpah dari setiap monster.', mul: { exp: 1.6 } },
    { id: 'treasure_rain', name: 'Hujan Harta', emoji: '🎁', desc: 'Peluang drop meningkat drastis.', mul: { drop: 2.0 } },
    { id: 'eclipse', name: 'Gerhana', emoji: '🌑', desc: 'Boss muncul lebih sering dan lebih kaya.', mul: { gold: 1.3, bossRate: 1.4 } },
    { id: 'hunt_fever', name: 'Demam Berburu', emoji: '🔥', desc: 'Semua reward naik sedikit, combo lebih cepat.', mul: { gold: 1.2, exp: 1.2, drop: 1.2 } }
];

const EVENT_PERIOD = 4 * 3600000;   // 4 jam

/** Event yang aktif saat ini (deterministik berdasarkan blok waktu). */
function currentEvent(date = Date.now()) {
    const block = Math.floor(date / EVENT_PERIOD);
    const ev = WORLD_EVENTS[Math.abs(block) % WORLD_EVENTS.length];
    const end = (block + 1) * EVENT_PERIOD;
    return { ...ev, block, end, remaining: Math.max(0, end - date) };
}

/** Event berikutnya (untuk teaser). */
function nextEvent(date = Date.now()) {
    return currentEvent(date + EVENT_PERIOD);
}

const eventMul = (ev) => ({ gold: 1, exp: 1, drop: 1, monsterAtk: 1, bossRate: 1, ...(ev?.mul || {}) });

/* ───────────────────────── BOUNTY ───────────────────────── */

/**
 * Bounty harian: satu monster jadi target buronan dengan hadiah besar.
 * Deterministik per tanggal sehingga semua orang mengejar target yang sama.
 */
function dailyBounty(date = new Date()) {
    const key = dayKey(date);
    let seed = 0;
    for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
    const monsters = require('./monsters');
    const pool = monsters.BOSS_POOL;
    seed = (seed * 1103515245 + 12345) >>> 0;
    const id = pool[seed % pool.length];
    return {
        key,
        monsterId: id,
        monster: monsters.MONSTERS[id],
        gold: 3000 + (seed % 5) * 1000,
        dust: 50 + (seed % 5) * 25,
        item: ['potion_l', 'scroll_exp', 'sage_amulet'][seed % 3]
    };
}

/** Cek & catat kill bounty. */
function checkBounty(p, date = new Date(), userNumber = '') {
    const b = dailyBounty(date);
    p.bounty = p.bounty || {};
    // Hari baru = reset penuh (hit & claimed), bukan hanya key.
    if (p.bounty.key !== b.key) p.bounty = { key: b.key, claimed: false, hit: false };
    return p.bounty;
}

/** Klaim bounty harian bila sudah dikalahkan. */
function claimBounty(p, date = new Date()) {
    const b = dailyBounty(date);
    const rec = checkBounty(p, date);
    if (rec.claimed) return { error: 'Bounty hari ini sudah kamu klaim.' };
    if (!rec.hit) return { error: 'Kamu belum mengalahkan bounty hari ini.', bounty: b };
    rec.claimed = true;
    p.gold += b.gold;
    p.stats.goldEarned += b.gold;
    p.enchant = p.enchant || { dust: 0, slots: {} };
    p.enchant.dust = (p.enchant.dust || 0) + b.dust;
    if (b.item && items.ITEMS[b.item]) items.addItem(p, b.item, 1);
    return { ok: true, bounty: b };
}

/* ───────────────────────── WEEKLY ───────────────────────── */

/** Misi mingguan: target lebih besar dengan hadiah item langka. */
const WEEKLY_GOAL = {
    kills: 150,
    bosses: 10,
    dungeons: 5,
    raids: 3,
    gold: 100000
};

function weeklyProgress(p) {
    const w = p.weekly || {};
    return [
        { id: 'kills', name: 'Mesin Pembunuh', need: WEEKLY_GOAL.kills, have: w.kills || 0, gold: 15000, dust: 300 },
        { id: 'bosses', name: 'Penakluk Boss', need: WEEKLY_GOAL.bosses, have: w.bosses || 0, gold: 20000, dust: 400 },
        { id: 'dungeons', name: 'Penjelajah', need: WEEKLY_GOAL.dungeons, have: w.dungeons || 0, gold: 12000, dust: 250 },
        { id: 'raids', name: 'Penantang Dunia', need: WEEKLY_GOAL.raids, have: w.raids || 0, gold: 18000, dust: 350 },
        { id: 'gold', name: 'Kolektor Kekayaan', need: WEEKLY_GOAL.gold, have: w.gold || 0, gold: 25000, dust: 500 }
    ].map((x) => ({ ...x, done: x.have >= x.need }));
}

/** Catat progres mingguan. */
function addWeekly(p, field, amount = 1) {
    if (!amount) return;
    p.weekly = p.weekly || { kills: 0, bosses: 0, dungeons: 0, raids: 0, gold: 0, week: weekKey() };
    if (p.weekly.week !== weekKey()) {
        p.weekly = { kills: 0, bosses: 0, dungeons: 0, raids: 0, gold: 0, week: weekKey() };
    }
    p.weekly[field] = (p.weekly[field] || 0) + amount;
}

/** Klaim reward misi mingguan yang sudah selesai (sekali per minggu per misi). */
function claimWeekly(p) {
    p.weekly = p.weekly || { kills: 0, bosses: 0, dungeons: 0, raids: 0, gold: 0, week: weekKey() };
    if (p.weekly.week !== weekKey()) {
        p.weekly = { kills: 0, bosses: 0, dungeons: 0, raids: 0, gold: 0, week: weekKey() };
    }
    p.weekly.claimed = Array.isArray(p.weekly.claimed) ? p.weekly.claimed : [];
    const claimed = [];
    let gold = 0, dust = 0;
    for (const goal of weeklyProgress(p)) {
        if (!goal.done || p.weekly.claimed.includes(goal.id)) continue;
        p.weekly.claimed.push(goal.id);
        gold += goal.gold;
        dust += goal.dust;
        claimed.push(goal);
    }
    if (!claimed.length) return { claimed: [], gold: 0, dust: 0, error: 'Belum ada misi mingguan yang bisa diklaim.' };
    p.gold += gold;
    p.stats.goldEarned += gold;
    p.enchant = p.enchant || { dust: 0, slots: {} };
    p.enchant.dust = (p.enchant.dust || 0) + dust;
    return { claimed, gold, dust };
}

/** Kunci minggu (ISO-ish: tahun-minggu). */
function weekKey(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));    // Senin
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = {
    DAY, dayKey, daysBetween,
    QUEST_POOL, dailyQuests, ensureDaily, addDailyProgress, dailyStatus, claimDaily, questDef,
    STREAK_MILESTONES, touchStreak,
    COMBO_WINDOW, COMBO_MAX, bumpCombo, resetCombo, comboMultiplier, comboRemaining,
    WORLD_EVENTS, currentEvent, nextEvent, eventMul, EVENT_PERIOD,
    dailyBounty, checkBounty, claimBounty,
    WEEKLY_GOAL, weeklyProgress, addWeekly, claimWeekly, weekKey
};
