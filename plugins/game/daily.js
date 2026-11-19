const { fmt, addExp } = require('../../lib/data/economy');
const { runtime } = require('../../lib/core/utils');

const DAY = 24 * 3600 * 1000;

module.exports = {
    name: 'Hadiah Harian',
    command: ['daily', 'harian', 'claim'],
    category: 'game',
    description: 'Klaim koin & exp harian (streak = bonus)',
    usage: '.daily',
    limit: 0,
    async execute(sock, m, { user, db, reply }) {
        const last = user.lastDaily || 0;
        const wait = last + DAY - Date.now();
        if (wait > 0) return await reply(`Hadiah harian sudah diambil.\nCoba lagi dalam *${runtime(Math.ceil(wait / 1000))}*.`);
        user.dailyStreak = Date.now() - last < 2 * DAY ? (user.dailyStreak || 0) + 1 : 1;
        user.lastDaily = Date.now();
        const coin = 500 + Math.min(user.dailyStreak, 7) * 100;
        const exp = 20 + Math.min(user.dailyStreak, 7) * 5;
        user.money += coin;
        const up = addExp(user, exp);
        db.markDirty();
        await reply(`*HADIAH HARIAN*\n+${fmt(coin)} koin • +${exp} exp\nStreak ${user.dailyStreak} hari (bonus naik sampai 7 hari)\nSaldo: ${fmt(user.money)} koin${up ? `\nNaik level! Sekarang Lv ${user.level}` : ''}`);
    }
};
