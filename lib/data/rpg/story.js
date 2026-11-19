/**
 * RPG ENGINE — rpg/story.js
 * Campaign 20 chapters + 12 monthly seasons.
 *
 * Story: the player is "The Summoned" — a soul from another world pulled into
 * Aetheria as the Primordial Seal begins to crack. The plot is told in chapters,
 * each with dialogue, objective, and reward. Themes: identity, memory, and the
 * question of who is really saving whom.
 */

/* ───────────────────────── CAMPAIGN ───────────────────────── */

/**
 * Chapter fields:
 *  id, title, region, req {level, chapter}, lore, dialogue[], task,
 *  objective {type:'kill'|'multi', target/list, count}, reward, boss
 */
const CHAPTERS = [
    {
        id: 0, title: 'The Summoned', region: 'meadow', req: { level: 1 },
        lore: 'You open your eyes on unfamiliar grass. Two moons hang in the sky. A voice whispers: *"At last, you have come, Summoned One."*',
        dialogue: [
            { who: '???', text: 'Can you hear me? Good. You are awake.' },
            { who: 'You', text: 'Where am I? This is not my world.' },
            { who: '???', text: 'Aetheria. And you are exactly where you must be.' }
        ],
        task: 'Survive the meadow. Defeat 5 Slimes.',
        objective: { type: 'kill', target: 'slime', count: 5 },
        reward: { gold: 500, exp: 300, item: 'potion_m' }
    },
    {
        id: 1, title: 'The Silent Village', region: 'meadow', req: { level: 3, chapter: 0 },
        lore: 'A village burns in silence. No bodies — only small footprints leading into the forest. Goblins. They took the people, they did not kill them.',
        dialogue: [
            { who: 'Farmer', text: 'They came at dusk. They took my daughter. They took everyone.' },
            { who: 'You', text: 'Why leave you alive?' },
            { who: 'Farmer', text: 'Because someone has to tell you they are still alive.' }
        ],
        task: 'Liberate the village: defeat 8 Goblins.',
        objective: { type: 'kill', target: 'goblin', count: 8 },
        reward: { gold: 900, exp: 700, item: 'iron_sword' }
    },
    {
        id: 2, title: 'The King Beneath the Mud', region: 'meadow', req: { level: 6, chapter: 1 },
        lore: 'The goblins did not act alone. In the swamp floor, something far older moves them — the Slime King, leftover from a forgotten war.',
        dialogue: [
            { who: 'Slime King', text: 'Another summoned blade. They always send blades.' },
            { who: 'You', text: 'You can speak?' },
            { who: 'Slime King', text: 'I was a general before you were a thought.' }
        ],
        task: 'Defeat the Slime King.',
        objective: { type: 'kill', target: 'slime_king', count: 1 },
        reward: { gold: 1800, exp: 1400, item: 'slime_core' }
    },
    {
        id: 3, title: 'The Whispering Forest', region: 'forest', req: { level: 8, chapter: 2 },
        lore: 'The Slime King spoke a name: *Aetherion*. The northern forest holds the answer, but its trees whisper in a language that makes your head ache.',
        dialogue: [
            { who: 'Forest Whisper', text: 'Aetherion... he called you... he always calls...' },
            { who: 'You', text: 'Who is Aetherion?' },
            { who: 'Forest Whisper', text: 'Ask the ones who never left.' }
        ],
        task: 'Clear the path: defeat 10 Shadow Wolves.',
        objective: { type: 'kill', target: 'wolf', count: 10 },
        reward: { gold: 2500, exp: 2000, item: 'luck_charm' }
    },
    {
        id: 4, title: 'The Guardian\'s Grief', region: 'forest', req: { level: 12, chapter: 3 },
        lore: 'The Forest Guardian does not hate you. It hates what was done to the h them. Its sanctuary was cut down to feed a war you have never heard of.',
        dialogue: [
            { who: 'Forest Guardian', text: 'You carry his mark. The Seal\'s mark.' },
            { who: 'You', text: 'I never asked for it.' },
            { who: 'Forest Guardian', text: 'Neither did I.' }
        ],
        task: 'Defeat the Forest Guardian and learn the truth.',
        objective: { type: 'kill', target: 'forest_guardian', count: 1 },
        reward: { gold: 4000, exp: 3000, item: 'storm_talisman' }
    },
    {
        id: 5, title: 'Bones That Stand', region: 'ruins', req: { level: 14, chapter: 4 },
        lore: 'The ruins are a temple. Inside, skeletons stand again — not through magic, but through an *obligation* left unfinished.',
        dialogue: [
            { who: 'Skeleton Warrior', text: 'You are late. You are always late.' },
            { who: 'You', text: 'Late for what?' },
            { who: 'Skeleton Warrior', text: 'For your own funeral. It has been waiting.' }
        ],
        task: 'Cleanse the temple: defeat 12 Skeleton Warriors.',
        objective: { type: 'kill', target: 'skeleton', count: 12 },
        reward: { gold: 5000, exp: 4000, item: 'chain_mail' }
    },
    {
        id: 6, title: 'The Poison Court', region: 'swamp', req: { level: 16, chapter: 5 },
        lore: 'The Swamp Hag offered the villagers immortality. They accepted. Now they do not remember their own names — and she wears them like jewellery.',
        dialogue: [
            { who: 'Swamp Hag', text: 'I give them forever. You give them graves. Which is the monster?' },
            { who: 'You', text: 'Forever without a name is not life.' },
            { who: 'Swamp Hag', text: 'Then take your names back.' }
        ],
        task: 'Break the bargain: defeat 15 Bog Zombies.',
        objective: { type: 'kill', target: 'zombie', count: 15 },
        reward: { gold: 7000, exp: 5500, item: 'sage_amulet' }
    },
    {
        id: 7, title: 'The Witch\'s Price', region: 'swamp', req: { level: 18, chapter: 6 },
        lore: 'The Hag will tell you where the Seal is. The price is the name of someone you love. She can smell that you still remember one.',
        dialogue: [
            { who: 'Swamp Hag', text: 'One name. That is all I ask.' },
            { who: 'You', text: 'No.' },
            { who: 'Swamp Hag', text: 'Then I will take it from your corpse.' }
        ],
        task: 'Defeat the Swamp Hag.',
        objective: { type: 'kill', target: 'swamp_hag', count: 1 },
        reward: { gold: 9000, exp: 7000, item: 'sage_amulet' }
    },
    {
        id: 8, title: 'The Lich That Remembers', region: 'ruins', req: { level: 22, chapter: 7 },
        lore: 'The Eternal Lich was once the priest who built the Seal. He did not betray it. He has been holding it shut from the inside — alone — for three hundred years.',
        dialogue: [
            { who: 'Eternal Lich', text: 'Three centuries. Holding a door. Would you like to try?' },
            { who: 'You', text: 'Why not let it close?' },
            { who: 'Eternal Lich', text: 'Because something is pushing from the other side.' }
        ],
        task: 'Defeat the Eternal Lich and take up his burden.',
        objective: { type: 'kill', target: 'lich', count: 1 },
        reward: { gold: 12000, exp: 9000, item: 'void_katana' }
    },
    {
        id: 9, title: 'The Mountain That Breathes', region: 'volcano', req: { level: 26, chapter: 8 },
        lore: 'The first Seal cracked here. The mountain\'s breath carries names of the dead. Golems wake from the stone.',
        dialogue: [
            { who: 'Mountain Echo', text: 'You are the seventeenth. The others are in the rock.' },
            { who: 'You', text: 'Seventeenth what?' },
            { who: 'Mountain Echo', text: 'Adventurer. Substitute. Fuel.' }
        ],
        task: 'Climb the slope: defeat 15 Brutal Orcs and 8 Stone Golems.',
        objective: { type: 'multi', list: [{ target: 'orc', count: 15 }, { target: 'golem', count: 8 }] },
        reward: { gold: 15000, exp: 12000, item: 'flame_saber' }
    },
    {
        id: 10, title: 'The Wounded Flame', region: 'volcano', req: { level: 30, chapter: 9 },
        lore: 'The Red Dragon is not your enemy — it is a guardian. Its wounds fester with something from the Abyss. Free it from its pain, however you must.',
        dialogue: [
            { who: 'Red Dragon', text: 'You smell of the Seal. Have you come to replace the Lich?' },
            { who: 'You', text: 'I have come to end this.' },
            { who: 'Red Dragon', text: 'Then prove you can survive the ending.' }
        ],
        task: 'Defeat the Red Dragon.',
        objective: { type: 'kill', target: 'dragon', count: 1 },
        reward: { gold: 20000, exp: 16000, item: 'dragon_plate' }
    },
    {
        id: 11, title: 'The Abyss Calls', region: 'abyss', req: { level: 35, chapter: 10 },
        lore: 'The dragon whispers: *"You are not the first summoned. You are only the last."* At the bottom of the Abyss, the traces of those who came before await.',
        dialogue: [
            { who: 'Red Dragon', text: 'They all came down here. All sixteen of them.' },
            { who: 'You', text: 'And what did they find?' },
            { who: 'Red Dragon', text: 'Themselves. That is the cruel part.' }
        ],
        task: 'Descend: defeat 20 Void Walkers.',
        objective: { type: 'kill', target: 'void_walker', count: 20 },
        reward: { gold: 26000, exp: 22000, item: 'abyss_eye' }
    },
    {
        id: 12, title: 'The Sixteen', region: 'abyss', req: { level: 38, chapter: 11 },
        lore: 'You find them: sixteen bodies, each wearing your face. Each a previous Summoned One, failed and forgotten. One of them is still breathing.',
        dialogue: [
            { who: 'Sixteenth', text: 'Don\'t... go up... the throne...' },
            { who: 'You', text: 'Who are you?' },
            { who: 'Sixteenth', text: 'You. Eleven years from now. Turn back.' }
        ],
        task: 'Put the sixteen to rest: defeat 12 Nightmares.',
        objective: { type: 'kill', target: 'nightmare', count: 12 },
        reward: { gold: 30000, exp: 26000, item: 'frost_blade' }
    },
    {
        id: 13, title: 'The Throne of Names', region: 'abyss', req: { level: 42, chapter: 12 },
        lore: 'The Demon Lord sits on a throne made of names. One of them is yours — carved there before you were born.',
        dialogue: [
            { who: 'Demon Lord', text: 'Ah. The seventeenth. Your name has been here since the beginning.' },
            { who: 'You', text: 'I do not believe you.' },
            { who: 'Demon Lord', text: 'Look at the throne. Look at the first name.' }
        ],
        task: 'Reach the throne: defeat 3 Shadow Dragons.',
        objective: { type: 'kill', target: 'shadow_dragon', count: 3 },
        reward: { gold: 36000, exp: 30000, item: 'shadow_dagger' }
    },
    {
        id: 14, title: 'The Demon Lord', region: 'abyss', req: { level: 46, chapter: 13 },
        lore: 'The Demon Lord is not a demon. He is the first Summoned One — the one who refused to go home and became the thing he was sent to kill.',
        dialogue: [
            { who: 'Demon Lord', text: 'I was you. I chose the throne. It is the only way to stop the cycle.' },
            { who: 'You', text: 'There has to be another way.' },
            { who: 'Demon Lord', text: 'Sixteen people said that. Show me.' }
        ],
        task: 'Defeat the Demon Lord.',
        objective: { type: 'kill', target: 'demon_lord', count: 1 },
        reward: { gold: 48000, exp: 40000, item: 'crown_abyss' }
    },
    {
        id: 15, title: 'The Seal Broken', region: 'abyss', req: { level: 50, chapter: 14 },
        lore: 'With the Demon Lord fallen, nothing holds the Seal. It shatters. The sky splits, and Aetherion finally speaks — not as a god, but as something very tired.',
        dialogue: [
            { who: 'Aetherion', text: 'Thank you. I have been waiting a long time.' },
            { who: 'You', text: 'You are the one who summoned me.' },
            { who: 'Aetherion', text: 'I am the one who made the Seal. I am the one who is breaking it.' }
        ],
        task: 'Survive the shattering: defeat 5 Fire Elementals and 5 Lava Hounds.',
        objective: { type: 'multi', list: [{ target: 'fire_elemental', count: 5 }, { target: 'lava_hound', count: 5 }] },
        reward: { gold: 55000, exp: 45000, item: 'celestial_wand' }
    },
    {
        id: 16, title: 'The Walked Colossus', region: 'abyss', req: { level: 58, chapter: 15 },
        lore: 'Aetherion\'s first guardian awakens: the Primordial Colossus, a structure that walked before the world had a name. It guards the final gateway.',
        dialogue: [
            { who: 'Aetherion', text: 'It will not let you pass. It believes you are the danger.' },
            { who: 'You', text: 'Is it wrong?' },
            { who: 'Aetherion', text: 'That is what I am trying to find out.' }
        ],
        task: 'Defeat the Primordial Colossus.',
        objective: { type: 'kill', target: 'world_boss_1', count: 1 },
        reward: { gold: 65000, exp: 55000, item: 'world_breaker' }
    },
    {
        id: 17, title: 'The Void That Remains', region: 'abyss', req: { level: 70, chapter: 16 },
        lore: 'Beyond the gate there is no world — only what is left after every name is forgotten. The Void Dragon guards the space where Aetheria used to be.',
        dialogue: [
            { who: 'Void Dragon', text: 'There is nothing here. There has never been anything here.' },
            { who: 'You', text: 'Then what am I standing on?' },
            { who: 'Void Dragon', text: 'A memory of a floor. Be careful.' }
        ],
        task: 'Defeat the Void Dragon.',
        objective: { type: 'kill', target: 'world_boss_2', count: 1 },
        reward: { gold: 80000, exp: 70000, item: 'crown_eternal' }
    },
    {
        id: 18, title: 'The Choice', region: 'abyss', req: { level: 85, chapter: 17 },
        lore: 'Aetherion shows you the truth: every Seal needs a keeper, and every keeper needs to forget who they were. He offers you the throne. Or the door home.',
        dialogue: [
            { who: 'Aetherion', text: 'Seal the door and go home. Or sit. Be the eighteenth.' },
            { who: 'You', text: 'And if I break the cycle entirely?' },
            { who: 'Aetherion', text: 'Then you must fight me. I will not make it easy.' }
        ],
        task: 'Prepare for the final battle: defeat 3 Void Walkers and 3 Nightmares.',
        objective: { type: 'multi', list: [{ target: 'void_walker', count: 3 }, { target: 'nightmare', count: 3 }] },
        reward: { gold: 100000, exp: 90000, item: 'aether_armor' }
    },
    {
        id: 19, title: 'The Eighteenth, No More', region: 'abyss', req: { level: 95, chapter: 18 },
        lore: 'This is the last chapter. Fight the Creator of the Seal. Whatever happens, there will be no nineteenth Summoned One.',
        dialogue: [
            { who: 'Aetherion', text: 'Show me a hero who does not become the throne.' },
            { who: 'You', text: 'I will show you someone who goes home.' },
            { who: 'Aetherion', text: 'Then take my blessing. And my burden.' }
        ],
        task: 'Defeat Aetherion and end the cycle.',
        objective: { type: 'kill', target: 'world_boss_3', count: 1 },
        reward: { gold: 200000, exp: 180000, item: 'crown_eternal' },
        ending: 'The sky heals. Two moons become one. Somewhere, a voice begins to whisper to someone new — but you are already gone, and the door is closed behind you. The cycle is broken. You were the seventeenth, and the last.'
    }
];

