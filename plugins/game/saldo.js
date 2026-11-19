const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Saldo',
    command: ['saldo', 'koin', 'balance', 'dompet'],
    category: 'game',
    description: 'Cek koin, level, dan streak harian',
    usage: '.saldo',
    limit: 0,
    async execute(sock, m, { user, reply, prefix }) {
        await reply(`*${user.regName || user.name || 'Kamu'}*\nKoin  : ${fmt(user.money)}\nLevel : ${user.level} (exp ${user.exp}/${user.level * 100})\nStreak: ${user.dailyStreak || 0} hari\n\n_Klaim koin gratis: ${prefix}daily • main: ${prefix}slot_`);
    }
};
