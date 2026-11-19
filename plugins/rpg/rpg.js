const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');
const { runtime: fmtTime } = require('../../lib/core/utils');

const BAR_LEN = 10;
const bar = (cur, max) => {
    const n = max > 0 ? Math.round((cur / max) * BAR_LEN) : 0;
    return `${'▰'.repeat(Math.max(0, n))}${'▱'.repeat(Math.max(0, BAR_LEN - n))}`;
};

const getProfile = (user) => (user.rpg ? rpg.syncProfile(user.rpg) : null);

/** Two-column class list. */
function classList() {
    const rows = Object.entries(rpg.CLASSES).map(([id, c], i) =>
        `${c.emoji} *${c.name}* — ${c.title}\n   _${c.role}_ • ${c.desc}`
    );
    return rows.join('\n');
}

module.exports = {
    name: 'RPG',
    command: ['rpg', 'char', 'statusrpg'],
    category: 'rpg',
    description: 'Karakter RPG: pilih dari 8 kelas, status lengkap, alokasi stat',
    usage: '.rpg • .rpg daftar <kelas> • .rpg alloc <stat> <n>',
    limit: 0,
    async execute(sock, m, { command, args, user, db, reply, prefix }) {
        const sub = (args[0] || 'status').toLowerCase();

        /* ── register ── */
        if (sub === 'daftar' || sub === 'register' || sub === 'class' || sub === 'kelas') {
            if (getProfile(user)) return await reply(`Kamu sudah punya karakter *${user.rpg.job}* (Lv ${user.rpg.rpgLevel}).\nPakai *${prefix}rpg* untuk status.`);
            const query = args.slice(1).join(' ');
            if (!query) {
                return await reply(
                    `*PILIH KELAS* (${Object.keys(rpg.CLASSES).length} tersedia)\n\n${classList()}\n\n` +
                    `Cara: *${prefix}rpg daftar warrior*\n_Alias Indonesia juga bisa: ksatria, penyihir, pemanah, pendeta, pencuri_`
                );
            }
            const key = rpg.CLASS_ALIASES[rpg.norm(query)] || rpg.findKey(rpg.CLASSES, query, rpg.CLASS_ALIASES);
            if (!key) {
                return await reply(`❌ Kelas *"${query}"* tidak dikenal.\n\n${classList()}\n\nCoba: *${prefix}rpg daftar warrior*`);
            }
            user.rpg = rpg.syncProfile(rpg.createProfile(user, key));
            const d = rpg.derived(user.rpg);
            db.markDirty();
            const season = rpg.currentSeason();
            return await reply(
                `✅ *CHARACTER CREATED*\n\n${rpg.CLASSES[key].emoji} *${user.rpg.job}* — ${rpg.CLASSES[key].title}\n` +
                `_${rpg.CLASSES[key].role}_\n` +
                `Lv 1 • HP ${d.maxHp} • MP ${d.maxMp} • ATK ${d.atk} • DEF ${d.def}\nPoin stat: *${user.rpg.statPoints}*\n\n` +
                `${season.emoji} *Season:* ${season.name}\n_"${season.tagline}"_\n\n` +
                `Mulai: *${prefix}story*\nAlokasi: *${prefix}rpg alloc str 5*\nBerburu: *${prefix}hunt*`
            );
        }

        const p = getProfile(user);
        if (!p) return await reply(`Kamu belum punya karakter RPG.\nMulai: *${prefix}rpg daftar*\n\n${classList()}`);

        /* ── allocate ── */
        if (sub === 'alloc' || sub === 'alokasi' || sub === 'tambah') {
            const stat = (args[1] || '').toLowerCase();
            const n = Math.max(1, Math.floor(Number(args[2] || 1)));
            if (!rpg.BASE_STAT[stat]) return await reply(`Stat: *str, agi, vit, int, luk*\nContoh: *${prefix}rpg alloc str 5*`);
            if (!Number.isFinite(n) || n < 1) return await reply('Jumlah tidak valid.');
            if (p.statPoints < n) return await reply(`Poin stat kamu hanya ${p.statPoints}.`);
            for (let i = 0; i < n; i++) rpg.allocPoint(p, stat);
            db.markDirty();
            const d = rpg.derived(p);
            return await reply(
                `✅ +${n} *${stat.toUpperCase()}*\nPoin tersisa: ${p.statPoints}\n\n` +
                `HP ${d.maxHp} • MP ${d.maxMp} • ATK ${d.atk} • DEF ${d.def}\n` +
                `Crit ${(d.critRate * 100).toFixed(1)}% • Dodge ${(d.dodge * 100).toFixed(1)}% • Power ${fmt(d.power)}`
            );
        }

        /* ── full status ── */
        const d = rpg.derived(p);
        const now = rpg.current(p);
        const cls = rpg.CLASSES[p.class];
        const need = rpg.expToNext(p.rpgLevel);
        const season = rpg.currentSeason();
        const set = rpg.activeSet(p);
        const buffs = rpg.activeBuffs(p);
        const ch = rpg.chapterProgress(p);
        const slots = p.enchant?.slots || {};

        const eqLine = ['weapon', 'armor', 'accessory'].map((s) => {
            const id = p.equipment[s];
            if (!id) return `   ${s.padEnd(9)} —`;
            const it = rpg.ITEMS[id];
            return `   ${s.padEnd(9)} ${it.emoji} ${it.name}${slots[s] ? ` +${slots[s]}` : ''}`;
        }).join('\n');

        const buffLine = buffs.active.length
            ? buffs.active.map((b) => `${b.emoji}${b.name}(${fmtTime(Math.ceil((b.until - Date.now()) / 1000))})`).join(' ')
            : '—';

        const petLine = p.pet
            ? `   🐾 ${rpg.PET_DEFS[p.pet.kind].emoji} ${rpg.PET_DEFS[p.pet.kind].name} Lv ${p.pet.level}`
            : '   🐾 —';

        await reply(
            `╭─「 ${cls.emoji} *${p.job.toUpperCase()}* — ${cls.title} 」\n` +
            `│ ${p.title ? `_${p.title}_` : cls.role}${p.prestige ? ` • 🌟P${p.prestige}` : ''}\n` +
            `│ Lv *${p.rpgLevel}* • EXP ${fmt(p.rpgExp)}/${fmt(need)}\n` +
            `│ ${bar(p.rpgExp, need)}\n` +
            `├─ *VITAL*\n` +
            `│ ❤️ ${bar(now.hp, d.maxHp)} ${now.hp}/${d.maxHp}\n` +
            `│ 💙 ${bar(now.mp, d.maxMp)} ${now.mp}/${d.maxMp}\n` +
            `├─ *ATTRIBUTES* (poin: ${p.statPoints})\n` +
            `│ 💪${d.str} 🏃${d.agi} 🛡${d.vit} 🧠${d.int} 🍀${d.luk}\n` +
            `├─ *DERIVED*\n` +
            `│ ⚔️${d.atk} 🔮${d.matk} 🛡${d.def} • 💥 Power ${fmt(d.power)}\n` +
            `│ Crit ${(d.critRate * 100).toFixed(1)}% • Dodge ${(d.dodge * 100).toFixed(1)}%\n` +
            `├─ *EQUIPMENT*${set ? ` — ${set.set.name}${set.full ? ' ✓' : ` (${set.count}/3)`}` : ''}\n${eqLine}\n` +
            `├─ *POSSESSIONS*\n` +
            `│ 🪙 ${fmt(p.gold)} • 🔮 ${p.enchant?.dust || 0} dust\n` +
            `│ 🎒 ${Object.keys(p.inventory).length} item • 🔨 Craft Lv ${p.craft.level}\n${petLine}\n` +
            `│ ✨ ${buffLine}\n` +
            `├─ *PROGRESS*\n` +
            `│ ⚔️ ${p.stats.kills} kills • 👑 ${p.stats.bossKills} bosses • 🏰 ${p.stats.dungeons} dungeons\n` +
            `│ 🏅 ${p.achievements.length}/${Object.keys(rpg.ACHIEVEMENTS).length} achievements\n` +
            `│ 📖 Chapter ${(p.quest.chapter || 0) + 1}/${rpg.CHAPTERS.length}${ch && ch.need !== undefined ? ` — ${ch.have}/${ch.need}` : ''}\n` +
            `╰─ ${season.emoji} ${season.name}`
        );
    }
};
