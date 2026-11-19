const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'RPG Rank',
    command: ['rpgtop', 'rank', 'peringkat'],
    category: 'rpg',
    description: 'Peringkat petualang: level, gold, kill, boss, power, streak, combo, atau chapter',
    usage: '.rank • .rank gold|kill|boss|power|streak|combo|chapter|achieve',
    limit: 0,
    async execute(sock, m, { args, user, db, reply }) {
        const mode = (args[0] || 'level').toLowerCase();
        const adv = Object.values(db.data.users).filter((u) => u.rpg);

        if (!adv.length) return await reply('Belum ada petualang terdaftar. Jadilah yang pertama: *.rpg daftar*');

        /** Skor kekuatan gabungan (sama dengan turnamen). */
        const powerOf = (rp) => {
            const d = rpg.derived(rp);
            return Math.floor(d.atk * 2 + d.matk + d.def * 1.5 + d.maxHp * 0.4 + d.maxMp * 0.3 + d.critRate * 500 + rp.rpgLevel * 10);
        };

        const scoreOf = {
            gold: (u) => u.rpg.gold || 0,
            kill: (u) => u.rpg.stats?.kills || 0,
            boss: (u) => u.rpg.stats?.bossKills || 0,
            power: (u) => powerOf(u.rpg),
            level: (u) => (u.rpg.rpgLevel || 1) * 1e6 + (u.rpg.rpgExp || 0),
            streak: (u) => u.rpg.streak?.days || 0,
            combo: (u) => u.rpg.combo?.best || 0,
            chapter: (u) => (u.rpg.quest?.chapter || 0) * 1e6 + (u.rpg.rpgLevel || 0),
            achieve: (u) => (u.rpg.achievements?.length || 0) * 1e6 + (u.rpg.rpgLevel || 0)
        };
        const label = {
            gold: 'GOLD', kill: 'KILL', boss: 'BOSS', power: 'POWER', level: 'LEVEL',
            streak: 'STREAK', combo: 'COMBO TERBAIK', chapter: 'CHAPTER',
            achieve: 'ACHIEVEMENT'
        };
        const score = scoreOf[mode] || scoreOf.level;

        adv.sort((a, b) => score(b) - score(a));
        const medal = ['🥇', '🥈', '🥉'];
        const rows = adv.slice(0, 10).map((u, i) => {
            const p = u.rpg;
            const name = (u.regName || u.name || u.number).slice(0, 14);
            const cls = rpg.CLASSES[p.class];
            const val = mode === 'gold' ? `🪙 ${fmt(p.gold)}`
                : mode === 'kill' ? `⚔️ ${p.stats?.kills || 0}`
                : mode === 'boss' ? `👑 ${p.stats?.bossKills || 0}`
                : mode === 'power' ? `💥 ${fmt(powerOf(p))}`
                : mode === 'streak' ? `🔥 ${p.streak?.days || 0} hari`
                : mode === 'combo' ? `⚡ ${p.combo?.best || 0}x`
                : mode === 'chapter' ? `📖 Bab ${(p.quest?.chapter || 0) + 1}`
                : mode === 'achieve' ? `🏅 ${p.achievements?.length || 0}/${Object.keys(rpg.ACHIEVEMENTS).length}`
                : `Lv ${p.rpgLevel}`;
            const title = p.title ? ` _${p.title}_` : '';
            return `${medal[i] || `${i + 1}.`} ${cls.emoji} ${name} — ${val}${title}`;
        });

        const mine = adv.findIndex((u) => u.number === user.number) + 1;
        const pMe = user.rpg;
        const myLine = pMe
            ? `\nPosisimu: #${mine || '-'} dari ${adv.length} • 💥 ${fmt(powerOf(pMe))} power`
            : '\n_Kamu belum terdaftar._';

        await reply(`🏆 *PERINGKAT (${label[mode] || 'LEVEL'})*\n\n${rows.join('\n')}${myLine}\n\n_Mode: level, gold, kill, boss, power, streak, combo, chapter, achieve_`);
    }
};
