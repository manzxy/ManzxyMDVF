/**
 * Pendaftaran user ke database — .daftar nama.umur • .unreg <SN> • .cekdaftar
 * Data: user.registered, regName, age, sn, regTime (lihat lib/database.js).
 * Semua teks ada di handler.js → TEXT.register* (ctx.texts).
 * Mewajibkan daftar untuk fitur lain: tambahkan `register: true` di plugin itu, atau aktifkan
 * config.register.enforce (semua command kecuali kategori di config.register.exemptCategories).
 */
const crypto = require('crypto');
const { button } = require('../../lib/wa/rich');

const NAME_RE = /^[\p{L}\p{N} _'-]{2,25}$/u;

function newSn(db) {
    const used = new Set(Object.values(db.data.users).map((u) => u.sn).filter(Boolean));
    for (let i = 0; i < 20; i++) {
        const sn = crypto.randomBytes(4).toString('hex').toUpperCase();
        if (!used.has(sn)) return sn;
    }
    return crypto.randomBytes(6).toString('hex').toUpperCase();
}

/** "Budi.17" | "Budi|17" | "Budi,17" | "Budi 17" → { name, age } */
function parseRegister(text) {
    const t = String(text || '').trim();
    const m = t.match(/^(.+?)\s*[.|,]\s*(\d{1,3})$/) || t.match(/^(.+?)\s+(\d{1,3})$/);
    if (!m) return null;
    return { name: m[1].replace(/\s+/g, ' ').trim(), age: Number(m[2]) };
}

module.exports = {
    name: 'Daftar',
    command: ['daftar', 'register', 'reg', 'unreg', 'unregister', 'cekdaftar', 'mydata'],
    category: 'main',
    description: 'Daftar ke database bot (nama.umur), hapus pendaftaran, cek status',
    usage: '.daftar nama.umur',
    limit: 0,
    register: false,                 // command pendaftaran sendiri tidak boleh mewajibkan daftar
    async execute(sock, m, { from, command, args, text, prefix, user, db, config, texts, reply }) {
        if (!user) return await reply('❌ Data user tidak tersedia.');
        const min = config.register.minAge, max = config.register.maxAge;

        /* ───── .cekdaftar ───── */
        if (command === 'cekdaftar' || command === 'mydata') {
            const extra = user.registered ? [] : [button.copy('📋 Salin contoh', `${prefix}daftar Budi.17`)];
            if (!extra.length) return await reply(texts.cekDaftar(user));
            return await sock.sendUniversalButton(from, { title: '🪪 STATUS PENDAFTARAN', body: `${texts.cekDaftar(user)}\n\n${texts.registerUsage(prefix, min, max)}`, footer: config.footerText }, extra, m);
        }

        /* ───── .unreg ───── */
        if (command === 'unreg' || command === 'unregister') {
            if (!user.registered) return await reply(texts.unregNotRegistered(prefix));
            if (!args[0]) return await reply(texts.unregUsage(prefix));
            if (args[0].toUpperCase() !== user.sn) return await reply(texts.unregWrongSn);
            Object.assign(user, { registered: false, regTime: 0, regName: '', age: -1, sn: '' });
            db.markDirty();
            return await reply(texts.unregSuccess);
        }

        /* ───── .daftar ───── */
        if (!config.register.enabled) return await reply(texts.registerDisabled);
        if (user.registered) return await reply(texts.registerAlready(user, prefix));
        if (!text) {
            return await sock.sendUniversalButton(from, { title: '📝 PENDAFTARAN', body: texts.registerUsage(prefix, min, max), footer: config.footerText },
                [button.copy('📋 Salin contoh', `${prefix}daftar Budi.17`)], m);
        }
        const parsed = parseRegister(text);
        if (!parsed) return await reply(texts.registerBadFormat(prefix));
        if (!NAME_RE.test(parsed.name)) return await reply(texts.registerBadName);
        if (!Number.isInteger(parsed.age) || parsed.age < min || parsed.age > max) return await reply(texts.registerBadAge(min, max));

        Object.assign(user, { registered: true, regTime: Date.now(), regName: parsed.name, age: parsed.age, sn: newSn(db) });
        db.markDirty();
        await reply(texts.registerSuccess(user, prefix));
    },
    _parseRegister: parseRegister
};
