/**
 * Atur saluran yang tampil di kartu balasan (nama saluran + tombol "Lihat saluran").
 *   .setch <link saluran>      → ambil ID & nama otomatis
 *   .setch <id@newsletter> [nama]
 *   reply pesan forward dari saluran + .setch
 *   .setch off                 → hapus (kembali ke config.channel)
 * Tersimpan di database, tidak perlu edit config.js.
 */
const db = require('../../lib/data/database');
const config = require('../../config');
const { channelInfo } = require('../../lib/wa/rich');

module.exports = {
    name: 'Atur Saluran',
    command: ['setch', 'setchannel'],
    category: 'owner',
    rootOwner: true,
    limit: 0,
    description: 'Atur saluran di kartu balasan',
    usage: '.setch <link saluran | id@newsletter> • .setch off',

    async execute(sock, m, { text, args, quoted, prefix, command, reply }) {
        const settings = db.data.settings;
        if ((args[0] || '').toLowerCase() === 'off') {
            delete settings.channel; db.markDirty();
            return await reply('Saluran kartu dihapus. Sekarang memakai config.channel.');
        }

        let jid = '', name = '';
        const link = (text || '').match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
        const rawJid = (text || '').match(/\d{10,25}@newsletter/);
        const fwd = quoted?.message && Object.values(quoted.message).map((v) => v?.contextInfo?.forwardedNewsletterMessageInfo).find(Boolean);

        try {
            if (link) {
                const meta = await sock.newsletterMetadata('invite', link[1]);
                jid = meta?.id; name = meta?.name;
            } else if (rawJid) {
                jid = rawJid[0];
                name = (text || '').replace(jid, '').trim();
                if (!name) { try { name = (await sock.newsletterMetadata('jid', jid))?.name; } catch { /* nama opsional */ } }
            } else if (fwd) {
                jid = fwd.newsletterJid; name = fwd.newsletterName;
            }
        } catch (err) { return await reply(`Gagal mengambil data saluran: ${err.message}`); }

        if (!jid || !jid.endsWith('@newsletter')) {
            const cur = channelInfo();
            return await reply(`Pakai: *${prefix}${command} <link saluran>*\nAtau reply pesan forward dari saluran.\n\nSaat ini: ${cur ? `${cur.newsletterName} (${cur.newsletterJid})` : 'belum diatur'}`);
        }
        settings.channel = { jid, name: name || config.botName, serverMessageId: -1 };
        db.markDirty();
        await reply(`Saluran diatur:\n*${settings.channel.name}*\n${jid}\n\nBerlaku untuk semua balasan bot.`);
    }
};
