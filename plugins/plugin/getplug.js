const fs = require('fs');
const path = require('path');
const pm = require('../../lib/bot/pluginManager');
const { formatBytes } = require('../../lib/core/utils');

module.exports = {
    name: 'Ambil Plugin',
    command: ['getplug', 'dlplug', 'ambilplug'],
    category: 'plugin',
    description: 'Ambil file plugin (dokumen .js), --text untuk kirim sebagai teks utuh',
    usage: '.getplug <nama> [--text]',
    rootOwner: true,
    async execute(sock, m, { from, text, prefix, reply }) {
        const { nameArg, flags } = pm.parseInput(text);
        if (!nameArg) {
            const files = pm.listFiles();
            return await reply(`*📦 GET PLUGIN*\n\nPakai: *${prefix}getplug <nama>*\nOpsi: --text (kirim sebagai teks)\n\nTersedia (${files.length}):\n` + files.map((f) => `• ${f.category}/${f.name}`).join('\n'));
        }

        const found = pm.resolve(nameArg);
        if (!found.length) return await reply(`❌ Plugin "${nameArg}" tidak ditemukan. Ketik *${prefix}getplug* untuk daftar.`);
        if (found.length > 1) return await reply(`⚠️ Ada ${found.length} plugin cocok:\n${found.map((f) => `• ${prefix}getplug ${f.category}/${f.name}`).join('\n')}`);
        const file = found[0].path, label = `${found[0].category}/${found[0].name}.js`;

        const code = fs.readFileSync(file, 'utf8');
        const base = path.basename(file);
        
        // JIKA MENGGUNAKAN OPSI --text (Kirim teks UTUH satu pesan, tanpa dipotong)
        if (flags.has('--text')) {
            return await sock.sendMessage(from, { text: `📄 *${label}*\n\n\`\`\`${code}\`\`\`` }, { quoted: m });
        }
        
        // JIKA TIDAK MENGGUNAKAN --text (Kirim sebagai dokumen biasa)
        try {
            if (sock.mediaOk && !sock.mediaOk()) throw new Error('media sedang disambung ulang');
            await sock.sendMessage(from, {
                document: Buffer.from(code),
                mimetype: 'application/javascript',
                fileName: base.endsWith('.js') ? base : `${base}.js`,
                caption: `📦 *${label}*\n${formatBytes(Buffer.byteLength(code))} • ${code.split('\n').length} baris\n\nEdit lalu kirim balik: reply file ini dengan *${prefix}svplug*`
            }, { quoted: m });
        } catch (err) {
            // Upload dokumen gagal → kirim sebagai teks UTUH
            await reply(`⚠️ Kirim file gagal (${err.message}), dikirim sebagai teks.`);
            await sock.sendMessage(from, { text: `\`\`\`${code}\`\`\`` });
        }
    }
};
