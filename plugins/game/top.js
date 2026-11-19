const { fmt } = require('../../lib/data/economy');

module.exports = {
    name: 'Leaderboard',
    command: ['top', 'leaderboard', 'lb'],
    category: 'game',
    description: 'Peringkat 10 teratas berdasarkan level atau koin',
    usage: '.top • .top koin',
    limit: 0,
    async execute(sock, m, { args, db, user, reply }) {
        const byMoney = /^(koin|money|saldo)$/i.test(args[0] || '');
        const all = Object.values(db.data.users).filter((u) => !u.banned?.active);
        const score = byMoney ? (u) => u.money : (u) => u.level * 100000 + u.exp;
        all.sort((a, b) => score(b) - score(a));
        const rows = all.slice(0, 10).map((u, i) => `${i + 1}. ${(u.regName || u.name || u.number).slice(0, 18)} — ${byMoney ? fmt(u.money) + ' koin' : `Lv ${u.level} (${u.exp} exp)`}`);
        const rank = all.findIndex((u) => u.number === user.number) + 1;
        await reply(`*TOP 10 ${byMoney ? 'KOIN' : 'LEVEL'}*\n\n${rows.join('\n')}\n\nPeringkatmu: #${rank || '-'} dari ${all.length}`);
    }
};
