const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Bounty',
    command: ['bounty', 'buronan', 'target'],
    category: 'rpg',
    description: 'Bounty harian: kalahkan monster buronan untuk hadiah besar',
    usage: '.bounty • .bounty klaim',
    limit: 0,
    async execute(sock, m, { args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const b = rpg.dailyBounty();
        const sub = (args[0] || '').toLowerCase();
        const rec = rpg.checkBounty(p, new Date(), user.number);

        /* ── klaim ── */
        if (sub === 'klaim' || sub === 'claim' || sub === 'ambil') {
            const r = rpg.claimBounty(p);
            if (r.error) {
                return await reply(
                    `❌ ${r.error}\n\n` +
                    (r.bounty
                        ? `Target: ${r.bounty.monster.emoji} *${r.bounty.monster.name}*\nSerang: *${prefix}boss ${r.bounty.monster.name}*`
                        : `Cek status: *${prefix}bounty*`)
                );
            }
            db.markDirty();
            const itemObj = rpg.ITEMS[b.item];
            return await reply(
                `🎯 *BOUNTY SELESAI!*\n${b.monster.emoji} ${b.monster.name}\n\n` +
                `🪙 +${fmt(b.gold)} gold\n🔮 +${fmt(b.dust)} dust` +
                (itemObj ? `\n🎁 ${itemObj.emoji} ${itemObj.name}` : '') +
                `\n\n🪙 Total gold: ${fmt(p.gold)}\nBounty baru besok. Lihat juga: *${prefix}dailyrpg*`
            );
        }

        /* ── info ── */
        const status = rec.claimed ? '✅ Sudah diklaim' : rec.hit ? '🎁 Siap diklaim!' : '⬜ Belum dikalahkan';
        const itemObj = rpg.ITEMS[b.item];

        await reply(
            `🎯 *BOUNTY HARIAN*\n_${b.key}_\n\n` +
            `Target: ${b.monster.emoji} *${b.monster.name}* (Lv ${b.monster.lv})\n` +
            `_${b.monster.lore || ''}_\n\n` +
            `*HADIAH*\n🪙 ${fmt(b.gold)} gold\n🔮 ${fmt(b.dust)} dust` +
            (itemObj ? `\n🎁 ${itemObj.emoji} ${itemObj.name}` : '') +
            `\n\n*STATUS:* ${status}\n` +
            (rec.claimed ? '' : `\nSerang: *${prefix}boss ${b.monster.name}*` +
                (rec.hit ? `\nKlaim: *${prefix}bounty klaim*` : '')) +
            `\n\n_Bounty berganti tiap hari dan sama untuk semua pemain._`
        );
    }
};
