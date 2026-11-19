const test = require('node:test');
const assert = require('node:assert');
const rpg = require('../lib/data/rpg');

const fixedRng = (v) => () => v;
const newChar = (cls = 'warrior') => rpg.syncProfile(rpg.createProfile({}, cls));

/* ───────────────────────── PROFIL & STAT ───────────────────────── */

test('createProfile valid untuk semua kelas', () => {
    for (const id of Object.keys(rpg.CLASSES)) {
        const p = newChar(id);
        assert.strictEqual(p.class, id);
        assert.strictEqual(p.rpgLevel, 1);
        const d = rpg.derived(p);
        assert.ok(d.maxHp > 0 && d.maxMp > 0 && d.atk > 0);
    }
});

test('profil baru punya semua field sistem', () => {
    const p = newChar();
    for (const k of ['partyId', 'guildId', 'pet', 'craft', 'enchant', 'buffs', 'achievements', 'titles', 'prestige', 'tournament', 'daily']) {
        assert.ok(k in p, `field ${k} hilang`);
    }
});

test('syncProfile memperbaiki profil rusak', () => {
    const p = rpg.syncProfile({ class: 'xxx', points: null, inventory: null, stats: null });
    assert.strictEqual(p.class, 'warrior');
    assert.strictEqual(typeof p.points.str, 'number');
    assert.strictEqual(typeof p.inventory, 'object');
    assert.strictEqual(p.prestige, 0);
});

test('addExp menaikkan level dan poin stat', () => {
    const p = newChar();
    const before = p.statPoints;
    const res = rpg.addExp(p, 500);
    assert.ok(res.levelUp);
    assert.strictEqual(p.statPoints, before + res.levels * rpg.STAT_POINTS_PER_LEVEL);
});

test('allocPoint mengurangi poin & menambah stat', () => {
    const p = newChar('mage');
    const sp = p.statPoints;
    assert.strictEqual(rpg.allocPoint(p, 'int').ok, true);
    assert.strictEqual(p.points.int, 1);
    assert.strictEqual(p.statPoints, sp - 1);
});

/* ───────────────────────── ITEM & EQUIPMENT ───────────────────────── */

test('equip menambah stat turunan', () => {
    const p = newChar();
    const before = rpg.derived(p).atk;
    rpg.addItem(p, 'steel_blade', 1);
    rpg.equip(p, 'steel_blade');
    assert.ok(rpg.derived(p).atk > before);
});

test('set bonus aktif saat 2+ piece terpasang', () => {
    const p = newChar();
    for (const id of ['slime_blade', 'slime_core', 'slime_ring']) {
        rpg.addItem(p, id, 1);
        rpg.equip(p, id);
    }
    const set = rpg.activeSet(p);
    assert.ok(set);
    assert.strictEqual(set.key, 'slime');
    assert.strictEqual(set.full, true);
    const bonus = rpg.setBonus(p);
    assert.ok(bonus.vit > 0);
});

test('useItem menyembuhkan dan mengurangi stok', () => {
    const p = newChar('cleric');
    rpg.addItem(p, 'potion_s', 2);
    rpg.applyCurrent(p, 10, 10);
    const r = rpg.useItem(p, 'potion_s');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(p.inventory.potion_s, 1);
    assert.ok(rpg.current(p).hp > 10);
});

test('useItem buff menerapkan buff aktif', () => {
    const p = newChar();
    rpg.addItem(p, 'atk_potion', 1);
    const r = rpg.useItem(p, 'atk_potion');
    assert.strictEqual(r.ok, true);
    assert.ok(rpg.activeBuffs(p).active.length > 0);
});

test('sellValue & dustValue naik sesuai rarity', () => {
    assert.ok(rpg.sellValue('void_katana') > rpg.sellValue('wooden_sword'));
    assert.ok(rpg.dustValue('crown_abyss') > rpg.dustValue('herb'));
});

/* ───────────────────────── MONSTER & COMBAT ───────────────────────── */

test('region terbuka sesuai level dan pool aman', () => {
    for (const lv of [1, 6, 12, 22, 40]) {
        const p = { rpgLevel: lv };
        const reg = rpg.pickRegion(p);
        assert.ok(rpg.unlockedRegions(lv).includes(reg));
        const pool = rpg.REGIONS[reg].pool;
        for (const id of pool) {
            assert.ok(rpg.MONSTERS[id].lv <= lv + 8, `${id} terlalu tinggi untuk lv ${lv}`);
        }
    }
});

test('spawnMonster menskalakan HP dengan level', () => {
    const low = rpg.spawnMonster('slime', 1, 'meadow');
    const high = rpg.spawnMonster('slime', 30, 'meadow');
    assert.ok(high.maxHp > low.maxHp);
    assert.strictEqual(low.hp, low.maxHp);
});

