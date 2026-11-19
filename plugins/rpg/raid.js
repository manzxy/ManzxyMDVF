const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');
const { runtime } = require('../../lib/core/utils');

const COOLDOWN = 120000;
const PARTY_SIZE = 4;

/**
 * Raid = world boss dengan HP besar. Bisa dinilai bersama party:
 * setiap anggota party menyumbang damage, hadiah dibagi sesuai kontribusi.
 */
module.exports = {
    name: 'Raid',
    command: ['raid', 'tournament', 'turnamen'],
    category: 'rpg',
    description: 'Raid world boss bersama party, atau turnamen PvP mingguan',
    usage: '.raid • .tournament',
    limit: 0,
    async execute(sock, m, { command, args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const data = db.data;

        /* ═══════════ TURNAMEN ═══════════ */
        if (command === 'tournament' || command === 'turnamen') {
            const fighters = Object.values(data.users)
                .filter((u) => u.rpg && u.number !== user.number)
                .sort((a, b) => (b.rpg.rpgLevel * 1e6 + b.rpg.rpgExp) - (a.rpg.rpgLevel * 1e6 + a.rpg.rpgExp))
                .slice(0, 3);

            if (!fighters.length) return await reply(`⚔️ *TURNAMEN*\n\nBelum ada petualang lain untuk dilawan.\nAjak teman bergabung: *${prefix}rpg daftar*`);

            const season = rpg.currentSeason();
            const myPower = power(p);
            const lines = [];
            let wins = 0;

            for (const foe of fighters) {
                const fp = foe.rpg;
                const foePower = power(fp);
                const win = myPower > foePower || (myPower === foePower && rpg.chance(0.5));
                if (win) wins++;
                lines.push(`${win ? '✅' : '❌'} vs ${rpg.CLASSES[fp.class].emoji} *${(foe.regName || foe.name || foe.number).slice(0, 14)}* (Lv ${fp.rpgLevel}) — ${win ? 'menang' : 'kalah'}`);
            }

            const rewardGold = wins * 800 + (wins === fighters.length ? 3000 : 0);
            const rewardExp = wins * 400 + (wins === fighters.length ? 1500 : 0);
            p.gold += Math.floor(rewardGold * (season.bonus?.goldMul || 1));
            rpg.addExp(p, Math.floor(rewardExp * (season.bonus?.expMul || 1)));
            if (wins > (p.tournament.best ?? -1)) p.tournament.best = wins;
            p.tournament.wins += wins;
            const ach = rpg.checkAchievements(p);
            db.markDirty();

            const medal = wins === fighters.length ? '🥇 JUARA!' : wins >= 2 ? '🥈' : wins >= 1 ? '🥉' : '📉';
            return await reply(
                `⚔️ *TURNAMEN* ${medal}\n\n${lines.join('\n')}\n\n` +
                `Menang ${wins}/${fighters.length}\n` +
                `🪙 +${fmt(rewardGold)} gold • ⬆️ +${fmt(rewardExp)} EXP\n` +
                `📊 Rekor terbaik: ${p.tournament.best}/${fighters.length}\n\n` +
                (ach.length ? `🏅 ${ach.map((a) => `${a.emoji} ${a.name}`).join(', ')}\n\n` : '') +
                `_Turnamen membandingkan total kekuatan (level+stat+equipment)._`
            );
        }

        /* ═══════════ RAID ═══════════ */
        if (Date.now() - (p.cooldowns.raid || 0) < COOLDOWN) {
            const left = Math.ceil(((p.cooldowns.raid || 0) + COOLDOWN - Date.now()) / 1000);
            return await reply(`⏳ Raid berikutnya dalam *${runtime(left)}*.`);
        }

        const cur = rpg.current(p);
        const d = rpg.derived(p);
        if (cur.hp < d.maxHp * 0.5) {
            return await reply(`❤️ HP ${cur.hp}/${d.maxHp}. Raid butuh minimal 50% HP.\nPulihkan: *${prefix}heal*`);
        }

        const season = rpg.currentSeason();
        const bossId = rpg.MONSTERS[season.boss]?.raid ? season.boss : rpg.RAID_POOL[0];
        const boss = rpg.spawnMonster(bossId, p.rpgLevel, 'abyss');

        // party ikut menyumbang damage
        const party = data.parties?.[p.partyId];
        const allies = (party?.members || []).filter((n) => n !== user.number).slice(0, PARTY_SIZE - 1);
        let allyDamage = 0;
        for (const n of allies) {
            const u = data.users[n];
            if (!u?.rpg) continue;
            allyDamage += Math.floor(rpg.derived(u.rpg).atk * rpg.randFloat(1.2, 2.0));
        }

        p.cooldowns.raid = Date.now();
        const res = rpg.battle(p, boss, { useSkill: true });
        rpg.applyCurrent(p, res.playerHp, res.playerMp);
        // Damage dihitung dari monster yang dipakai battle (bukan boss mentah),
        // karena `battle` mengembalikan salinan dengan hp tersisa.
        const myDamage = Math.max(0, boss.hp - res.monster.hp);
        rpg.live.addWeekly(p, 'raids', 1);

        if (res.win) {
            const rw = rpg.battleReward(p, res.monster, {
                partySize: 1 + allies.length,
                guildLevel: data.guilds?.[p.guildId]?.level || 1,
                guild: data.guilds?.[p.guildId] || null,
                season,
                userNumber: user.number
            });
            rpg.live.addDailyProgress(p, user.number, 'raid', 1);
            rpg.live.addWeekly(p, 'bosses', 1);
            p.stats.raids = (p.stats.raids || 0) + 1;
            const ach = rpg.checkAchievements(p);
            db.markDirty();
            return await reply(
                `🏆 *RAID BERHASIL!*\n${boss.emoji} *${boss.name}* (Lv ${boss.lv}) tumbang!\n\n` +
                `${allies.length ? `👥 Bantuan party: ${allies.length} orang (${fmt(allyDamage)} damage)\n` : ''}` +
                `⚔️ Damage kamu: ${fmt(myDamage)} / ${fmt(boss.maxHp)}\n` +
                `❤️ HP tersisa ${res.playerHp}/${d.maxHp}\n\n` +
                `🪙 +${fmt(rw.gold)} gold • ⬆️ +${fmt(rw.exp)} EXP\n` +
                `${rw.drops.length ? `🎁 ${rw.drops.map((id) => rpg.ITEMS[id].name).join(', ')}` : ''}` +
                `${rw.levelUp ? `\n\n🌟 Naik ${rw.levels} level!` : ''}` +
                `${ach.length ? `\n🏅 ${ach.map((a) => `${a.emoji} ${a.name}`).join(', ')}` : ''}`
            );
        }

        // Kalah: tetap beri EXP hiburan kecil supaya tidak sia-sia.
        p.stats.deaths++;
        const consolation = Math.floor(boss.exp * 0.05);
        const cl = rpg.addExp(p, consolation);
        db.markDirty();
        return await reply(
            `💀 *RAID GAGAL*\n${boss.emoji} *${boss.name}* masih berdiri.\n\n` +
            `⚔️ Damage kamu: ${fmt(myDamage)} / ${fmt(boss.maxHp)} (${((myDamage / boss.maxHp) * 100).toFixed(1)}%)\n` +
            `${allies.length ? `👥 Party: +${fmt(allyDamage)} damage\n` : ''}` +
            `🔥 Sisa HP boss: ${fmt(res.monster.hp)}\n` +
            `⬆️ EXP hiburan: +${fmt(consolation)}${cl.levelUp ? ` • 🌟 naik ${cl.levels} level!` : ''}\n\n` +
            `_Kumpulkan party lebih besar dan coba lagi._`
        );
    }
};

/** Skor kekuatan gabungan untuk turnamen. */
function power(p) {
    const d = rpg.derived(p);
    return Math.floor(d.atk * 2 + d.matk + d.def * 1.5 + d.maxHp * 0.4 + d.maxMp * 0.3 + d.critRate * 500 + p.rpgLevel * 10);
}
