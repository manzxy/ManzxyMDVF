/**
 * RPG ENGINE — rpg/core.js
 * Inti: konstanta, RNG, profil, stat, leveling, elemen, combat, dan pencarian fuzzy.
 * Semua sistem lain (items, monsters, systems, story) bergantung pada modul ini.
 */

const MAX_LEVEL = 120;
const STAT_POINTS_PER_LEVEL = 5;
const BASE_STAT = { str: 5, agi: 5, vit: 5, int: 5, luk: 5 };

/**
 * 8 kelas. `growth` = distribusi stat otomatis tiap naik level.
 * `skill` = skill utama, `unlock` = skill tambahan pada level tertentu.
 */
const CLASSES = {
    warrior: {
        name: 'Warrior', title: 'Ksatria Baja', emoji: '⚔️', role: 'Tank/DPS',
        desc: 'Frontline fighter. Highest HP and defence, steady damage.',
        growth: { str: 3, vit: 2, agi: 1, int: 0, luk: 0 },
        element: 'earth', weapon: 'sword',
        skill: { id: 'cleave', name: 'Cleave', cost: 8, power: 1.8, desc: 'Tebasan lebar, damage besar ke satu target.' },
        unlock: [{ lv: 15, id: 'iron_will', name: 'Iron Will', cost: 20, defMul: 2.0, dur: 3, desc: 'DEF ×2 for 3 turns.' }]
    },
    mage: {
        name: 'Mage', title: 'Penyihir Elemen', emoji: '🔮', role: 'Burst Magic',
        desc: 'Highest magic damage in the game, lowest HP.',
        growth: { int: 3, luk: 2, vit: 1, agi: 1, str: 0 },
        element: 'fire', weapon: 'staff',
        skill: { id: 'meteor', name: 'Meteor', cost: 12, power: 2.4, desc: 'Hujan meteor, damage sihir masif.' },
        unlock: [{ lv: 15, id: 'mana_font', name: 'Mana Font', cost: 0, restoreMp: 0.35, desc: 'Restores 35% MP.' }]
    },
    archer: {
        name: 'Archer', title: 'Pemburu Bayangan', emoji: '🏹', role: 'Crit DPS',
        desc: 'Fast attacks with the highest crit chance.',
        growth: { agi: 3, luk: 2, str: 2, vit: 1, int: 0 },
        element: 'wind', weapon: 'bow',
        skill: { id: 'pierce', name: 'Piercing Shot', cost: 9, power: 2.0, desc: 'Panah menembus, kritikal sangat tinggi.' },
        unlock: [{ lv: 15, id: 'rain_arrows', name: 'Rain of Arrows', cost: 18, power: 2.8, desc: 'Hujan panah beruntun.' }]
    },
    cleric: {
        name: 'Cleric', title: 'Pendeta Cahaya', emoji: '✨', role: 'Support/Healer',
        desc: 'Menyembuhkan diri sendiri, tahan banting di pertarungan panjang.',
        growth: { int: 2, vit: 3, luk: 1, agi: 1, str: 0 },
        element: 'light', weapon: 'staff',
        skill: { id: 'holy_heal', name: 'Holy Heal', cost: 10, heal: 0.45, power: 1.2, desc: 'Restore 45% HP while striking with holy light.' },
        unlock: [
            { lv: 15, id: 'sanctuary', name: 'Sanctuary', cost: 25, heal: 0.8, desc: 'Restores 80% HP at once.' },
            { lv: 25, id: 'holy_smite', name: 'Holy Smite', cost: 20, power: 2.8, desc: 'A devastating judgement of light.' }
        ]
    },
    rogue: {
        name: 'Rogue', title: 'Pencuri Nokturnal', emoji: '🗡️', role: 'Loot/DPS',
        desc: 'Highest loot and gold chance. A specialist of spoils.',
        growth: { agi: 3, luk: 3, str: 1, vit: 1, int: 0 },
        element: 'dark', weapon: 'dagger',
        skill: { id: 'backstab', name: 'Backstab', cost: 8, power: 2.1, desc: 'A backstab with bonus loot.' },
        unlock: [{ lv: 15, id: 'shadow_step', name: 'Shadow Step', cost: 14, dodgeAdd: 0.3, desc: 'Dodge +30% for the fight.' }]
    },
    necromancer: {
        name: 'Necromancer', title: 'Penjinak Kematian', emoji: '💀', role: 'DoT/Summon',
        desc: 'Summons death energy. Damage rises with your kill count.',
        growth: { int: 3, vit: 2, luk: 1, agi: 1, str: 0 },
        element: 'dark', weapon: 'staff',
        skill: { id: 'soul_drain', name: 'Soul Drain', cost: 14, power: 1.6, drain: 0.4, desc: 'Drains 40% of damage as HP.' },
        unlock: [{ lv: 15, id: 'army_dead', name: 'Army of the Dead', cost: 30, power: 3.6, desc: 'Pasukan bangkit menyerang.' }]
    },
    paladin: {
        name: 'Paladin', title: 'Pelindung Suci', emoji: '🛡️', role: 'Tank/Healer',
        desc: 'Warrior and Cleric combined. Very hard to kill.',
        growth: { str: 2, vit: 3, int: 2, luk: 1, agi: 0 },
        element: 'light', weapon: 'sword',
        skill: { id: 'divine_shield', name: 'Divine Shield', cost: 12, heal: 0.25, defMul: 1.5, power: 1.1, desc: 'Heal 25% HP, DEF naik, sambil menyerang.' },
        unlock: [{ lv: 15, id: 'judgment', name: 'Judgment', cost: 24, power: 3.3, desc: 'Hukuman ilahi.' }]
    },
    berserker: {
        name: 'Berserker', title: 'Pembantai Liar', emoji: '🪓', role: 'Glass Cannon',
        desc: 'Semakin rendah HP, semakin besar damage. Berisiko tinggi.',
        growth: { str: 4, agi: 2, vit: 1, luk: 1, int: 0 },
        element: 'fire', weapon: 'axe',
        skill: { id: 'rage', name: 'Rage', cost: 10, power: 2.2, lowHpBonus: true, desc: 'Damage spikes as HP drops.' },
        unlock: [{ lv: 15, id: 'last_stand', name: 'Last Stand', cost: 20, power: 4.0, lowHpBonus: true, desc: 'A devastating final stand.' }]
    }
};

