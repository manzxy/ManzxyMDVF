/**
 * RPG ENGINE — rpg/systems.js
 * Sistem pendukung yang SALING BERHUBUNGAN:
 *   buff ← potion/skill, dipakai combat
 *   pet  ← dibeli/di-tame, memberi bonus stat & ikut bertarung
 *   party/guild → bonus exp & gold saat berburu bersama
 *   craft ← butuh material dari drop monster
 *   enchant ← butuh debu dari jual item / dismantle
 *   achievement → membuka title → memberi bonus permanen
 *   prestige ← reset progres untuk bonus global
 */

const core = require('./core');
const items = require('./items');

/* ───────────────────────── BUFF ───────────────────────── */

/** Definisi buff: id → efek. `statMul` mengalikan turunan, `statBonus` flat. */
const BUFFS = {
    atk_up:  { name: 'Strength', emoji: '🧨', desc: 'ATK +25%',  dmgMul: 1.25 },
    def_up:  { name: 'Shield', emoji: '🧱', desc: 'DEF +30%',  defMul: 1.3 },
    luck_up: { name: 'Fortune', emoji: '🍀', desc: 'Drop +50%', dropMul: 1.5 },
    haste:   { name: 'Haste', emoji: '💨', desc: 'Dodge +15%', dodgeAdd: 0.15 },
    focus:   { name: 'Focus', emoji: '🎯', desc: 'Crit +15%', critAdd: 0.15 },
    bless:   { name: 'Blessing', emoji: '✨', desc: 'EXP +30%',  expMul: 1.3 }
};

/** Terapkan buff (menimpa durasi bila sudah ada). */
function applyBuff(p, id, durationMs) {
    if (!BUFFS[id]) return { error: 'Buff tidak dikenal.' };
    p.buffs = p.buffs || {};
    p.buffs[id] = { until: Date.now() + durationMs };
    return { ok: true, buff: BUFFS[id], until: p.buffs[id].until };
}

/** Buang buff kedaluwarsa & ambil efek gabungan yang masih aktif. */
function activeBuffs(p) {
    const now = Date.now();
    const active = [];
    const eff = { dmgMul: 1, defMul: 1, dropMul: 1, expMul: 1, dodgeAdd: 0, critAdd: 0, statBonus: {} };
    p.buffs = p.buffs || {};
    for (const [id, b] of Object.entries(p.buffs)) {
        if (!b || !b.until || b.until <= now) { delete p.buffs[id]; continue; }
        const def = BUFFS[id];
        if (!def) continue;
        active.push({ id, ...def, until: b.until });
        if (def.dmgMul) eff.dmgMul *= def.dmgMul;
        if (def.defMul) eff.defMul *= def.defMul;
        if (def.dropMul) eff.dropMul *= def.dropMul;
        if (def.expMul) eff.expMul *= def.expMul;
        if (def.dodgeAdd) eff.dodgeAdd += def.dodgeAdd;
        if (def.critAdd) eff.critAdd += def.critAdd;
        if (def.statBonus) for (const k of Object.keys(def.statBonus)) eff.statBonus[k] = (eff.statBonus[k] || 0) + def.statBonus[k];
    }
    return { active, ...eff };
}

/* ───────────────────────── PET ───────────────────────── */

/** Pet: `bonus` per level, `atkRatio` kontribusi damage tambahan. */
const PET_DEFS = {
    slime_pet:   { name: 'Tame Slime', emoji: '🟢', price: 2500, bonus: { vit: 2 }, atkRatio: 0.10, desc: 'A loyal companion that boosts endurance.' },
    wolf_pet:    { name: 'Wolf Pup', emoji: '🐺', price: 6000, bonus: { agi: 3 }, atkRatio: 0.18, desc: 'Fast and aggressive.' },
    phoenix_pet: { name: 'Phoenix Chick', emoji: '🔥', price: 15000, bonus: { int: 4 }, atkRatio: 0.22, desc: 'Scorches foes from afar.' },
    dragon_pet:  { name: 'Mini Dragon', emoji: '🐲', price: 30000, bonus: { str: 5 }, atkRatio: 0.30, desc: "A dragon's might in a tiny body." },
    void_pet:    { name: 'Abyss Shade', emoji: '🌑', price: 50000, bonus: { luk: 6 }, atkRatio: 0.35, desc: 'An entity that brings fortune.' }
};