test('elementMultiplier kuat/lemah/netral', () => {
    assert.ok(rpg.elementMultiplier('fire', 'wind') > 1);
    assert.ok(rpg.elementMultiplier('wind', 'fire') < 1);
    assert.strictEqual(rpg.elementMultiplier('fire', 'fire'), 1);
});

test('battle menghasilkan hasil yang konsisten', () => {
    rpg.setRng(fixedRng(0.5));
    const p = newChar();
    const mons = rpg.spawnMonster('slime', 1, 'meadow');
    const res = rpg.battle(p, mons, {});
    assert.ok(res.turns > 0);
    assert.ok(Array.isArray(res.log) && res.log.length > 0);
    assert.ok(res.playerHp >= 0 && res.monster.hp >= 0);
    rpg.setRng(Math.random);
});

test('battleReward menerapkan pengali party & guild', () => {
    rpg.setRng(fixedRng(0.5));
    const solo = newChar('rogue');
    const group = newChar('rogue');
    const m1 = rpg.spawnMonster('goblin', 5, 'meadow');
    const m2 = rpg.spawnMonster('goblin', 5, 'meadow');
    const r1 = rpg.battleReward(solo, m1, { partySize: 1, guildLevel: 1 });
    const r2 = rpg.battleReward(group, m2, { partySize: 5, guildLevel: 5 });
    assert.ok(r2.exp > r1.exp, 'party/guild harus menambah EXP');
    assert.ok(r2.gold > r1.gold, 'party/guild harus menambah gold');
    rpg.setRng(Math.random);
});

/* ───────────────────────── STORY & SEASON ───────────────────────── */

test('kampanye punya babak dan season lengkap', () => {
    assert.ok(rpg.CHAPTERS.length >= 10);
    assert.strictEqual(rpg.SEASONS.length, 12);
    for (const ch of rpg.CHAPTERS) {
        assert.ok(ch.title && ch.lore && ch.task && ch.reward);
        assert.ok(ch.objective);
    }
});

test('activeChapter mengikuti progres', () => {
    const p = newChar();
    assert.strictEqual(rpg.activeChapter(p).id, 0);
    p.quest.chapter = 3;
    assert.strictEqual(rpg.activeChapter(p).id, 3);
});

test('chapterProgress & completeChapter bekerja', () => {
    const p = newChar();
    const ch = rpg.activeChapter(p);
    if (ch.objective.type === 'kill') {
        p.killed[ch.objective.target] = ch.objective.count;
        const pr = rpg.chapterProgress(p);
        assert.strictEqual(pr.done, true);
        const r = rpg.completeChapter(p);
        assert.strictEqual(r.ok, true);
        assert.strictEqual(p.quest.chapter, 1);
        assert.ok(p.quest.completed.includes(ch.id));
    }
});

test('completeChapter menolak bila objektif belum selesai', () => {
    const p = newChar();
    assert.ok(rpg.completeChapter(p).error);
});

test('season berpindah sesuai bulan', () => {
    const jan = rpg.currentSeason(new Date(2025, 0, 15));
    const dec = rpg.currentSeason(new Date(2025, 11, 15));
    assert.strictEqual(jan.month, 1);
    assert.strictEqual(dec.month, 12);
    assert.notStrictEqual(jan.id, dec.id);
    assert.ok(rpg.seasonRemaining(new Date(2025, 0, 15)) > 0);
});

/* ───────────────────────── SISTEM PENDUKUNG ───────────────────────── */

test('buff aktif kedaluwarsa', () => {
    const p = newChar();
    rpg.applyBuff(p, 'atk_up', 1);
    assert.strictEqual(rpg.activeBuffs(p).active.length, 1);
    return new Promise((resolve) => setTimeout(() => {
        assert.strictEqual(rpg.activeBuffs(p).active.length, 0);
        resolve();
    }, 15));
});

test('pet adopsi, bonus stat, dan naik level', () => {
    const p = newChar();
    p.gold = 100000;
    const r = rpg.adoptPet(p, 'wolf_pet');
    assert.strictEqual(r.ok, true);
    assert.ok(rpg.derived(p).agi > rpg.derived(newChar()).agi);
    const lvl = rpg.petGainExp(p, 10000);
    assert.ok(lvl.levelUp);
});

test('party & guild bonus naik dengan ukuran/level', () => {
    assert.ok(rpg.partyBonus(5).expMul > rpg.partyBonus(1).expMul);
    assert.ok(rpg.guildBonus(10).expMul > rpg.guildBonus(1).expMul);
});

