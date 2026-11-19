const rpg = require('../../lib/data/rpg');
const { runtime } = require('../../lib/core/utils');

const pct = (m) => (m && m !== 1 ? `×${m}` : null);

module.exports = {
    name: 'WorldEvent',
    command: ['event', 'worldevent', 'kejadian'],
    category: 'rpg',
    description: 'World event global yang berotasi tiap 4 jam: bonus reward untuk semua pemain',
    usage: '.event • .event list',
    limit: 0,
    async execute(sock, m, { args, user, reply, prefix }) {
        const sub = (args[0] || '').toLowerCase();

        /* ── daftar semua event ── */
        if (sub === 'list' || sub === 'daftar') {
            const rows = rpg.WORLD_EVENTS.map((e) => {
                const m = e.mul || {};
                const eff = [
                    pct(m.gold) && `Gold ${pct(m.gold)}`,
                    pct(m.exp) && `EXP ${pct(m.exp)}`,
                    pct(m.drop) && `Drop ${pct(m.drop)}`,
                    pct(m.monsterAtk) && `Monster ATK ${pct(m.monsterAtk)}`,
                    pct(m.bossRate) && `Boss ${pct(m.bossRate)}`
                ].filter(Boolean).join(' • ') || 'tidak ada bonus';
                return `${e.emoji} *${e.name}*\n   _${e.desc}_\n   ${eff}`;
            }).join('\n\n');
            return await reply(`🌍 *SEMUA WORLD EVENT*\n\n${rows}\n\nRotasi tiap 4 jam. Aktif sekarang: *${prefix}event*`);
        }

        /* ── event aktif ── */
        const cur = rpg.currentEvent();
        const nxt = rpg.nextEvent();
        const mul = cur.mul || {};
        const eff = [
            pct(mul.gold) && `🪙 Gold ${pct(mul.gold)}`,
            pct(mul.exp) && `⬆️ EXP ${pct(mul.exp)}`,
            pct(mul.drop) && `🎁 Drop ${pct(mul.drop)}`,
            pct(mul.monsterAtk) && `💀 Monster ATK ${pct(mul.monsterAtk)}`,
            pct(mul.bossRate) && `👑 Boss rate ${pct(mul.bossRate)}`
        ].filter(Boolean).join('\n');

        const combo = user.rpg ? rpg.comboMultiplier(user.rpg) : 1;
        const comboLeft = user.rpg ? rpg.comboRemaining(user.rpg) : 0;

        await reply(
            `🌍 *WORLD EVENT AKTIF*\n\n` +
            `${cur.emoji} *${cur.name}*\n` +
            `_${cur.desc}_\n\n` +
            `${eff || '_Tidak ada bonus khusus._'}\n\n` +
            `⏳ Sisa: *${runtime(Math.floor(cur.remaining / 1000))}*\n` +
            `➡️ Berikutnya: ${nxt.emoji} ${nxt.name}\n\n` +
            (combo > 1
                ? `🔥 Combo kamu: *${user.rpg.combo.count}x* (+${Math.round((combo - 1) * 100)}% reward) — ${runtime(Math.ceil(comboLeft / 1000))}\n\n`
                : '') +
            `Event berlaku untuk *semua pemain* dan mengalikan reward.\n` +
            `Daftar: *${prefix}event list*`
        );
    }
};
