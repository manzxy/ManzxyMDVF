const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');
const { runtime } = require('../../lib/core/utils');

const PRICE_PER_HP = 2;
const PRICE_PER_MP = 3;
/** Istirahat gratis: pulih sebagian, dengan cooldown. */
const REST_HEAL = 0.35;
const REST_COOLDOWN = 5 * 60000;

module.exports = {
    name: 'Heal',
    command: ['heal', 'pulih', 'istirahat', 'rest'],
    category: 'rpg',
    description: 'Pulihkan HP & MP di kota dengan gold, atau istirahat gratis',
    usage: '.heal • .heal mp • .rest',
    limit: 0,
    async execute(sock, m, { command, args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const d = rpg.derived(p);
        const now = rpg.current(p);

        /* ── istirahat gratis (mencegah softlock saat gold habis) ── */
        const wantsRest = command === 'rest' || /^(gratis|free|rest)$/i.test(args[0] || '');
        if (wantsRest) {
            const left = (p.cooldowns.rest || 0) + REST_COOLDOWN - Date.now();
            if (left > 0) {
                return await reply(`😴 Kamu masih kelelahan. Istirahat lagi dalam *${runtime(Math.ceil(left / 1000))}*.`);
            }
            if (now.hp >= d.maxHp && now.mp >= d.maxMp) return await reply('❤️ HP dan MP kamu sudah penuh.');
            const hp = Math.min(d.maxHp, now.hp + Math.ceil(d.maxHp * REST_HEAL));
            const mp = Math.min(d.maxMp, now.mp + Math.ceil(d.maxMp * REST_HEAL));
            rpg.applyCurrent(p, hp, mp);
            p.cooldowns.rest = Date.now();
            db.markDirty();
            return await reply(
                `😴 *ISTIRAHAT GRATIS*\n` +
                `❤️ HP ${now.hp} → ${hp}/${d.maxHp}\n` +
                `💙 MP ${now.mp} → ${mp}/${d.maxMp}\n\n` +
                `_Pulih ${Math.round(REST_HEAL * 100)}% dari maksimum. Tersedia lagi dalam 5 menit._`
            );
        }

        const onlyMp = /^(mp|mana)$/i.test(args[0] || '');
        const hpGap = onlyMp ? 0 : d.maxHp - now.hp;
        const mpGap = d.maxMp - now.mp;
        if (hpGap === 0 && mpGap === 0) return await reply('❤️ HP dan MP kamu sudah penuh.');

        const cost = Math.ceil(hpGap * PRICE_PER_HP + mpGap * PRICE_PER_MP);
        if (p.gold < cost) {
            return await reply(
                `Biaya penyembuhan: 🪙 *${fmt(cost)} gold*\nGold kamu: ${fmt(p.gold)} (kurang ${fmt(cost - p.gold)})\n\n` +
                `*Alternatif gratis:*\n` +
                `• Istirahat: *${prefix}rest* (pulih ${Math.round(REST_HEAL * 100)}%, tanpa gold)\n` +
                `• Pakai potion: *${prefix}use potion_s*\n` +
                `• Jual item: *${prefix}sell <item>*`
            );
        }

        p.gold -= cost;
        rpg.applyCurrent(p, onlyMp ? now.hp : d.maxHp, d.maxMp);
        db.markDirty();
        await reply(
            `✨ *PEMULIHAN SELESAI*\n` +
            `❤️ HP ${now.hp} → ${onlyMp ? now.hp : d.maxHp}\n` +
            `💙 MP ${now.mp} → ${d.maxMp}\n\n` +
            `🪙 Biaya ${fmt(cost)} gold (sisa ${fmt(p.gold)})\n` +
            `_Hemat: ${prefix}rest memberi pemulihan gratis tiap 5 menit._`
        );
    },
    REST_COOLDOWN
};
