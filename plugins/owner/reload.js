const loader = require('../../lib/bot/pluginLoader');

module.exports = {
    name: 'Muat Ulang Plugin',
    command: ['reload', 'rl', 'hotreload'],
    category: 'owner',
    description: 'Muat ulang plugin manual • .hotreload on|off = muat ulang otomatis saat file berubah',
    usage: '.reload  |  .hotreload on|off',
    rootOwner: true,
    async execute(sock, m, { from, command, args, config, loadPlugins }) {
        if (command === 'hotreload') {
            const arg = String(args[0] || '').toLowerCase();
            if (process.env.MANZXY_SUPERVISED) {
                return await sock.reply(from, '🟢 *Reload seluruh proyek aktif*\nSetiap perubahan file atau folder source memulai ulang bot secara otomatis. Direktori sesi dan database dikecualikan. Pengaturan *.hotreload on|off* hanya berlaku saat menjalankan `node index.js` tanpa supervisor.', m);
            }
            if (arg === 'on' || arg === 'off') {
                config.hotReload = arg === 'on';
                if (config.hotReload) loader.watchPlugins(); else loader.unwatchPlugins();
            } else if (arg) return await sock.reply(from, 'Format: *.hotreload on|off*', m);
            const now = loader.isWatching();
            return await sock.reply(from, `${now ? '🟢' : '🔴'} *Hot-reload ${now ? 'AKTIF' : 'MATI'}*\n${now ? 'Plugin dimuat ulang otomatis saat file berubah.' : 'Perubahan file TIDAK dimuat otomatis. Pakai *.reload* atau simpan lewat *.svplug* / *.editplug*.'}\n\n_Berlaku sampai bot restart; permanen: config.hotReload._`, m);
        }
        const loaded = loadPlugins();
        await sock.reply(from, `✅ *Plugin dimuat ulang!*\nTotal file: *${loaded.size}*\nJika ada yang gagal dimuat, lihat error di console.`, m);
    }
};
