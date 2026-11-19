const { fmt, parseBet } = require('../../lib/data/economy');

module.exports = {
    name: 'Mini Game',
    command: ['dadu', 'koinflip', 'pilih'],
    category: 'game',
    description: 'Lempar dadu, lempar koin (taruhan opsional), pilih acak',
    usage: '.dadu • .koinflip kepala|ekor [taruhan] • .pilih a|b|c',
    limit: 0,
    async execute(sock, m, { command, args, text, user, db, reply, prefix }) {
        if (command === 'dadu') return await reply(`Dadumu: *${1 + Math.floor(Math.random() * 6)}*`);

        if (command === 'pilih') {
            const opts = text.split(/\s*(?:\||,|\batau\b)\s*/i).map((s) => s.trim()).filter(Boolean);
            if (opts.length < 2) return await reply(`Contoh: *${prefix}pilih makan | tidur | main*`);
            return await reply(`Aku pilih: *${opts[Math.floor(Math.random() * opts.length)]}*`);
        }

        const side = (args[0] || '').toLowerCase();
        const pick = { kepala: 'kepala', head: 'kepala', ekor: 'ekor', tail: 'ekor' }[side];
        const result = Math.random() < 0.5 ? 'kepala' : 'ekor';
        if (!pick) return await reply(`Hasil lemparan: *${result}*\n_Taruhan: ${prefix}koinflip kepala 500_`);
        const { bet, error } = parseBet(args[1], user.money);
        if (error) return await reply(error);
        const win = pick === result;
        user.money += win ? bet : -bet;
        db.markDirty();
        await reply(`Lemparan: *${result}* • tebakanmu *${pick}*\n${win ? `Menang +${fmt(bet)}` : `Kalah -${fmt(bet)}`} koin\nSaldo: ${fmt(user.money)}`);
    }
};
