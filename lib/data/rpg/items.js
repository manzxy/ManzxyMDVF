/**
 * RPG ENGINE — rpg/items.js
 * Katalog item (60+), rarity, set bonus, resep crafting, inventory API.
 */

const core = require('./core');

const RARITY = {
    common:    { name: 'Common',    emoji: '⚪', sell: 1.0, dust: 1,  weight: 50 },
    uncommon:  { name: 'Uncommon',  emoji: '🟢', sell: 1.4, dust: 2,  weight: 26 },
    rare:      { name: 'Rare',      emoji: '🔵', sell: 2.0, dust: 4,  weight: 14 },
    epic:      { name: 'Epic',      emoji: '🟣', sell: 3.0, dust: 8,  weight: 7  },
    legendary: { name: 'Legendary', emoji: '🟠', sell: 5.0, dust: 18, weight: 2.5 },
    mythic:    { name: 'Mythic',    emoji: '🔴', sell: 8.0, dust: 40, weight: 0.5 }
};

/** Set perlengkapan: 2 piece = bonus separuh, 3 piece = bonus penuh. */
const SETS = {
    slime:   { name: 'Ancient Slime Set',  pieces: ['slime_blade', 'slime_core', 'slime_ring'], bonus: { vit: 8, str: 4 },      desc: 'A rubbery body that shrugs off blows.' },
    shadow:  { name: 'Shadow Set',      pieces: ['shadow_dagger', 'shadow_cloak', 'shadow_charm'], bonus: { agi: 16, luk: 10 }, desc: 'Moves without a sound.' },
    flame:   { name: 'Eternal Flame Set',     pieces: ['flame_saber', 'dragon_plate', 'flame_seal'], bonus: { str: 26, int: 14 },   desc: 'Burns anything in the way.' },
    abyss:   { name: 'Abyss Set',        pieces: ['void_katana', 'crown_abyss', 'abyss_eye'], bonus: { str: 36, luk: 24, int: 18 }, desc: 'A power that swallows light.' },
    divine:  { name: 'Divine Set',       pieces: ['aegis_divine', 'celestial_wand', 'halo_relic'], bonus: { vit: 30, int: 30, luk: 12 }, desc: 'The blessing of the gods.' },
    frost:   { name: 'Frost Set',          pieces: ['frost_blade', 'frost_mail', 'frost_pendant'], bonus: { agi: 20, vit: 14 }, desc: 'Freezes even time.' },
    storm:   { name: 'Storm Set',         pieces: ['storm_bow', 'storm_robe', 'storm_talisman'], bonus: { agi: 24, luk: 16 }, desc: 'Lightning follows your steps.' },
    blood:   { name: 'Blood Set',         pieces: ['blood_axe', 'blood_armor', 'blood_amulet'], bonus: { str: 30, vit: 20 }, desc: 'The more wounded, the stronger.' }
};

/* ───────────────────────── ITEM ───────────────────────── */