test('craft membutuhkan material dan menghasilkan item', () => {
    const p = newChar();
    assert.ok(rpg.craft(p, 'iron_sword').error, 'harus gagal tanpa material');
    rpg.addItem(p, 'mat_iron_ore', 3);
    rpg.addItem(p, 'mat_slime_jelly', 2);
    const r = rpg.craft(p, 'iron_sword');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(p.inventory.iron_sword, 1);
    assert.strictEqual(p.inventory.mat_iron_ore, undefined);
});

test('dismantle menghasilkan debu, enchant memakainya', () => {
    const p = newChar();
    rpg.addItem(p, 'wooden_sword', 2);
    rpg.equip(p, 'wooden_sword');
    // bongkar salinan yang tidak dipakai agar slot weapon tetap terisi
    const d = rpg.dismantle(p, 'wooden_sword');
    assert.ok(d.dust > 0);
    assert.strictEqual(p.equipment.weapon, 'wooden_sword');
    p.enchant.dust = 1000;
    // Enchant punya peluang gagal; kunci RNG agar tes tidak flaky.
    rpg.setRng(fixedRng(0.01));
    try {
        const e = rpg.enchant(p, 'weapon');
        assert.strictEqual(e.ok, true);
        assert.strictEqual(p.enchant.slots.weapon, 1);
    } finally {
        rpg.setRng(Math.random);
    }
});

test('item terakhir yang sedang dipakai tidak bisa dihilangkan', () => {
    const p = newChar();
    rpg.addItem(p, 'wooden_sword', 1);
    rpg.equip(p, 'wooden_sword');
    rpg.dismantle(p, 'wooden_sword');
    // setelah habis, slot tidak boleh menunjuk item yang sudah tidak dimiliki
    assert.strictEqual(p.equipment.weapon, null);
});

test('enchant gagal bila tidak ada debu', () => {
    const p = newChar();
    rpg.addItem(p, 'wooden_sword', 1);
    rpg.equip(p, 'wooden_sword');
    p.enchant.dust = 0;
    assert.ok(rpg.enchant(p, 'weapon').error);
});

test('achievement terbuka dan memberi bonus', () => {
    const p = newChar();
    p.stats.kills = 1;
    const got = rpg.checkAchievements(p);
    assert.ok(got.some((a) => a.id === 'first_blood'));
    assert.ok(rpg.achievementBonus(p).str >= 1);
    // idempoten
    assert.strictEqual(rpg.checkAchievements(p).length, 0);
});

test('prestige mensyaratkan level dan mereset progres', () => {
    const p = newChar();
    assert.ok(rpg.prestige(p).error);
    p.rpgLevel = 50;
    const r = rpg.prestige(p);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(p.rpgLevel, 1);
    assert.strictEqual(p.prestige, 1);
});

test('shim quest lama tetap berfungsi', () => {
    const p = newChar();
    assert.ok(rpg.QUESTS.length > 0);
    assert.ok(rpg.nextQuest(p));
    assert.ok(rpg.questProgress(p));
});

/* ───────────────────────── CONTENT BARU ───────────────────────── */

test('8 kelas tersedia dan alias Indonesia dikenali', () => {
    assert.strictEqual(Object.keys(rpg.CLASSES).length, 8);
    assert.strictEqual(rpg.CLASS_ALIASES[rpg.norm('penyihir')], 'mage');
    assert.strictEqual(rpg.CLASS_ALIASES[rpg.norm('ksatria')], 'warrior');
    assert.strictEqual(rpg.CLASS_ALIASES[rpg.norm('pemanah')], 'archer');
});

test('6 region dengan urutan level naik', () => {
    const regions = Object.keys(rpg.REGIONS);
    assert.strictEqual(regions.length, 6);
    const lv = regions.map((r) => rpg.REGIONS[r].minLv);
    assert.deepStrictEqual(lv, [...lv].sort((a, b) => a - b));
});

test('semua monster punya drop item yang valid', () => {
    for (const [id, mo] of Object.entries(rpg.MONSTERS)) {
        assert.ok(mo.name, `monster ${id} tanpa nama`);
        assert.ok(mo.region && rpg.REGIONS[mo.region], `monster ${id} region tidak valid`);
        for (const [drop] of mo.drops || []) {
            assert.ok(rpg.ITEMS[drop], `drop ${drop} (${id}) tidak ada di ITEMS`);
        }
    }
});

test('pool region hanya berisi monster yang ada', () => {
    for (const [rid, r] of Object.entries(rpg.REGIONS)) {
        for (const id of r.pool) assert.ok(rpg.MONSTERS[id], `pool ${rid} -> ${id} tidak ada`);
    }
});

