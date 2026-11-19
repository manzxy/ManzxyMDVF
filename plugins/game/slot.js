const { fmt, addExp, parseBet } = require('../../lib/data/economy');

const REEL = ['7', 'BAR', 'BELL', 'LEMON', 'CHERRY'];
const last = new Map();         // anti-spam per user

module.exports = {
    name: 'Slot',
    command: ['slot'],
    category: 'game',
    description: 'Main slot dengan koin (3 sama = 5x, 2 sama = balik modal)',
    usage: '.slot <taruhan|all>',
    limit: 0,
    async execute(sock, m, { user, args, senderNumber, db, reply }) {
        if (Date.now() - (last.get(senderNumber) || 0) < 4000) return await reply('Tunggu beberapa detik sebelum main lagi.');
        const { bet, error } = parseBet(args[0], user.money);
        if (error) return await reply(`${error}\nContoh: *.slot 500*`);
        last.set(senderNumber, Date.now());
        if (last.size > 500) last.clear();

        const r = [0, 0, 0].map(() => REEL[Math.floor(Math.random() * REEL.length)]);
        const same = new Set(r).size;
        let delta, label;
        if (same === 1) { delta = bet * 4; label = 'JACKPOT! Menang 5x'; }
        else if (same === 2) { delta = 0; label = 'Dua sama, modal kembali'; }
        else { delta = -bet; label = 'Kalah'; }
        user.money += delta;
        if (delta > 0) addExp(user, 15);
        db.markDirty();
        await reply(`*SLOT*\n[ ${r.join(' | ')} ]\n\n${label}\n${delta > 0 ? '+' : ''}${fmt(delta)} koin\nSaldo: ${fmt(user.money)}`);
    }
};