const ITEMS = {
    /* ── Consumable ── */
    herb:         { name: 'Herbal Remedy',    emoji: '🌿', type: 'consumable', tier: 1, rarity: 'common', price: 60,  heal: 80,  desc: 'Restores 80 HP.' },
    potion_s:     { name: 'Small Potion',     emoji: '🧪', type: 'consumable', tier: 1, rarity: 'common', price: 150, heal: 250, desc: 'Restores 250 HP.' },
    potion_m:     { name: 'Medium Potion',    emoji: '⚗️', type: 'consumable', tier: 2, rarity: 'uncommon', price: 400, heal: 700, desc: 'Restores 700 HP.' },
    potion_l:     { name: 'Large Potion',     emoji: '🍶', type: 'consumable', tier: 3, rarity: 'rare', price: 900, heal: 1800, desc: 'Restores 1800 HP.' },
    potion_xl:    { name: 'Giant Potion',   emoji: '🫙', type: 'consumable', tier: 4, rarity: 'epic', price: 1800, heal: 4000, desc: 'Restores 4000 HP.' },
    ether:        { name: 'Blue Ether',       emoji: '💠', type: 'consumable', tier: 2, rarity: 'uncommon', price: 350, mana: 80, desc: 'Restores 80 MP.' },
    elixir:       { name: 'Dragon Elixir',      emoji: '🏺', type: 'consumable', tier: 4, rarity: 'epic', price: 2200, heal: 9999, mana: 999, desc: 'Restores all HP and MP.' },
    phoenix_tear: { name: 'Phoenix Tear', emoji: '💧', type: 'consumable', tier: 5, rarity: 'legendary', price: 4500, heal: 9999, mana: 999, revive: true, desc: 'Revive with full HP on defeat.' },
    scroll_exp_s: { name: 'Small EXP Scroll', emoji: '📜', type: 'consumable', tier: 2, rarity: 'uncommon', price: 600, exp: 300, desc: 'Grants 300 RPG EXP.' },
    scroll_exp:   { name: 'EXP Scroll',     emoji: '📜', type: 'consumable', tier: 3, rarity: 'rare', price: 1500, exp: 900, desc: 'Grants 900 RPG EXP.' },
    scroll_exp_l: { name: 'Large EXP Scroll', emoji: '📃', type: 'consumable', tier: 4, rarity: 'epic', price: 4000, exp: 3000, desc: 'Grants 3000 RPG EXP.' },
    atk_potion:   { name: 'Strength Potion',  emoji: '🧨', type: 'consumable', tier: 3, rarity: 'rare', price: 800, buff: { id: 'atk_up', dur: 600000 }, desc: 'ATK +25% for 10 minutes.' },
    def_potion:   { name: 'Shield Potion',   emoji: '🧱', type: 'consumable', tier: 3, rarity: 'rare', price: 800, buff: { id: 'def_up', dur: 600000 }, desc: 'DEF +30% for 10 minutes.' },
    luck_potion:  { name: 'Luck Potion', emoji: '🍀', type: 'consumable', tier: 3, rarity: 'rare', price: 900, buff: { id: 'luck_up', dur: 900000 }, desc: 'Drop rate +50% for 15 minutes.' },
    haste_potion: { name: 'Haste Potion', emoji: '💨', type: 'consumable', tier: 3, rarity: 'rare', price: 850, buff: { id: 'haste', dur: 600000 }, desc: 'Dodge +15% for 10 minutes.' },
    focus_potion: { name: 'Focus Potion',     emoji: '🎯', type: 'consumable', tier: 3, rarity: 'rare', price: 850, buff: { id: 'focus', dur: 600000 }, desc: 'Crit +15% for 10 minutes.' },
    bless_potion: { name: 'Blessing Potion',     emoji: '✨', type: 'consumable', tier: 4, rarity: 'epic', price: 1600, buff: { id: 'bless', dur: 900000 }, desc: 'EXP +30% for 15 minutes.' },

    /* ── Material ── */
    mat_slime_jelly:  { name: 'Slime Jelly',       emoji: '🟢', type: 'material', tier: 1, rarity: 'common', price: 40, desc: 'Basic material.' },
    mat_iron_ore:     { name: 'Iron Ore',        emoji: '⛏️', type: 'material', tier: 2, rarity: 'common', price: 90, desc: 'Tier 2 material.' },
    mat_magic_dust:   { name: 'Magic Dust',        emoji: '✨', type: 'material', tier: 3, rarity: 'uncommon', price: 180, desc: 'Enchant material.' },
    mat_dragon_scale: { name: 'Dragon Scale',        emoji: '🐲', type: 'material', tier: 4, rarity: 'rare', price: 450, desc: 'Tier 4 material.' },
    mat_void_shard:   { name: 'Void Shard', emoji: '🌑', type: 'material', tier: 5, rarity: 'epic', price: 900, desc: 'Tier 5 material.' },
    mat_ancient_rune: { name: 'Ancient Rune',         emoji: '🔯', type: 'material', tier: 5, rarity: 'epic', price: 1200, desc: 'Legendary material.' },
    mat_frost_core:   { name: 'Frost Core',           emoji: '🧊', type: 'material', tier: 4, rarity: 'rare', price: 500, desc: 'Frost set material.' },
    mat_storm_feather:{ name: 'Storm Feather',        emoji: '🪶', type: 'material', tier: 4, rarity: 'rare', price: 520, desc: 'Storm set material.' },
    mat_blood_essence:{ name: 'Blood Essence',      emoji: '🩸', type: 'material', tier: 4, rarity: 'rare', price: 540, desc: 'Blood set material.' },
    mat_phoenix_down: { name: 'Phoenix Down',      emoji: '🔥', type: 'material', tier: 5, rarity: 'legendary', price: 1500, desc: 'Mythic material.' },
    mat_eternal_gem:  { name: 'Eternal Gem',     emoji: '💎', type: 'material', tier: 6, rarity: 'mythic', price: 3000, desc: 'Rarest material in existence.' },

    /* ── Weapon t1-t5 ── */
    wooden_sword: { name: 'Wooden Sword',       emoji: '🗡️', type: 'weapon', tier: 1, rarity: 'common', price: 300, stats: { str: 4 }, desc: 'Village training weapon.' },
    iron_sword:   { name: 'Iron Sword',       emoji: '⚔️', type: 'weapon', tier: 2, rarity: 'common', price: 1200, stats: { str: 11 }, desc: 'Standard soldier sword.' },
    steel_blade:  { name: 'Steel Blade',        emoji: '🔪', type: 'weapon', tier: 3, rarity: 'uncommon', price: 4000, stats: { str: 22, agi: 6 }, desc: 'Sharp and balanced.' },
    flame_saber:  { name: 'Flame Saber',        emoji: '🔥', type: 'weapon', tier: 4, rarity: 'epic', price: 12000, stats: { str: 38, int: 12 }, element: 'fire', desc: 'An eternally burning blade.' },
    void_katana:  { name: 'Void Katana',  emoji: '🌑', type: 'weapon', tier: 5, rarity: 'legendary', price: 32000, stats: { str: 58, agi: 24, luk: 12 }, element: 'dark', desc: 'Cuts through space and time.' },

    /* ── Armor t1-t5 ── */
    cloth_robe:   { name: 'Cloth Robe',        emoji: '🥋', type: 'armor', tier: 1, rarity: 'common', price: 250, stats: { vit: 4 }, desc: 'Makeshift protection.' },
    leather_armor:{ name: 'Leather Armor',       emoji: '🦺', type: 'armor', tier: 2, rarity: 'common', price: 1000, stats: { vit: 10, agi: 3 }, desc: 'Light and flexible.' },
    chain_mail:   { name: 'Chain Mail',       emoji: '🛡️', type: 'armor', tier: 3, rarity: 'uncommon', price: 3600, stats: { vit: 20, str: 5 }, desc: 'Tightly woven steel.' },
    dragon_plate: { name: 'Dragon Plate',        emoji: '🐉', type: 'armor', tier: 4, rarity: 'epic', price: 11000, stats: { vit: 34, str: 12 }, element: 'fire', desc: 'Genuine dragon scales.' },
    aegis_divine: { name: 'Divine Aegis',     emoji: '👼', type: 'armor', tier: 5, rarity: 'legendary', price: 30000, stats: { vit: 52, int: 18 }, element: 'light', desc: 'Blessing of the light god.' },

    /* ── Accessory t1-t5 ── */
    copper_ring:  { name: 'Copper Ring',    emoji: '💍', type: 'accessory', tier: 1, rarity: 'common', price: 200, stats: { luk: 4 }, desc: 'A little luck.' },
    luck_charm:   { name: 'Luck Charm', emoji: '🍀', type: 'accessory', tier: 2, rarity: 'uncommon', price: 900, stats: { luk: 10, agi: 2 }, desc: 'Loot drops more often.' },
    mana_pendant: { name: 'Mana Pendant',      emoji: '🔷', type: 'accessory', tier: 3, rarity: 'uncommon', price: 3200, stats: { int: 18 }, desc: 'Expands your mana reserve.' },
    sage_amulet:  { name: 'Sage Amulet',      emoji: '🔮', type: 'accessory', tier: 4, rarity: 'epic', price: 9800, stats: { int: 30, luk: 10 }, desc: 'Ancient knowledge.' },
    crown_abyss:  { name: 'Abyss Crown',    emoji: '👑', type: 'accessory', tier: 5, rarity: 'legendary', price: 28000, stats: { luk: 38, int: 22, str: 12 }, desc: 'Dominion over the Abyss.' },

    /* ── Set pieces ── */
    slime_blade:   { name: 'Slime Blade',     emoji: '🟢', type: 'weapon', tier: 2, rarity: 'uncommon', price: 1500, stats: { str: 13, vit: 3 }, set: 'slime', desc: 'Squishy, yet lethal.' },
    slime_core:    { name: 'Slime Core',      emoji: '🔵', type: 'armor', tier: 2, rarity: 'uncommon', price: 1400, stats: { vit: 13 }, set: 'slime', desc: 'Absorbs part of each blow.' },
    slime_ring:    { name: 'Slime Ring',    emoji: '💧', type: 'accessory', tier: 2, rarity: 'uncommon', price: 1300, stats: { luk: 8, vit: 4 }, set: 'slime', desc: 'Slippery and profitable.' },

    shadow_dagger: { name: 'Shadow Dagger',  emoji: '🌑', type: 'weapon', tier: 3, rarity: 'rare', price: 5000, stats: { agi: 17, luk: 11 }, set: 'shadow', element: 'dark', desc: 'A stab from the dark.' },
    shadow_cloak:  { name: 'Shadow Cloak',  emoji: '🥷', type: 'armor', tier: 3, rarity: 'rare', price: 4600, stats: { agi: 14, vit: 9 }, set: 'shadow', desc: 'Blends into the night.' },
    shadow_charm:  { name: 'Shadow Charm',   emoji: '🖤', type: 'accessory', tier: 3, rarity: 'rare', price: 4400, stats: { luk: 20 }, set: 'shadow', desc: 'Draws dark fortune.' },

    flame_seal:    { name: 'Flame Seal',        emoji: '🔴', type: 'accessory', tier: 4, rarity: 'epic', price: 9500, stats: { int: 24, str: 10 }, set: 'flame', element: 'fire', desc: 'Withstands magma heat.' },
    abyss_eye:     { name: 'Abyss Eye',      emoji: '👁️', type: 'accessory', tier: 5, rarity: 'legendary', price: 26000, stats: { luk: 32, int: 24 }, set: 'abyss', element: 'dark', desc: 'Sees what cannot be seen.' },
    celestial_wand:{ name: 'Celestial Wand',  emoji: '🌟', type: 'weapon', tier: 5, rarity: 'legendary', price: 31000, stats: { int: 50, luk: 14 }, set: 'divine', element: 'light', desc: 'Calls down the blessing of the sky.' },
    halo_relic:    { name: 'Halo Relic',       emoji: '💫', type: 'accessory', tier: 5, rarity: 'mythic', price: 42000, stats: { int: 44, vit: 26, luk: 22 }, set: 'divine', element: 'light', desc: 'A shard of a divine crown.' },

    frost_blade:   { name: 'Frost Blade',       emoji: '❄️', type: 'weapon', tier: 4, rarity: 'epic', price: 10500, stats: { int: 26, agi: 16 }, set: 'frost', element: 'wind', desc: 'A cold that burns.' },
    frost_mail:    { name: 'Frost Mail',       emoji: '🧊', type: 'armor', tier: 4, rarity: 'epic', price: 10000, stats: { vit: 30, agi: 12 }, set: 'frost', desc: 'An eternal layer of ice.' },
    frost_pendant: { name: 'Frost Pendant',     emoji: '🪬', type: 'accessory', tier: 4, rarity: 'epic', price: 9200, stats: { int: 22, luk: 14 }, set: 'frost', desc: 'The breath of winter.' },

    storm_bow:     { name: 'Storm Bow',      emoji: '🏹', type: 'weapon', tier: 4, rarity: 'epic', price: 10800, stats: { agi: 30, luk: 14 }, set: 'storm', element: 'wind', desc: 'Its arrows are lightning.' },
    storm_robe:    { name: 'Storm Robe',      emoji: '🌪️', type: 'armor', tier: 4, rarity: 'epic', price: 9900, stats: { agi: 22, vit: 18 }, set: 'storm', desc: 'Roofed by clouds.' },
    storm_talisman:{ name: 'Storm Talisman',   emoji: '⚡', type: 'accessory', tier: 4, rarity: 'epic', price: 9400, stats: { agi: 18, luk: 18 }, set: 'storm', desc: 'Lightning in your grasp.' },

    blood_axe:     { name: 'Blood Axe',      emoji: '🪓', type: 'weapon', tier: 4, rarity: 'epic', price: 11000, stats: { str: 44, vit: 8 }, set: 'blood', element: 'fire', desc: 'Thirsts for battle.' },
    blood_armor:   { name: 'Blood Armor',      emoji: '🩸', type: 'armor', tier: 4, rarity: 'epic', price: 10200, stats: { str: 20, vit: 30 }, set: 'blood', desc: 'The more wounded, the stronger.' },
    blood_amulet:  { name: 'Blood Amulet',     emoji: '❤️‍🔥', type: 'accessory', tier: 4, rarity: 'epic', price: 9600, stats: { str: 18, luk: 16 }, set: 'blood', desc: 'The pulse of war.' },

    /* ── Endgame ── */
    world_breaker: { name: 'World Breaker',    emoji: '🌋', type: 'weapon', tier: 6, rarity: 'mythic', price: 80000, stats: { str: 95, agi: 34, luk: 22 }, element: 'earth', desc: 'A weapon from the age of the gods.' },
    crown_eternal: { name: 'Eternal Crown',    emoji: '👑', type: 'accessory', tier: 6, rarity: 'mythic', price: 95000, stats: { luk: 64, int: 44, vit: 34 }, element: 'light', desc: 'For the final victor alone.' },
    aether_armor:  { name: 'Aetherion Armor',  emoji: '🌌', type: 'armor', tier: 6, rarity: 'mythic', price: 88000, stats: { vit: 70, int: 40, str: 20 }, element: 'light', desc: 'The shell of the Seal\'s Creator.' }
};