/** Alias kelas (Indonesia + Inggris). */
const CLASS_ALIASES = {
    warrior: 'warrior', ksatria: 'warrior', tank: 'warrior', petarung: 'warrior', prajurit: 'warrior',
    mage: 'mage', penyihir: 'mage', wizard: 'mage', sihir: 'mage', magician: 'mage',
    archer: 'archer', pemanah: 'archer', hunter: 'archer', pemburu: 'archer', panah: 'archer',
    cleric: 'cleric', pendeta: 'cleric', priest: 'cleric', healer: 'cleric', penyembuh: 'cleric',
    rogue: 'rogue', pencuri: 'rogue', assassin: 'rogue', pembunuh: 'rogue', bandit: 'rogue',
    necromancer: 'necromancer', necro: 'necromancer', pemanggil: 'necromancer', dukun: 'necromancer',
    paladin: 'paladin', pelindung: 'paladin', suci: 'paladin', holy: 'paladin',
    berserker: 'berserker', barbar: 'berserker', barbarian: 'berserker', liar: 'berserker'
};

/** Elemen & keunggulan (siklus 5 arah). */
const ELEMENTS = {
    fire:  { name: 'Api',       emoji: '🔥', strong: 'wind'  },
    wind:  { name: 'Angin',     emoji: '🌪️', strong: 'earth' },
    earth: { name: 'Tanah',     emoji: '🪨', strong: 'light' },
    light: { name: 'Cahaya',    emoji: '🌟', strong: 'dark'  },
    dark:  { name: 'Kegelapan', emoji: '🌑', strong: 'fire'  }
};

const ELEMENT_CHAIN = ['fire', 'wind', 'earth', 'light', 'dark'];

/* ───────────────────────── RNG ───────────────────────── */

let rng = Math.random;
function setRng(fn) { rng = typeof fn === 'function' ? fn : Math.random; }
const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const randFloat = (min, max) => rng() * (max - min) + min;
const pick = (arr) => (arr && arr.length ? arr[Math.floor(rng() * arr.length)] : undefined);
const chance = (p) => rng() < p;

/* ───────────────────────── PENCARIAN FUZZY ───────────────────────── */

/** Normalisasi teks: huruf kecil, buang tanda baca & spasi ganda. */
const norm = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Cari id dari katalog berdasarkan id persis, alias, atau bagian nama.
 * @param {object} table  kamus id → objek (harus punya `.name`)
 * @param {string} query  input pengguna
 * @param {object} aliases peta alias → id (opsional)
 * @param {string[]} order urutan id untuk tie-break (opsional)
 */
