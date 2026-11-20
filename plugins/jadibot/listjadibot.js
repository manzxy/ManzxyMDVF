const { listAllJadibots } = require('../../lib/bot/jadibotManager');
const { button } = require('../../lib/wa/rich');
const { runtime, formatDateTime } = require('../../lib/core/utils');

const STATE = {
    open: '🟢 Terhubung', connecting: '🟡 Menyambung', pairing: '🟠 Menunggu pairing',
    failed: '🔴 Gagal', closed: '⚪ Mati', expired: '⌛ Kedaluwarsa'
};
const ICON = { open: '🟢', connecting: '🟡', pairing: '🟠', failed: '🔴', closed: '⚪', expired: '⌛' };
const isLive = (j) => ['open', 'connecting', 'pairing'].includes(j.state);

module.exports = {
    name: 'Kelola Jadibot',
    command: ['listjadibot', 'jadibotlist', 'myjadibot'],
    category: 'jadibot',
    description: 'Daftar jadibot milikmu + tombol matikan/hapus/nyalakan',
    usage: '.listjadibot',
    async execute(sock, m, { from, senderNumber, isRootOwner, prefix, config }) {
        const all = listAllJadibots();
        const list = isRootOwner ? all : all.filter((j) => j.owner === senderNumber);

        if (!list.length) {
            return await sock.sendUniversalButton(from, {
                title: '🤖 JADIBOT SAYA',
                body: `Kamu belum punya jadibot.\n\nBuat dengan *${prefix}jadibot <nomor> <durasi>*`,
                footer: config.footerText
            }, [button.quick('💰 Harga & Cara Buat', `${prefix}jadibot`), button.quick('📜 Menu', `${prefix}menu`)], m);
        }

        let body = `*${isRootOwner ? 'SEMUA JADIBOT' : 'JADIBOT SAYA'}*  (${list.length}${isRootOwner ? `/${config.jadibot.max}` : ''})\n\n`;
        list.forEach((j, i) => {
            body += `${i + 1}. ${ICON[j.state] || '⚪'} *+${j.number}*${j.name && j.name !== '-' ? ` (${j.name})` : ''}\n` +
                `   • Status : ${STATE[j.state] || j.state}\n` +
                (isRootOwner ? `   • Owner  : +${j.owner}\n` : '') +
                `   • Mode   : ${j.selfMode ? 'Self' : 'Public'}\n` +
                (j.uptime ? `   • Uptime : ${runtime(j.uptime)}\n` : '') +
                (j.attempts ? `   • Reconnect : ${j.attempts}x\n` : '') +
                `   • Aktif  : ${j.expire ? `s/d ${formatDateTime(new Date(j.expire))}` : 'Permanen'}\n\n`;
        });
        body += '_Pilih bot di daftar bawah untuk mematikan / menghapus / menyalakan._';

        const sections = [];
        const live = list.filter(isLive);
        const off = list.filter((j) => !isLive(j) && j.state !== 'expired');
        if (live.length) sections.push({ title: '⏹️ Matikan (sesi tetap tersimpan)', rows: live.map((j) => ({ header: 'MATIKAN', title: `⏹️ +${j.number}`, description: `${STATE[j.state]} • owner +${j.owner}`, id: `${prefix}stopjadibot ${j.number}` })) });
        if (off.length) sections.push({ title: '▶️ Nyalakan kembali', rows: off.map((j) => ({ header: 'NYALAKAN', title: `▶️ +${j.number}`, description: `${STATE[j.state] || j.state} • owner +${j.owner}`, id: `${prefix}jadibot ${j.number}` })) });
        sections.push({ title: '🗑️ Hapus permanen (sesi dihapus)', rows: list.map((j) => ({ header: 'HAPUS', title: `🗑️ +${j.number}`, description: 'Sesi dihapus, harus pairing ulang', id: `${prefix}deljadibot ${j.number}` })) });

        await sock.sendUniversalButton(from, { title: '🤖 JADIBOT MONITOR', body: body.trim(), footer: config.footerText }, [
            button.list('⚙️ Kelola Jadibot', sections),
            button.quick('🔄 Refresh', `${prefix}listjadibot`),
            button.quick('➕ Buat Baru', `${prefix}jadibot`)
        ], m);
    }
};
