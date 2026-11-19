/**
 * RPG ENGINE — rpg/monsters.js
 * 6 wilayah, 40+ monster, boss, world boss, drop table, dan reward.
 */

const core = require('./core');
const items = require('./items');

/** Wilayah. `bonus` mengalikan exp/gold; `elite` memungkinkan varian elite. */
const REGIONS = {
    meadow: {
        name: 'Slime Meadow', emoji: '🌾', minLv: 1, order: 1, element: 'earth',
        desc: 'Rolling grass where new adventurers forge themselves.',
        bonus: { exp: 1.0, gold: 1.0 },
        pool: ['slime', 'goblin', 'rat', 'wild_boar']
    },
    forest: {
        name: 'Shadow Forest', emoji: '🌲', minLv: 5, order: 2, element: 'wind',
        desc: 'Dense trees that swallow the light; a wolf den.',
        bonus: { exp: 1.1, gold: 1.1 },
        pool: ['wolf', 'skeleton', 'goblin_chief', 'spider']
    },
    swamp: {
        name: 'Poison Swamp', emoji: '🏞️', minLv: 9, order: 3, element: 'dark',
        desc: 'Black water, and the dead walking its banks.',
        bonus: { exp: 1.18, gold: 1.15 },
        pool: ['zombie', 'toxic_toad', 'bog_witch', 'skeleton']
    },
    ruins: {
        name: 'Ancient Ruins', emoji: '🏛️', minLv: 14, order: 4, element: 'light',
        desc: 'The buried remains of a civilisation; the orcs keep it.',
        bonus: { exp: 1.28, gold: 1.22 },
        pool: ['orc', 'wraith', 'stone_sentinel', 'plague_priest']
    },
    volcano: {
        name: 'Volcano Peak', emoji: '🌋', minLv: 22, order: 5, element: 'fire',
        desc: 'Burning ground where golems and drakes roam.',
        bonus: { exp: 1.4, gold: 1.34 },
        pool: ['golem', 'drake', 'lava_hound', 'fire_elemental']
    },
    abyss: {
        name: 'Void Abyss', emoji: '🕳️', minLv: 35, order: 6, element: 'dark',
        desc: 'The edge of the world; only the strongest endure.',
        bonus: { exp: 1.65, gold: 1.55 },
        pool: ['void_walker', 'nightmare', 'shadow_dragon', 'drake']
    }
};

/**
 * Monster. `family` untuk pengelompokan codex, `drops` = [[id, chance]].
 * `boss` = boss biasa, `raid` = world boss, `elite` = bisa jadi varian elite.
 */
