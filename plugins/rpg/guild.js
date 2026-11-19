const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Guild',
    command: ['guild', 'gilda'],
    category: 'rpg',
    description: 'Guild: kumpulkan anggota, naikkan level, dapat bonus EXP & stat',
    usage: '.guild • .guild buat <nama> • .guild join <nama> • .guild bank <gold>',
    limit: 0,
    async execute(sock, m, { args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const data = db.data;
        data.guilds = data.guilds || {};

        const sub = (args[0] || 'info').toLowerCase();
        const key = (args[1] || '').toUpperCase();
        const mine = p.guildId ? data.guilds[p.guildId] : null;

        /* ── buat ── */
        if (sub === 'buat' || sub === 'create') {
            if (mine) return await reply(`Kamu sudah di guild *${mine.name}*.`);
            if (!key) return await reply(`Format: *${prefix}guild buat <nama>*\nContoh: *${prefix}guild buat AETHER*`);
            if (data.guilds[key]) return await reply(`❌ Nama guild *${key}* sudah dipakai.`);
            const COST = 5000;
            if (p.gold < COST) return await reply(`Butuh 🪙 ${fmt(COST)} gold untuk mendirikan guild (punya ${fmt(p.gold)}).`);
            p.gold -= COST;
            data.guilds[key] = { ...rpg.createGuild(key, user.number), bank: 0 };
            p.guildId = key;
            db.markDirty();
            return await reply(
                `🏰 *GUILD DIDIRIKAN*\n\nNama: *${key}*\n👑 Pemimpin: kamu\n💰 Biaya: ${fmt(COST)} gold\n\n` +
                `Undang anggota: *${prefix}guild join ${key}*\n` +
                `_Bonus guild: +5% EXP & gold per level, +stat STR/VIT._`
            );
        }

        /* ── gabung ── */
        if (sub === 'join' || sub === 'gabung') {
            if (mine) return await reply(`Kamu sudah di guild *${mine.name}*.`);
            const g = data.guilds[key];
            if (!g) return await reply(`❌ Guild *${key}* tidak ada.`);
            if (g.members.length >= rpg.GUILD_MAX_MEMBERS) return await reply(`❌ Guild penuh (${rpg.GUILD_MAX_MEMBERS} anggota).`);
            g.members.push(user.number);
            p.guildId = key;
            db.markDirty();
            return await reply(`✅ Bergabung ke guild *${key}* (Lv ${g.level}, ${g.members.length} anggota).`);
        }

        /* ── keluar ── */
        if (sub === 'keluar' || sub === 'leave') {
            if (!mine) return await reply('Kamu tidak di guild mana pun.');
            if (mine.owner === user.number) return await reply(`❌ Pemimpin tidak bisa keluar. Bubarkan dulu: *${prefix}guild bubar*`);
            mine.members = mine.members.filter((n) => n !== user.number);
            p.guildId = null;
            db.markDirty();
            return await reply(`✅ Keluar dari guild *${mine.name}*.`);
        }

        /* ── bubar ── */
        if (sub === 'bubar' || sub === 'disband') {
            if (!mine) return await reply('Kamu tidak di guild.');
            if (mine.owner !== user.number) return await reply('Hanya pemimpin yang bisa membubarkan.');
            for (const n of mine.members) {
                const u = data.users[n];
                if (u?.rpg) u.rpg.guildId = null;
            }
            delete data.guilds[p.guildId];
            p.guildId = null;
            db.markDirty();
            return await reply(`🗑️ Guild *${mine.name}* dibubarkan.`);
        }

        /* ── setor bank ── */
        if (sub === 'bank' || sub === 'setor') {
            if (!mine) return await reply('Kamu tidak di guild.');
            const amt = Math.floor(Number(String(args[1] || '').replace(/[.,]/g, '')));
            if (!Number.isFinite(amt) || amt < 1) return await reply('Jumlah tidak valid.');
            if (p.gold < amt) return await reply(`Gold kamu hanya ${fmt(p.gold)}.`);
            p.gold -= amt;
            mine.bank = (mine.bank || 0) + amt;
            // setoran memberi EXP guild
            const g = rpg.guildGainExp(mine, Math.floor(amt / 50));
            db.markDirty();
            return await reply(
                `💰 Menyetor ${fmt(amt)} gold ke bank *${mine.name}*\n` +
                `Bank guild: ${fmt(mine.bank)}\nGuild Lv ${mine.level}${g.levelUp ? ` ⬆️ naik ${g.levels} level!` : ''}`
            );
        }

        /* ── info ── */
        if (!mine) {
            const list = Object.entries(data.guilds)
                .sort((a, b) => b[1].level - a[1].level)
                .slice(0, 10)
                .map(([k, g], i) => `${i + 1}. *${k}* — Lv ${g.level} • ${g.members.length}/${rpg.GUILD_MAX_MEMBERS} anggota`);
            return await reply(
                `🏰 *GUILD*\n\nKamu belum di guild.\n\n` +
                `Buat: *${prefix}guild buat <nama>* (5.000 gold)\nGabung: *${prefix}guild join <nama>*\n\n` +
                (list.length ? `*Daftar guild:*\n${list.join('\n')}` : '_Belum ada guild. Jadilah yang pertama._')
            );
        }

        const bonus = rpg.guildBonus(mine.level);
        const need = rpg.guildExpToNext(mine.level);
        const members = mine.members.slice(0, 15).map((n) => {
            const u = data.users[n];
            const rp = u?.rpg;
            return `${n === mine.owner ? '👑' : '•'} ${(u?.regName || u?.name || n).slice(0, 16)}${rp ? ` — Lv ${rp.rpgLevel}` : ''}`;
        });

        await reply(
            `🏰 *GUILD ${mine.name}*\n\n` +
            `📊 Lv *${mine.level}* • EXP ${fmt(mine.exp)}/${fmt(need)}\n` +
            `💰 Bank: ${fmt(mine.bank)} gold\n` +
            `👥 Anggota: ${mine.members.length}/${rpg.GUILD_MAX_MEMBERS}\n\n` +
            `*Bonus:* EXP ×${bonus.expMul.toFixed(2)} • Gold ×${bonus.goldMul.toFixed(2)} • STR+${bonus.statBonus.str} VIT+${bonus.statBonus.vit}\n\n` +
            `${members.join('\n')}${mine.members.length > 15 ? `\n_...dan ${mine.members.length - 15} lainnya_` : ''}\n\n` +
            `Setor: *${prefix}guild bank <gold>*\nKeluar: *${prefix}guild keluar*`
        );
    }
};