/** ID yang dijual di toko. */
const SHOP_IDS = Object.keys(ITEMS).filter((id) => {
    const it = ITEMS[id];
    if (it.type === 'material' || it.set) return false;
    if (it.type === 'consumable') return it.tier <= 4;
    return ['weapon', 'armor', 'accessory'].includes(it.type) && it.tier <= 3;
});

/* ───────────────────────── RESEP ───────────────────────── */

const RECIPES = {
    iron_sword:     { level: 1, need: { mat_iron_ore: 3, mat_slime_jelly: 2 }, out: 'iron_sword' },
    leather_armor:  { level: 1, need: { mat_slime_jelly: 4, mat_iron_ore: 1 }, out: 'leather_armor' },
    slime_core:     { level: 2, need: { mat_slime_jelly: 8, mat_iron_ore: 2 }, out: 'slime_core' },
    luck_charm:     { level: 2, need: { mat_magic_dust: 2, mat_slime_jelly: 3 }, out: 'luck_charm' },
    steel_blade:    { level: 3, need: { mat_iron_ore: 6, mat_magic_dust: 3 }, out: 'steel_blade' },
    chain_mail:     { level: 3, need: { mat_iron_ore: 5, mat_magic_dust: 4 }, out: 'chain_mail' },
    mana_pendant:   { level: 4, need: { mat_magic_dust: 6, mat_dragon_scale: 1 }, out: 'mana_pendant' },
    shadow_dagger:  { level: 5, need: { mat_dragon_scale: 2, mat_magic_dust: 5, mat_void_shard: 1 }, out: 'shadow_dagger' },
    shadow_cloak:   { level: 5, need: { mat_magic_dust: 8, mat_dragon_scale: 2 }, out: 'shadow_cloak' },
    flame_saber:    { level: 7, need: { mat_dragon_scale: 4, mat_magic_dust: 8 }, out: 'flame_saber' },
    dragon_plate:   { level: 7, need: { mat_dragon_scale: 5, mat_iron_ore: 10 }, out: 'dragon_plate' },
    frost_blade:    { level: 8, need: { mat_frost_core: 4, mat_magic_dust: 10 }, out: 'frost_blade' },
    storm_bow:      { level: 8, need: { mat_storm_feather: 4, mat_magic_dust: 10 }, out: 'storm_bow' },
    blood_axe:      { level: 8, need: { mat_blood_essence: 4, mat_iron_ore: 12 }, out: 'blood_axe' },
    flame_seal:     { level: 9, need: { mat_dragon_scale: 3, mat_magic_dust: 10, mat_ancient_rune: 1 }, out: 'flame_seal' },
    frost_mail:     { level: 9, need: { mat_frost_core: 6, mat_dragon_scale: 3 }, out: 'frost_mail' },
    storm_robe:     { level: 9, need: { mat_storm_feather: 6, mat_dragon_scale: 3 }, out: 'storm_robe' },
    blood_armor:    { level: 9, need: { mat_blood_essence: 6, mat_dragon_scale: 3 }, out: 'blood_armor' },
    void_katana:    { level: 11, need: { mat_void_shard: 5, mat_ancient_rune: 3, mat_dragon_scale: 6 }, out: 'void_katana' },
    abyss_eye:      { level: 11, need: { mat_void_shard: 4, mat_ancient_rune: 4 }, out: 'abyss_eye' },
    celestial_wand: { level: 13, need: { mat_ancient_rune: 6, mat_void_shard: 6 }, out: 'celestial_wand' },
    aegis_divine:   { level: 14, need: { mat_ancient_rune: 8, mat_void_shard: 5, mat_phoenix_down: 2 }, out: 'aegis_divine' },
    halo_relic:     { level: 15, need: { mat_ancient_rune: 10, mat_void_shard: 10, mat_phoenix_down: 4 }, out: 'halo_relic' },
    world_breaker:  { level: 18, need: { mat_eternal_gem: 3, mat_ancient_rune: 12, mat_void_shard: 12 }, out: 'world_breaker' },
    crown_eternal:  { level: 20, need: { mat_eternal_gem: 5, mat_ancient_rune: 15, mat_phoenix_down: 6 }, out: 'crown_eternal' },
    aether_armor:   { level: 20, need: { mat_eternal_gem: 4, mat_ancient_rune: 14, mat_void_shard: 14 }, out: 'aether_armor' }
};

