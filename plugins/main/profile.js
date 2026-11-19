const { runtime, formatDateTime } = require('../../lib/core/utils');
const rpg = require('../../lib/data/rpg');
const card = require('../../lib/data/rpg/card');

/** Ambil foto profil; gagal = null (card akan pakai inisial). */
async function fetchAvatar(sock, jid) {
    try {
        const url = await sock.profilePictureUrl(jid, 'image');
        return url || null;
    } catch { return null; }
}

/** Petakan data user + rpg → objek untuk card.render(). */
function buildCardData(user, { pushname, isOwner, isUnlimited, isPremium, rank, rankTotal }) {
    const p = user.rpg;
    const cls = p ? rpg.CLASSES[p.class] : null;
    const d = p ? rpg.derived(p) : null;
    const now = p ? rpg.current(p) : null;
    const season = rpg.currentSeason();
    const event = rpg.currentEvent();
    const set = p ? rpg.activeSet(p) : null;
    let daily = { done: 0, total: 4 };
    if (p) {
        const dq = rpg.dailyStatus(p, user.number);
        daily = { done: dq.filter((q) => q.claimed).length, total: dq.length };
    }
    const colorOf = {
        warrior: card.C.orange, mage: card.C.purple, archer: card.C.green,
        cleric: card.C.yellow, rogue: card.C.pink, necromancer: card.C.purple,
        paladin: card.C.cyan, berserker: card.C.red
    };
    return {
        name: user.registered ? user.regName : pushname || user.name || 'Adventurer',
        number: user.number,
        level: p ? p.rpgLevel : user.level || 1,
        expNow: p ? p.rpgExp : user.exp || 0,
        expNeed: p ? rpg.expToNext(p.rpgLevel) : (user.level || 1) * 100,
        hp: now ? now.hp : 0,
        hpMax: d ? d.maxHp : 1,
        mp: now ? now.mp : 0,
        mpMax: d ? d.maxMp : 1,
        atk: d ? d.atk : 0,
        matk: d ? d.matk : 0,
        def: d ? d.def : 0,
        power: d ? d.power : 0,
        crit: d ? d.critRate : 0,
        gold: p ? p.gold : user.money || 0,
        dust: p?.enchant?.dust || 0,
        kills: p?.stats?.kills || 0,
        bossKills: p?.stats?.bossKills || 0,
        dungeons: p?.stats?.dungeons || 0,
        cls: cls ? { name: cls.name, title: cls.title, color: colorOf[p.class] } : null,
        title: p?.title || (isOwner ? 'Owner' : isPremium ? 'Premium' : null),
        prestige: p?.prestige || 0,
        achievements: p?.achievements?.length || 0,
        achTotal: Object.keys(rpg.ACHIEVEMENTS).length,
        chapter: p?.quest?.chapter || 0,
        chapterTotal: rpg.CHAPTERS.length,
        streak: p?.streak?.days || user.dailyStreak || 0,
        combo: p?.combo?.count || 0,
        season: { name: season.name },
        event: event.mul && Object.keys(event.mul).length ? { name: event.name } : null,
        items: p ? Object.keys(p.inventory || {}).length : 0,
        pet: p?.pet ? { name: rpg.PET_DEFS[p.pet.kind]?.name || 'Pet', level: p.pet.level } : null,
        guild: p?.guildId ? (rpg.GUILD_NAMES?.[p.guildId] || p.guildId) : null,
        rank: rank || null,
        rankTotal: rankTotal || null,
        set: set?.set ? { name: set.set.name, count: set.count } : null,
        daily
    };
}