const MONSTERS = {
    /* ═══ MEADOW ═══ */
    slime:        { name: 'Slime',              emoji: '🟢', lv: 1,  hp: 60,   atk: 8,   def: 2,   exp: 22,   gold: 12,  element: 'earth', region: 'meadow', family: 'slime',   drops: [['mat_slime_jelly', 0.6], ['herb', 0.25]] },
    rat:          { name: 'Giant Rat',      emoji: '🐀', lv: 2,  hp: 90,   atk: 11,  def: 3,   exp: 30,   gold: 16,  element: 'earth', region: 'meadow', family: 'beast',   drops: [['mat_slime_jelly', 0.4], ['herb', 0.3]] },
    goblin:       { name: 'Goblin',             emoji: '👺', lv: 3,  hp: 140,  atk: 16,  def: 6,   exp: 48,   gold: 30,  element: 'earth', region: 'meadow', family: 'goblinoid', drops: [['mat_slime_jelly', 0.4], ['wooden_sword', 0.08], ['mat_iron_ore', 0.2]] },
    wild_boar:    { name: 'Wild Boar',         emoji: '🐗', lv: 4,  hp: 180,  atk: 21,  def: 7,   exp: 62,   gold: 38,  element: 'earth', region: 'meadow', family: 'beast',   drops: [['mat_slime_jelly', 0.3], ['mat_iron_ore', 0.25]] },

    /* ═══ FOREST ═══ */
    wolf:         { name: 'Shadow Wolf',  emoji: '🐺', lv: 5,  hp: 220,  atk: 26,  def: 9,   exp: 80,   gold: 52,  element: 'dark',  region: 'forest', family: 'beast',   drops: [['potion_s', 0.3], ['mat_magic_dust', 0.15]] },
    spider:       { name: 'Giant Spider',  emoji: '🕷️', lv: 6,  hp: 260,  atk: 31,  def: 10,  exp: 95,   gold: 60,  element: 'dark',  region: 'forest', family: 'insect',  drops: [['mat_magic_dust', 0.2], ['herb', 0.35]] },
    skeleton:     { name: 'Skeleton Warrior',  emoji: '💀', lv: 8,  hp: 360,  atk: 40,  def: 16,  exp: 140,  gold: 88,  element: 'dark',  region: 'forest', family: 'undead',  drops: [['potion_s', 0.3], ['mat_iron_ore', 0.35], ['iron_sword', 0.05]] },
    goblin_chief: { name: 'Goblin Chieftain', emoji: '👹', lv: 10, hp: 480,  atk: 48,  def: 19,  exp: 180,  gold: 120, element: 'earth', region: 'forest', family: 'goblinoid', elite: true, drops: [['mat_iron_ore', 0.5], ['slime_ring', 0.1]] },

    /* ═══ SWAMP ═══ */
    zombie:       { name: 'Bog Zombie',        emoji: '🧟', lv: 9,  hp: 420,  atk: 44,  def: 18,  exp: 160,  gold: 105, element: 'dark',  region: 'swamp', family: 'undead',  drops: [['herb', 0.4], ['mat_magic_dust', 0.2]] },
    toxic_toad:   { name: 'Toxic Toad',      emoji: '🐸', lv: 11, hp: 520,  atk: 55,  def: 20,  exp: 205,  gold: 135, element: 'earth', region: 'swamp', family: 'beast',   drops: [['potion_m', 0.25], ['mat_magic_dust', 0.25]] },
    bog_witch:    { name: 'Bog Witch',      emoji: '🧙‍♀️', lv: 13, hp: 600,  atk: 68,  def: 22,  exp: 250,  gold: 165, element: 'dark',  region: 'swamp', family: 'magic',   elite: true, drops: [['mat_magic_dust', 0.5], ['ether', 0.25]] },

    /* ═══ RUINS ═══ */
    orc:          { name: 'Brutal Orc',         emoji: '👹', lv: 14, hp: 720,  atk: 72,  def: 28,  exp: 280,  gold: 175, element: 'earth', region: 'ruins', family: 'goblinoid', drops: [['potion_m', 0.28], ['mat_iron_ore', 0.4], ['steel_blade', 0.04]] },
    wraith:       { name: 'Wraith',             emoji: '👻', lv: 16, hp: 820,  atk: 90,  def: 30,  exp: 350,  gold: 220, element: 'dark',  region: 'ruins', family: 'undead',  drops: [['ether', 0.3], ['mat_magic_dust', 0.35]] },
    stone_sentinel:{ name: 'Stone Sentinel',      emoji: '🗿', lv: 18, hp: 1100, atk: 88,  def: 55,  exp: 420,  gold: 275, element: 'earth', region: 'ruins', family: 'construct', elite: true, drops: [['mat_iron_ore', 0.6], ['mat_ancient_rune', 0.08]] },
    plague_priest:{ name: 'Plague Priest',      emoji: '⚰️', lv: 20, hp: 980,  atk: 105, def: 34,  exp: 480,  gold: 320, element: 'dark',  region: 'ruins', family: 'magic',   drops: [['mat_magic_dust', 0.45], ['ether', 0.35]] },

    /* ═══ VOLCANO ═══ */
    golem:        { name: 'Stone Golem',         emoji: '🗿', lv: 22, hp: 1400, atk: 110, def: 62,  exp: 540,  gold: 350, element: 'earth', region: 'volcano', family: 'construct', drops: [['potion_l', 0.22], ['mat_iron_ore', 0.5]] },
    lava_hound:   { name: 'Lava Hound',       emoji: '🐕‍🦺', lv: 24, hp: 1250, atk: 135, def: 45,  exp: 600,  gold: 395, element: 'fire',  region: 'volcano', family: 'beast',   drops: [['potion_l', 0.25], ['mat_dragon_scale', 0.2]] },
    fire_elemental:{ name: 'Fire Elemental',     emoji: '🔥', lv: 26, hp: 1150, atk: 155, def: 40,  exp: 660,  gold: 440, element: 'fire',  region: 'volcano', family: 'elemental', drops: [['mat_dragon_scale', 0.3], ['mat_magic_dust', 0.4]] },
    drake:        { name: 'Young Drake',         emoji: '🐲', lv: 28, hp: 1900, atk: 145, def: 66,  exp: 720,  gold: 520, element: 'fire',  region: 'volcano', family: 'dragon',  drops: [['potion_l', 0.25], ['mat_dragon_scale', 0.3]] },

    /* ═══ ABYSS ═══ */
    void_walker:  { name: 'Void Walker',emoji: '🌑', lv: 35, hp: 2600, atk: 195, def: 80,  exp: 1050, gold: 720, element: 'dark',  region: 'abyss', family: 'void',   drops: [['mat_void_shard', 0.3], ['potion_xl', 0.15]] },
    nightmare:    { name: 'Nightmare',   emoji: '🐴', lv: 38, hp: 2900, atk: 215, def: 78,  exp: 1200, gold: 830, element: 'dark',  region: 'abyss', family: 'void',   drops: [['mat_void_shard', 0.35], ['ether', 0.4]] },
    shadow_dragon:{ name: 'Shadow Dragon',      emoji: '🐉', lv: 42, hp: 3600, atk: 245, def: 95,  exp: 1450, gold: 1020, element: 'dark', region: 'abyss', family: 'dragon', elite: true, drops: [['mat_void_shard', 0.45], ['mat_ancient_rune', 0.15]] },

    /* ═══ BOSS REGION ═══ */
    slime_king:   { name: 'Slime King',         emoji: '🐸', lv: 6,  hp: 900,   atk: 34,  def: 14,   exp: 420,   gold: 380,   element: 'earth', region: 'meadow',  boss: true, family: 'slime',     lore: 'A relic of an ancient war that commands the goblins.', drops: [['slime_core', 0.5], ['copper_ring', 0.3], ['mat_slime_jelly', 0.9]] },
    forest_guardian:{ name: 'Forest Guardian',    emoji: '🌳', lv: 12, hp: 1600,  atk: 66,  def: 30,   exp: 800,   gold: 700,   element: 'wind',  region: 'forest',  boss: true, family: 'elemental', lore: 'A forest spirit enraged by the felling of its sanctuary.', drops: [['storm_talisman', 0.2], ['mat_magic_dust', 0.8]] },
    swamp_hag:    { name: 'Swamp Hag',          emoji: '🧙', lv: 18, hp: 2400,  atk: 100, def: 38,   exp: 1300,  gold: 1100,  element: 'dark',  region: 'swamp',   boss: true, family: 'magic',     lore: 'She trades the lives of villagers for her own longevity.', drops: [['sage_amulet', 0.25], ['mat_magic_dust', 0.9]] },
    lich:         { name: 'Eternal Lich',         emoji: '☠️', lv: 26, hp: 3400,  atk: 150, def: 50,   exp: 1900,  gold: 1600,  element: 'dark',  region: 'ruins',   boss: true, family: 'undead',    lore: 'The priest who guards the Seal from the wrong side.', drops: [['sage_amulet', 0.35], ['mat_magic_dust', 0.8], ['ether', 0.5]] },
    dragon:       { name: 'Red Dragon',         emoji: '🐉', lv: 35, hp: 5200,  atk: 210, def: 88,   exp: 3200,  gold: 2600,  element: 'fire',  region: 'volcano', boss: true, family: 'dragon',    lore: 'Guardian of the first seal, wounded by something from the Abyss.', drops: [['dragon_plate', 0.25], ['mat_dragon_scale', 0.9], ['elixir', 0.4]] },
    demon_lord:   { name: 'Demon Lord',         emoji: '😈', lv: 50, hp: 9500,  atk: 320, def: 130,  exp: 6800,  gold: 5200,  element: 'dark',  region: 'abyss',   boss: true, family: 'demon',     lore: 'He sits on a throne made of names — including yours.', drops: [['crown_abyss', 0.2], ['mat_void_shard', 0.8], ['phoenix_tear', 0.15]] },

    /* ═══ WORLD BOSS (RAID) ═══ */
    world_boss_1: { name: 'Primordial Colossus',     emoji: '🗿', lv: 60, hp: 24000, atk: 380, def: 160, exp: 12000, gold: 9000,  element: 'earth', region: 'ruins', boss: true, raid: true, family: 'construct', lore: 'A structure that walked before the world had a name.', drops: [['world_breaker', 0.1], ['mat_eternal_gem', 0.2], ['mat_ancient_rune', 0.9]] },
    world_boss_2: { name: 'Void Dragon',     emoji: '🐉', lv: 75, hp: 38000, atk: 470, def: 200, exp: 20000, gold: 15000, element: 'dark',  region: 'abyss', boss: true, raid: true, family: 'dragon',    lore: 'What remains after every name has been forgotten.', drops: [['crown_eternal', 0.08], ['aether_armor', 0.06], ['mat_eternal_gem', 0.3]] },
    world_boss_3: { name: 'Aetherion',          emoji: '🌌', lv: 95, hp: 62000, atk: 620, def: 260, exp: 32000, gold: 24000, element: 'light', region: 'abyss', boss: true, raid: true, family: 'divine',   lore: 'The Creator of the Seal. Not evil — only weary.', drops: [['crown_eternal', 0.2], ['aether_armor', 0.2], ['mat_eternal_gem', 0.5]] }
};

