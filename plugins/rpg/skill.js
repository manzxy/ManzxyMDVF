const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');
const { runtime } = require('../../lib/core/utils');

const CD_MS = 45000;

/**
 * Skill pohon umum: terbuka untuk semua kelas lewat level.
 * `heal` = fraksi max HP, `power` = pengali ATK, `drain` = fraksi damage jadi HP.
 */
const EXTRA_SKILLS = [
    { id: 'second_wind', name: 'Second Wind', lv: 10, cost: 15, heal: 0.30, desc: 'Pulihkan 30% HP maksimum.' },
    { id: 'power_strike', name: 'Power Strike', lv: 20, cost: 18, power: 3.0, desc: 'Serangan ×3 damage.' },
    { id: 'guard_break', name: 'Guard Break', lv: 30, cost: 22, power: 2.6, pierce: 0.5, desc: 'Abaikan 50% DEF musuh.' },
    { id: 'ultimate', name: 'Ultimate', lv: 40, cost: 40, power: 5.0, desc: 'Serangan pamungkas ×5 damage.' }
];

const isUnlocked = (p, s) => p.rpgLevel >= s.lv;

module.exports = {
    name: 'Skill',
    command: ['skill', 'skills'],
    category: 'rpg',
    description: 'Daftar skill kelas + skill pohon yang terbuka sesuai level',
    usage: '.skill • .skill list • .skill use <nama>',
    limit: 0,
    async execute(sock, m, { args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const cls = rpg.CLASSES[p.class];
        const sk = cls.skill;
        const now = Date.now();
        const d = rpg.derived(p);
        const cur = rpg.current(p);
        const buffs = rpg.activeBuffs(p);
        const sub = (args[0] || '').toLowerCase();

        /* ── daftar singkat ── */
        if (sub === 'list' || sub === 'daftar') {
            const extra = EXTRA_SKILLS.map((s) => {
                const ok = isUnlocked(p, s);
                return `${ok ? '✅' : '🔒'} *${s.name}* \`${s.id}\` Lv${s.lv} — ${s.desc}`;
            }).join('\n');
            return await reply(
                `📘 *SKILL LIST*\n\n` +
                `*KELAS* — ${cls.emoji} *${sk.name}* \`${sk.id}\`\n_${sk.desc}_\n\n` +
                `*UMUM* (${EXTRA_SKILLS.filter((s) => isUnlocked(p, s)).length}/${EXTRA_SKILLS.length})\n${extra}\n\n` +
                `Pakai saat berburu: *${prefix}hunt --skill*\nInfo detail: *${prefix}skill*`
            );
        }

        /* ── pakai skill di luar pertarungan (heal saja) ── */
        if (sub === 'use' || sub === 'pakai') {
            const name = args.slice(1).join(' ').toLowerCase();
            const all = [sk, ...EXTRA_SKILLS];
            const found = all.find((s) => s.id === name || s.name.toLowerCase() === name);
            if (!found) return await reply(`❌ Skill *"${name}"* tidak ada.\nLihat: *${prefix}skill list*`);
            if (found.id !== 'second_wind' && !found.heal) {
                return await reply(`⚔️ *${found.name}* hanya bisa dipakai saat bertarung.\nGunakan: *${prefix}hunt --skill*`);
            }
            if (!isUnlocked(p, found) && found.lv) return await reply(`🔒 Butuh level ${found.lv}.`);
            const cd = (p.cooldowns[found.id] || 0) + CD_MS - now;
            if (cd > 0) return await reply(`⏳ Cooldown: *${runtime(Math.ceil(cd / 1000))}*`);
            if (cur.mp < found.cost) return await reply(`💙 MP kurang (${cur.mp}/${found.cost}).`);

            const heal = Math.floor(d.maxHp * (found.heal || 0));
            const newHp = Math.min(d.maxHp, cur.hp + heal);
            rpg.applyCurrent(p, newHp, cur.mp - found.cost);
            p.cooldowns[found.id] = now;
            db.markDirty();
            return await reply(`✨ *${found.name}!*\n❤️ +${fmt(newHp - cur.hp)} HP → ${newHp}/${d.maxHp}\n💙 -${found.cost} MP`);
        }

        /* ── detail lengkap ── */
        const cdLeft = Math.max(0, (p.cooldowns[sk.id] || 0) + CD_MS - now);
        const extra = EXTRA_SKILLS.map((s) => {
            const ok = isUnlocked(p, s);
            const c = ok ? Math.max(0, (p.cooldowns[s.id] || 0) + CD_MS - now) : 0;
            return `${ok ? '✅' : '🔒'} *${s.name}* (Lv ${s.lv})\n   _${s.desc}_ • 💙${s.cost}${c > 0 ? ` • ⏳${runtime(Math.ceil(c / 1000))}` : ''}`;
        }).join('\n');

        const buffTxt = buffs.active.length
            ? buffs.active.map((b) => `${b.emoji} ${b.name} (${runtime(Math.ceil((b.until - now) / 1000))})`).join('\n')
            : '_tidak ada_';

        const eff = [];
        if (sk.power) eff.push(`Power ×${sk.power}`);
        if (sk.heal) eff.push(`Heal ${Math.round(sk.heal * 100)}%`);
        if (sk.drain) eff.push(`Drain ${Math.round(sk.drain * 100)}%`);
        if (sk.defMul) eff.push(`DEF ×${sk.defMul}`);
        if (sk.lowHpBonus) eff.push('Bonus saat HP rendah');

        await reply(
            `📘 *SKILL — ${p.job.toUpperCase()}*\n` +
            `_${cls.role}_\n\n` +
            `${cls.emoji} *${sk.name}* — Lv ${p.skills[sk.id] || 1}\n` +
            `_${sk.desc}_\n` +
            `💙${sk.cost} • ${eff.join(' • ') || '—'}\n` +
            `${cdLeft > 0 ? `⏳ Cooldown ${runtime(Math.ceil(cdLeft / 1000))}` : '✅ Siap'}\n\n` +
            `💙 MP ${cur.mp}/${d.maxMp} • ❤️ HP ${cur.hp}/${d.maxHp}\n\n` +
            `*SKILL UMUM* (${EXTRA_SKILLS.filter((s) => isUnlocked(p, s)).length}/${EXTRA_SKILLS.length})\n${extra}\n\n` +
            `*BUFF AKTIF*\n${buffTxt}\n\n` +
            `Pakai saat berburu: *${prefix}hunt --skill*\n` +
            `Heal di luar perang: *${prefix}skill use second_wind*\n` +
            `Buff potion: *${prefix}use atk_potion*`
        );
    },

    /** Dipakai hunt.js: pilih skill terkuat yang siap dipakai. */
    pickCombatSkill(p) {
        const cls = rpg.CLASSES[p.class];
        const now = Date.now();
        const cur = rpg.current(p);
        const cands = [cls.skill, ...EXTRA_SKILLS].filter((s) => isUnlocked(p, s));
        const ready = cands.filter((s) => (p.cooldowns[s.id] || 0) + CD_MS <= now && cur.mp >= s.cost);
        if (!ready.length) return null;
        return ready.sort((a, b) => (b.power || 0) - (a.power || 0))[0];
    },
    CD_MS,
    EXTRA_SKILLS
};