const petExpToNext = (lv) => Math.floor(60 * Math.pow(1.25, lv - 1));

function adoptPet(p, kind) {
    const def = PET_DEFS[kind];
    if (!def) return { error: 'Pet tidak dikenal.' };
    if (p.pet) return { error: `Kamu sudah punya ${PET_DEFS[p.pet.kind].name}. Lepaskan dulu (.pet lepas).` };
    if (p.gold < def.price) return { error: `Butuh ${def.price} gold.` };
    p.gold -= def.price;
    p.pet = { kind, level: 1, exp: 0, hunger: 100, hiredAt: Date.now() };
    return { ok: true, pet: def };
}

function releasePet(p) {
    if (!p.pet) return { error: 'Tidak ada pet.' };
    const def = PET_DEFS[p.pet.kind];
    p.pet = null;
    return { ok: true, pet: def };
}

function feedPet(p, amount = 1) {
    if (!p.pet) return { error: 'Tidak ada pet.' };
    p.pet.hunger = Math.min(100, (p.pet.hunger || 0) + 20 * amount);
    return { ok: true, hunger: p.pet.hunger };
}

/** Beri pet EXP selepas pertarungan; naik level sesuai kelas. */
function petGainExp(p, amount) {
    if (!p.pet) return { levelUp: false, levels: 0 };
    p.pet.exp = (p.pet.exp || 0) + Math.floor(amount * 0.5);
    let levels = 0;
    while (p.pet.level < 50 && p.pet.exp >= petExpToNext(p.pet.level)) {
        p.pet.exp -= petExpToNext(p.pet.level);
        p.pet.level++;
        levels++;
    }
    return { levelUp: levels > 0, levels };
}

/* ───────────────────────── PARTY & GUILD ───────────────────────── */

/** Bonus party: makin banyak anggota, makin besar (tapi ada batas). */
function partyBonus(memberCount) {
    const n = Math.max(1, Math.min(5, memberCount));
    return { expMul: 1 + (n - 1) * 0.15, goldMul: 1 + (n - 1) * 0.10, size: n };
}

const GUILD_MAX_MEMBERS = 20;

function createGuild(name, owner) {
    return {
        name: String(name).slice(0, 24),
        owner,
        members: [owner],
        level: 1,
        exp: 0,
        bank: 0,
        createdAt: Date.now()
    };
}

const guildExpToNext = (lv) => Math.floor(500 * Math.pow(1.4, lv - 1));

/** Bonus guild berdasarkan level. */
function guildBonus(level) {
    const lv = Math.max(1, level || 1);
    return { expMul: 1 + (lv - 1) * 0.05, goldMul: 1 + (lv - 1) * 0.05, statBonus: { str: lv, vit: lv } };
}

function guildGainExp(guild, amount) {
    guild.exp = (guild.exp || 0) + Math.floor(amount);
    let levels = 0;
    while (guild.level < 30 && guild.exp >= guildExpToNext(guild.level)) {
        guild.exp -= guildExpToNext(guild.level);
        guild.level++;
        levels++;
    }
    return { levelUp: levels > 0, levels };
}

/* ───────────────────────── CRAFTING ───────────────────────── */