/** Alias monster (Indonesia & Inggris) → id. */
const MONSTER_ALIASES = {
    'naga merah': 'dragon', naga: 'dragon', dragon: 'dragon', 'red dragon': 'dragon',
    'raja iblis': 'demon_lord', iblis: 'demon_lord', 'demon lord': 'demon_lord', rajaiblis: 'demon_lord',
    'raja slime': 'slime_king', slimeking: 'slime_king', 'slime raja': 'slime_king',
    lich: 'lich', 'lich abadi': 'lich',
    'penjaga hutan': 'forest_guardian', hutan: 'forest_guardian',
    'ratu rawa': 'swamp_hag', rawa: 'swamp_hag',
    colossus: 'world_boss_1', 'colossus purba': 'world_boss_1',
    'naga kehampaan': 'world_boss_2', aetherion: 'world_boss_3',
    serigala: 'wolf', wolf: 'wolf',
    kerangka: 'skeleton', skeleton: 'skeleton',
    orc: 'orc', wraith: 'wraith', golem: 'golem', drake: 'drake',
    zombie: 'zombie', 'laba laba': 'spider', spider: 'spider',
    goblin: 'goblin', tikus: 'rat', rat: 'rat', babi: 'wild_boar', boar: 'wild_boar',
    katak: 'toxic_toad', toad: 'toxic_toad',
    sentinel: 'stone_sentinel', 'penjaga batu': 'stone_sentinel',
    'pendeta wabah': 'plague_priest',
    'elemental api': 'fire_elemental', 'api': 'fire_elemental',
    'anjing lahar': 'lava_hound',
    'bayangan': 'void_walker', void: 'void_walker',
    nightmare: 'nightmare', 'mimpi buruk': 'nightmare',
    'naga bayangan': 'shadow_dragon'
};

