const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Shop',
    command: ['shop', 'toko', 'buy', 'beli', 'sell', 'jual'],
    category: 'rpg',
    description: 'Beli dan jual item dengan gold RPG',
    usage: '.shop • .buy <item> [jml] • .sell <item> [jml]',
    limit: 0,
    async execute(sock, m, { command, args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);

        /* ── beli ── */
        if (command === 'buy' || command === 'beli') {
            const { item: id, qty } = rpg.parseItemArgs(args);
            if (!id) return await reply(`Item tidak dikenal. Lihat toko: *${prefix}shop*`);
            if (!rpg.SHOP_IDS.includes(id)) return await reply(`❌ *${rpg.ITEMS[id].name}* tidak dijual di toko.\n_Craft sendiri: *${prefix}craft* atau dapatkan dari boss._`);
            const total = rpg.ITEMS[id].price * qty;
            if (p.gold < total) return await reply(`🪙 Gold kamu ${fmt(p.gold)}, butuh ${fmt(total)}.`);
            p.gold -= total;
            rpg.addItem(p, id, qty);
            db.markDirty();
            const it = rpg.ITEMS[id];
            return await reply(`✅ Membeli ${it.emoji} *${it.name}* ×${qty}\n🪙 -${fmt(total)} gold (sisa ${fmt(p.gold)})`);
        }

        /* ── jual ── */
        if (command === 'sell' || command === 'jual') {
            const { item: id, qty: wantQty } = rpg.parseItemArgs(args);
            if (!id) return await reply(`Item tidak dikenal.`);
            if (!(p.inventory[id] > 0)) return await reply(`❌ *${rpg.ITEMS[id].name}* tidak ada di tas.`);
            const have = p.inventory[id];
            const qty = Math.min(have, Math.max(1, wantQty));
            // Item yang sedang dipakai tidak boleh terjual habis (dulu membuat slot menunjuk item hilang).
            const equippedSlot = Object.keys(p.equipment).find((s) => p.equipment[s] === id);
            if (equippedSlot && qty >= have) {
                return await reply(
                    `❌ *${rpg.ITEMS[id].name}* sedang dipakai di slot *${equippedSlot}*.\n` +
                    `Lepas dulu: *${prefix}unequip ${equippedSlot}*`
                );
            }
            const gain = rpg.sellValue(id) * qty;
            rpg.removeItem(p, id, qty);
            p.gold += gain;
            p.stats.goldEarned += gain;
            db.markDirty();
            return await reply(`✅ Menjual *${rpg.ITEMS[id].name}* ×${qty}\n🪙 +${fmt(gain)} gold (sisa ${fmt(p.gold)})\n_Tip: .dismantle untuk dapat debu enchant._`);
        }

        /* ── tampilkan toko ── */
        const filter = (args[0] || '').toLowerCase();
        const typeMap = { weapon: 'weapon', senjata: 'weapon', armor: 'armor', baju: 'armor', acc: 'accessory', accessory: 'accessory', aksesoris: 'accessory', potion: 'consumable', consumable: 'consumable', ramuan: 'consumable' };
        const type = typeMap[filter] || null;

        const ids = rpg.SHOP_IDS.filter((id) => !type || rpg.ITEMS[id].type === type);
        if (!ids.length) return await reply(`Kategori kosong. Pilih: weapon, armor, accessory, potion`);

        const groups = {};
        for (const id of ids) {
            const it = rpg.ITEMS[id];
            const rar = rpg.RARITY[it.rarity] || rpg.RARITY.common;
            const bonus = it.stats ? ` (${Object.entries(it.stats).map(([k, v]) => `+${v}${k.toUpperCase()}`).join(' ')})` : '';
            (groups[it.type] ||= []).push(`${rar.emoji} ${it.emoji} ${it.name}${bonus} — 🪙${fmt(it.price)}`);
        }

        const labels = { weapon: '⚔️ SENJATA', armor: '🛡 ARMOR', accessory: '💍 AKSESORIS', consumable: '🧪 KONSUMABEL' };
        const body = Object.entries(groups)
            .map(([t, rows]) => `*${labels[t] || t.toUpperCase()}*\n${rows.join('\n')}`)
            .join('\n\n');

        await reply(
            `🏪 *TOKO RPG*\nGold: 🪙 ${fmt(p.gold)}\n\n${body}\n\n` +
            `Beli: *${prefix}buy <item> [jml]*\nJual: *${prefix}sell <item> [jml]*\n\n` +
            `_Item tier tinggi hanya bisa di-craft:_ *${prefix}craft*`
        );
    }
};
