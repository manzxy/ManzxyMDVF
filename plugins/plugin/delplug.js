const pm = require('../../lib/bot/pluginManager');

const PROTECTED = new Set(['plugin/svplug', 'plugin/delplug', 'plugin/editplug', 'plugin/getplug', 'plugin/listplug']);

module.exports = {
    name: 'Hapus Plugin',
    command: ['delplug', 'rmplug', 'hapusplug'],
    category: 'plugin',
    description: 'Hapus plugin dari chat (permanen, tanpa backup)',
    usage: '.delplug [kategori/]nama',
    rootOwner: true,
    async execute(sock, m, { args, prefix, reply }) {
        if (!args[0]) return await reply(`Format: *${prefix}delplug kategori/nama* atau nama saja.\nLihat daftar: *${prefix}listplug*`);
        const found = pm.resolve(args[0]);
        if (!found.length) return await reply(`❌ Plugin "${args[0]}" tidak ditemukan. Lihat *${prefix}listplug*.`);
        if (found.length > 1) return await reply(`⚠️ Ada ${found.length} plugin cocok, pilih salah satu:\n${found.map((f) => `• ${prefix}delplug ${f.category}/${f.name}`).join('\n')}`);

        const f = found[0];
        if (PROTECTED.has(`${f.category}/${f.name}`)) {
            return await reply('🛡️ Plugin manajemen ini dilindungi agar kamu tidak terkunci. Hapus manual lewat VPS bila benar-benar perlu.');
        }
        try {
            pm.deletePlugin(f);
            await reply(`🗑️ *Plugin dihapus:* plugins/${f.category}/${f.name}.js\n\n⚠️ Permanen — tidak ada backup. Ambil dulu dengan *${prefix}getplug* sebelum menghapus bila perlu.`);
        } catch (err) {
            await reply(`❌ Gagal menghapus: ${err.message}`);
        }
    }
};