const HUNT_POOL = Object.keys(MONSTERS).filter((id) => !MONSTERS[id].boss);
const BOSS_POOL = Object.keys(MONSTERS).filter((id) => MONSTERS[id].boss && !MONSTERS[id].raid);
const RAID_POOL = Object.keys(MONSTERS).filter((id) => MONSTERS[id].raid);

/** Cari id monster dari input bebas. */
const findMonster = (q) => core.findKey(MONSTERS, q, MONSTER_ALIASES);

/** Region terbuka untuk level tertentu. */
function unlockedRegions(level) {
    return Object.entries(REGIONS)
        .filter(([, r]) => r.minLv <= level)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([id]) => id);
}

/** Region default (tertinggi yang terbuka) atau region tertentu. */
function pickRegion(p, forced) {
    if (forced && REGIONS[forced]) return forced;
    const open = unlockedRegions(p.rpgLevel);
    return open[open.length - 1] || 'meadow';
}

/** Pilih monster untuk hunt, dibatasi level pemain. */
function pickHuntMonster(p, forced, region) {
    if (forced && MONSTERS[forced]) return forced;
    const reg = REGIONS[region] || REGIONS[pickRegion(p)];
    const pool = reg.pool.filter((id) => MONSTERS[id].lv <= p.rpgLevel + 8);
    return pool.length ? core.pick(pool) : reg.pool[0] || 'slime';
}