/** Craft item dari resep. Mengembalikan item yang dihasilkan. */
function craft(p, itemId) {
    const rec = items.RECIPES[itemId];
    if (!rec) return { error: 'Resep tidak dikenal.' };
    if (p.craft.level < rec.level) return { error: `Butuh level crafting ${rec.level} (kamu ${p.craft.level}).` };
    if (!items.hasItems(p, rec.need)) {
        const missing = Object.entries(rec.need)
            .filter(([id, n]) => (p.inventory[id] || 0) < n)
            .map(([id, n]) => `${items.ITEMS[id]?.name || id} ${p.inventory[id] || 0}/${n}`);
        return { error: `Material kurang: ${missing.join(', ')}` };
    }
    items.consumeItems(p, rec.need);
    items.addItem(p, rec.out, 1);
    p.craft.exp += 40 + rec.level * 10;
    let levels = 0;
    while (p.craft.level < 30 && p.craft.exp >= items.craftExpToNext(p.craft.level)) {
        p.craft.exp -= items.craftExpToNext(p.craft.level);
        p.craft.level++;
        levels++;
    }
    return { ok: true, item: items.ITEMS[rec.out], id: rec.out, levelUp: levels > 0, levels };
}

/* ───────────────────────── ENCHANT ───────────────────────── */

/** Dismantle item → debu enchant. */
function dismantle(p, itemId) {
    if (!(p.inventory[itemId] > 0)) return { error: 'Item tidak ada di tas.' };
    const it = items.ITEMS[itemId];
    if (!it) return { error: 'Item tidak dikenal.' };
    const dust = items.dustValue(itemId);
    items.removeItem(p, itemId, 1);
    p.enchant.dust = (p.enchant.dust || 0) + dust;
    return { ok: true, dust, item: it };
}

/** Biaya debu untuk enchant level berikutnya. */
const enchantCost = (lv) => Math.floor(10 * Math.pow(1.6, lv));

/**
 * Enchant perlengkapan yang sedang dipakai → menambah stat +1 per level
 * ke stat utama item. Disimpan di p.enchant.slots[slot] = level.
 */
function enchant(p, slot) {
    if (!['weapon', 'armor', 'accessory'].includes(slot)) return { error: 'Slot: weapon, armor, accessory' };
    const id = p.equipment[slot];
    if (!id) return { error: 'Slot itu kosong.' };
    p.enchant = p.enchant || { dust: 0 };
    p.enchant.slots = p.enchant.slots || {};
    const lv = p.enchant.slots[slot] || 0;
    if (lv >= 10) return { error: 'Enchant sudah maksimal (+10).' };
    const cost = enchantCost(lv);
    if ((p.enchant.dust || 0) < cost) return { error: `Butuh ${cost} debu (kamu ${p.enchant.dust || 0}).` };
    const successChance = Math.max(0.25, 0.95 - lv * 0.07);
    p.enchant.dust -= cost;
    if (!core.chance(successChance)) return { ok: false, failed: true, cost, chance: successChance, level: lv };
    p.enchant.slots[slot] = lv + 1;
    return { ok: true, level: lv + 1, cost, chance: successChance, item: items.ITEMS[id] };
}

/* ───────────────────────── ACHIEVEMENT & TITLE ───────────────────────── */

/**
 * Achievement: `check(p)` mengembalikan boolean.
 * `title` diberikan saat selesai; title memberi bonus permanen.
 */