/** Versi teks — dipakai bila canvas tidak tersedia. */
function textProfile(user, o) {
    const top = Object.entries(user.commandUsage || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} (${n}x)`).join(', ') || '-';
    const bar = (cur, max) => {
        const n = max > 0 ? Math.max(0, Math.min(10, Math.round((cur / max) * 10))) : 0;
        return `${'▰'.repeat(n)}${'▱'.repeat(10 - n)}`;
    };
    const rpgBlock = o.cls
        ? (
            `│ Kelas     : ${o.cls.name}${o.prestige ? ` ★P${o.prestige}` : ''}${o.title ? ` — _${o.title}_` : ''}\n` +
            `│ Level     : ${o.level}\n` +
            (o.expNeed ? `│ EXP       : ${bar(o.expNow, o.expNeed)} ${o.expNow}/${o.expNeed}\n` : '') +
            `│ HP        : ${bar(o.hp, o.hpMax)} ${o.hp}/${o.hpMax}\n` +
            `│ MP        : ${bar(o.mp, o.mpMax)} ${o.mp}/${o.mpMax}\n` +
            `│ ATK/DEF   : ${card.fmtNum(o.atk)} / ${card.fmtNum(o.def)}\n` +
            `│ Power     : ${card.fmtNum(o.power)}\n` +
            `│ Gold      : ${card.fmtNum(o.gold)} • Dust ${card.fmtNum(o.dust)}\n` +
            `│ Kills     : ${card.fmtNum(o.kills)} • Boss ${card.fmtNum(o.bossKills)} • Dungeon ${o.dungeons}\n` +
            `│ Chapter   : ${Math.min(o.chapter + 1, o.chapterTotal)}/${o.chapterTotal} • Achieve ${o.achievements}/${o.achTotal}\n` +
            (o.pet ? `│ Pet       : ${o.pet.name} Lv${o.pet.level}\n` : '') +
            (o.set ? `│ Set       : ${o.set.name} (${o.set.count}/3)\n` : '') +
            `│ Streak    : ${o.streak} hari • Combo ${o.combo}x\n`
        )
        : `│ Status    : ❌ belum punya karakter RPG\n`;

    return (
        `╭───「 👤 *PROFIL* 」\n` +
        `│ Nama      : ${o.name}\n` +
        (user.registered ? `│ Umur      : ${user.age}\n│ SN        : ${user.sn}\n` : `│ Daftar    : ❌ belum (ketik .daftar nama.umur)\n`) +
        `│ Nomor     : +${user.number}\n` +
        (o.rank ? `│ Peringkat : #${o.rank} dari ${o.rankTotal}\n` : '') +
        `${rpgBlock}` +
        `│ Pesan     : ${user.stats?.messages || 0}\n` +
        `│ Command   : ${user.stats?.commands || 0}\n` +
        `│ Favorit   : ${top}\n` +
        `│ Pertama   : ${formatDateTime(new Date(user.stats?.firstSeen || Date.now()))}\n` +
        `│ Season    : ${o.season?.name || '—'}\n` +
        `╰──────────────` +
        (o.cls ? '' : `\n\n_Mulai RPG: .rpg daftar_`)
    );
}

module.exports = {
    name: 'Profil Saya',
    command: ['profile', 'me', 'profil'],
    category: 'main',
    description: 'Kartu profil gambar (canvas) + statistik RPG lengkap',
    usage: '.profile • .profile text',
    async execute(sock, m, { from, user, group, isOwner, isUnlimited, pushname, reply, args, db }) {
        if (!user) return await sock.reply(from, '❌ Data user tidak tersedia.', m);
        const sub = (args?.[0] || '').toLowerCase();
        const p = user.rpg;
        if (p) rpg.syncProfile(p);

        // Peringkat power (dari database) untuk ditampilkan di kartu
        let rank = null, rankTotal = null;
        try {
            const all = db?.data?.users || {};
            const list = Object.values(all).filter((u) => u.rpg).map((u) => ({ n: u.number, pw: rpg.derived(rpg.syncProfile(u.rpg)).power }))
                .sort((a, b) => b.pw - a.pw);
            rankTotal = list.length;
            const idx = list.findIndex((x) => x.n === user.number);
            rank = idx >= 0 ? idx + 1 : null;
        } catch { /* abaikan */ }

        const data = buildCardData(user, {
            pushname, isOwner, isUnlimited,
            isPremium: user.premium?.active,
            rank, rankTotal
        });

        /* ── paksa teks ── */
        if (sub === 'text' || sub === 'teks') {
            return await sock.reply(from, textProfile(user, data), m);
        }

        /* ── coba render kartu ── */
        try {
            data.avatar = await fetchAvatar(sock, user.jid || `${user.number}@s.whatsapp.net`);
            const buf = await card.render(data);
            const lines = [
                `👤 *${data.name}*${data.cls ? ` — ${data.cls.name}` : ''}`,
                data.rank ? `🏆 Peringkat *#${data.rank}* dari ${data.rankTotal} petualang` : null,
                data.cls ? `💥 Power *${card.fmtNum(data.power)}* • ⚔️ ${card.fmtNum(data.atk)} • 🛡 ${card.fmtNum(data.def)}` : null,
                data.cls ? `📖 Chapter ${Math.min((data.chapter || 0) + 1, data.chapterTotal || 20)}/${data.chapterTotal || 20} • 🪙 ${card.fmtNum(data.gold)}` : null,
                '',
                data.cls ? `Detail: *.rpg* • Quest: *.dailyrpg* • Kartu teks: *.profile text*` : `Mulai RPG: *.rpg daftar*`
            ].filter((l) => l !== null);
            return await sock.sendMessage(from, { image: buf, caption: lines.join('\n') }, { quoted: m });
        } catch (err) {
            // Canvas tidak ada / gambar gagal → kirim versi teks saja (jangan error ke user)
            return await sock.reply(from, textProfile(user, data), m);
        }
    }
};