test('fuzzy matching nama monster Indonesia dan Inggris', () => {
    assert.strictEqual(rpg.findMonster('naga merah'), 'dragon');
    assert.strictEqual(rpg.findMonster('raja iblis'), 'demon_lord');
    assert.strictEqual(rpg.findMonster('serigala'), 'wolf');
    assert.strictEqual(rpg.findMonster('Slime King'), 'slime_king');
    assert.strictEqual(rpg.findMonster('zzz tidak ada'), null);
});

test('spawnMonster menskala sesuai level pemain', () => {
    const low = rpg.spawnMonster('slime', 1, 'meadow');
    const high = rpg.spawnMonster('slime', 40, 'meadow');
    assert.ok(high.maxHp > low.maxHp);
    assert.ok(high.exp > low.exp);
    assert.strictEqual(high.hp, high.maxHp);
});

test('elite menaikkan stat monster non-boss saja', () => {
    const normal = rpg.spawnMonster('goblin', 5, 'meadow');
    const elite = rpg.spawnMonster('goblin', 5, 'meadow', { elite: true });
    assert.ok(elite.maxHp > normal.maxHp);
    assert.ok(elite.displayName.startsWith('Elite'));
    const bossElite = rpg.spawnMonster('slime_king', 5, 'meadow', { elite: true });
    assert.strictEqual(bossElite.elite, false);
});

test('pickBoss dan pickRaidBoss mengembalikan id valid', () => {
    const p = newChar();
    p.rpgLevel = 50;
    assert.ok(rpg.MONSTERS[rpg.pickBoss(p)]);
    assert.ok(rpg.MONSTERS[rpg.pickRaidBoss(p)]);
});

test('20 chapter, 12 season, urutan chapter konsisten', () => {
    assert.strictEqual(rpg.CHAPTERS.length, 20);
    assert.strictEqual(rpg.SEASONS.length, 12);
    rpg.CHAPTERS.forEach((c, i) => {
        assert.strictEqual(c.id, i, `chapter ${i} id salah`);
        assert.ok(c.title && c.lore && c.task);
        assert.ok(c.dialogue.length >= 2, `chapter ${i} dialog kurang`);
        assert.ok(c.reward.gold > 0 && c.reward.exp > 0);
    });
});

test('objektif chapter merujuk monster yang ada', () => {
    for (const c of rpg.CHAPTERS) {
        const targets = c.objective.type === 'kill'
            ? [c.objective.target]
            : c.objective.list.map((o) => o.target);
        for (const t of targets) assert.ok(rpg.MONSTERS[t], `chapter ${c.id} target ${t} tidak ada`);
        if (c.reward.item) assert.ok(rpg.ITEMS[c.reward.item], `chapter ${c.id} reward item hilang`);
    }
});

test('season punya 12 bulan unik dan boss valid', () => {
    const months = rpg.SEASONS.map((s) => s.month);
    assert.deepStrictEqual(months, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const s of rpg.SEASONS) {
        assert.ok(rpg.MONSTERS[s.boss], `season ${s.id} boss ${s.boss} tidak ada`);
        assert.ok(s.tiers.length >= 3, `season ${s.id} tier kurang`);
        assert.ok(rpg.ITEMS[s.reward.item], `season ${s.id} reward item hilang`);
    }
});

test('currentSeason mengikuti bulan berjalan', () => {
    const s = rpg.currentSeason(new Date(2025, 6, 15));
    assert.strictEqual(s.month, 7);
    assert.strictEqual(s.key, '2025-07');
    assert.strictEqual(s.name, rpg.SEASONS[6].name);
});

test('seasonBonus mengembalikan 1 bila tanpa bonus', () => {
    const b = rpg.seasonBonus({ bonus: {} });
    assert.deepStrictEqual(b, { expMul: 1, goldMul: 1, dropMul: 1 });
});

test('battleReward menerapkan pengali season', () => {
    const p = newChar();
    const mo = rpg.spawnMonster('slime', 1, 'meadow');
    const base = rpg.battleReward({ ...p, killed: {}, codex: {}, stats: { ...p.stats } }, { ...mo }, {});
    const p2 = newChar();
    const boosted = rpg.battleReward(
        { ...p2, killed: {}, codex: {}, stats: { ...p2.stats } },
        { ...mo },
        { season: { bonus: { expMul: 2, goldMul: 2 } } }
    );
    assert.ok(boosted.exp > base.exp);
    assert.ok(boosted.gold > base.gold);
});

test('battleReward mengisi codex dan killed', () => {
    const p = newChar();
    p.codex = {};
    const mo = rpg.spawnMonster('goblin', 3, 'meadow');
    rpg.battleReward(p, mo, {});
    assert.strictEqual(p.codex.goblin, 1);
    assert.strictEqual(p.killed.goblin, 1);
});