function findKey(table, query, aliases = {}, order = null) {
    const q = norm(query);
    if (!q) return null;
    const ids = order || Object.keys(table);

    // 1. id persis
    if (table[q]) return q;

    // 2. alias persis
    if (aliases[q]) return aliases[q];

    // 3. id yang mengandung query atau sebaliknya
    const byId = ids.find((id) => id === q) || ids.find((id) => norm(id) === q);
    if (byId) return byId;

    // 4. nama item mengandung query (atau sebaliknya)
    const candidates = [];
    for (const id of ids) {
        const name = norm(table[id]?.name || '');
        if (!name) continue;
        if (name === q) return id;
        if (name.includes(q)) candidates.push({ id, score: name.indexOf(q) });
        else if (q.includes(name)) candidates.push({ id, score: 100 - name.length });
    }
    if (candidates.length) {
        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].id;
    }

    // 5. per kata: semua kata kunci harus ada di nama
    const words = q.split(' ').filter(Boolean);
    if (words.length > 1) {
        const hit = ids.find((id) => {
            const name = norm(table[id]?.name || '');
            return words.every((w) => name.includes(w) || norm(id).includes(w));
        });
        if (hit) return hit;
    }
    return null;
}

/* ───────────────────────── PROFIL ───────────────────────── */

function createProfile(user, classId) {
    const cls = CLASSES[classId];
    const allocations = {};
    for (const k of Object.keys(BASE_STAT)) allocations[k] = 0;
    return {
        class: classId,
        job: cls.name,
        rpgLevel: 1,
        rpgExp: 0,
        statPoints: 5,
        points: { ...allocations },
        hp: null,
        mp: null,
        mpUpdatedAt: 0,
        gold: 0,
        inventory: {},
        equipment: { weapon: null, armor: null, accessory: null },
        skills: { [cls.skill.id]: 1 },
        unlocked: {},
        quest: { active: null, completed: [], chapter: 0 },
        stats: { kills: 0, deaths: 0, bossKills: 0, dungeons: 0, raids: 0, goldEarned: 0, damageDealt: 0, created: Date.now() },
        cooldowns: {},
        killed: {},
        title: '',
        lastHunt: 0,
        partyId: null,
        guildId: null,
        pet: null,
        craft: { level: 1, exp: 0 },
        enchant: { dust: 0, slots: {} },
        buffs: {},
        achievements: [],
        titles: [],
        prestige: 0,
        tournament: { best: null, wins: 0 },
        daily: { lastRaid: 0, raidStreak: 0 },
        lastSeason: '',
        codex: {}
    };
}