/** Pilih boss terkuat yang masih menantang. */
function pickBoss(p) {
    const ok = BOSS_POOL.filter((id) => MONSTERS[id].lv <= p.rpgLevel + 10);
    return ok.length ? ok[ok.length - 1] : 'slime_king';
}

/** Pilih world boss sesuai level. */
function pickRaidBoss(p) {
    const ok = RAID_POOL.filter((id) => MONSTERS[id].lv <= p.rpgLevel + 30);
    return ok.length ? ok[ok.length - 1] : RAID_POOL[0];
}

/** Bangun instance monster berskala level pemain + bonus region. */
function spawnMonster(id, playerLevel, region, { elite = false } = {}) {
    const base = MONSTERS[id];
    if (!base) return null;
    // Skala halus: monster tumbuh lebih lambat dari pemain di level tinggi
    // (lv^1.1 vs lv^1.25 milik pemain) supaya Lv50+ tetap bisa dimenangkan.
    const gap = Math.max(0, playerLevel - base.lv);
    const scale = 1 + gap * 0.10 + Math.pow(gap, 1.18) * 0.045;
    const regBonus = REGIONS[region]?.bonus || { exp: 1, gold: 1 };
    let hp = Math.floor(base.hp * scale);
    // ATK monster sedikit lebih landai dari HP: tanpa ini class HP-rendah
    // (archer/berserker/rogue) mati sebelum sempat membunuh di Lv80+.
    let atk = Math.floor(base.atk * Math.pow(scale, 0.88));
    // DEF tumbuh lebih lambat dari HP/ATK: DEF besar membuat damage pemain
    // tertelan habis dan pertarungan jadi seri di level tinggi.
    let def = Math.floor(base.def * Math.pow(scale, 0.72));
    let exp = Math.floor(base.exp * (1 + gap * 0.08) * (regBonus.exp || 1));
    let gold = Math.floor(base.gold * (1 + gap * 0.08) * (regBonus.gold || 1));
    let name = base.name;
    let prefix = '';
    if (elite && !base.boss) {
        hp = Math.floor(hp * 1.6); atk = Math.floor(atk * 1.3); def = Math.floor(def * 1.25);
        exp = Math.floor(exp * 1.8); gold = Math.floor(gold * 1.7);
        prefix = 'Elite ';
    }
    return {
        id, name: name, displayName: prefix + name, emoji: base.emoji, element: base.element,
        boss: Boolean(base.boss), raid: Boolean(base.raid), elite: Boolean(elite && !base.boss),
        family: base.family, lore: base.lore, region: base.region,
        lv: base.lv, maxHp: hp, hp, atk, def, exp, gold,
        drops: (base.drops || []).map(([d]) => d),
        dropTable: base.drops || []
    };
}

/** Roll drop; `luckMul` dari buff/kelas. */
function rollDrops(monster, luckMul = 1) {
    const out = [];
    for (const [id, baseChance] of monster.dropTable || []) {
        const c = Math.min(0.98, baseChance * luckMul * (monster.boss ? 1.3 : 1) * (monster.elite ? 1.2 : 1));
        if (core.chance(c)) out.push(id);
    }
    return out;
}

/** Reward sederhana (tanpa pengali eksternal). */
function reward(p, monster, { luckMul = 1 } = {}) {
    const cls = core.CLASSES[p.class];
    const luckBonus = 1 + (p.points.luk || 0) * 0.01 + (cls === core.CLASSES.rogue ? 0.15 : 0) + (p.prestige || 0) * 0.05;
    const gold = Math.floor(monster.gold * luckBonus);
    p.gold += gold;
    p.stats.goldEarned += gold;
    p.stats.kills++;
    if (monster.boss) p.stats.bossKills++;
    p.killed[monster.id] = (p.killed[monster.id] || 0) + 1;
    const drops = rollDrops(monster, luckMul * luckBonus);
    for (const id of drops) items.addItem(p, id, 1);
    const lvl = core.addExp(p, monster.exp);
    return { gold, exp: monster.exp, drops, levelUp: lvl.levelUp, levels: lvl.levels };
}

module.exports = {
    REGIONS, MONSTERS, MONSTER_ALIASES, HUNT_POOL, BOSS_POOL, RAID_POOL,
    findMonster, unlockedRegions, pickRegion, pickHuntMonster, pickBoss, pickRaidBoss,
    spawnMonster, rollDrops, reward
};
