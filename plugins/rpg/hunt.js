const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

const COOLDOWN = 2500;
const last = new Map();

/** Active party the player is in (or solo). */
function partyInfo(db, user) {
    const p = db.data.parties?.[user.rpg?.partyId];
    if (!p) return { size: 1, members: [], guild: null };
    return {
        size: p.members.length,
        members: p.members.filter((n) => n !== user.number),
        guild: db.data.guilds?.[user.rpg?.guildId] || null
    };
}

module.exports = {
    name: 'Hunt',
    command: ['hunt', 'berburu', 'fight', 'battle', 'boss'],
    category: 'rpg',
    description: 'Berburu monster / boss dengan bonus party, guild, season, dan buff',
    usage: '.hunt • .hunt <monster> • .hunt <region> • .hunt --skill • .boss [nama]',
    limit: 0,
    async execute(sock, m, { command, args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);

        if (Date.now() - (last.get(user.number) || 0) < COOLDOWN) return await reply('⏳ Tunggu sebentar sebelum berburu lagi.');
        last.set(user.number, Date.now());
        if (last.size > 800) last.clear();

        const now = rpg.current(p);
        if (now.hp <= 0) return await reply(`❤️ HP kamu habis! Pulihkan dulu: *${prefix}heal* atau *${prefix}use potion_s*`);

        const isBoss = command === 'boss';
        const wantsSkill = args.includes('--skill') || args.includes('-s');
        // Pilih skill terkuat yang siap (cooldown & MP cukup). Null = serang biasa.
        const skillMod = require('./skill');
        const chosen = wantsSkill ? skillMod.pickCombatSkill(p) : null;
        const useSkill = Boolean(chosen);
        if (wantsSkill && !chosen) {
            return await reply(
                `⏳ Tidak ada skill yang siap.\n` +
                `Periksa MP & cooldown: *${prefix}skill*\n` +
                `Atau serang biasa: *${prefix}hunt* (tanpa --skill)`
            );
        }
        const season = rpg.currentSeason();

        // Resolve target: region name, monster name (fuzzy), or random
        const words = args.filter((a) => !a.startsWith('-'));
        const query = words.join(' ').trim();
        const regionArg = words.find((w) => rpg.REGIONS[w]);
        const monsterId = query ? rpg.findMonster(query) : null;

        let region, finalId;
        if (isBoss) {
            finalId = monsterId || (query ? null : rpg.pickBoss(p));
            if (query && !monsterId) {
                return await reply(`❌ Boss *"${query}"* tidak ditemukan.\nLihat daftar: *${prefix}monsters boss*`);
            }
            region = rpg.MONSTERS[finalId]?.region || 'meadow';
        } else if (monsterId) {
            region = rpg.MONSTERS[monsterId].region;
            finalId = monsterId;
        } else if (query && !regionArg) {
            return await reply(
                `❌ *"${query}"* tidak ditemukan.\n\n` +
                `Coba: *${prefix}monsters* untuk daftar monster,\n` +
                `atau *${prefix}region* untuk daftar wilayah.`
            );
        } else {
            region = rpg.pickRegion(p, regionArg);
            finalId = rpg.pickHuntMonster(p, null, region);
        }

        const elite = !isBoss && Math.random() < 0.12;
        const monster = rpg.spawnMonster(finalId, p.rpgLevel, region, { elite });
        if (!monster) return await reply(`❌ Monster tidak ditemukan. Lihat: *${prefix}monsters*`);

        const party = partyInfo(db, user);
        const buffs = rpg.activeBuffs(p);
        const streakInfo = rpg.touchStreak(p);
        const worldEvent = rpg.currentEvent();
        const res = rpg.battle(p, monster, { useSkill });
        rpg.applyCurrent(p, res.playerHp, res.playerMp);
        if (chosen) p.cooldowns[chosen.id] = Date.now();

        const shownName = monster.displayName || monster.name;

        if (!res.win) {
            p.stats.deaths++;
            const consolation = Math.floor(monster.exp * 0.1);
            rpg.addExp(p, consolation);
            db.markDirty();
            const tail = res.log.slice(-4).join('\n');
            return await reply(
                `${monster.emoji} *${shownName}* (Lv ${monster.lv})\n\n${tail}\n\n` +
                `💀 Kamu kalah! EXP hiburan: +${fmt(consolation)}\n` +
                `${rpg.resetCombo(p) === 0 && p.combo?.best > 1 ? `💔 Combo putus (terbaik: ${p.combo.best}x)\n` : ''}` +
                `Pulihkan: *${prefix}heal*`
            );
        }

        const rw = rpg.battleReward(p, res.monster, {
            partySize: party.size,
            guildLevel: party.guild?.level || 1,
            guild: party.guild,
            season,
            userNumber: user.number,
            event: worldEvent
        });
        db.markDirty();

        const d = rpg.derived(p);
        const dropTxt = rw.drops.length
            ? `\n🎁 ${rw.drops.map((id) => `${rpg.ITEMS[id].emoji} ${rpg.ITEMS[id].name}`).join(', ')}`
            : '';

        const mult = [];
        if (party.size > 1) mult.push(`👥×${party.size}`);
        if ((party.guild?.level || 1) > 1) mult.push(`🏰Lv${party.guild.level}`);
        if (buffs.active.length) mult.push(buffs.active.map((b) => b.emoji).join(''));

        await reply(
            `⚔️ *MENANG!* ${monster.emoji} ${shownName} (Lv ${monster.lv})${monster.elite ? ' ✨ELITE' : ''}\n` +
            `_${res.turns} giliran${chosen ? ` • ${rpg.CLASSES[p.class].emoji} ${chosen.name}` : ''}${mult.length ? ` • ${mult.join(' ')}` : ''}_\n\n` +
            `❤️ HP ${res.playerHp}/${d.maxHp} • 💙 MP ${res.playerMp}/${d.maxMp}\n` +
            `⬆️ +${fmt(rw.exp)} EXP • 🪙 +${fmt(rw.gold)} gold${dropTxt}` +
            `${rw.combo > 1 ? `\n🔥 *COMBO ${rw.combo}x* — bonus ${Math.round((rw.combo - 1) * 8)}%` : ''}` +
            `${worldEvent.mul && Object.keys(worldEvent.mul).length ? `\n${worldEvent.emoji} ${worldEvent.name}` : ''}` +
            `${rw.bountyHit ? `\n🎯 *BOUNTY HIT!* Klaim: *${prefix}bounty*` : ''}` +
            `${streakInfo.isNew ? `\n📅 Streak hari ke-${streakInfo.days}! +${fmt(streakInfo.bonus.gold)} gold bonus${streakInfo.milestone ? ` • ${streakInfo.milestone.emoji} ${streakInfo.milestone.name}` : ''}` : ''}` +
            `${rw.levelUp ? `\n\n🎉 *NAIK ${rw.levels} LEVEL!* +${rw.levels * rpg.STAT_POINTS_PER_LEVEL} poin` : ''}` +
            `${rw.petLevelUp ? `\n🐾 Pet naik ${rw.petLevels} level!` : ''}` +
            `${rw.achievements.length ? `\n🏅 ${rw.achievements.map((a) => `${a.emoji} ${a.name}`).join(', ')}` : ''}` +
            `${rw.combo > 1 && rw.combo < 10 ? `\n_Combo berlanjut kalau berburu lagi dalam ${Math.round(rpg.COMBO_WINDOW / 1000)}s_` : ''}`
        );
    }
};