/** Normalisasi profil lama agar selalu punya field terbaru. */
function syncProfile(p) {
    if (!p) return null;
    const cls = CLASSES[p.class] || CLASSES.warrior;
    p.class = p.class && CLASSES[p.class] ? p.class : 'warrior';
    p.job = cls.name;
    p.rpgLevel = Math.max(1, Math.floor(Number(p.rpgLevel) || 1));
    p.rpgExp = Math.max(0, Math.floor(Number(p.rpgExp) || 0));
    p.statPoints = Math.max(0, Math.floor(Number(p.statPoints) || 0));
    p.points = p.points && typeof p.points === 'object' ? p.points : {};
    for (const k of Object.keys(BASE_STAT)) p.points[k] = Math.max(0, Number(p.points[k]) || 0);
    p.inventory = p.inventory && typeof p.inventory === 'object' ? p.inventory : {};
    p.equipment = p.equipment || { weapon: null, armor: null, accessory: null };
    for (const k of ['weapon', 'armor', 'accessory']) if (p.equipment[k] === undefined) p.equipment[k] = null;
    p.skills = p.skills && typeof p.skills === 'object' ? p.skills : {};
    if (!p.skills[cls.skill.id]) p.skills[cls.skill.id] = 1;
    p.unlocked = p.unlocked && typeof p.unlocked === 'object' ? p.unlocked : {};
    p.quest = p.quest && typeof p.quest === 'object' ? p.quest : { active: null, completed: [], chapter: 0 };
    if (!Array.isArray(p.quest.completed)) p.quest.completed = [];
    if (!Number.isFinite(p.quest.chapter)) p.quest.chapter = 0;
    p.stats = p.stats && typeof p.stats === 'object' ? p.stats : {};
    const zero = { kills: 0, deaths: 0, bossKills: 0, dungeons: 0, raids: 0, goldEarned: 0, damageDealt: 0, created: Date.now() };
    for (const k of Object.keys(zero)) if (!Number.isFinite(p.stats[k])) p.stats[k] = zero[k];
    p.cooldowns = p.cooldowns && typeof p.cooldowns === 'object' ? p.cooldowns : {};
    p.killed = p.killed && typeof p.killed === 'object' ? p.killed : {};
    p.codex = p.codex && typeof p.codex === 'object' ? p.codex : {};
    p.gold = Math.max(0, Math.floor(Number(p.gold) || 0));
    if (typeof p.title !== 'string') p.title = '';
    if (p.partyId === undefined) p.partyId = null;
    if (p.guildId === undefined) p.guildId = null;
    if (p.pet === undefined) p.pet = null;
    if (p.craft === undefined || typeof p.craft !== 'object') p.craft = { level: 1, exp: 0 };
    else { if (!Number.isFinite(p.craft.level)) p.craft.level = 1; if (!Number.isFinite(p.craft.exp)) p.craft.exp = 0; }
    if (p.enchant === undefined || typeof p.enchant !== 'object') p.enchant = { dust: 0, slots: {} };
    else {
        if (!Number.isFinite(p.enchant.dust)) p.enchant.dust = 0;
        if (!p.enchant.slots || typeof p.enchant.slots !== 'object') p.enchant.slots = {};
    }
    if (p.buffs === undefined || typeof p.buffs !== 'object') p.buffs = {};
    if (!Array.isArray(p.achievements)) p.achievements = [];
    if (!Array.isArray(p.titles)) p.titles = [];
    if (!Number.isFinite(p.prestige)) p.prestige = 0;
    if (p.tournament === undefined || typeof p.tournament !== 'object') p.tournament = { best: null, wins: 0 };
    else { if (p.tournament.best === undefined) p.tournament.best = null; if (!Number.isFinite(p.tournament.wins)) p.tournament.wins = 0; }
    if (p.daily === undefined || typeof p.daily !== 'object') p.daily = { lastRaid: 0, raidStreak: 0 };
    else { if (!Number.isFinite(p.daily.lastRaid)) p.daily.lastRaid = 0; if (!Number.isFinite(p.daily.raidStreak)) p.daily.raidStreak = 0; }
    if (p.lastSeason === undefined) p.lastSeason = '';
    if (p.bounty === undefined || typeof p.bounty !== 'object' || p.bounty === null) p.bounty = { key: '', claimed: false, hit: false };
    if (p.weekly === undefined || typeof p.weekly !== 'object' || p.weekly === null) {
        p.weekly = { kills: 0, bosses: 0, dungeons: 0, raids: 0, gold: 0, week: '', claimed: [] };
    } else {
        for (const k of ['kills', 'bosses', 'dungeons', 'raids', 'gold']) if (!Number.isFinite(p.weekly[k])) p.weekly[k] = 0;
        if (!Array.isArray(p.weekly.claimed)) p.weekly.claimed = [];
        if (typeof p.weekly.week !== 'string') p.weekly.week = '';
    }
    if (p.streak === undefined || typeof p.streak !== 'object' || p.streak === null) p.streak = { last: null, days: 0 };
    if (p.combo === undefined || typeof p.combo !== 'object' || p.combo === null) p.combo = { count: 0, last: 0, best: 0 };
    return p;
}

/* ───────────────────────── STAT ───────────────────────── */