/* ───────────────────────── KESEIMBANGAN ───────────────────────── */

/** Alokasikan poin mengikuti growth kelas, seperti pemain aktif. */
function levelUp(p, target) {
    let guard = 0;
    while (p.rpgLevel < target && guard++ < 900) rpg.addExp(p, rpg.expToNext(p.rpgLevel));
    const growth = rpg.CLASSES[p.class].growth;
    while (p.statPoints > 0) {
        const best = Object.keys(growth).sort((a, b) => growth[b] - growth[a])[0];
        rpg.allocPoint(p, best);
    }
    rpg.applyCurrent(p, rpg.derived(p).maxHp, rpg.derived(p).maxMp);
    return p;
}

test('setiap kelas punya win rate sehat di semua tingkat level', () => {
    // RNG deterministik: uji 10 pertarungan per kombinasi, bukan sekali.
    // Menuntut 100% akan rapuh — 1 kekalahan di level maksimum masih wajar.
    const seed = (n) => () => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n / 0x7fffffff; };
    for (const cls of Object.keys(rpg.CLASSES)) {
        for (const lv of [1, 10, 25, 50, 80, 120]) {
            let wins = 0;
            let maxTurns = 0;
            for (let s = 1; s <= 10; s++) {
                rpg.setRng(seed(s * 7919));
                const p = levelUp(newChar(cls), lv);
                const regions = rpg.unlockedRegions(p.rpgLevel);
                const region = regions[regions.length - 1];
                const id = rpg.pickHuntMonster(p, null, region);
                const mo = rpg.spawnMonster(id, p.rpgLevel, region);
                const r = rpg.battle(p, mo, { useSkill: true });
                assert.ok(r.turns < 40, `${cls} Lv${lv}: ${r.turns} giliran (stalemate?)`);
                if (r.win) wins++;
                maxTurns = Math.max(maxTurns, r.turns);
            }
            assert.ok(wins >= 8, `${cls} Lv${lv} hanya menang ${wins}/10`);
            void maxTurns;
        }
    }
    rpg.setRng(Math.random);
});

test('cleric dan paladin punya skill damage (anti-stalemate)', () => {
    for (const cls of ['cleric', 'paladin']) {
        const c = rpg.CLASSES[cls];
        const skills = [c.skill, ...(c.unlock || [])];
        assert.ok(skills.some((s) => s.power > 0), `${cls} tidak punya skill damage`);
    }
});

test('battle tidak memakai heal terus saat HP penuh', () => {
    const p = levelUp(newChar('cleric'), 50);
    const mo = rpg.spawnMonster('skeleton', 50, 'forest');
    const r = rpg.battle(p, mo, { useSkill: true });
    assert.ok(r.damageDealt > 0, 'tidak ada damage sama sekali → stalemate heal');
    assert.ok(r.win);
});

test('monster DEF tumbuh lebih lambat dari HP', () => {
    const low = rpg.spawnMonster('golem', 5, 'volcano');
    const high = rpg.spawnMonster('golem', 90, 'volcano');
    const hpRatio = high.maxHp / low.maxHp;
    const defRatio = high.def / low.def;
    assert.ok(defRatio < hpRatio, `DEF (×${defRatio.toFixed(1)}) tumbuh lebih cepat dari HP (×${hpRatio.toFixed(1)})`);
});

test('serangan dengan pierce mengabaikan sebagian DEF', () => {
    const a = { atk: 1000, matk: 1000, critRate: 0, critDamage: 1.5, element: 'fire' };
    const target = { def: 500, element: 'earth' };
    // RNG tetap: variance 0.9–1.1 membuat satu roll acak bisa menyamakan hasil.
    rpg.setRng(fixedRng(0.5));
    try {
        const normal = rpg.attack(a, target, {});
        const pierced = rpg.attack(a, target, { pierce: 0.5 });
        assert.ok(pierced.damage > normal.damage);
    } finally {
        rpg.setRng(Math.random);
    }
});

test('boss akhir tidak bisa dikalahkan di level rendah', () => {
    const p = levelUp(newChar('warrior'), 20);
    const mo = rpg.spawnMonster('world_boss_3', p.rpgLevel, 'abyss');
    const r = rpg.battle(p, mo, { useSkill: true, maxTurns: 80 });
    assert.strictEqual(r.win, false);
});

/* ───────────────────────── FITUR ENGAGEMENT (live.js) ───────────────────────── */