const activeChapter = (p) => {
    const idx = p.quest?.chapter || 0;
    if (idx >= CHAPTERS.length) return null;   // kampanye selesai
    return CHAPTERS[idx] || null;
};

/** Kampanye sudah tamat? */
const campaignComplete = (p) => (p.quest?.chapter || 0) >= CHAPTERS.length;

function canStartChapter(p, chapter) {
    const ch = CHAPTERS[chapter];
    if (!ch) return { ok: false, reason: 'Chapter tidak ada.' };
    if ((p.quest.chapter || 0) !== chapter) return { ok: false, reason: `Selesaikan chapter ${(p.quest.chapter || 0) + 1} dulu.` };
    if (p.rpgLevel < ch.req.level) return { ok: false, reason: `Butuh level ${ch.req.level} (kamu ${p.rpgLevel}).` };
    return { ok: true, chapter: ch };
}

function chapterProgress(p) {
    if (campaignComplete(p)) return null;
    const ch = activeChapter(p);
    if (!ch) return null;
    const killed = p.killed || {};
    if (ch.objective.type === 'kill') {
        const have = Math.min(killed[ch.objective.target] || 0, ch.objective.count);
        return { chapter: ch, have, need: ch.objective.count, done: have >= ch.objective.count, target: ch.objective.target };
    }
    if (ch.objective.type === 'multi') {
        const parts = ch.objective.list.map((o) => ({
            target: o.target, have: Math.min(killed[o.target] || 0, o.count), need: o.count
        }));
        return { chapter: ch, parts, done: parts.every((x) => x.have >= x.need) };
    }
    return { chapter: ch, done: false };
}

