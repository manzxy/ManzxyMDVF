const { groupCache, msgDedupeCache } = require('../../lib/core/jid');
const cleaner = require('../../lib/bot/cleaner');
const janitor = require('../../lib/bot/janitor');
const { formatBytes } = require('../../lib/core/utils');

module.exports = {
    name: 'Bersihkan Sampah',
    command: ['clearsession', 'clearram', 'sampah', 'bersihkan'],
    category: 'owner',
    description: 'Bersihkan sesi jadibot, sender-key, session lama, backup & sampah; kosongkan cache RAM',
    usage: '.sampah [scan|deep|restore|list]',
    rootOwner: true,
    async execute(sock, m, { from, args, prefix, config }) {
        const sub = (args[0] || '').toLowerCase();

        // Kembalikan trash terakhir (janitor).
        if (/^(restore|pulihkan|undo)$/.test(sub)) {
            const r = janitor.restore(args[1]);
            return await sock.reply(from, r.ok
                ? `✅ *DIPULIHKAN* — ${r.restored} item (${r.skipped} dilewati) dari trash \`${r.trashId}\``
                : `⚠️ ${r.message}`, m);
        }
        if (/^(list|trash)$/.test(sub)) {
            const list = janitor.listTrash();
            if (!list.length) return await sock.reply(from, 'Belum ada trash janitor.', m);
            const text = list.map((t) => `• \`${t.id}\` — ${t.moved} item (${formatBytes(t.bytes)})`).join('\n');
            return await sock.reply(from, `*🗑️ TRASH TERSEDIA*\n\n${text}`, m);
        }

        // scan / deep = janitor (dry-run, termasuk kandidat kode mati di deep)
        if (/^(scan|cek|preview|deep)$/.test(sub)) {
            const deep = sub === 'deep';
            const jr = janitor.scan({ includeDeadCode: deep });
            let text = `*🔍 PRATINJAU JANITOR* (belum ada yang dipindah)\n\n${janitor.formatReport(jr)}`;
            const cr = cleaner.run({ dryRun: true });
            text += `\n\n${cleaner.formatReport(cr)}`;
            return await sock.reply(from, text, m);
        }

        // Default: jalankan dua pembersih + flush RAM.
        const cleanerReport = cleaner.run({ dryRun: false });
        const janitorReport = janitor.run({ apply: true });
        const before = process.memoryUsage().rss;
        groupCache.flushAll();
        msgDedupeCache.flushAll();
        if (global.gc) global.gc();
        const after = process.memoryUsage().rss;

        await sock.reply(from,
            `*🧹 PEMBERSIHAN SELESAI*\n\n` +
            `*Cleaner:*\n${cleaner.formatReport(cleanerReport)}\n\n` +
            `*Janitor:*\n${janitor.formatReport(janitorReport)}\n\n` +
            `• *RAM sebelum:* ${formatBytes(before)}\n• *RAM sekarang:* ${formatBytes(after)}` +
            `${global.gc ? '' : '\n\n_Jalankan dengan --expose-gc agar GC manual aktif._'}\n\n` +
            `_Otomatis tiap ${config.cleaner?.intervalHours || 6} jam: ${config.cleaner?.auto ? 'AKTIF' : 'mati'} (config.cleaner)._\n` +
            `_Subcommand: scan · deep · restore · list_`, m);
    }
};
