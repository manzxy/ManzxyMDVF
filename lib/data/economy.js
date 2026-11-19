/** Ekonomi ringan untuk fitur game: koin + exp/level (rumus level sama dengan database.js). */
const fmt = (n) => Number(n || 0).toLocaleString('id-ID');

function addExp(user, amount) {
    user.exp += amount;
    let up = 0;
    while (user.exp >= user.level * 100) { user.exp -= user.level * 100; user.level++; up++; }
    return up;
}

function parseBet(arg, balance, { min = 50, max = 100000 } = {}) {
    if (!arg) return { error: 'Tentukan taruhan, mis. 500 atau all.' };
    const bet = /^(all|semua)$/i.test(arg) ? Math.min(balance, max) : Math.floor(Number(String(arg).replace(/[.,]/g, '')));
    if (!Number.isFinite(bet) || bet < min) return { error: `Taruhan minimal ${fmt(min)} koin.` };
    if (bet > max) return { error: `Taruhan maksimal ${fmt(max)} koin.` };
    if (bet > balance) return { error: `Koin kamu tidak cukup (punya ${fmt(balance)}).` };
    return { bet };
}

module.exports = { fmt, addExp, parseBet };
