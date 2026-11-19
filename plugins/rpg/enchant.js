const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Enchant',
    command: ['enchant', 'ec', 'dismantle', 'bongkar'],
    category: 'rpg',
    description: 'Dismantle item jadi debu, lalu enchant perlengkapan (+stat)',
    usage: '.dismantle <item> • .enchant <slot>',
    limit: 0,
    async execute(sock, m, { command, args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);

        /* ── dismantle ── */
        if (command === 'dismantle' || command === 'bongkar') {
            const { item: id } = rpg.parseItemArgs(args, { allowQty: false });
            if (!id) return await reply(`Item tidak dikenal. Lihat tas: *${prefix}inv*`);
            const equippedSlot = Object.keys(p.equipment).find((s) => p.equipment[s] === id);
            if (equippedSlot && p.inventory[id] <= 1) {
                return await reply(
                    `❌ *${rpg.ITEMS[id].name}* sedang dipakai di slot *${equippedSlot}*.\n` +
                    `Lepas dulu: *${prefix}unequip ${equippedSlot}*`
                );
            }
            const r = rpg.dismantle(p, id);
            if (r.error) return await reply(`❌ ${r.error}`);
            db.markDirty();
            return await reply(`♻️ *${r.item.name}* dibongkar → 🔮 +${r.dust} debu\nTotal debu: ${p.enchant.dust}`);
        }

        /* ── enchant slot ── */
        const slot = (args[0] || '').toLowerCase();
        if (!slot) {
            const slots = p.enchant.slots || {};
            const rows = ['weapon', 'armor', 'accessory'].map((s) => {
                const id = p.equipment[s];
                const lv = slots[s] || 0;
                const next = lv >= 10 ? 'MAX' : `${rpg.enchantCost(lv)} debu`;
                return `${s}: ${id ? rpg.ITEMS[id].name : '—'} • +${lv} \n   _berikutnya: ${next}_`;
            }).join('\n');
            return await reply(
                `🔮 *ENCHANT* — ${p.enchant.dust || 0} debu\n\n${rows}\n\n` +
                `Enchant: *${prefix}enchant weapon*\nDapat debu: *${prefix}dismantle <item>*\n` +
                `_Setiap +1 memberi +2 stat utama item. Maks +10._`
            );
        }

        const r = rpg.enchant(p, slot);
        if (r.error) return await reply(`❌ ${r.error}`);
        db.markDirty();
        if (r.failed) {
            return await reply(
                `💨 *ENCHANT GAGAL*\n${r.item.emoji} ${r.item.name} tetap +${r.level}\n` +
                `🔮 -${r.cost} debu (peluang ${Math.round(r.chance * 100)}%)\nSisa debu: ${p.enchant.dust}`
            );
        }
        const it = rpg.ITEMS[p.equipment[slot]];
        const mainStat = Object.keys(it.stats)[0];
        return await reply(
            `✨ *ENCHANT BERHASIL!*\n${it.emoji} ${it.name} → *+${r.level}*\n` +
            `📈 +${r.level * 2} ${mainStat.toUpperCase()}\n` +
            `🔮 -${r.cost} debu (sisa ${p.enchant.dust})\n\n` +
            `${r.level < 10 ? `Lanjut: *${prefix}enchant ${slot}*` : '🔝 Sudah maksimal (+10)'}`
        );
    }
};