const ACHIEVEMENTS = {
    first_blood: { name: 'First Blood', emoji: '🗡️', desc: 'Defeat your first monster.', check: (p) => p.stats.kills >= 1, title: 'Brave Novice', bonus: { str: 1 } },
    hunter_50:   { name: 'True Hunter', emoji: '🏹', desc: 'Defeat 50 monsters.', check: (p) => p.stats.kills >= 50, title: 'Hunter', bonus: { agi: 3 } },
    hunter_500:  { name: 'Hunting Legend', emoji: '🌟', desc: 'Defeat 500 monsters.', check: (p) => p.stats.kills >= 500, title: 'The Legend', bonus: { str: 10, agi: 10 } },
    boss_first:  { name: 'Boss Slayer', emoji: '👑', desc: 'Defeat your first boss.', check: (p) => p.stats.bossKills >= 1, title: 'Conqueror', bonus: { str: 5 } },
    boss_10:     { name: 'Throne Breaker', emoji: '💀', desc: 'Defeat 10 bosses.', check: (p) => p.stats.bossKills >= 10, title: 'Throne Breaker', bonus: { str: 15, vit: 10 } },
    rich:        { name: 'Tycoon', emoji: '💰', desc: 'Hold 50,000 gold.', check: (p) => p.gold >= 50000, title: 'Tycoon', bonus: { luk: 8 } },
    level_30:    { name: 'Seasoned Adventurer', emoji: '⬆️', desc: 'Reach level 30.', check: (p) => p.rpgLevel >= 30, title: 'Seasoned', bonus: { vit: 10 } },
    level_60:    { name: 'Elite', emoji: '🔥', desc: 'Reach level 60.', check: (p) => p.rpgLevel >= 60, title: 'Elite', bonus: { str: 15, int: 15 } },
    crafter:     { name: 'Blacksmith', emoji: '🔨', desc: 'Reach crafting level 5.', check: (p) => p.craft.level >= 5, title: 'Blacksmith', bonus: { str: 3 } },
    enchanter:   { name: 'Enchanter', emoji: '🔮', desc: 'Reach enchant +5 on one slot.', check: (p) => Math.max(0, ...Object.values(p.enchant?.slots || {})) >= 5, title: 'Enchanter', bonus: { int: 8 } },
    collector:   { name: 'Collector', emoji: '🎒', desc: 'Own 15 different item types.', check: (p) => Object.keys(p.inventory).length >= 15, title: 'Collector', bonus: { luk: 5 } },
    survivor:    { name: 'Unbroken', emoji: '💪', desc: 'Endure 20 defeats.', check: (p) => p.stats.deaths >= 20, title: 'Unbroken', bonus: { vit: 8 } }
};

/** Cek semua achievement; kembalikan yang baru terbuka. */
function checkAchievements(p) {
    p.achievements = p.achievements || [];
    const unlocked = [];
    for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
        if (p.achievements.includes(id)) continue;
        let ok = false;
        try { ok = a.check(p); } catch { ok = false; }
        if (ok) {
            p.achievements.push(id);
            if (a.title && !p.titles.includes(a.title)) p.titles.push(a.title);
            unlocked.push({ id, ...a });
        }
    }
    return unlocked;
}

/** Bonus stat dari semua achievement yang sudah terbuka. */
function achievementBonus(p) {
    const b = {};
    for (const id of p.achievements || []) {
        const a = ACHIEVEMENTS[id];
        if (!a?.bonus) continue;
        for (const k of Object.keys(a.bonus)) b[k] = (b[k] || 0) + a.bonus[k];
    }
    return b;
}

/* ───────────────────────── PRESTIGE ───────────────────────── */

const PRESTIGE_MIN_LEVEL = 50;

/** Syarat prestige: level ≥ 50. Reset level, dapat bonus permanen. */
function canPrestige(p) {
    return p.rpgLevel >= PRESTIGE_MIN_LEVEL;
}

function prestige(p) {
    if (!canPrestige(p)) return { error: `Butuh level ${PRESTIGE_MIN_LEVEL} (kamu ${p.rpgLevel}).` };
    p.prestige = (p.prestige || 0) + 1;
    p.rpgLevel = 1;
    p.rpgExp = 0;
    p.statPoints = 5;
    for (const k of Object.keys(core.BASE_STAT)) p.points[k] = 0;
    p.hp = null;
    p.mp = null;
    p.mpUpdatedAt = Date.now();
    p.gold = Math.floor(p.gold * 0.5);
    return { ok: true, prestige: p.prestige, bonus: p.prestige * 5 };
}

module.exports = {
    BUFFS, applyBuff, activeBuffs,
    PET_DEFS, petExpToNext, adoptPet, releasePet, feedPet, petGainExp,
    partyBonus, GUILD_MAX_MEMBERS, createGuild, guildExpToNext, guildBonus, guildGainExp,
    craft, dismantle, enchant, enchantCost,
    ACHIEVEMENTS, checkAchievements, achievementBonus,
    PRESTIGE_MIN_LEVEL, canPrestige, prestige
};
