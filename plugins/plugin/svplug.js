const pm = require('../../lib/bot/pluginManager');
const { stripCodeFence } = require('../../lib/core/utils');

module.exports = {
    name: 'Simpan Plugin',
    command: ['svplug', 'saveplug', 'addplug'],
    category: 'plugin',
    description: 'Simpan plugin baru / timpa lama dari chat (reply kode atau file .js)',
    usage: '.svplug [kategori/]nama',
    rootOwner: true,
    async execute(sock, m, { from, text, quoted, prefix, reply }) {
        const { nameArg, body, invalidName } = pm.parseInput(text);
        if (invalidName) return await reply(`❌ Nama "${invalidName}" tidak valid. Pakai huruf, angka, "-", "_" dan satu "/" untuk kategori.`);

        let code = body ? stripCodeFence(body) : '';
        let fileName = '';
        if (!code) {
            const q = await pm.readQuotedCode(quoted);
            if (!q) {
                return await reply(
                    `*📥 SAVE PLUGIN*\n\nCara pakai:\n` +
                    `1. *Reply* pesan berisi kode / file .js lalu ketik:\n   ${prefix}svplug kategori/nama\n` +
                    `2. Atau tulis langsung:\n   ${prefix}svplug tools/halo\n   (baris berikutnya: kode plugin)\n\n` +
                    `Nama boleh dikosongkan — akan dibaca dari file / isi kode.\n` +
                    `Sintaks dicek dulu, dan jika gagal dimuat, plugin lama otomatis dikembalikan.`
                );
            }
            code = q.code;
            fileName = q.fileName;
        }

        const meta = pm.guessMeta(code);
        let category = '';
        let name = '';
        if (nameArg.includes('/')) [category, name] = nameArg.toLowerCase().split('/');
        else {
            name = (nameArg || fileName || meta.command).toLowerCase();
            const existing = pm.listFiles().filter((f) => f.name.toLowerCase() === name);
            category = existing.length === 1 ? existing[0].category : (meta.category || 'custom');
        }
        if (!name) return await reply('❌ Nama plugin tidak bisa ditentukan. Tulis: *' + prefix + 'svplug kategori/nama*');

        try {
            const r = pm.savePlugin(category, name, code);
            await reply(
                `✅ *Plugin ${r.existed ? 'diperbarui' : 'disimpan'}!*\n\n` +
                `• *File:* plugins/${r.category}/${r.name}.js\n` +
                `• *Ukuran:* ${r.size} byte\n` +
                `• *Command:* ${r.commands.length ? r.commands.map((c) => prefix + c).join(' ') : '(hook saja)'}\n` +
                `\nSudah aktif tanpa restart.`
            );
        } catch (err) {
            await reply(`❌ *Gagal menyimpan plugin*\n${err.message}`);
        }
    }
};