const craftExpToNext = (lv) => Math.floor(100 * Math.pow(1.32, lv - 1));

/* ───────────────────────── INVENTORY API ───────────────────────── */

function addItem(p, id, qty = 1) {
    if (!ITEMS[id]) return { error: 'Item tidak dikenal.' };
    p.inventory[id] = (p.inventory[id] || 0) + qty;
    return { ok: true, id, qty };
}

/** Hapus item; bila item itu sedang dipakai, slot otomatis dikosongkan. */
function removeItem(p, id, qty = 1) {
    const have = p.inventory[id] || 0;
    if (have < qty) return false;
    p.inventory[id] = have - qty;
    if (p.inventory[id] <= 0) {
        delete p.inventory[id];
        // Perlengkapan yang sudah tidak dimiliki tidak boleh tetap terpasang.
        for (const slot of ['weapon', 'armor', 'accessory']) {
            if (p.equipment && p.equipment[slot] === id) p.equipment[slot] = null;
        }
    }
    return true;
}

function hasItems(p, need) {
    return Object.entries(need).every(([id, n]) => (p.inventory[id] || 0) >= n);
}

function consumeItems(p, need) {
    for (const [id, n] of Object.entries(need)) removeItem(p, id, n);
}

function equip(p, id) {
    const it = ITEMS[id];
    if (!it) return { error: 'Item tidak dikenal.' };
    if (!['weapon', 'armor', 'accessory'].includes(it.type)) return { error: 'Item ini tidak bisa dipakai.' };
    if (!(p.inventory[id] > 0)) return { error: `Item tidak ada di tas.` };
    if (p.equipment[it.type] === id) return { error: `${it.name} sudah terpasang di slot ${it.type}.`, already: true };
    const previous = p.equipment[it.type];
    p.equipment[it.type] = id;
    return { ok: true, slot: it.type, item: it, previous: previous ? ITEMS[previous] : null };
}

