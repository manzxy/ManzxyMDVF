const path = require('path');
const fs = require('fs');
const pm = require('../../lib/bot/pluginManager');
const { stripCodeFence } = require('../../lib/core/utils');

const PATCH_RE = /\[CARI\][ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\[GANTI\][ \t]*(?:\r?\n)?([\s\S]*)$/i;

module.exports = {
    name: 'Edit Plugin',
    command: ['editplug', 'editplugin'],
    category: 'plugin',
    description: 'Edit plugin dari chat: ganti sebagian teks atau timpa seluruh file',
    usage: '.editplug <nama>',
    rootOwner: true,
    async execute(sock, m, { from, text, quoted, prefix, reply }) {
        const { nameArg, flags, body, invalidName } = pm.parseInput(text);
        if (invalidName) return await reply(`❌ Nama "${invalidName}" tidak valid.`);
        if (!nameArg) {
            return await reply(
                `*✏️ EDIT PLUGIN*\n\n` +
                `*A. Ganti sebagian teks:*\n${prefix}editplug ping\n[CARI]\nteks lama\n[GANTI]\nteks baru\n\n` +
                `*B. Timpa seluruh file:* reply kode / file .js lalu ketik\n${prefix}editplug ping\n\n` +
                `*C. Lihat isi saat ini:* ${prefix}editplug ping (tanpa isi lain)\n\n` +
                `Opsi: *--all* untuk mengganti semua kemunculan teks.\nSemua perubahan dicek sintaksnya; bila gagal dimuat, isi lama dikembalikan.`
            );
        }

        const found = pm.resolve(nameArg);
        if (!found.length) return await reply(`❌ Plugin "${nameArg}" tidak ditemukan. Lihat *${prefix}listplug*.`);
        if (found.length > 1) return await reply(`⚠️ Ada ${found.length} plugin cocok:\n${found.map((f) => `• ${prefix}editplug ${f.category}/${f.name}`).join('\n')}`);
        const f = found[0];
        const current = fs.readFileSync(f.path, 'utf8');

        try {
            let newCode = null;
            let info = '';
            const patch = body.match(PATCH_RE);

            if (patch) {
                const r = pm.replaceInCode(current, patch[1], patch[2], flags.has('--all'));
                newCode = r.code;
                info = `${r.count} bagian diganti`;
            } else if (body) {
                newCode = stripCodeFence(body);
                info = 'seluruh file ditimpa';
            } else {
                const q = await pm.readQuotedCode(quoted);
                if (q) { newCode = q.code; info = `seluruh file ditimpa (dari ${q.from})`; }
            }

            if (newCode === null) {
                // Mode lihat: tampilkan isi saat ini
                return await reply(`📄 *plugins/${f.category}/${f.name}.js* (${current.split('\n').length} baris)\n\n\`\`\`${current}\`\`\`\n\nEdit dengan format [CARI]/[GANTI] atau reply kode baru.`);
            }
            if (newCode === current) return await reply('ℹ️ Tidak ada perubahan (isi sama persis).');

            const r = pm.savePlugin(f.category, f.name, newCode);
            const diff = newCode.split('\n').length - current.split('\n').length;
            await reply(
                `✅ *Plugin diedit:* ${f.category}/${f.name}.js\n\n` +
                `• ${info}\n• Selisih baris: ${diff >= 0 ? '+' : ''}${diff}\n` +
                `• Command: ${r.commands.map((c) => prefix + c).join(' ') || '-'}\n` +
                `\nSudah aktif tanpa restart.`
            );
        } catch (err) {
            await reply(`❌ *Gagal mengedit plugin*\n${err.message}`);
        }
    }
};
