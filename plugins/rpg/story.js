const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

const pbar = (have, need) => {
    const n = need > 0 ? Math.round((Math.min(have, need) / need) * 10) : 0;
    return `${'▰'.repeat(n)}${'▱'.repeat(10 - n)}`;
};

module.exports = {
    name: 'Story',
    command: ['story', 'cerita', 'campaign', 'bab'],
    category: 'rpg',
    description: 'Kampanye cerita RPG 20 chapter: lore, dialog, objektif, dan season',
    usage: '.story • .story list • .story klaim • .story recap',
    limit: 0,
    async execute(sock, m, { args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const sub = (args[0] || '').toLowerCase();

        /* ── chapter list ── */
        if (sub === 'list' || sub === 'daftar') {
            const cur = p.quest.chapter || 0;
            const rows = rpg.CHAPTERS.map((c, i) => {
                const done = i < cur;
                const active = i === cur;
                const lock = i > cur;
                const mark = done ? '✅' : active ? '▶️' : '🔒';
                return `${mark} *${i + 1}. ${c.title}*${lock ? ` _(Lv ${c.req.level})_` : ''}`;
            });
            const half = Math.ceil(rows.length / 2);
            return await reply(
                `📖 *CAMPAIGN — ${rpg.CHAPTERS.length} CHAPTERS*\n\n` +
                `${rows.slice(0, half).join('\n')}\n${rows.slice(half).join('\n')}\n\n` +
                `Active: *${prefix}story*\nSeason: *${prefix}season*`
            );
        }

        /* ── recap: all dialogue so far ── */
        if (sub === 'recap' || sub === 'rangkuman') {
            const done = p.quest.chapter || 0;
            const parts = rpg.CHAPTERS.slice(0, Math.max(1, done)).map((c) =>
                `*${c.id + 1}. ${c.title}*\n${c.lore}`
            );
            return await reply(`📜 *STORY RECAP* (${done}/${rpg.CHAPTERS.length})\n\n${parts.join('\n\n')}`);
        }

        /* ── claim ── */
        if (sub === 'klaim' || sub === 'claim' || sub === 'selesai') {
            const r = rpg.completeChapter(p);
            if (r.error) {
                if (r.complete) {
                    return await reply(`🏆 *KAMPANYE SUDAH TAMAT!*\n\nSemua ${rpg.CHAPTERS.length} chapter selesai.\nTetap berburu, raid, dan kejar season: *${prefix}season*`);
                }
                const pr = rpg.chapterProgress(p);
                if (!pr) return await reply(`❌ ${r.error}`);
                const line = pr.parts
                    ? pr.parts.map((x) => `• ${rpg.MONSTERS[x.target].emoji} ${rpg.MONSTERS[x.target].name}: ${x.have}/${x.need}`).join('\n')
                    : `• ${rpg.MONSTERS[pr.target]?.name || ''}: ${pr.have}/${pr.need}`;
                return await reply(`❌ ${r.error}\n\n*Progres:*\n${line}`);
            }
            db.markDirty();
            const it = rpg.ITEMS[r.chapter.reward.item];
            const next = r.next;
            const dialogue = r.chapter.dialogue?.length
                ? `\n\n${r.chapter.dialogue.map((d) => `_${d.who}:_ ${d.text}`).join('\n')}`
                : '';

            let body =
                `🎬 *CHAPTER ${r.chapter.id + 1} COMPLETE — ${r.chapter.title}*${dialogue}\n\n` +
                `🪙 +${fmt(r.chapter.reward.gold)} gold\n⬆️ +${fmt(r.chapter.reward.exp)} EXP\n🎁 ${it ? `${it.emoji} ${it.name}` : '-'}` +
                `${r.levelUp ? `\n\n🌟 *NAIK ${r.levels} LEVEL!*` : ''}`;

            if (r.storyComplete) {
                body += `\n\n🏆 *CAMPAIGN COMPLETE!*\n\n${r.chapter.ending || ''}\n\n_Season masih berjalan:_ *${prefix}season*`;
            } else if (next) {
                body += `\n\n📖 *Next: ${next.title}* _(Lv ${next.req.level})_\n_"${next.lore}"_` +
                    (next.dialogue?.length ? `\n\n${next.dialogue.map((d) => `_${d.who}:_ ${d.text}`).join('\n')}` : '');
            }
            return await reply(body);
        }

        /* ── active chapter ── */
        const ch = rpg.activeChapter(p);
        const pr = rpg.chapterProgress(p);
        const season = rpg.currentSeason();

        if (!ch) {
            const done = p.quest.completed || [];
            return await reply(
                `🏆 *KAMPANYE TAMAT — ${done.length}/${rpg.CHAPTERS.length} CHAPTER*\n\n` +
                `_${rpg.CHAPTERS[rpg.CHAPTERS.length - 1].ending || 'Kamu menutup pintu di belakangmu.'}_\n\n` +
                `Yang masih tersedia:\n` +
                `• Berburu: *${prefix}hunt* • Boss: *${prefix}boss*\n` +
                `• Dungeon: *${prefix}dungeon* • Raid: *${prefix}raid*\n` +
                `• Season: *${prefix}season* • Codex: *${prefix}codex*\n\n` +
                `Rangkuman: *${prefix}story recap*`
            );
        }

        let progTxt = '';
        if (pr?.parts) {
            progTxt = pr.parts.map((x) => {
                const mo = rpg.MONSTERS[x.target];
                return `${mo.emoji} ${mo.name}: ${x.have}/${x.need} ${pbar(x.have, x.need)}`;
            }).join('\n');
        } else if (pr) {
            const mo = rpg.MONSTERS[ch.objective.target];
            progTxt = `${mo?.emoji || ''} ${mo?.name || ''}: ${pr.have}/${pr.need} ${pbar(pr.have, pr.need)}`;
        }

        const dialogue = ch.dialogue?.length
            ? `\n\n💬 ${ch.dialogue.map((d) => `_${d.who}:_ ${d.text}`).join('\n💬 ')}`
            : '';

        await reply(
            `📖 *CHAPTER ${(p.quest.chapter || 0) + 1}/${rpg.CHAPTERS.length}*\n` +
            `*${ch.title}*\n\n` +
            `_"${ch.lore}"_${dialogue}\n\n` +
            `🎯 *Task:* ${ch.task}\n\n${progTxt}\n\n` +
            `🏆 *Reward:* ${fmt(ch.reward.gold)} gold • ${fmt(ch.reward.exp)} EXP • ${rpg.ITEMS[ch.reward.item]?.name || '-'}\n\n` +
            (pr?.done ? `✅ Done! Claim: *${prefix}story klaim*` : `Hunt: *${prefix}hunt*`) +
            `\n\n${season.emoji} Season: ${season.name}`
        );
    }
};