function unequip(p, slot) {
    if (!p.equipment[slot]) return { error: 'Slot itu kosong.' };
    p.equipment[slot] = null;
    return { ok: true };
}

function activeSet(p) {
    const eq = ['weapon', 'armor', 'accessory'].map((s) => p.equipment[s]).filter(Boolean);
    for (const [key, set] of Object.entries(SETS)) {
        const count = eq.filter((id) => set.pieces.includes(id)).length;
        if (count >= 2) return { key, set, count, full: count >= set.pieces.length };
    }
    return null;
}

function setBonus(p) {
    const a = activeSet(p);
    if (!a) return {};
    if (a.full) return a.set.bonus;
    const half = {};
    for (const k of Object.keys(a.set.bonus)) half[k] = Math.floor(a.set.bonus[k] * 0.5);
    return half;
}

function useItem(p, id) {
    const it = ITEMS[id];
    if (!it) return { error: 'Item tidak dikenal.' };
    if (it.type !== 'consumable') return { error: 'Pakai .equip untuk item perlengkapan.' };
    if (!(p.inventory[id] > 0)) return { error: 'Item tidak ada di tas.' };
    const d = core.derived(p);
    const now = core.current(p);

    // Jangan buang item kalau tidak ada efeknya sama sekali.
    const heals = Boolean(it.heal) && now.hp < d.maxHp;
    const restoresMp = Boolean(it.mana) && now.mp < d.maxMp;
    const grantsExp = Boolean(it.exp);
    const grantsBuff = Boolean(it.buff);
    if (!heals && !restoresMp && !grantsExp && !grantsBuff) {
        if (it.heal && !it.mana) return { error: `HP kamu sudah penuh. ${it.name} tidak terpakai.` };
        if (it.mana && !it.heal) return { error: `MP kamu sudah penuh. ${it.name} tidak terpakai.` };
        return { error: '❤️ HP dan 💙 MP kamu sudah penuh.' };
    }

    let hp = now.hp, mp = now.mp, exp = 0;
    if (it.heal) hp = Math.min(d.maxHp, hp + it.heal);
    if (it.mana) mp = Math.min(d.maxMp, mp + it.mana);
    if (it.exp) exp = it.exp;
    removeItem(p, id, 1);
    core.applyCurrent(p, hp, mp);
    let buffResult = null;
    if (it.buff) {
        const systems = require('./systems');
        buffResult = systems.applyBuff(p, it.buff.id, it.buff.dur);
    }
    const lvl = exp ? core.addExp(p, exp) : { levelUp: false, levels: 0 };
    return { ok: true, item: it, levelUp: lvl.levelUp, levels: lvl.levels, buff: buffResult, revive: Boolean(it.revive) };
}