function totalStats(p, extra = {}) {
    const t = { ...BASE_STAT };
    for (const k of Object.keys(BASE_STAT)) t[k] = BASE_STAT[k] + (p.points[k] || 0);

    // equipment
    const items = require('./items');
    for (const slot of ['weapon', 'armor', 'accessory']) {
        const id = p.equipment[slot];
        const it = id ? items.ITEMS[id] : null;
        if (it?.stats) for (const k of Object.keys(it.stats)) t[k] = (t[k] || 0) + it.stats[k];
    }
    // pet
    const systems = require('./systems');
    if (p.pet && systems.PET_DEFS[p.pet.kind]) {
        const pet = systems.PET_DEFS[p.pet.kind];
        if (pet.bonus) for (const k of Object.keys(pet.bonus)) t[k] = (t[k] || 0) + pet.bonus[k] * (p.pet.level || 1);
    }
    // set bonus
    const sb = items.setBonus(p);
    for (const k of Object.keys(sb)) t[k] = (t[k] || 0) + sb[k];
    // achievement
    const ab = systems.achievementBonus(p);
    for (const k of Object.keys(ab)) t[k] = (t[k] || 0) + ab[k];
    // enchant
    const slots = p.enchant?.slots || {};
    for (const slot of ['weapon', 'armor', 'accessory']) {
        const lv = slots[slot] || 0;
        if (!lv) continue;
        const id = p.equipment[slot];
        const it = id ? items.ITEMS[id] : null;
        if (!it?.stats) continue;
        const main = Object.keys(it.stats)[0];
        if (main) t[main] = (t[main] || 0) + lv * 2;
    }
    // buff flat
    const b = systems.activeBuffs(p);
    if (b.statBonus) for (const k of Object.keys(b.statBonus)) t[k] = (t[k] || 0) + b.statBonus[k];
    // prestige
    t.luk += (p.prestige || 0) * 5;
    // guild: bonus flat STR/VIT sesuai level guild (dulu hanya ditampilkan, tidak dipakai)
    const guild = p.guildId ? require('../database').data?.guilds?.[p.guildId] : null;
    if (guild && typeof guild.level === 'number') {
        const gb = systems.guildBonus(guild.level).statBonus || {};
        for (const k of Object.keys(gb)) t[k] = (t[k] || 0) + gb[k];
    }
    // extra
    if (extra) for (const k of Object.keys(extra)) if (BASE_STAT[k] !== undefined) t[k] = (t[k] || 0) + (extra[k] || 0);
    return t;
}

function derived(p, extra = {}) {
    const s = totalStats(p, extra);
    const lv = p.rpgLevel;
    // Kurva sengaja super-linear (lv^1.25) supaya damage pemain mengejar HP monster
    // di level tinggi. Tanpa ini, monster Lv50+ tidak terkalahkan.
    const tier = Math.pow(lv, 1.25);
    const maxHp = Math.floor(50 + tier * 26 + s.vit * 16 + s.str * 4);
    const maxMp = Math.floor(20 + tier * 7 + s.int * 9);
    const atk = Math.floor(5 + tier * 3.4 + s.str * 4.2 + s.int * 2.0 + s.agi * 1.3);
    const matk = Math.floor(4 + tier * 2.8 + s.int * 4.6);
    const def = Math.floor(2 + tier * 2.2 + s.vit * 3.0);
    const critRate = Math.min(0.65, 0.03 + s.luk * 0.012 + s.agi * 0.004);
    const critDamage = 1.5 + s.luk * 0.012;
    const dodge = Math.min(0.45, s.agi * 0.009);
    const regen = Math.max(1, Math.floor(1 + lv * 0.4 + s.vit * 0.3));
    const power = Math.floor(atk * 2 + matk + def * 1.5 + maxHp * 0.4 + maxMp * 0.3 + critRate * 500 + lv * 10);
    return { ...s, maxHp, maxMp, atk, matk, def, critRate, critDamage, dodge, regen, power, level: lv };
}

function current(p) {
    const d = derived(p);
    const now = Date.now();
    let mp = p.mp;
    if (mp === null || mp === undefined) mp = d.maxMp;
    // mp regen: `mpUpdatedAt` 0 berarti belum pernah disimpan → anggap baru saja penuh,
    // bukan "sejak 1970" (yang membuat MP terlihat tidak pernah pulih).
    if (p.mpUpdatedAt) {
        const minutes = Math.max(0, (now - p.mpUpdatedAt) / 60000);
        if (minutes > 0) mp = Math.min(d.maxMp, mp + Math.floor(minutes * (1 + p.rpgLevel * 0.12)));
    }
    let hp = p.hp;
    if (hp === null || hp === undefined) hp = d.maxHp;
    return { hp: Math.max(0, Math.min(d.maxHp, hp)), mp: Math.max(0, Math.min(d.maxMp, mp)), ...d };
}

function applyCurrent(p, hp, mp) {
    const d = derived(p);
    p.hp = Math.max(0, Math.min(d.maxHp, Math.floor(hp)));
    p.mp = Math.max(0, Math.min(d.maxMp, Math.floor(mp)));
    p.mpUpdatedAt = Date.now();
}

