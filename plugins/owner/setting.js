/**
 * Pengaturan bot — online, mengetik, merekam suara, baca otomatis, lihat status, anti call.
 * Tersimpan di database (bot utama: settings.bot • jadibot: jadibots[nomor].botSettings).
 * Logikanya ada di lib/botSettings.js; handler.js yang menjalankannya.
 *
 *   .setting                 → panel (tombol list)
 *   .online on|off           → selalu online
 *   .typing on|off           → "mengetik..." saat memproses perintah
 *   .recording on|off        → "merekam suara..." saat memproses perintah
 *   .autoread on|off         → pesan masuk otomatis dibaca
 *   .readstatus on|off       → status/story otomatis dilihat
 *   .anticall on|off         → tolak panggilan • .anticallblock on|off → + blokir penelepon
 * Tanpa on/off = bolak-balik (toggle).
 */
const { button } = require('../../lib/wa/rich');

const KEY_COMMAND = { online: 'online', typing: 'typing', recording: 'recording', autoRead: 'autoread', autoReadStatus: 'readstatus', antiCall: 'anticall', antiCallBlock: 'anticallblock' };
const ALIAS = {
    online: 'online',
    typing: 'typing', mengetik: 'typing',
    recording: 'recording', merekam: 'recording', rekam: 'recording',
    autoread: 'autoRead', bacaotomatis: 'autoRead',
    readstatus: 'autoReadStatus', autoviewstatus: 'autoReadStatus', lihatstatus: 'autoReadStatus',
    anticall: 'antiCall',
    anticallblock: 'antiCallBlock'
};
const ON = ['on', 'aktif', 'nyala', '1', 'true'], OFF = ['off', 'mati', '0', 'false'];
const dot = (v) => (v ? '🟢' : '🔴');

module.exports = {
    name: 'Pengaturan Bot',
    command: ['setting', 'settings', 'botset', 'pengaturan', ...Object.keys(ALIAS)],
    category: 'owner',
    description: 'Atur online, mengetik, merekam, baca otomatis, lihat status, anti call',
    usage: '.setting',
    owner: true,
    async execute(sock, m, { from, command, args, prefix, config, isSelfMode, botSettings: bs, reply }) {
        const KEYS = bs.KEYS;

        /* ───── toggle satu pengaturan ───── */
        if (ALIAS[command]) {
            const key = ALIAS[command];
            const arg = String(args[0] || '').toLowerCase();
            let next;
            if (ON.includes(arg)) next = true;
            else if (OFF.includes(arg)) next = false;
            else if (!arg) next = !bs.get(sock)[key];
            else return await reply(`Format: *${prefix}${command} on|off*`);

            const now = bs.set(sock, key, next);
            const notes = [];
            if (key === 'online' && next) notes.push('⚠️ Saat *Online* aktif, HP utama tidak menerima notifikasi pesan (perilaku WhatsApp).');
            if (key === 'typing' && next) notes.push('ℹ️ *Merekam* dimatikan (hanya satu yang aktif).');
            if (key === 'recording' && next) notes.push('ℹ️ *Mengetik* dimatikan (hanya satu yang aktif).');
            if (key === 'antiCallBlock' && next) notes.push('ℹ️ *Anti Call* ikut diaktifkan.');
            if (key === 'autoReadStatus' && next) notes.push('ℹ️ Berlaku untuk status yang masuk setelah ini.');
            return await reply(`${dot(now[key])} *${KEYS[key].label}* ${now[key] ? 'diaktifkan' : 'dimatikan'}.${notes.length ? '\n\n' + notes.join('\n') : ''}`);
        }

        /* ───── panel ───── */
        const cur = bs.get(sock);
        const lines = Object.keys(KEYS).map((k) => `│ ${dot(cur[k])} ${KEYS[k].label}`);
        const rows = Object.keys(KEYS).map((k) => ({
            header: 'PENGATURAN',
            title: `${dot(cur[k])} ${KEYS[k].label}`.slice(0, 24),
            description: `${KEYS[k].desc} — ketuk untuk ${cur[k] ? 'mematikan' : 'mengaktifkan'}`.slice(0, 72),
            id: `${prefix}${KEY_COMMAND[k]} ${cur[k] ? 'off' : 'on'}`
        }));
        rows.push({ header: 'MODE', title: isSelfMode ? '🔓 Ubah ke Public' : '🔒 Ubah ke Self', description: `Sekarang: ${isSelfMode ? 'Self (hanya owner)' : 'Public (semua orang)'}`, id: `${prefix}${isSelfMode ? 'public' : 'self'}` });

        await sock.sendUniversalButton(from, {
            title: '⚙️ PENGATURAN BOT',
            body: `╭──「 🎛️ *STATUS* 」\n${lines.join('\n')}\n│ ⚙️ Mode : ${isSelfMode ? 'Self' : 'Public'}\n╰──────────────────────\n\nKetuk *Atur* untuk mengubah, atau ketik mis. *${prefix}online on*.\n⚠️ Online aktif = HP utama tidak menerima notifikasi.`,
            footer: config.footerText
        }, [button.list('⚙️ Atur', [{ title: 'Pengaturan', rows }])], m);
    }
};
