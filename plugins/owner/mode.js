const { setJadibotMode } = require('../../lib/bot/jadibotManager');

module.exports = {
    name: 'Mode Bot',
    command: ['self', 'public', 'mode'],
    category: 'owner',
    description: 'Atur mode bot Self / Public (jadibot: berlaku per sesi)',
    usage: '.self | .public | .mode self|public',
    owner: true,
    async execute(sock, m, { from, command, args, config, db }) {
        let target;
        const current = sock.isJadibot ? sock.selfMode !== false : config.selfMode;
        if (command === 'self') target = true;
        else if (command === 'public') target = false;
        else if (args[0]) target = args[0].toLowerCase() === 'self';
        else target = !current;

        if (sock.isJadibot) setJadibotMode(sock.jadibotNumber, target);
        else { config.selfMode = target; db.markDirty(); }

        await sock.reply(from, `✅ *Mode ${sock.isJadibot ? 'Jadibot' : config.botName} diubah!*\n\n• Sekarang: *${target ? 'SELF (pribadi)' : 'PUBLIC (umum)'}*${sock.isJadibot ? '' : '\n_Mode bot utama kembali ke nilai config.js setelah restart._'}`, m);
    }
};