test('quest harian deterministik per user per hari', () => {
    const a = rpg.dailyQuests('628111');
    const b = rpg.dailyQuests('628111');
    assert.deepStrictEqual(a.map((q) => q.id), b.map((q) => q.id));
    assert.strictEqual(a.length, 4);
    const ids = new Set(a.map((q) => q.id));
    assert.strictEqual(ids.size, 4, 'ada quest duplikat dalam sehari');
});

test('quest harian berganti esok hari', () => {
    const today = rpg.dailyQuests('628111');
    const tomorrow = rpg.dailyQuests('628111', new Date(Date.now() + 86400000));
    const nextWeek = rpg.dailyQuests('628111', new Date(Date.now() + 7 * 86400000));
    // minimal salah satu hari berbeda (deterministik tapi tidak selalu sama)
    const same = (x, y) => x.map((q) => q.id).join() === y.map((q) => q.id).join();
    assert.ok(!same(today, tomorrow) || !same(today, nextWeek));
});

test('progres quest harian bertambah dan bisa diklaim', () => {
    const p = newChar();
    const num = '628222';
    const st = rpg.dailyStatus(p, num);
    const killQuest = st.find((q) => q.kind === 'kills');
    if (!killQuest) return; // hari ini tidak ada quest kill
    rpg.addDailyProgress(p, num, 'kills', killQuest.need);
    const after = rpg.dailyStatus(p, num).find((q) => q.id === killQuest.id);
    assert.strictEqual(after.prog, killQuest.need);
    assert.strictEqual(after.done, true);
    const goldBefore = p.gold;
    const r = rpg.claimDaily(p, num, killQuest.id);
    assert.strictEqual(r.ok, true);
    assert.ok(p.gold > goldBefore);
    // tidak bisa diklaim dua kali
    assert.ok(rpg.claimDaily(p, num, killQuest.id).error);
});

test('quest yang belum selesai tidak bisa diklaim', () => {
    const p = newChar();
    const st = rpg.dailyStatus(p, '628333');
    const r = rpg.claimDaily(p, '628333', st[0].id);
    assert.ok(r.error);
});

test('streak login bertambah dan reset bila bolong', () => {
    const p = newChar();
    const d1 = rpg.touchStreak(p, new Date(2025, 0, 10));
    assert.strictEqual(d1.days, 1);
    const d2 = rpg.touchStreak(p, new Date(2025, 0, 11));
    assert.strictEqual(d2.days, 2);
    // hari yang sama tidak dihitung dua kali
    const d2b = rpg.touchStreak(p, new Date(2025, 0, 11));
    assert.strictEqual(d2b.isNew, false);
    // bolong 2 hari -> reset
    const d3 = rpg.touchStreak(p, new Date(2025, 0, 14));
    assert.strictEqual(d3.days, 1);
});

test('streak memberi bonus gold dan milestone item', () => {
    const p = newChar();
    for (let i = 0; i < 3; i++) rpg.touchStreak(p, new Date(2025, 0, 10 + i));
    assert.ok(p.streak.days >= 3);
    assert.ok(p.gold > 0);
});

test('combo naik bila berurutan dan reset setelah jeda', () => {
    const p = newChar();
    const t0 = 1000000;
    assert.strictEqual(rpg.bumpCombo(p, t0), 1);
    assert.strictEqual(rpg.bumpCombo(p, t0 + 1000), 2);
    assert.strictEqual(rpg.bumpCombo(p, t0 + 2000), 3);
    // jeda lebih dari window sejak bump terakhir -> kembali 1
    assert.strictEqual(rpg.bumpCombo(p, t0 + 2000 + rpg.COMBO_WINDOW + 1), 1);
});

test('combo dibatasi COMBO_MAX dan menaikkan pengali', () => {
    const p = newChar();
    let t = 1000;
    for (let i = 0; i < 30; i++) { rpg.bumpCombo(p, t); t += 100; }
    assert.strictEqual(p.combo.count, rpg.COMBO_MAX);
    const mul = rpg.comboMultiplier(p, t - 50);
    assert.ok(mul > 1 && mul <= 1 + rpg.COMBO_MAX * 0.08);
});

test('combo habis setelah window lewat', () => {
    const p = newChar();
    const t0 = 5000;
    rpg.bumpCombo(p, t0);
    assert.strictEqual(rpg.comboMultiplier(p, t0 + rpg.COMBO_WINDOW + 1), 1);
    assert.strictEqual(rpg.comboRemaining(p, t0 + rpg.COMBO_WINDOW + 1), 0);
});

test('resetCombo mengosongkan combo tapi menyimpan best', () => {
    const p = newChar();
    rpg.bumpCombo(p, 1000);
    rpg.bumpCombo(p, 2000);
    const best = p.combo.best;
    assert.strictEqual(rpg.resetCombo(p), 0);
    assert.strictEqual(p.combo.best, best);
});

