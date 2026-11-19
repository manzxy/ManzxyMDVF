const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

/**
 * Codex: tracks every monster the player has killed (p.codex).
 * Shows completion per region and family, plus drop hints.
 */
module.exports = {
    name: 'Codex',
    command: ['codex', 'bestiary2', 'koleksi_monster'],
    category: 'rpg',
    description: 'Codex monster: progres koleksi, keluarga, dan drop',
    usage: '.codex • .codex <region>',
    limit: 0,
    async execute(sock, m, { args, user, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const codex = p.codex || {};
        const region = (args[0] || '').toLowerCase();

        /* ── single region detail ── */
        if (rpg.REGIONS[region]) {
            const r = rpg.REGIONS[region];
            const rows = r.pool.map((id) => {
                const mo = rpg.MONSTERS[id];
                const n = codex[id] || 0;
                const drops = (mo.drops || []).map(([d]) => rpg.ITEMS[d]?.emoji || '').join('');
                return `${n ? '✅' : '⬜'} ${mo.emoji} *${mo.name}* ×${n} ${drops}`;
            }).join('\n');
            const seen = r.pool.filter((id) => codex[id]).length;
            return await reply(
                `${r.emoji} *${r.name}* — ${seen}/${r.pool.length} ditemukan\n_${r.desc}_\n\n${rows}\n\n` +
                `_Emoji di kanan = kemungkinan drop._`
            );
        }

        /* ── overall codex ── */
        const all = Object.keys(rpg.MONSTERS);
        const seen = all.filter((id) => codex[id]);
        const totalKills = Object.values(codex).reduce((a, b) => a + b, 0);

        const byRegion = Object.entries(rpg.REGIONS)
            .sort((a, b) => a[1].order - b[1].order)
            .map(([id, r]) => {
                const pool = [...r.pool, ...rpg.BOSS_POOL.filter((b) => rpg.MONSTERS[b].region === id)];
                const got = pool.filter((m) => codex[m]).length;
                const pct = pool.length ? Math.round((got / pool.length) * 100) : 0;
                return `${r.emoji} ${r.name}: ${got}/${pool.length} (${pct}%)`;
            }).join('\n');

        const families = {};
        for (const id of seen) {
            const f = rpg.MONSTERS[id].family || 'unknown';
            families[f] = (families[f] || 0) + 1;
        }
        const famTxt = Object.entries(families).sort((a, b) => b[1] - a[1])
            .map(([f, n]) => `${f}: ${n}`).join(' • ') || '—';

        const pct = Math.round((seen.length / all.length) * 100);

        await reply(
            `📖 *MONSTER CODEX* — ${seen.length}/${all.length} (${pct}%)\n` +
            `⚔️ Total kills: ${fmt(totalKills)}\n\n` +
            `*PER REGION*\n${byRegion}\n\n` +
            `*FAMILIES*\n${famTxt}\n\n` +
            `Detail: *${prefix}codex meadow*\n_Daftar monster: ${prefix}monsters_`
        );
    }
};
