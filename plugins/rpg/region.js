const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Regions',
    command: ['region', 'wilayah', 'map', 'peta'],
    category: 'rpg',
    description: 'Daftar wilayah, monster, dan syarat level',
    usage: '.region • .region <wilayah>',
    limit: 0,
    async execute(sock, m, { args, user, reply, prefix }) {
        const lv = user.rpg?.rpgLevel || 1;
        const open = rpg.unlockedRegions(lv);
        const target = (args[0] || '').toLowerCase();

        /* ── detail satu wilayah ── */
        if (target && rpg.REGIONS[target]) {
            const r = rpg.REGIONS[target];
            const unlocked = open.includes(target);
            const mobs = r.pool.map((id) => {
                const mo = rpg.MONSTERS[id];
                const el = rpg.ELEMENTS[mo.element];
                return `${mo.emoji} *${mo.name}* Lv ${mo.lv} • ${el.emoji} ${el.name}\n   HP ${fmt(mo.hp)} • ATK ${fmt(mo.atk)} • EXP ${fmt(mo.exp)}`;
            }).join('\n');
            return await reply(
                `${r.emoji} *${r.name}*${unlocked ? '' : ' 🔒'}\n` +
                `_${r.desc}_\n\n` +
                `📊 Syarat: Lv ${r.minLv}${unlocked ? ' ✅' : ` ❌ (kamu ${lv})`}\n` +
                `✨ Bonus: EXP ×${r.bonus.exp} • Gold ×${r.bonus.gold}\n\n` +
                `*MONSTER:*\n${mobs}\n\n` +
                `Berburu di sini: *${prefix}hunt ${target}* (monster tetap acak)\n` +
                `_Untuk monster spesifik: *${prefix}hunt <nama monster>*_`
            );
        }

        /* ── daftar wilayah ── */
        const rows = Object.entries(rpg.REGIONS)
            .sort((a, b) => a[1].order - b[1].order)
            .map(([id, r]) => {
                const ok = open.includes(id);
                return `${ok ? '🟢' : '🔒'} ${r.emoji} *${r.name}* (${id})\n   Lv ${r.minLv}+ • EXP ×${r.bonus.exp} • ${r.pool.length} monster`;
            }).join('\n');

        await reply(
            `${user.rpg ? `${rpg.CLASSES[user.rpg.class].emoji} Lv ${lv}` : 'Petualang'} — *PETA AETHERIA*\n\n${rows}\n\n` +
            `Detail: *${prefix}region <nama>*\n` +
            `_Wilayah tertinggi yang terbuka otomatis dipakai saat .hunt._`
        );
    }
};