test('world event berotasi dan punya pengali valid', () => {
    const a = rpg.currentEvent(1000);
    const b = rpg.currentEvent(1000 + rpg.EVENT_PERIOD);
    assert.ok(a.id && b.id);
    assert.ok(a.remaining > 0 && a.remaining <= rpg.EVENT_PERIOD);
    for (const ev of rpg.WORLD_EVENTS) {
        const mul = rpg.eventMul(ev);
        for (const k of ['gold', 'exp', 'drop', 'monsterAtk', 'bossRate']) {
            assert.strictEqual(typeof mul[k], 'number');
            assert.ok(mul[k] > 0);
        }
    }
});

test('eventMul default 1 untuk event kosong', () => {
    assert.deepStrictEqual(rpg.eventMul(null), { gold: 1, exp: 1, drop: 1, monsterAtk: 1, bossRate: 1 });
});

test('bounty harian stabil sepanjang hari dan punya monster valid', () => {
    const a = rpg.dailyBounty(new Date(2025, 5, 1));
    const b = rpg.dailyBounty(new Date(2025, 5, 1, 23, 59));
    assert.strictEqual(a.monsterId, b.monsterId);
    assert.ok(rpg.MONSTERS[a.monsterId]);
    assert.ok(a.gold > 0 && rpg.ITEMS[a.item]);
});

test('misi mingguan melacak progres dan reset antar minggu', () => {
    const p = newChar();
    rpg.addWeekly(p, 'kills', 10);
    rpg.addWeekly(p, 'gold', 500);
    const wk = rpg.weeklyProgress(p);
    const kills = wk.find((w) => w.id === 'kills');
    assert.strictEqual(kills.have, 10);
    assert.strictEqual(kills.done, false);
    rpg.addWeekly(p, 'kills', rpg.WEEKLY_GOAL.kills);
    assert.strictEqual(rpg.weeklyProgress(p).find((w) => w.id === 'kills').done, true);
});

test('battleReward mencatat progres harian dan mingguan', () => {
    const p = newChar();
    const num = '628444';
    rpg.ensureDaily(p, num);
    const mo = rpg.spawnMonster('slime', 2, 'meadow');
    rpg.battleReward(p, mo, { userNumber: num });
    const st = rpg.dailyStatus(p, num);
    const total = st.reduce((a, q) => a + q.prog, 0);
    assert.ok(total > 0, 'tidak ada progres quest harian tercatat');
    assert.ok((p.weekly?.kills || 0) > 0, 'tidak ada progres mingguan tercatat');
});

test('battleReward menandai bounty saat monster cocok', () => {
    const p = newChar();
    const b = rpg.dailyBounty();
    const mo = rpg.spawnMonster(b.monsterId, 10, rpg.MONSTERS[b.monsterId].region);
    const r = rpg.battleReward(p, mo, {});
    assert.strictEqual(r.bountyHit, true);
    assert.ok(r.combo >= 1);
});

test('dayKey dan daysBetween konsisten', () => {
    assert.strictEqual(rpg.dayKey(new Date(2025, 0, 5)), '2025-01-05');
    assert.strictEqual(rpg.daysBetween('2025-01-05', '2025-01-06'), 1);
    assert.strictEqual(rpg.daysBetween('2025-01-05', '2025-01-12'), 7);
    assert.strictEqual(rpg.daysBetween(null, '2025-01-12'), Infinity);
});

/* ───────────────────────── REGRESI: EKONOMI & PROGRES ───────────────────────── */

test('battleReward membayar gold tepat sekali (dungeon tak boleh menambah ulang)', () => {
    const p = newChar();
    p.gold = 0;
    p.stats.goldEarned = 0;
    const mo = rpg.spawnMonster('slime', 10, 'meadow');
    const r = rpg.battleReward(p, mo, {});
    assert.strictEqual(p.gold, r.gold);
    assert.strictEqual(p.stats.goldEarned, r.gold);
});

test('grantBonus menambah di atas reward yang sudah dibayar', () => {
    const p = newChar();
    p.gold = 100;
    const r = rpg.grantBonus(p, { gold: 50, exp: 10, dust: 5 });
    assert.strictEqual(p.gold, 150);
    assert.strictEqual(r.gold, 50);
    assert.strictEqual(p.enchant.dust, 5);
});

test('kills hanya bertambah sekali per kemenangan', () => {
    const p = newChar();
    const mo = rpg.spawnMonster('slime', 1, 'meadow');
    rpg.battleReward(p, mo, {});
    assert.strictEqual(p.stats.kills, 1);
});