function completeChapter(p) {
    if (campaignComplete(p)) return { error: 'Kampanye sudah tamat. Tidak ada chapter tersisa.', complete: true };
    const pr = chapterProgress(p);
    if (!pr) return { error: 'Tidak ada chapter aktif.' };
    if (!pr.done) return { error: 'Objektif chapter belum selesai.' };
    const ch = pr.chapter;
    const core = require('./core');
    const items = require('./items');
    p.gold += ch.reward.gold;
    p.stats.goldEarned += ch.reward.gold;
    if (ch.reward.item) items.addItem(p, ch.reward.item, 1);
    const lvl = core.addExp(p, ch.reward.exp);
    p.quest.chapter = Math.min(CHAPTERS.length, (p.quest.chapter || 0) + 1);
    if (!p.quest.completed.includes(ch.id)) p.quest.completed.push(ch.id);
    return {
        ok: true, chapter: ch, next: CHAPTERS[p.quest.chapter] || null,
        levelUp: lvl.levelUp, levels: lvl.levels,
        storyComplete: p.quest.chapter >= CHAPTERS.length
    };
}

/* ───────────────────────── SEASON ───────────────────────── */

/**
 * Seasons rotate monthly. Each has a theme, bonus multipliers, a featured boss,
 * a multi-tier reward ladder, and a piece of lore that ties into the campaign.
 */