/** Harga jual (40% × pengali rarity). */
function sellValue(id) {
    const it = ITEMS[id];
    if (!it) return 0;
    return Math.max(1, Math.floor(it.price * (RARITY[it.rarity]?.sell || 1) * 0.4));
}

function dustValue(id) {
    const it = ITEMS[id];
    if (!it) return 0;
    return (RARITY[it.rarity]?.dust || 1) * (it.tier || 1);
}

/** Pilih rarity acak berbobot. */
function rollRarity() {
    const entries = Object.entries(RARITY);
    const total = entries.reduce((a, [, r]) => a + r.weight, 0);
    let r = Math.random() * total;
    for (const [k, v] of entries) { r -= v.weight; if (r <= 0) return k; }
    return 'common';
}

/** Alias item yang sering diketik pengguna. */
const ITEM_ALIASES = {
    potion: 'potion_s', pot: 'potion_s', ramuan: 'potion_s', 'potion kecil': 'potion_s',
    'potion medium': 'potion_m', 'potion besar': 'potion_l', 'potion giant': 'potion_xl',
    heal: 'potion_s', obat: 'potion_s',
    herb: 'herb', herbal: 'herb', jamu: 'herb',
    ether: 'ether', mp: 'ether', mana: 'ether',
    elixir: 'elixir',
    tear: 'phoenix_tear', 'phoenix tear': 'phoenix_tear',
    scroll: 'scroll_exp_s', 'exp scroll': 'scroll_exp_s',
    jelly: 'mat_slime_jelly', slime: 'mat_slime_jelly',
    ore: 'mat_iron_ore', iron: 'mat_iron_ore', besi: 'mat_iron_ore',
    dust: 'mat_magic_dust', debu: 'mat_magic_dust',
    scale: 'mat_dragon_scale', 'dragon scale': 'mat_dragon_scale',
    sword: 'iron_sword', pedang: 'iron_sword',
    staff: 'wooden_sword',
    bow: 'storm_bow', panah: 'storm_bow',
    dagger: 'shadow_dagger', pisau: 'shadow_dagger',
    armor: 'leather_armor', baju: 'leather_armor', zirah: 'leather_armor',
    ring: 'copper_ring', cincin: 'copper_ring',
    amulet: 'sage_amulet', kalung: 'sage_amulet',
    cloak: 'shadow_cloak', jubah: 'shadow_cloak',
    pot_atk: 'atk_potion', potion_atk: 'atk_potion',
    pot_def: 'def_potion', potion_def: 'def_potion',
    pot_luck: 'luck_potion', potion_luck: 'luck_potion'
};

