module.exports = {
    name: 'Kalkulator',
    command: ['calc', 'hitung', 'kalkulator'],
    category: 'tools',
    description: 'Hitung ekspresi matematika',
    usage: '.calc 2*(3+4)^2',
    limit: 0,
    async execute(sock, m, { text, quoted, reply, prefix, command }) {
        const raw = (text || quoted?.text || '').trim();
        if (!raw) return await reply(`Contoh: *${prefix}${command} 12*(3+4)/2*\nOperator: + - * / % ^ ( )`);
        const expr = raw.replace(/,/g, '.').replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/\^/g, '**').replace(/\s+/g, '');
        // hanya angka & operator → tidak mungkin menjalankan kode lain
        if (expr.length > 100 || !/^[0-9+\-*/().%]+$/.test(expr)) return await reply('Ekspresi tidak valid. Pakai angka dan operator + - * / % ^ ( ) saja.');
        let result;
        try { result = Function(`"use strict"; return (${expr});`)(); } catch { return await reply('Ekspresi tidak valid.'); }
        if (typeof result !== 'number' || !Number.isFinite(result)) return await reply('Hasilnya tidak terhingga / tidak terdefinisi.');
        await reply(`${raw}\n= *${Number(result.toPrecision(12)).toLocaleString('id-ID', { maximumFractionDigits: 10 })}*`);
    }
};
