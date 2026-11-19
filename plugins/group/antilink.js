const { getCachedGroupMetadata } = require('../../lib/core/jid');
const { participantMatches } = require('../../handler/access');

const LINK = /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/i;
const MODES = ['delete', 'warn', 'kick'];

module.exports = {
    name: 'Anti Link Grup',
    command: ['antilink'],
    category: 'group',
    description: 'Hapus link grup WhatsApp (delete / warn / kick)',
    usage: '.antilink on|off|mode <delete|warn|kick>',
    group: true,
    admin: true,
    limit: 0,
    async execute(sock, m, { args, group, db, prefix, reply }) {
        const cfg = group.settings.antilink;
        const a = (args[0] || '').toLowerCase();
        if (a === 'on' || a === 'off') cfg.enabled = a === 'on';
        else if (a === 'mode' && MODES.includes((args[1] || '').toLowerCase())) cfg.mode = args[1].toLowerCase();
        else return await reply(`Anti link: *${cfg.enabled ? 'ON' : 'OFF'}* • mode *${cfg.mode}*\n\n${prefix}antilink on|off\n${prefix}antilink mode delete|warn|kick\n\n_delete = hapus pesan • warn = hapus + peringatan (3x kick) • kick = langsung keluarkan. Admin & owner dikecualikan. Bot harus admin._`);
        db.markDirty();
        await reply(`Anti link *${cfg.enabled ? 'ON' : 'OFF'}* • mode *${cfg.mode}*`);
    },

    async before(m, { sock, from, isGroup, group, body, isOwner, senderNumber, senderLid, botNumber, db }) {
        const cfg = group?.settings?.antilink;
        if (!isGroup || !cfg?.enabled || isOwner || m.key.fromMe || !LINK.test(body || '')) return false;
        if ((cfg.whitelist || []).some((w) => (body || '').includes(w))) return false;

        const meta = await getCachedGroupMetadata(sock, from);
        const parts = meta?.participants || [];
        const sender = parts.find((p) => participantMatches(p, { number: senderNumber, lid: senderLid }));
        if (!sender || sender.admin) return false;
        const me = parts.find((p) => participantMatches(p, { number: botNumber, lid: sock.user?.lid || '' }));
        if (!me?.admin) return false;                          // bot bukan admin → tidak bisa menghapus

        try { await sock.sendMessage(from, { delete: m.key }); } catch { return false; }
        const tag = `@${senderNumber}`;
        let kick = cfg.mode === 'kick';
        if (cfg.mode === 'warn') {
            group.warns[senderNumber] = (group.warns[senderNumber] || 0) + 1;
            kick = group.warns[senderNumber] >= 3;
            if (!kick) await sock.sendMessage(from, { text: `${tag} dilarang mengirim link grup. Peringatan ${group.warns[senderNumber]}/3.`, mentions: [sender.id] });
            else delete group.warns[senderNumber];
            db.markDirty();
        } else if (!kick) await sock.sendMessage(from, { text: `${tag} dilarang mengirim link grup.`, mentions: [sender.id] });
        if (kick) {
            try {
                await sock.groupParticipantsUpdate(from, [sender.id], 'remove');
                await sock.sendMessage(from, { text: `${tag} dikeluarkan karena mengirim link grup.`, mentions: [sender.id] });
            } catch { /* gagal kick: abaikan */ }
        }
        return true;
    }
};
