const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

const COOLDOWN = 90000;
const MULT_FLOOR = 1.35;
const FLOORS = 3;

/**
 * Dungeon bertingkat: 3 lantai monster lalu boss.
 * Reward memakai battleReward sehingga season, party, dan guild ikut berlaku.
 */
module.exports = {
    name: 'Dungeon',
    command: ['dungeon', 'dgn'],
    category: 'rpg',
    description: 'Dungeon bertingkat: lawan 3 gelombang lalu boss dengan multiplier reward',
    usage: '.dungeon',
    limit: 0,
    async execute(sock, m, { user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);

        const wait = (p.cooldowns.dungeon || 0) + COOLDOWN - Date.now();
        if (wait > 0) return await reply(`⏳ Dungeon berikutnya bisa dimasuki dalam *${Math.ceil(wait / 1000)} detik*.`);

        const d0 = rpg.derived(p);
        const cur = rpg.current(p);
        if (cur.hp < d0.maxHp * 0.5) {
            return await reply(`❤️ HP kamu ${cur.hp}/${d0.maxHp}. Dungeon butuh minimal 50% HP.\nPulihkan: *${prefix}heal*`);
        }

        p.cooldowns.dungeon = Date.now();
        const season = rpg.currentSeason();
        const region = rpg.pickRegion(p);
        const party = db.data.parties?.[p.partyId];
        const ctx = {
            partySize: party?.members.length || 1,
            guildLevel: db.data.guilds?.[p.guildId]?.level || 1,
            season
        };

        const log = [];
        let hp = cur.hp, mp = cur.mp;
        let gold = 0, exp = 0, cleared = 0;
        const drops = [];
        const achievements = [];
        let levelUps = 0;

        for (let floor = 1; floor <= FLOORS; floor++) {
            const id = rpg.pickHuntMonster(p, null, region);
            const mons = rpg.spawnMonster(id, Math.floor(p.rpgLevel * (1 + floor * 0.1)), region);
            const res = rpg.battle({ ...p, hp, mp, mpUpdatedAt: p.mpUpdatedAt }, mons, { useSkill: floor === 1 });
            hp = res.playerHp; mp = res.playerMp;
            if (!res.win) {
                log.push(`▸ Lantai ${floor}: 💀 tumbang oleh ${mons.emoji} ${mons.name}`);
                break;
            }
            // battleReward SUDAH membayar gold/exp/drop ke profil. Angka di sini hanya untuk ringkasan.
            const rw = rpg.battleReward(p, res.monster, ctx);
            gold += rw.gold;
            exp += rw.exp;
            drops.push(...rw.drops);
            achievements.push(...rw.achievements);
            levelUps += rw.levels;
            cleared++;
            log.push(`▸ Lantai ${floor}: ${mons.emoji} ${mons.name} tumbang (${res.turns} giliran)`);
        }

        if (cleared === FLOORS) {
            const boss = rpg.spawnMonster(rpg.pickBoss(p), p.rpgLevel, region);
            const res = rpg.battle({ ...p, hp, mp, mpUpdatedAt: p.mpUpdatedAt }, boss, { useSkill: true });
            hp = res.playerHp; mp = res.playerMp;
            if (res.win) {
                const rw = rpg.battleReward(p, res.monster, ctx);
                gold += rw.gold;
                exp += rw.exp;
                drops.push(...rw.drops);
                achievements.push(...rw.achievements);
                levelUps += rw.levels;
                cleared++;
                p.stats.dungeons++;
                log.push(`▸ 👑 BOSS ${boss.emoji} ${boss.name} TUMBANG!`);
            } else {
                log.push(`▸ 👑 BOSS ${boss.emoji} ${boss.name} menang — kamu terlempar keluar.`);
            }
        }

        // Bonus dungeon (di atas reward dasar) — bukan pembayaran ulang.
        const bonusGold = Math.floor(gold * (MULT_FLOOR - 1));
        const bonusExp = Math.floor(exp * (MULT_FLOOR - 1));
        const bonus = rpg.grantBonus(p, { gold: bonusGold, exp: bonusExp });
        levelUps += bonus.levels;
        rpg.live.addWeekly(p, 'dungeons', cleared > FLOORS ? 1 : 0);
        rpg.live.addDailyProgress(p, user.number, 'dungeon', cleared > FLOORS ? 1 : 0);
        rpg.applyCurrent(p, hp, mp);
        const newAch = rpg.checkAchievements(p);
        db.markDirty();

        const d = rpg.derived(p);
        const uniq = [...new Set(drops)];
        const dropTxt = uniq.length ? `\n🎁 ${uniq.map((id) => `${rpg.ITEMS[id].emoji} ${rpg.ITEMS[id].name}`).join(', ')}` : '';
        const achTxt = [...new Map([...achievements, ...newAch].map((a) => [a.id, a])).values()];

        await reply(
            `🏰 *DUNGEON* — ${cleared}/${FLOORS + 1} lantai\n\n${log.join('\n')}\n\n` +
            `❤️ HP ${hp}/${d.maxHp} • 💙 MP ${mp}/${d.maxMp}\n` +
            `⬆️ +${fmt(exp + bonus.exp)} EXP • 🪙 +${fmt(gold + bonus.gold)} gold${dropTxt}` +
            (bonusGold || bonusExp ? `\n_✨ Bonus dungeon ×${MULT_FLOOR}_` : '') +
            `${levelUps ? `\n\n🌟 *NAIK ${levelUps} LEVEL!*` : ''}` +
            `${achTxt.length ? `\n🏅 ${achTxt.map((a) => a.name).join(', ')}` : ''}\n\n` +
            `_Masuk lagi dalam 90 detik._`
        );
    }
};
