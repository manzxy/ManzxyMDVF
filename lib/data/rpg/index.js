/**
 * RPG ENGINE — entry point.
 * Combines core, items, monsters, systems, and story into one API.
 *
 * Pure logic: never touches sockets or storage. Callers must db.markDirty().
 */

const core = require('./core');
const items = require('./items');
const monsters = require('./monsters');
const systems = require('./systems');
const story = require('./story');
const live = require('./live');

/**
 * Compute full rewards for one victory, with every multiplier applied:
 * season, party size, guild level, buffs, combo, and the rotating world event.
 * @param {object} p        rpg profile
 * @param {object} monster  monster instance
 * @param {object} ctx      { partySize, guildLevel, season, elite, userNumber, event, skipCombo }
 */
function battleReward(p, monster, ctx = {}) {
    const { partySize = 1, guildLevel = 1, season = null, userNumber = '', skipCombo = false } = ctx;
    const buffs = systems.activeBuffs(p);
    const pb = systems.partyBonus(partySize);
    const gb = systems.guildBonus(guildLevel);
    const sb = season ? story.seasonBonus(season) : { expMul: 1, goldMul: 1, dropMul: 1 };

    // Combo & world event ikut mengalikan semuanya.
    const combo = skipCombo ? 1 : live.comboMultiplier(p);
    const event = live.eventMul(ctx.event);

    const expMul = pb.expMul * gb.expMul * sb.expMul * buffs.expMul * combo * event.exp;
    const goldMul = pb.goldMul * gb.goldMul * sb.goldMul * combo * event.gold;
    const dropMul = sb.dropMul * buffs.dropMul * event.drop;

    const cls = core.CLASSES[p.class];
    const luckBonus = 1 + (p.points.luk || 0) * 0.01 + (cls === core.CLASSES.rogue ? 0.15 : 0) + (p.prestige || 0) * 0.05;
    const gold = Math.floor(monster.gold * luckBonus * goldMul);
    const exp = Math.floor(monster.exp * expMul);

    p.gold += gold;
    p.stats.goldEarned += gold;
    p.stats.kills++;
    if (monster.boss) p.stats.bossKills++;
    p.killed[monster.id] = (p.killed[monster.id] || 0) + 1;
    // codex: track how many of each monster has been seen/killed
    p.codex = p.codex || {};
    p.codex[monster.id] = (p.codex[monster.id] || 0) + 1;

    const drops = monsters.rollDrops(monster, luckBonus * dropMul);
    for (const id of drops) items.addItem(p, id, 1);

    const lvl = core.addExp(p, exp);
    const petLvl = systems.petGainExp(p, monster.exp);
    const achievements = systems.checkAchievements(p);
    const guildLvl = ctx.guild ? systems.guildGainExp(ctx.guild, Math.floor(monster.exp * 0.3)) : null;

    // Progres misi harian & mingguan
    live.addDailyProgress(p, userNumber, 'kills', 1);
    live.addDailyProgress(p, userNumber, 'gold', gold);
    if (monster.boss) live.addDailyProgress(p, userNumber, 'boss', 1);
    live.addWeekly(p, 'kills', 1);
    live.addWeekly(p, 'gold', gold);
    if (monster.boss) live.addWeekly(p, 'bosses', 1);

    // Bounty harian
    const bounty = live.dailyBounty();
    let bountyHit = false;
    if (monster.id === bounty.monsterId) {
        // Pastikan catatan bounty milik hari ini; hari baru = reset penuh.
        if (!p.bounty || p.bounty.key !== bounty.key) p.bounty = { key: bounty.key, claimed: false, hit: false };
        if (!p.bounty.hit) { p.bounty.hit = true; bountyHit = true; }
    }

    const comboCount = skipCombo ? (p.combo?.count || 0) : live.bumpCombo(p);

    return {
        gold, exp, drops,
        levelUp: lvl.levelUp, levels: lvl.levels,
        petLevelUp: petLvl.levelUp, petLevels: petLvl.levels,
        guildLevelUp: guildLvl ? guildLvl.levelUp : false, guildLevels: guildLvl ? guildLvl.levels : 0,
        achievements,
        bountyHit,
        combo: comboCount,
        multipliers: { exp: expMul, gold: goldMul, drop: dropMul }
    };
}

/**
 * Terapkan reward satu kemenangan ke profil.
 *
 * `battleReward()` di atas SUDAH menambahkan gold, EXP, drop, dan stats ke `p`.
 * Karena itu plugin tidak boleh menambahkan gold/exp lagi — cukup pakai angka
 * di return value untuk ditampilkan. Untuk bonus tambahan (dungeon/raid) pakai
 * helper di bawah agar tidak terjadi pembayaran ganda.
 */
const rewardApplied = true;

/**
 * Beri bonus (gold/exp/dust) di atas reward yang sudah dibayar.
 * @returns {{gold:number, exp:number, levels:number, levelUp:boolean}}
 */
function grantBonus(p, { gold = 0, exp = 0, dust = 0 } = {}) {
    const g = Math.max(0, Math.floor(gold));
    const e = Math.max(0, Math.floor(exp));
    const d = Math.max(0, Math.floor(dust));
    if (g) { p.gold += g; p.stats.goldEarned += g; }
    if (d) { p.enchant = p.enchant || { dust: 0, slots: {} }; p.enchant.dust = (p.enchant.dust || 0) + d; }
    const lvl = e ? core.addExp(p, e) : { levels: 0, levelUp: false };
    return { gold: g, exp: e, dust: d, levels: lvl.levels, levelUp: lvl.levelUp };
}

module.exports = {
    ...core,
    ...items,
    ...monsters,
    ...systems,
    ...story,
    ...live,
    live,
    core, itemsModule: items, monstersModule: monsters, systems, story,
    battleReward, rewardApplied, grantBonus
};
