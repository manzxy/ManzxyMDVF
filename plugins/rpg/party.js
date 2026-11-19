const rpg = require('../../lib/data/rpg');
const { fmt } = require('../../lib/data/economy');

const MAX_PARTY = 5;
const IDLE_MS = 30 * 60000;          // party bubar bila idle 30 menit

/** Buang party yang sudah lama tidak dipakai. */
function cleanup(data) {
    const now = Date.now();
    for (const [id, p] of Object.entries(data.parties || {})) {
        if (now - (p.updatedAt || 0) > IDLE_MS) delete data.parties[id];
    }
}

/** Party tempat user berada (atau null). */
function findParty(data, number) {
    for (const [id, p] of Object.entries(data.parties || {})) {
        if (p.members.includes(number)) return { id, ...p };
    }
    return null;
}

module.exports = {
    name: 'Party',
    command: ['party', 'pt', 'grup_rpg'],
    category: 'rpg',
    description: 'Party berburu bersama: bonus EXP & gold untuk semua anggota',
    usage: '.party • .party buat • .party join <id> • .party keluar',
    limit: 0,
    async execute(sock, m, { args, user, db, reply, prefix }) {
        if (!user.rpg) return await reply(`Buat karakter dulu: *${prefix}rpg daftar*`);
        const p = rpg.syncProfile(user.rpg);
        const data = db.data;
        data.parties = data.parties || {};
        cleanup(data);

        const sub = (args[0] || 'info').toLowerCase();
        const mine = findParty(data, user.number);

        /* ── buat ── */
        if (sub === 'buat' || sub === 'create') {
            if (mine) return await reply(`Kamu sudah di party *${mine.id}*. Keluar dulu: *${prefix}party keluar*`);
            const id = `${p.job.slice(0, 3).toUpperCase()}${Math.floor(1000 + Math.random() * 9000)}`;
            data.parties[id] = {
                leader: user.number,
                members: [user.number],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                name: (args[1] || `Party ${p.job}`).slice(0, 20)
            };
            p.partyId = id;
            db.markDirty();
            return await reply(
                `✅ *PARTY DIBUAT*\n\n🆔 ID: *${id}*\n👑 Ketua: kamu\n👥 Anggota: 1/${MAX_PARTY}\n\n` +
                `Ajak teman: *${prefix}party join ${id}*\n` +
                `_Bonus: +15% EXP & +10% gold per anggota tambahan._`
            );
        }

        /* ── gabung ── */
        if (sub === 'join' || sub === 'gabung') {
            if (mine) return await reply(`Kamu sudah di party *${mine.id}*.`);
            const target = (args[1] || '').toUpperCase();
            const party = data.parties[target];
            if (!party) return await reply(`❌ Party *${target}* tidak ditemukan atau sudah bubar.`);
            if (party.members.length >= MAX_PARTY) return await reply(`❌ Party penuh (${MAX_PARTY} anggota).`);
            party.members.push(user.number);
            party.updatedAt = Date.now();
            p.partyId = target;
            db.markDirty();
            return await reply(
                `✅ Bergabung ke party *${target}*\n👥 Anggota: ${party.members.length}/${MAX_PARTY}\n\n` +
                `Bonus sekarang: EXP ×${rpg.partyBonus(party.members.length).expMul.toFixed(2)} • Gold ×${rpg.partyBonus(party.members.length).goldMul.toFixed(2)}`
            );
        }

        /* ── keluar ── */
        if (sub === 'keluar' || sub === 'leave') {
            if (!mine) return await reply('Kamu tidak sedang di party mana pun.');
            const party = data.parties[mine.id];
            party.members = party.members.filter((n) => n !== user.number);
            if (!party.members.length || party.leader === user.number) {
                for (const n of party.members) {
                    const u = data.users[n];
                    if (u?.rpg) u.rpg.partyId = null;
                }
                delete data.parties[mine.id];
            } else {
                party.updatedAt = Date.now();
            }
            p.partyId = null;
            db.markDirty();
            return await reply(`✅ Keluar dari party *${mine.id}*.`);
        }

        /* ── tendang ── */
        if (sub === 'tendang' || sub === 'kick') {
            if (!mine) return await reply('Kamu tidak di party.');
            if (mine.leader !== user.number) return await reply('Hanya ketua party yang bisa menendang.');
            const target = String(args[1] || '').replace(/\D/g, '');
            if (!mine.members.includes(target)) return await reply('Nomor itu bukan anggota party.');
            const party = data.parties[mine.id];
            party.members = party.members.filter((n) => n !== target);
            party.updatedAt = Date.now();
            const u = data.users[target];
            if (u?.rpg) u.rpg.partyId = null;
            db.markDirty();
            return await reply(`✅ Mengeluarkan ${target} dari party.`);
        }

        /* ── info ── */
        if (!mine) {
            return await reply(
                `👥 *PARTY*\n\nKamu belum di party.\n\n` +
                `Buat: *${prefix}party buat*\nGabung: *${prefix}party join <id>*\n\n` +
                `_Party memberi bonus EXP & gold untuk semua anggota_\n` +
                `_\\(maks ${MAX_PARTY} orang, bubar otomatis bila idle 30 menit\\)_`
            );
        }

        const bonus = rpg.partyBonus(mine.members.length);
        const rows = mine.members.map((n) => {
            const u = data.users[n];
            const rp = u?.rpg;
            const name = (u?.regName || u?.name || n).slice(0, 16);
            const cls = rp ? rpg.CLASSES[rp.class] : null;
            const leader = n === mine.leader ? '👑' : '•';
            return `${leader} ${cls?.emoji || '❔'} ${name}${rp ? ` — Lv ${rp.rpgLevel} ${rp.job}` : ''}`;
        });

        await reply(
            `👥 *PARTY ${mine.id}*${mine.name ? ` — ${mine.name}` : ''}\n\n` +
            `${rows.join('\n')}\n\n` +
            `👤 ${mine.members.length}/${MAX_PARTY}\n` +
            `📈 Bonus: EXP ×${bonus.expMul.toFixed(2)} • Gold ×${bonus.goldMul.toFixed(2)}\n\n` +
            `Ajak: *${prefix}party join ${mine.id}*\nKeluar: *${prefix}party keluar*`
        );
    }
};
