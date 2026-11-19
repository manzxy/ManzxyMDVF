const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Inventory',
    command: ['inv', 'inventory', 'tas', 'use', 'equip', 'unequip'],
    category: 'rpg',
    description: 'Lihat tas, pakai item, dan pasang perlengkapan',
    usage: '.inv • .use <item> • .equip <item> • .unequip <slot>',
    limit: 0,
    async execute(sock, m, { command, args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);

        if (command === 'use') {
            const { item: id } = rpg.parseItemArgs(args, { allowQty: false });
            if (!id) return await reply(`Item tidak dikenal.\nLihat tas: *${prefix}inv*`);
            const r = rpg.useItem(p, id);
            if (r.error) return await reply(`❌ ${r.error}`);
            db.markDirty();
            const d = rpg.derived(p);
            const now = rpg.current(p);
            return await reply(
                `✅ Memakai *${r.item.name}*\n❤️ HP ${now.hp}/${d.maxHp} • 💙 MP ${now.mp}/${d.maxMp}` +
                `${r.item.exp ? `\n⬆️ +${r.item.exp} EXP` : ''}` +
                `${r.buff ? `\n✨ Buff ${r.buff.buff.emoji} ${r.buff.buff.name} aktif` : ''}` +
                `${r.levelUp ? `\n🎉 Naik ${r.levels} level!` : ''}`
            );
        }

        if (command === 'equip') {
            const { item: id } = rpg.parseItemArgs(args, { allowQty: false });
            if (!id) return await reply(`Item tidak dikenal.\nLihat tas: *${prefix}inv*`);
            const r = rpg.equip(p, id);
            if (r.error) return await reply(`❌ ${r.error}`);
            db.markDirty();
            const set = rpg.activeSet(p);
            const d = rpg.derived(p);
            return await reply(
                `✅ *${r.item.name}* dipasang di slot *${r.slot}*\n` +
                (r.previous ? `_${r.previous.name} kembali ke tas._\n` : '') +
                `\nATK ${d.atk} • DEF ${d.def} • HP ${d.maxHp}` +
                `${set ? `\n\n🔥 *${set.set.name}* ${set.full ? 'LENGKAP' : `(${set.count}/3)`}\n_${set.set.desc}_` : ''}`
            );
        }

        if (command === 'unequip') {
            const slot = (args[0] || '').toLowerCase();
            if (!['weapon', 'armor', 'accessory'].includes(slot)) return await reply(`Slot: weapon, armor, accessory`);
            const r = rpg.unequip(p, slot);
            if (r.error) return await reply(`❌ ${r.error}`);
            db.markDirty();
            return await reply(`✅ Slot *${slot}* dikosongkan.`);
        }

        /* ── tampilkan inventory ── */
        const ids = Object.keys(p.inventory).filter((id) => p.inventory[id] > 0);
        if (!ids.length) return await reply(`🎒 Tas kosong.\nBeli: *${prefix}shop* • Berburu untuk drop: *${prefix}hunt*`);

        const group = { weapon: [], armor: [], accessory: [], consumable: [], material: [], other: [] };
        for (const id of ids) {
            const it = rpg.ITEMS[id] || { name: id, emoji: '❔', type: 'other', rarity: 'common' };
            const rar = rpg.RARITY[it.rarity] || rpg.RARITY.common;
            const eq = Object.values(p.equipment).includes(id) ? ' *(dipakai)*' : '';
            (group[it.type] || group.other).push(`${rar.emoji} ${it.emoji} ${it.name} ×${p.inventory[id]}${eq}`);
        }

        const section = (name, list) => (list.length ? `*${name}*\n${list.join('\n')}\n` : '');
        const slots = p.enchant?.slots || {};
        const equipped = ['weapon', 'armor', 'accessory']
            .map((s) => {
                const id = p.equipment[s];
                if (!id) return `${s}: —`;
                return `${s}: ${rpg.ITEMS[id].emoji} ${rpg.ITEMS[id].name}${slots[s] ? ` +${slots[s]}` : ''}`;
            }).join('\n');

        const totalItems = ids.reduce((a, id) => a + p.inventory[id], 0);
        await reply(
            `🎒 *TAS* (${ids.length} jenis • ${totalItems} item)\n\n` +
            section('⚔️ SENJATA', group.weapon) +
            section('🛡 ARMOR', group.armor) +
            section('💍 AKSESORIS', group.accessory) +
            section('🧪 KONSUMABEL', group.consumable) +
            section('⛏ MATERIAL', group.material) +
            `\n*DIPASANG:*\n${equipped}\n\n` +
            `Pakai: *${prefix}use <item>*\nPasang: *${prefix}equip <item>*\nJual: *${prefix}sell <item>*\nBongkar: *${prefix}dismantle <item>*`
        );
    }
};