/* ───────────────────────── LEVEL ───────────────────────── */

const expToNext = (lv) => Math.floor(80 * Math.pow(1.16, lv - 1));

function addExp(p, amount) {
    p.rpgExp += Math.max(0, Math.floor(amount));
    let levels = 0;
    while (p.rpgLevel < MAX_LEVEL && p.rpgExp >= expToNext(p.rpgLevel)) {
        p.rpgExp -= expToNext(p.rpgLevel);
        p.rpgLevel++;
        p.statPoints += STAT_POINTS_PER_LEVEL;
        levels++;
        const growth = CLASSES[p.class].growth;
        for (const k of Object.keys(growth)) p.points[k] += growth[k];
    }
    if (p.rpgLevel >= MAX_LEVEL) p.rpgExp = Math.min(p.rpgExp, expToNext(MAX_LEVEL));
    if (levels) { p.hp = null; p.mp = null; p.mpUpdatedAt = Date.now(); }
    return { levels, levelUp: levels > 0, points: levels * STAT_POINTS_PER_LEVEL };
}

function allocPoint(p, stat) {
    if (!BASE_STAT[stat]) return { error: 'Stat tidak dikenal. Pilih: str, agi, vit, int, luk.' };
    if (p.statPoints <= 0) return { error: 'Poin stat habis.' };
    p.points[stat]++;
    p.statPoints--;
    return { ok: true, stat };
}

/* ───────────────────────── COMBAT ───────────────────────── */

const elementMultiplier = (atkEl, defEl) => {
    if (!atkEl || !defEl) return 1;
    if (ELEMENTS[atkEl]?.strong === defEl) return 1.35;
    if (ELEMENTS[defEl]?.strong === atkEl) return 0.78;
    return 1;
};

function attack(attacker, defender, opts = {}) {
    const power = opts.power || 1;
    const useMagic = Boolean(opts.magic);
    const base = useMagic ? (attacker.matk || attacker.atk) : attacker.atk;
    const eleMul = elementMultiplier(opts.element || attacker.element, defender.element);
    let raw = base * power * eleMul * randFloat(0.9, 1.1);
    const crit = chance(attacker.critRate || 0);
    if (crit) raw *= attacker.critDamage || 1.5;
    // `pierce` = fraksi DEF musuh yang diabaikan (0..1)
    const defEff = (defender.def || 0) * (1 - Math.min(1, Math.max(0, opts.pierce || 0)));
    const dmg = Math.max(1, Math.floor(raw - defEff * 0.6));
    return { damage: dmg, crit, element: eleMul > 1 ? 'super' : eleMul < 1 ? 'weak' : 'normal' };
}

/**
 * Simulasi pertarungan penuh. Mendukung skill kelas, skill unlock, dan
 * buff (dmgMul/defMul/dodgeAdd/critAdd).
 * @returns {{win, log, playerHp, playerMp, monster, turns, damageDealt}}
 */
