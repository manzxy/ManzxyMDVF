const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');
const { runtime } = require('../../lib/core/utils');

module.exports = {
    name: 'Season',
    command: ['season', 'musim', 'seasonal'],
    category: 'rpg',
    description: 'Season bulanan: tema, bonus, boss, reward berjenjang',
    usage: '.season • .season claim [tier] • .season list',
    limit: 0,
    async execute(sock, m, { args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const season = rpg.currentSeason();
        const sub = (args[0] || '').toLowerCase();

        /* ── season calendar ── */
        if (sub === 'list' || sub === 'daftar') {
            const rows = rpg.SEASONS.map((s) => {
                const b = s.bonus || {};
                const m = [b.expMul && `EXP×${b.expMul}`, b.goldMul && `Gold×${b.goldMul}`, b.dropMul && `Drop×${b.dropMul}`].filter(Boolean).join(' ');
                return `${s.month === season.month ? '▶️' : `  `} ${s.emoji} *${String(s.month).padStart(2, '0')}* ${s.name} — ${m}`;
            });
            return await reply(`📅 *SEASON CALENDAR*\n\n${rows.join('\n')}\n\nNow: *${prefix}season*`);
        }

        /* ── claim tiered rewards ── */
        if (sub === 'claim' || sub === 'klaim') {
            const data = db.data;
            data.seasons = data.seasons || {};
            const rec = data.seasons[season.key] || (data.seasons[season.key] = { claimedBy: [], tiers: {} });
            if (!rec.tiers) rec.tiers = {};

            const kills = p.killed[season.boss] || 0;
            if (kills < 1) {
                const boss = rpg.MONSTERS[season.boss];
                return await reply(
                    `❌ *Belum bisa klaim.*\n\nKalahkan boss season ini dulu:\n${boss.emoji} *${boss.name}* (Lv ${boss.lv})\n\n` +
                    `Progres: ${kills}/1\nSerang: *${prefix}boss ${boss.name}*`
                );
            }

            const claimed = rec.tiers[user.number] || 0;
            const tiers = season.tiers || [];
            if (claimed >= tiers.length) {
                return await reply(`✅ Semua tier reward ${season.emoji} *${season.name}* sudah kamu klaim.\nTunggu season berikutnya.`);
            }
            const t = tiers[claimed];
            p.gold += t.gold;
            p.enchant.dust = (p.enchant.dust || 0) + (t.dust || 0);
            rec.tiers[user.number] = claimed + 1;
            if (!rec.claimedBy.includes(user.number)) rec.claimedBy.push(user.number);
            db.markDirty();

            const nextTier = tiers[claimed + 1];
            return await reply(
                `🎉 *SEASON REWARD — TIER ${claimed + 1}/${tiers.length}*\n${season.emoji} ${season.name}\n\n` +
                `🪙 +${fmt(t.gold)} gold\n🔮 +${fmt(t.dust || 0)} dust\n\n` +
                (nextTier
                    ? `Next tier: 🪙${fmt(nextTier.gold)} • 🔮${fmt(nextTier.dust)}\nKlaim lagi: *${prefix}season claim*`
                    : `🏆 Semua tier diklaim!\nFinal reward: ${season.reward.item ? rpg.ITEMS[season.reward.item].name : '-'} _(via .season claim saat chapter selesai)_`)
            );
        }

        /* ── season info ── */
        const left = rpg.seasonRemaining();
        const b = season.bonus || {};
        const boss = rpg.MONSTERS[season.boss];
        const kills = p.killed[season.boss] || 0;
        const rec = (db.data.seasons || {})[season.key];
        const claimedTiers = (rec?.tiers || {})[user.number] || 0;

        const bonusTxt = [
            b.expMul ? `EXP ×${b.expMul}` : '',
            b.goldMul ? `Gold ×${b.goldMul}` : '',
            b.dropMul ? `Drop ×${b.dropMul}` : ''
        ].filter(Boolean).join(' • ') || 'tidak ada';

        const tierRows = (season.tiers || []).map((t, i) =>
            `${i < claimedTiers ? '✅' : '⬜'} Tier ${i + 1}: 🪙${fmt(t.gold)} • 🔮${fmt(t.dust)}`
        ).join('\n');

        await reply(
            `${season.emoji} *SEASON: ${season.name}*\n` +
            `_"${season.tagline}"_\n\n` +
            `📜 ${season.lore}\n\n` +
            `├ ⏳ Sisa: *${runtime(Math.floor(left / 1000))}*\n` +
            `├ ✨ Bonus: ${bonusTxt}\n` +
            `├ 👹 Boss: ${boss.emoji} ${boss.name} (Lv ${boss.lv})\n` +
            `├ 📊 Kill: ${kills}\n` +
            `└ 🏆 Final: ${fmt(season.reward.gold)}g • ${fmt(season.reward.exp)} EXP • ${rpg.ITEMS[season.reward.item]?.name}\n\n` +
            `*TIER REWARD*\n${tierRows}\n\n` +
            `Serang boss: *${prefix}boss ${boss.name}*\nKlaim: *${prefix}season claim*\nKalender: *${prefix}season list*`
        );
    }
};
