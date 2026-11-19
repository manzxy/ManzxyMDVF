const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Pet',
    command: ['pet', 'pel'],
    category: 'rpg',
    description: 'Pet pendamping: bonus stat, ikut bertarung, naik level bersamamu',
    usage: '.pet • .pet beli <nama> • .pet beri',
    limit: 0,
    async execute(sock, m, { args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const sub = (args[0] || 'info').toLowerCase();

        /* ── beli / adopsi ── */
        if (sub === 'beli' || sub === 'adopsi' || sub === 'buy') {
            const key = (args[1] || '').toLowerCase();
            if (!rpg.PET_DEFS[key]) {
                const rows = Object.entries(rpg.PET_DEFS).map(([id, d]) =>
                    `${d.emoji} *${id}* — ${d.name}\n   🪙 ${fmt(d.price)} • ${d.desc}`
                ).join('\n');
                return await reply(`🐾 *DAPATKAN PET*\n\n${rows}\n\nCara: *${prefix}pet beli wolf_pet*\nGold kamu: 🪙 ${fmt(p.gold)}`);
            }
            const r = rpg.adoptPet(p, key);
            if (r.error) return await reply(`❌ ${r.error}`);
            db.markDirty();
            return await reply(`✅ *PET BARU!*\n\n${r.pet.emoji} *${r.pet.name}* Lv 1\n${r.pet.desc}\n\n_Pet naik level bersama perburuanmu dan memberi bonus stat._`);
        }

        /* ── beri makan ── */
        if (sub === 'beri' || sub === 'feed') {
            const r = rpg.feedPet(p, 1);
            if (r.error) return await reply(`❌ ${r.error}`);
            db.markDirty();
            return await reply(`🍖 Pet diberi makan. Hunger: ${r.hunger}/100`);
        }

        /* ── lepas ── */
        if (sub === 'lepas' || sub === 'release') {
            const r = rpg.releasePet(p);
            if (r.error) return await reply(`❌ ${r.error}`);
            db.markDirty();
            return await reply(`👋 *${r.pet.name}* dilepaskan ke alam liar.`);
        }

        /* ── info ── */
        if (!p.pet) {
            const rows = Object.entries(rpg.PET_DEFS).map(([id, d]) =>
                `${d.emoji} *${d.name}* (\`${id}\`)\n   🪙 ${fmt(d.price)} • +${Object.entries(d.bonus).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(' ')} /level`
            ).join('\n\n');
            return await reply(`🐾 *PET*\n\nKamu belum punya pet.\n\n${rows}\n\nBeli: *${prefix}pet beli <nama>*\nGold: 🪙 ${fmt(p.gold)}`);
        }

        const def = rpg.PET_DEFS[p.pet.kind];
        const need = rpg.petExpToNext(p.pet.level);
        const bonus = Object.entries(def.bonus).map(([k, v]) => `+${v * p.pet.level} ${k.toUpperCase()}`).join(' • ');

        await reply(
            `🐾 *PET AKTIF*\n\n` +
            `${def.emoji} *${def.name}* — Lv ${p.pet.level}\n` +
            `_${def.desc}_\n\n` +
            `📈 EXP ${fmt(p.pet.exp)}/${fmt(need)}\n` +
            `🍖 Hunger: ${p.pet.hunger}/100\n` +
            `✨ Bonus: ${bonus}\n` +
            `⚔️ Kontribusi damage: +${Math.round(def.atkRatio * 100)}%\n\n` +
            `Beri makan: *${prefix}pet beri*\nLepas: *${prefix}pet lepas*`
        );
    }
};
