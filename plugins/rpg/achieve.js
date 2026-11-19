const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Achievement',
    command: ['achieve', 'ach', 'title', 'prestige'],
    category: 'rpg',
    description: 'Pencapaian, title, dan prestige untuk bonus permanen',
    usage: '.achieve • .title <nama> • .prestige',
    limit: 0,
    async execute(sock, m, { command, args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);

        /* ── prestise ── */
        if (command === 'prestige') {
            if (!rpg.canPrestige(p)) {
                return await reply(
                    `🌟 *PRESTIGE*\n\nSyarat: level ${rpg.PRESTIGE_MIN_LEVEL} (kamu ${p.rpgLevel}).\n\n` +
                    `_Prestige mereset level & stat ke awal, tapi memberi +5 LUK permanen per tingkat._\n` +
                    `Prestige sekarang: ${p.prestige || 0}`
                );
            }
            if ((args[0] || '').toLowerCase() !== 'ya') {
                return await reply(
                    `⚠️ *KONFIRMASI PRESTIGE*\n\nLevel ${p.rpgLevel} → 1, stat direset, gold dipotong 50%.\n` +
                    `Bonus: +5 LUK permanen (total jadi ${(p.prestige || 0) + 1}×).\n\n` +
                    `Ketik *${prefix}prestige ya* untuk melanjutkan.`
                );
            }
            const r = rpg.prestige(p);
            if (r.error) return await reply(`❌ ${r.error}`);
            db.markDirty();
            return await reply(
                `🌟 *PRESTIGE ${r.prestige}!*\n\nKamu kembali ke level 1 — tapi dengan kekuatan yang lebih dalam.\n` +
                `✨ Bonus permanen: +${r.bonus} LUK\n\n_Petualangan baru dimulai._`
            );
        }

        /* ── pilih title ── */
        if (command === 'title') {
            const want = (args.join(' ') || '').toLowerCase();
            if (!want || want === 'list') {
                const rows = (p.titles || []).length
                    ? p.titles.map((t) => `${p.title.toLowerCase() === t.toLowerCase() ? '▶️' : '•'} ${t}`).join('\n')
                    : '_Belum ada title. Selesaikan achievement untuk mendapatkannya._';
                return await reply(`📛 *TITLE KAMU*\n\n${rows}\n\nPakai: *${prefix}title <nama title>*`);
            }
            const found = (p.titles || []).find((t) => t.toLowerCase().includes(want));
            if (!found) return await reply(`❌ Title tidak ditemukan.\nLihat: *${prefix}title*`);
            p.title = found;
            db.markDirty();
            return await reply(`✅ Title dipasang: *${found}*`);
        }

        /* ── daftar achievement ── */
        const unlocked = new Set(p.achievements || []);
        const rows = Object.entries(rpg.ACHIEVEMENTS).map(([id, a]) => {
            const done = unlocked.has(id);
            const bonus = a.bonus ? ` (${Object.entries(a.bonus).map(([k, v]) => `+${v} ${k.toUpperCase()}`).join(' ')})` : '';
            return `${done ? '✅' : '⬜'} ${a.emoji} *${a.name}*${bonus}\n   _${a.desc}_`;
        }).join('\n');

        const bonusTotal = rpg.achievementBonus(p);
        const bonusTxt = Object.keys(bonusTotal).length
            ? Object.entries(bonusTotal).map(([k, v]) => `+${v} ${k.toUpperCase()}`).join(' • ')
            : 'belum ada';

        await reply(
            `🏅 *ACHIEVEMENT* (${unlocked.size}/${Object.keys(rpg.ACHIEVEMENTS).length})\n\n${rows}\n\n` +
            `📛 Title: *${p.title || '—'}*\n` +
            `✨ Bonus total: ${bonusTxt}\n` +
            `🌟 Prestige: ${p.prestige || 0}\n\n` +
            `Title: *${prefix}title* • Prestige: *${prefix}prestige*`
        );
    }
};
