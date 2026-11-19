const { getMentions } = require('../../lib/core/mentions');
const { participantMatches } = require('../../handler/access');
const { numberOf } = require('../../lib/core/utils');

const ACTIONS = {
    kick: { act: 'remove', ok: 'dikeluarkan' },
    promote: { act: 'promote', ok: 'dijadikan admin' },
    demote: { act: 'demote', ok: 'diturunkan dari admin' }
};

module.exports = {
    name: 'Kelola Anggota',
    command: ['kick', 'promote', 'demote'],
    category: 'group',
    description: 'Keluarkan / jadikan admin / turunkan admin (mention atau reply)',
    usage: '.kick @user • .promote @user • .demote @user',
    group: true,
    admin: true,
    botAdmin: true,
    limit: 0,
    async execute(sock, m, { from, command, quoted, toJid, groupMetadata, botNumber, prefix, reply }) {
        const ids = getMentions(m, quoted);
        if (!ids.length) return await reply(`Mention atau reply orangnya.\nContoh: *${prefix}${command} @user*`);
        const meta = groupMetadata || (await sock.groupMetadata(from));
        const { act, ok } = ACTIONS[command];
        const done = [], skipped = [];
        for (const id of ids.slice(0, 10)) {
            const nums = [numberOf(id), numberOf(await toJid(id))];
            const p = (meta.participants || []).find((x) => nums.some((n) => participantMatches(x, { number: n, lid: '' })));
            if (!p) { skipped.push(`@${nums[0]} (bukan anggota)`); continue; }
            if (nums.includes(botNumber)) { skipped.push('bot sendiri'); continue; }
            if (p.admin === 'superadmin') { skipped.push(`@${nums[0]} (pembuat grup)`); continue; }
            if (act === 'promote' && p.admin) { skipped.push(`@${nums[0]} (sudah admin)`); continue; }
            if (act === 'demote' && !p.admin) { skipped.push(`@${nums[0]} (bukan admin)`); continue; }
            try { await sock.groupParticipantsUpdate(from, [p.id], act); done.push(p.id); }
            catch (err) { skipped.push(`@${nums[0]} (${err.message})`); }
        }
        const lines = [];
        if (done.length) lines.push(`${done.map((j) => '@' + numberOf(j)).join(', ')} berhasil ${ok}.`);
        if (skipped.length) lines.push(`Dilewati: ${skipped.join(', ')}`);
        await sock.sendMessage(from, { text: lines.join('\n'), mentions: [...done, ...ids] }, { quoted: m });
    }
};