/**
 * Cari id item dari input bebas secara cerdas.
 * Prioritas: id persis → alias → nama persis → nama dimulai query → nama mengandung.
 * Ini mencegah "potion" salah jatuh ke "Luck Potion" seperti pada findKey generik.
 * @param {string} query
 * @param {(id:string)=>boolean} [filter] batasi hasil (mis. hanya yang ada di tas)
 */
function findItem(query, filter = null) {
    const q = core.norm(query || '');
    if (!q) return null;
    const ok = (id) => ITEMS[id] && (!filter || filter(id));
    const ids = Object.keys(ITEMS);

    if (ok(q)) return q;

    // Singkatan bertingkat: "potion m" / "potion s" / "potion l" / "potion xl" → id potion_<x>
    // Dicek sebelum alias agar "potion l" tidak jatuh ke alias generik "potion".
    const sh = q.match(/^(.+?)\s+(xs|xl|s|m|l)$/);
    if (sh) {
        const base = sh[1].trim();
        const suffix = sh[2];
        // Coba id mentah dulu (potion → potion_m), baru alias (ramuan → potion_s → potion_m).
        for (const baseId of [base, ITEM_ALIASES[base]].filter(Boolean)) {
            const cand = `${baseId}_${suffix}`;
            if (ok(cand)) return cand;
            // alias bisa berupa potion_s → ambil akar id-nya
            const root = baseId.replace(/_[a-z0-9]+$/, '');
            const cand2 = `${root}_${suffix}`;
            if (root !== baseId && ok(cand2)) return cand2;
        }
    }

    if (ITEM_ALIASES[q] && ok(ITEM_ALIASES[q])) return ITEM_ALIASES[q];

    const byName = (pred) => ids.find((id) => ok(id) && pred(core.norm(ITEMS[id].name)));
    const exact = byName((n) => n === q);
    if (exact) return exact;
    const starts = byName((n) => n.startsWith(q));
    if (starts) return starts;
    const word = byName((n) => n.split(' ').includes(q));
    if (word) return word;
    const has = byName((n) => n.includes(q));
    if (has) return has;
    // terakhir: cocokkan per kata kunci
    const words = q.split(' ').filter(Boolean);
    if (words.length > 1) {
        const hit = ids.find((id) => {
            if (!ok(id)) return false;
            const n = core.norm(ITEMS[id].name);
            return words.every((w) => n.includes(w));
        });
        if (hit) return hit;
    }
    return null;
}

module.exports = {
    RARITY, SETS, ITEMS, SHOP_IDS, RECIPES, craftExpToNext, ITEM_ALIASES, findItem,
    addItem, removeItem, hasItems, consumeItems,
    equip, unequip, useItem, activeSet, setBonus,
    sellValue, dustValue, rollRarity
};

/**
 * Pisahkan argumen perintah menjadi { item, qty }.
 * Mendukung nama multi-kata dan jumlah di akhir: "wooden sword", "potion m 3", "iron sword 2".
 * `args` = array kata setelah command.
 * @param {string[]} args
 * @param {{filter?:(id:string)=>boolean, allowQty?:boolean}} [opts]
 */
function parseItemArgs(args, { filter = null, allowQty = true } = {}) {
    const words = (args || []).map((w) => String(w || '')).filter(Boolean);
    if (!words.length) return { item: null, qty: 1 };
    let qty = 1;
    if (allowQty && words.length > 1) {
        const last = words[words.length - 1];
        if (/^\d+$/.test(last)) {
            qty = Math.max(1, Number(last));
            words.pop();
        }
    }
    const item = findItem(words.join(' '), filter);
    return { item, qty };
}

module.exports.parseItemArgs = parseItemArgs;
