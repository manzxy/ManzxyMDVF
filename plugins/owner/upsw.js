/**
 * Upload / hapus Status WhatsApp (akun bot).
 *   .upsw <teks>                      status teks (latar & font acak)
 *   kirim / reply gambar, video, audio + .upsw [caption]
 *   .upsw ... --me                    hanya terlihat oleh akun bot + owner
 *   .upsw ... --bg=#1f2c34            warna latar (status teks / audio)
 *   .delsw [all]                      hapus status terakhir (atau semua yang tercatat)
 *
 * PERBAIKAN: status hanya terkirim bila `statusJidList` (daftar kontak penerima) diisi, dan
 * `backgroundColor` / `font` harus dikirim lewat OPSI (argumen ke-3), bukan isi pesan. Sebelumnya keduanya
 * salah sehingga status tidak muncul / latar diabaikan. Media sekarang juga dicek sehat lewat sock.mediaOk().
 */
const { jidNormalizedUser } = require('../../lib/wa/waCompat');
const { downloadContentFromMessage } = require('../../lib/wa/mediaDownload');
const { unwrapMessage } = require('../../handler/parser');
const { numberOf, formatBytes } = require('../../lib/core/utils');
const config = require('../../config');

const STATUS = 'status@broadcast';
const BG = ['#000000', '#1F2C34', '#008069', '#8E24AA', '#E53935', '#F57C00', '#1565C0', '#00897B'];
const FONTS = [0, 1, 2, 6, 7, 8, 9, 10];
const MAX_BYTES = 64 * 1024 * 1024;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/** Penerima status: akun bot + owner (+ semua user yang pernah chat bila bukan --me). */
function audience(sock, db, onlyMe) {
    const set = new Set();
    const self = jidNormalizedUser(sock.user?.id || '');
    if (self) set.add(self);
    for (const n of config.ownerNumber || []) set.add(`${numberOf(n)}@s.whatsapp.net`);
    if (!onlyMe) {
        const cap = config.upsw?.maxViewers ?? 1500;
        for (const u of Object.values(db.data.users)) {
            if (set.size >= cap) break;
            // Terima PN maupun LID — resolveStatusRecipients() di zapoCompat
            // akan mengubah PN ke LID sebelum kirim status.
            if ((u.jid?.endsWith('@s.whatsapp.net') || u.jid?.endsWith('@lid')) && !u.banned?.active) set.add(u.jid);
        }
    }
    return [...set];
}

async function download(node, type) {
    const chunks = [];
    for await (const c of await downloadContentFromMessage(node, type)) chunks.push(c);
    return Buffer.concat(chunks);
}

function parseFlags(text) {
    const flags = { me: false, bg: '' };
    const rest = (text || '').replace(/(?:^|\s)--(me|bg=#?[0-9a-f]{6})(?=\s|$)/gi, (_, f) => {
        if (f.toLowerCase() === 'me') flags.me = true; else flags.bg = '#' + f.split('=')[1].replace('#', '');
        return ' ';
    }).trim();
    return { ...flags, text: rest };
}

module.exports = {
    name: 'Upload Status',
    command: ['upsw', 'upstatus', 'statuswa', 'delsw', 'hapussw'],
    category: 'owner',
    owner: true,
    description: 'Upload (teks, gambar, video, audio) atau hapus Status WhatsApp bot',
    usage: '.upsw <teks> • kirim/reply media + .upsw [caption] • .upsw ... --me • .delsw [all]',

    async execute(sock, m, { text, command, prefix, quoted, db, reply }) {
        const log = (db.data.settings.statusLog ||= []);

        /* ── HAPUS ── */
        if (['delsw', 'hapussw'].includes(command)) {
            if (!log.length) return await reply('Belum ada status yang tercatat untuk dihapus.');
            const targets = /^all$/i.test(text || '') ? log.splice(0) : [log.pop()];
            let ok = 0;
            for (const t of targets) {
                try {
                    await sock.sendMessage(STATUS, { delete: { remoteJid: STATUS, fromMe: true, id: t.id } }, { statusJidList: audience(sock, db, t.me) });
                    ok++;
                } catch { /* lanjut ke status berikutnya */ }
            }
            db.markDirty();
            return await reply(`${ok}/${targets.length} status dihapus.`);
        }

        /* ── SUMBER KONTEN ── */
        const flags = parseFlags(text);
        const own = unwrapMessage(m.message) || {};
        const q = quoted?.message || {};
        const holder = (own.imageMessage || own.videoMessage || own.audioMessage) ? own : q;
        const kind = holder.imageMessage ? 'image' : holder.videoMessage ? 'video' : holder.audioMessage ? 'audio' : null;
        const caption = flags.text || (kind ? holder[`${kind}Message`].caption : '') || (!kind ? quoted?.text : '') || '';

        if (!kind && !caption) {
            return await reply([
                '*UPLOAD STATUS*',
                `${prefix}${command} <teks>  — status teks`,
                'Kirim / reply gambar, video, atau audio dengan caption',
                `${prefix}${command} [caption]`,
                '',
                'Opsi: `--me` hanya akun bot + owner • `--bg=#1f2c34` warna latar',
                `Hapus: ${prefix}delsw  (atau ${prefix}delsw all)`
            ].join('\n'));
        }

        const jids = audience(sock, db, flags.me);
        const opts = { statusJidList: jids, backgroundColor: flags.bg || pick(BG), font: pick(FONTS) };

        try {
            let content;
            if (kind) {
                if (sock.mediaOk && !sock.mediaOk()) return await reply('Koneksi media sedang disambung ulang otomatis. Coba lagi sebentar.');
                const node = holder[`${kind}Message`];
                if (Number(node.fileLength) > MAX_BYTES) return await reply(`File terlalu besar (${formatBytes(Number(node.fileLength))}). Maksimal ${formatBytes(MAX_BYTES)}.`);
                const buffer = await download(node, kind);
                if (kind === 'image') content = { image: buffer, caption };
                else if (kind === 'video') content = { video: buffer, caption, mimetype: node.mimetype || 'video/mp4' };
                else content = { audio: buffer, mimetype: node.mimetype || 'audio/ogg; codecs=opus', ptt: true };
            } else content = { text: caption };

            const res = await sock.sendMessage(STATUS, content, opts);
            if (res?.key?.id) {
                log.push({ id: res.key.id, type: kind || 'text', time: Date.now(), me: flags.me });
                if (log.length > 20) log.splice(0, log.length - 20);
                db.markDirty();
            }
            await reply(`Status ${kind || 'teks'} terkirim ke ${jids.length} kontak${flags.me ? ' (mode --me)' : ''}.\nHapus: ${prefix}delsw`);
        } catch (err) {
            sock.reportMediaFailure?.(err);
            await reply(`Gagal mengunggah status: ${err.message}`);
        }
    }
};