function battle(p, monster, { useSkill = false, maxTurns = 40, extra = {} } = {}) {
    const cls = CLASSES[p.class];
    const systems = require('./systems');
    const buffs = systems.activeBuffs(p);
    const d = derived(p, extra);
    const st = current(p);
    let php = st.hp, pmp = st.mp;
    let mhp = monster.hp;
    const log = [];
    let turns = 0;
    let damageDealt = 0;

    // Daftar skill tersedia (utama + unlock yang levelnya sudah cukup).
    const avail = [{ ...cls.skill }];
    for (const u of cls.unlock || []) if (p.rpgLevel >= u.lv) avail.push({ ...u });

    /**
     * Pilih skill untuk giliran ini.
     * Utilitas (heal/restoreMp/defMul/dodgeAdd) hanya dipakai bila memang perlu,
     * supaya tidak terjadi stalemate "heal terus tanpa menyerang".
     * Skill bertipe damage dipilih bergiliran agar variasinya terlihat.
     */
    let dmgIdx = 0;
    const pickSkill = () => {
        const usable = avail.filter((s) => pmp >= s.cost);
        if (!usable.length) return null;
        const hurt = php / d.maxHp;
        // 1) heal bila HP rendah
        const healer = usable.filter((s) => s.heal).sort((a, b) => b.heal - a.heal)[0];
        if (healer && hurt < 0.55) return healer;
        // 2) pulihkan MP bila hampir habis
        const mpRestore = usable.find((s) => s.restoreMp && pmp / d.maxMp < 0.2);
        if (mpRestore) return mpRestore;
        // 3) buff DEF bila HP sedang dan belum aktif
        const shielder = usable.find((s) => s.defMul && tempDefMul === 1 && hurt < 0.75);
        if (shielder) return shielder;
        // 4) skill damage terkuat, bergiliran
        const dmg = usable.filter((s) => s.power);
        if (!dmg.length) return usable[0];
        const sk = dmg[dmgIdx % dmg.length];
        dmgIdx++;
        return sk;
    };

    let tempDefMul = 1;
    let tempDodge = 0;

    while (php > 0 && mhp > 0 && turns < maxTurns) {
        turns++;
        const adjDef = Math.floor(d.def * (buffs.defMul || 1));
        const atkAdj = { ...d, atk: Math.floor(d.atk * (buffs.dmgMul || 1)), matk: Math.floor(d.matk * (buffs.dmgMul || 1)) };
        const sk = useSkill ? pickSkill() : null;

        if (sk) {
            pmp -= sk.cost;
            let handled = false;
            if (sk.heal) {
                const heal = Math.floor(d.maxHp * sk.heal);
                php = Math.min(d.maxHp, php + heal);
                log.push(`${sk.name} memulihkan ${heal} HP.`);
                handled = true;
            }
            if (sk.restoreMp) {
                const mp = Math.floor(d.maxMp * sk.restoreMp);
                pmp = Math.min(d.maxMp, pmp + mp);
                log.push(`${sk.name} memulihkan ${mp} MP.`);
                handled = true;
            }
            if (sk.defMul) { tempDefMul = sk.defMul; log.push(`${sk.name}: DEF meningkat!`); handled = true; }
            if (sk.dodgeAdd) { tempDodge = sk.dodgeAdd; log.push(`${sk.name}: Dodge meningkat!`); handled = true; }
            if (sk.power) {
                let power = sk.power;
                if (sk.lowHpBonus) power *= 1 + (1 - php / d.maxHp) * 1.5;
                const hit = attack({ ...atkAdj, element: cls.element }, monster, { power, pierce: sk.pierce, magic: cls.element !== 'earth' });
                mhp -= hit.damage;
                damageDealt += hit.damage;
                log.push(`${sk.name}! ${hit.damage} damage${hit.crit ? ' (KRITIS)' : ''}${hit.element === 'super' ? ' (efektif)' : ''}.`);
                if (sk.drain) {
                    const drain = Math.floor(hit.damage * sk.drain);
                    php = Math.min(d.maxHp, php + drain);
                    log.push(`Menyerap ${drain} HP.`);
                }
                handled = true;
            }
            if (!handled) {
                const hit = attack({ ...atkAdj, element: cls.element }, monster, {});
                mhp -= hit.damage;
                damageDealt += hit.damage;
                log.push(`Menyerang: ${hit.damage} damage.`);
            }
        } else {
            const hit = attack({ ...atkAdj, element: cls.element }, monster, {});
            mhp -= hit.damage;
            damageDealt += hit.damage;
            log.push(`Menyerang: ${hit.damage} damage${hit.crit ? ' (KRITIS)' : ''}.`);
        }
        if (mhp <= 0) break;

        if (chance(d.dodge + tempDodge)) {
            log.push(`${monster.name} menyerang, kamu menghindar!`);
        } else {
            const hit = attack(
                { atk: monster.atk, matk: monster.atk, critRate: monster.boss ? 0.12 : 0.05, critDamage: 1.4, element: monster.element },
                { def: Math.floor(adjDef * tempDefMul), element: cls.element },
                {}
            );
            php -= hit.damage;
            log.push(`${monster.name} menyerang: ${hit.damage} damage.`);
        }
    }

    const win = mhp <= 0 && php > 0;
    return {
        win, log,
        playerHp: Math.max(0, php), playerMp: Math.max(0, pmp),
        monster: { ...monster, hp: Math.max(0, mhp) },
        turns, damageDealt
    };
}

module.exports = {
    MAX_LEVEL, STAT_POINTS_PER_LEVEL, BASE_STAT, CLASSES, CLASS_ALIASES, ELEMENTS, ELEMENT_CHAIN,
    setRng, randInt, randFloat, pick, chance, norm, findKey,
    createProfile, syncProfile, totalStats, derived, current, applyCurrent,
    expToNext, addExp, allocPoint,
    elementMultiplier, attack, battle
};
