const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Bestiary',
    command: ['monsters', 'bestiary', 'monster'],
    category: 'rpg',
    description: 'Daftar monster, boss, dan region beserta stat dasar',
    usage: '.monsters • .monsters boss • .monsters <region>',
    limit: 0,
    async execute(sock, m, { args, user, reply, prefix }) {
        const arg = (args[0] || '').toLowerCase();
        const lv = user.rpg?.rpgLevel || 1;

        /* ── filter per region ── */
        if (rpg.REGIONS[arg]) {
            const r = rpg.REGIONS[arg];
            const rows = r.pool.map((id) => {
                const mo = rpg.MONSTERS[id];
                const el = rpg.ELEMENTS[mo.element];
                return `${mo.emoji} *${mo.name}* Lv ${mo.lv} • ${el.emoji}\n   HP ${fmt(mo.hp)} • ATK ${fmt(mo.atk)} • ${fmt(mo.exp)} EXP`;
            }).join('\n');
            return await reply(`${r.emoji} *${r.name}* — Lv ${r.minLv}+\n_${r.desc}_\n\n${rows}`);
        }

        const bossOnly = /^(boss|raja)$/i.test(arg);
        const raidOnly = /^(raid|worldboss|wb)$/i.test(arg);
        let ids;
        if (raidOnly) ids = rpg.RAID_POOL;
        else if (bossOnly) ids = rpg.BOSS_POOL;
        else ids = [...rpg.HUNT_POOL, ...rpg.BOSS_POOL];

        const rows = ids.map((id) => {
            const mo = rpg.MONSTERS[id];
            const el = rpg.ELEMENTS[mo.element];
            const mark = mo.lv > lv + 8 ? ' 🔒' : '';
            const kind = mo.raid ? ' 🌍' : mo.boss ? ' 👑' : '';
            return `${mo.emoji} *${mo.name}* Lv ${mo.lv}${kind}${mark}\n   ${el.emoji} ${el.name} • HP ${fmt(mo.hp)} • ATK ${fmt(mo.atk)} • ${fmt(mo.exp)} EXP • 🪙${fmt(mo.gold)}`;
        });

        const title = raidOnly ? ' — WORLD BOSS' : bossOnly ? ' — BOSS' : '';
        await reply(
            `📖 *BESTIARY${title}*\n\n${rows.join('\n\n')}\n\n` +
            `🔒 jauh di atas levelmu • 👑 boss • 🌍 world boss\n` +
            `Elemen: Api→Angin→Tanah→Cahaya→Kegelapan→Api\n\n` +
            `Per region: *${prefix}monsters meadow*\nSerang boss: *${prefix}boss* • Raid: *${prefix}raid*`
        );
    }
};