const SEASONS = [
    {
        id: 's_awakening', month: 1, name: 'Dawn of the Summoned', emoji: '🌅', theme: 'light',
        tagline: 'The beginning of everything. The world opens its eyes.',
        lore: 'The month Aetheria first remembered your name.',
        bonus: { expMul: 1.10 }, boss: 'slime_king',
        reward: { gold: 5000, exp: 4000, item: 'celestial_wand' },
        tiers: [{ gold: 1000, dust: 50 }, { gold: 2500, dust: 120 }, { gold: 5000, dust: 260 }]
    },
    {
        id: 's_ember', month: 2, name: 'Season of Embers', emoji: '🔥', theme: 'fire',
        tagline: 'Fire burns along every border.',
        lore: 'The mountains sing, and the dragons wake from their long sleep.',
        bonus: { goldMul: 1.20 }, boss: 'dragon',
        reward: { gold: 8000, exp: 6000, item: 'flame_seal' },
        tiers: [{ gold: 2000, dust: 80 }, { gold: 4500, dust: 190 }, { gold: 8000, dust: 400 }]
    },
    {
        id: 's_bloom', month: 3, name: 'Bloom of Shadows', emoji: '🌸', theme: 'wind',
        tagline: 'The gentle hides the sharp.',
        lore: 'Flowers bloom over graves; the forest closes its secrets.',
        bonus: { dropMul: 1.25 }, boss: 'forest_guardian',
        reward: { gold: 6000, exp: 5000, item: 'shadow_charm' },
        tiers: [{ gold: 1500, dust: 70 }, { gold: 3500, dust: 160 }, { gold: 6000, dust: 340 }]
    },
    {
        id: 's_veil', month: 4, name: 'The Thin Veil', emoji: '🌫️', theme: 'dark',
        tagline: 'The line between the living and the dead begins to blur.',
        lore: 'Wraiths walk in daylight. No one dares go outside.',
        bonus: { expMul: 1.20 }, boss: 'lich',
        reward: { gold: 9000, exp: 8000, item: 'abyss_eye' },
        tiers: [{ gold: 2500, dust: 100 }, { gold: 5500, dust: 230 }, { gold: 9000, dust: 480 }]
    },
    {
        id: 's_storm', month: 5, name: 'Silver Storm', emoji: '⚡', theme: 'wind',
        tagline: 'Lightning marks the chosen.',
        lore: 'The storm arrives without clouds. Only the sky, cracked open.',
        bonus: { goldMul: 1.30 }, boss: 'demon_lord',
        reward: { gold: 12000, exp: 10000, item: 'storm_bow' },
        tiers: [{ gold: 3000, dust: 130 }, { gold: 7000, dust: 300 }, { gold: 12000, dust: 620 }]
    },
    {
        id: 's_solstice', month: 6, name: 'The Longest Day', emoji: '☀️', theme: 'light',
        tagline: 'The longest day, the shortest night.',
        lore: 'The sun did not set for seven days. The world held its breath.',
        bonus: { expMul: 1.30 }, boss: 'world_boss_1',
        reward: { gold: 18000, exp: 15000, item: 'halo_relic' },
        tiers: [{ gold: 4500, dust: 180 }, { gold: 10000, dust: 420 }, { gold: 18000, dust: 900 }]
    },
    {
        id: 's_hollow', month: 7, name: 'The Hollow', emoji: '🕳️', theme: 'dark',
        tagline: 'Something is missing from the world, and no one remembers what.',
        lore: 'The names of villagers began to vanish from memory.',
        bonus: { dropMul: 1.30 }, boss: 'demon_lord',
        reward: { gold: 15000, exp: 12000, item: 'void_katana' },
        tiers: [{ gold: 3800, dust: 160 }, { gold: 8500, dust: 360 }, { gold: 15000, dust: 780 }]
    },
    {
        id: 's_harvest', month: 8, name: 'Blood Harvest', emoji: '🌾', theme: 'earth',
        tagline: 'What was planted for years is finally reaped.',
        lore: 'The fields turned gold, but it was not wheat that grew.',
        bonus: { goldMul: 1.40 }, boss: 'dragon',
        reward: { gold: 20000, exp: 16000, item: 'blood_axe' },
        tiers: [{ gold: 5000, dust: 200 }, { gold: 11000, dust: 460 }, { gold: 20000, dust: 980 }]
    },
    {
        id: 's_eclipse', month: 9, name: 'Eternal Eclipse', emoji: '🌑', theme: 'dark',
        tagline: 'The sun is devoured. Light is only a memory.',
        lore: 'The eclipse lasted a full month. Monsters grew far stronger.',
        bonus: { expMul: 1.40 }, boss: 'demon_lord',
        reward: { gold: 22000, exp: 18000, item: 'crown_abyss' },
        tiers: [{ gold: 5500, dust: 220 }, { gold: 12500, dust: 500 }, { gold: 22000, dust: 1100 }]
    },
    {
        id: 's_requiem', month: 10, name: 'Requiem', emoji: '🕯️', theme: 'light',
        tagline: 'A song for those who have gone.',
        lore: 'Bells rang in temples that had already collapsed.',
        bonus: { expMul: 1.25, goldMul: 1.25 }, boss: 'lich',
        reward: { gold: 25000, exp: 20000, item: 'aegis_divine' },
        tiers: [{ gold: 6000, dust: 240 }, { gold: 14000, dust: 560 }, { gold: 25000, dust: 1250 }]
    },
    {
        id: 's_frost', month: 11, name: 'Frostfall', emoji: '❄️', theme: 'wind',
        tagline: 'A cold that freezes even time.',
        lore: 'The Abyss froze over. Something walked across it.',
        bonus: { dropMul: 1.35 }, boss: 'swamp_hag',
        reward: { gold: 28000, exp: 22000, item: 'frost_blade' },
        tiers: [{ gold: 6800, dust: 270 }, { gold: 15500, dust: 620 }, { gold: 28000, dust: 1400 }]
    },
    {
        id: 's_eternal', month: 12, name: 'The Eternal Night', emoji: '✨', theme: 'dark',
        tagline: 'The end of the year, and the end of a cycle.',
        lore: 'Every road meets here. Every season before this was part of it.',
        bonus: { expMul: 1.50, goldMul: 1.50, dropMul: 1.50 }, boss: 'world_boss_2',
        reward: { gold: 50000, exp: 40000, item: 'crown_eternal' },
        tiers: [{ gold: 12000, dust: 400 }, { gold: 28000, dust: 900 }, { gold: 50000, dust: 2000 }]
    }
];

function currentSeason(date = new Date()) {
    const month = date.getMonth() + 1;
    const s = SEASONS.find((x) => x.month === month) || SEASONS[0];
    const year = date.getFullYear();
    return { ...s, key: `${year}-${String(month).padStart(2, '0')}`, year, month };
}

function seasonRemaining(date = new Date()) {
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
    return Math.max(0, end - date);
}

function seasonBonus(season) {
    const b = (season && season.bonus) || {};
    return { expMul: b.expMul || 1, goldMul: b.goldMul || 1, dropMul: b.dropMul || 1 };
}

module.exports = {
    CHAPTERS, activeChapter, campaignComplete, canStartChapter, chapterProgress, completeChapter,
    SEASONS, currentSeason, seasonRemaining, seasonBonus
};