test('claimBounty membayar sekali dan menandai klaim', () => {
    const p = newChar();
    p.gold = 0;
    const b = rpg.dailyBounty();
    p.bounty = { key: b.key, claimed: false, hit: true };
    const r = rpg.claimBounty(p);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(p.gold, b.gold);
    const again = rpg.claimBounty(p);
    assert.ok(again.error);
    assert.strictEqual(p.gold, b.gold);
});

test('checkBounty mereset hit saat hari berganti', () => {
    const p = newChar();
    p.bounty = { key: '1999-01-01', claimed: true, hit: true };
    const rec = rpg.checkBounty(p);
    assert.strictEqual(rec.hit, false);
    assert.strictEqual(rec.claimed, false);
});

/* ───────────────────────── REGRESI: KAMPANYE ───────────────────────── */

test('kampanye tamat tidak bisa diklaim ulang', () => {
    const p = newChar();
    p.quest.chapter = rpg.CHAPTERS.length;
    assert.strictEqual(rpg.activeChapter(p), null);
    assert.strictEqual(rpg.chapterProgress(p), null);
    const r = rpg.completeChapter(p);
    assert.ok(r.error);
    assert.strictEqual(r.complete, true);
    assert.strictEqual(p.quest.chapter, rpg.CHAPTERS.length);
});

/* ───────────────────────── REGRESI: ITEM ───────────────────────── */

test('findItem menemukan item yang benar, bukan sekadar mirip', () => {
    assert.strictEqual(rpg.findItem('potion'), 'potion_s');
    assert.strictEqual(rpg.findItem('potion m'), 'potion_m');
    assert.strictEqual(rpg.findItem('potion l'), 'potion_l');
    assert.strictEqual(rpg.findItem('potion xl'), 'potion_xl');
    assert.strictEqual(rpg.findItem('wooden sword'), 'wooden_sword');
    assert.strictEqual(rpg.findItem('tidak ada item begini'), null);
});

test('parseItemArgs memisahkan nama multi-kata dan jumlah', () => {
    assert.deepStrictEqual(rpg.parseItemArgs(['potion', 'm']), { item: 'potion_m', qty: 1 });
    assert.deepStrictEqual(rpg.parseItemArgs(['iron', 'sword', '2']), { item: 'iron_sword', qty: 2 });
    assert.deepStrictEqual(rpg.parseItemArgs(['potion', 's', '3']), { item: 'potion_s', qty: 3 });
});

test('consumable tidak terbuang saat HP dan MP masih penuh', () => {
    const p = newChar();
    rpg.addItem(p, 'potion_m', 1);
    const r = rpg.useItem(p, 'potion_m');
    assert.ok(r.error);
    assert.strictEqual(p.inventory.potion_m, 1);
});

test('consumable terpakai saat HP berkurang', () => {
    const p = newChar();
    rpg.addItem(p, 'potion_m', 1);
    rpg.applyCurrent(p, 1, 1);
    const r = rpg.useItem(p, 'potion_m');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(p.inventory.potion_m, undefined);
});

test('equip item yang sudah terpasang tidak membuat duplikat', () => {
    const p = newChar();
    rpg.addItem(p, 'wooden_sword', 1);
    rpg.equip(p, 'wooden_sword');
    const again = rpg.equip(p, 'wooden_sword');
    assert.ok(again.error);
    assert.strictEqual(p.inventory.wooden_sword, 1);
});

/* ───────────────────────── REGRESI: GUILD & WEEKLY ───────────────────────── */

test('guildBonus memberi stat yang benar-benar dipakai totalStats', () => {
    const db = require('../lib/data/database');
    if (!db.data) db.load();
    const p = newChar();
    const before = rpg.totalStats(p).str;
    db.data.guilds = db.data.guilds || {};
    db.data.guilds.__T = { name: '__T', owner: '0', members: ['0'], level: 10, exp: 0, bank: 0 };
    p.guildId = '__T';
    const after = rpg.totalStats(p).str;
    p.guildId = null;
    delete db.data.guilds.__T;
    assert.strictEqual(after - before, rpg.guildBonus(10).statBonus.str);
});

test('claimWeekly membayar sekali per minggu', () => {
    const p = newChar();
    p.gold = 0;
    p.stats.goldEarned = 0;
    p.weekly = { kills: 150, bosses: 10, dungeons: 5, raids: 3, gold: 100000, week: rpg.weekKey(), claimed: [] };
    const c = rpg.claimWeekly(p);
    assert.ok(c.claimed.length >= 4);
    assert.strictEqual(p.gold, c.gold);
    const again = rpg.claimWeekly(p);
    assert.ok(again.error);
    assert.strictEqual(p.gold, c.gold);
});
