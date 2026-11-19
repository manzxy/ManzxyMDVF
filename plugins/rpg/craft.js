const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Craft',
    command: ['craft', 'craf', 'buat_item'],
    category: 'rpg',
    description: 'Crafting: ubah material hasil buruan menjadi perlengkapan',
    usage: '.craft • .craft <item>',
    limit: 0,
    async execute(sock, m, { args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const target = (args[0] || '').toLowerCase();

        /* ── craft item ── */
        if (target) {
            const rec = rpg.RECIPES[target];
            if (!rec) {
                const match = Object.keys(rpg.RECIPES).find((id) =>
                    rpg.ITEMS[id]?.name.toLowerCase().includes(target));
                if (!match) return await reply(`❌ Resep tidak ditemukan. Lihat daftar: *${prefix}craft*`);
                return await doCraft(p, match, db, reply, prefix);
            }
            return await doCraft(p, target, db, reply, prefix);
        }

        /* ── daftar resep ── */
        const need = rpg.craftExpToNext(p.craft.level);
        const rows = Object.entries(rpg.RECIPES).map(([id, rec]) => {
            const it = rpg.ITEMS[rec.out];
            const lock = p.craft.level < rec.level ? `🔒 Lv${rec.level}` : '✅';
            const canDo = rpg.hasItems(p, rec.need);
            const mats = Object.entries(rec.need)
                .map(([mid, n]) => `${rpg.ITEMS[mid].emoji}${p.inventory[mid] || 0}/${n}`)
                .join(' ');
            return `${lock} ${it.emoji} *${it.name}*${canDo ? ' ✔' : ''}\n   ${mats}`;
        }).join('\n');

        const mats = Object.entries(p.inventory)
            .filter(([id]) => rpg.ITEMS[id]?.type === 'material')
            .map(([id, n]) => `${rpg.ITEMS[id].emoji} ${rpg.ITEMS[id].name} ×${n}`)
            .join('\n') || '_belum ada material — berburu monster dulu_';

        await reply(
            `🔨 *CRAFTING* — Lv ${p.craft.level}\n` +
            `EXP ${fmt(p.craft.exp)}/${fmt(need)}\n\n` +
            `*MATERIAL KAMU:*\n${mats}\n\n` +
            `*RESEP:*\n${rows}\n\n` +
            `Craft: *${prefix}craft <nama item>*\n_✔ = material cukup_`
        );
    }
};

async function doCraft(p, id, db, reply, prefix) {
    const r = rpg.craft(p, id);
    if (r.error) return await reply(`❌ ${r.error}`);
    db.markDirty();
    await reply(
        `🔨 *CRAFTING BERHASIL*\n\n${r.item.emoji} *${r.item.name}*\n_${r.item.desc}_\n\n` +
        `Masuk ke tas.\nPasang: *${prefix}equip ${id}*` +
        `${r.levelUp ? `\n\n🎉 Level crafting naik ke *${p.craft.level}*!` : ''}`
    );
}
