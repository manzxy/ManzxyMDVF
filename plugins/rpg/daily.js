const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');
const { runtime } = require('../../lib/core/utils');

const bar = (have, need) => {
    const n = need > 0 ? Math.round((Math.min(have, need) / need) * 10) : 0;
    return `${'▰'.repeat(n)}${'▱'.repeat(10 - n)}`;
};

/** Sisa waktu sampai tengah malam lokal. */
const untilReset = () => {
    const now = new Date();
    const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return mid - now;
};

module.exports = {
    name: 'DailyQuest',
    command: ['dailyrpg', 'quest_harian', 'misiharian', 'dq'],
    category: 'rpg',
    description: 'Quest harian RPG: 4 target acak per hari + streak login + misi mingguan',
    usage: '.dailyrpg • .dailyrpg klaim <nomor> • .dailyrpg mingguan',
    limit: 0,
    async execute(sock, m, { args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const sub = (args[0] || '').toLowerCase();

        /* ── klaim ── */
        if (sub === 'klaim' || sub === 'claim' || sub === 'ambil') {
            const list = rpg.dailyStatus(p, user.number);
            const idx = (args[1] || '').toLowerCase();
            let target;

            if (idx === 'all' || idx === 'semua') {
                // klaim semua yang selesai
                const done = list.filter((q) => q.done && !q.claimed);
                if (!done.length) return await reply(`❌ Tidak ada quest yang siap diklaim.\nLihat: *${prefix}dailyrpg*`);
                let gold = 0, dust = 0, exp = 0;
                const names = [];
                for (const q of done) {
                    const r = rpg.claimDaily(p, user.number, q.id);
                    if (r.ok) { gold += q.gold; dust += q.dust || 0; exp += q.exp; names.push(q.name); }
                }
                db.markDirty();
                const all = rpg.dailyStatus(p, user.number).every((q) => q.claimed);
                return await reply(
                    `✅ *KLAIM ${names.length} QUEST*\n${names.map((n) => `• ${n}`).join('\n')}\n\n` +
                    `🪙 +${fmt(gold)} gold • 🔮 +${fmt(dust)} dust • ⬆️ +${fmt(exp)} EXP` +
                    (all ? `\n\n🏆 *SEMUA QUEST HARIAN SELESAI!*\nBonus: 🪙 +5.000 gold • 🔮 +100 dust` : '')
                );
            }

            const n = Number(idx);
            if (!Number.isInteger(n) || n < 1 || n > list.length) {
                return await reply(`Pilih nomor 1-${list.length}, atau \`all\`.\nContoh: *${prefix}dailyrpg klaim 1*`);
            }
            target = list[n - 1];
            const r = rpg.claimDaily(p, user.number, target.id);
            if (r.error) return await reply(`❌ ${r.error}`);
            db.markDirty();
            return await reply(
                `✅ *QUEST SELESAI — ${r.def.name}*\n\n` +
                `🪙 +${fmt(r.def.gold)} gold\n🔮 +${fmt(r.def.dust || 0)} dust\n⬆️ +${fmt(r.def.exp)} EXP` +
                (r.def.item ? `\n🎁 ${rpg.ITEMS[r.def.item].emoji} ${rpg.ITEMS[r.def.item].name}` : '') +
                (r.levelUp ? `\n\n🌟 *NAIK ${r.levels} LEVEL!*` : '') +
                (r.allDone && r.bonus ? `\n\n🏆 *SEMUA QUEST HARIAN SELESAI!*\nBonus: 🪙 +${fmt(r.bonus.gold)} gold • 🔮 +${fmt(r.bonus.dust)} dust` : '') +
                (r.allDone ? '' : `\n\nSisa: *${prefix}dailyrpg*`)
            );
        }

        /* ── misi mingguan ── */
        if (sub === 'mingguan' || sub === 'weekly' || sub === 'week') {
            /* klaim reward mingguan */
            if ((args[1] || '').toLowerCase() === 'klaim' || (args[1] || '').toLowerCase() === 'claim') {
                const c = rpg.claimWeekly(p);
                if (c.error) return await reply(`❌ ${c.error}\nLihat progres: *${prefix}dailyrpg mingguan*`);
                db.markDirty();
                return await reply(
                    `✅ *REWARD MINGGUAN DIKLAIM*\n\n` +
                    `${c.claimed.map((w) => `• ${w.name}`).join('\n')}\n\n` +
                    `🪙 +${fmt(c.gold)} gold • 🔮 +${fmt(c.dust)} dust`
                );
            }
            const wk = rpg.weeklyProgress(p);
            p.weekly = p.weekly || {};
            const claimedIds = Array.isArray(p.weekly.claimed) ? p.weekly.claimed : [];
            const rows = wk.map((w) => {
                const pct = Math.min(100, Math.round((w.have / w.need) * 100));
                const mark = claimedIds.includes(w.id) ? '🎁' : w.done ? '🎁' : '⬜';
                return `${mark} *${w.name}*\n   ${fmt(Math.min(w.have, w.need))}/${fmt(w.need)} (${pct}%) ${bar(w.have, w.need)}\n   🪙${fmt(w.gold)} • 🔮${fmt(w.dust)}`;
            }).join('\n');
            const claimable = wk.filter((w) => w.done && !claimedIds.includes(w.id)).length;
            const daysLeft = (() => { const n = new Date(); return ((8 - n.getDay()) % 7) || 7; })();
            return await reply(
                `📆 *MISI MINGGUAN*\n_Reset dalam ${daysLeft} hari_\n\n${rows}\n\n` +
                (claimable
                    ? `🎁 *${claimable} misi siap diklaim!* ➜ *${prefix}dailyrpg mingguan klaim*\n\n`
                    : '') +
                `Harian: *${prefix}dailyrpg* • Bounty: *${prefix}bounty*`
            );
        }

        /* ── daftar harian (default) ── */
        const streak = rpg.touchStreak(p);
        if (streak.isNew) db.markDirty();
        const list = rpg.dailyStatus(p, user.number);
        const event = rpg.currentEvent();
        const doneCount = list.filter((q) => q.claimed).length;

        const rows = list.map((q, i) => {
            const mark = q.claimed ? '✅' : q.done ? '🎁' : '⬜';
            return (
                `${mark} *${i + 1}. ${q.name}*\n` +
                `   ${q.desc} — ${Math.min(q.prog, q.need)}/${q.need}\n` +
                `   🪙${fmt(q.gold)} • 🔮${fmt(q.dust || 0)} • ⬆️${fmt(q.exp)}` +
                (q.claimed ? '' : q.done ? `\n   ➜ *${prefix}dailyrpg klaim ${i + 1}*` : '')
            );
        }).join('\n');

        await reply(
            `📋 *QUEST HARIAN* — ${doneCount}/${list.length} selesai\n` +
            `${bar(doneCount, list.length)}\n` +
            `⏳ Reset dalam ${runtime(Math.floor(untilReset() / 1000))}\n\n` +
            `${rows}\n\n` +
            `🔥 Streak: *${streak.days > 0 ? p.streak.days : p.daily?.streak || 0} hari*` +
            `${streak.isNew ? ` (+${fmt(streak.bonus.gold)} gold hari ini)` : ''}\n` +
            `${event.emoji} Event: *${event.name}* — ${event.desc}\n\n` +
            `Klaim: *${prefix}dailyrpg klaim 1* atau *${prefix}dailyrpg klaim all*\n` +
            `Mingguan: *${prefix}dailyrpg mingguan*`
        );
    }
};
