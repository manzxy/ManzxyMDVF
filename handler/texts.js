/**
 * TEKS BOT — semua kalimat balasan handler dikumpulkan di sini.
 * Ubah kalimatnya di satu tempat; plugin memakainya lewat ctx.texts.
 * Kelompok: penolakan umum • limit • premium • pendaftaran • panggilan • deteksi grup
 */
const config = require('../config');
const { formatDateTime, formatDuration, truncate } = require('../lib/core/utils');

const TEXT = {
    /* ── penolakan umum ── */
    rootOwnerOnly: '❌ Khusus *Root Owner* bot utama!',
    ownerOnly: '❌ Khusus Owner!',
    groupOnly: '❌ Khusus di dalam Grup!',
    privateOnly: '❌ Khusus Chat Pribadi!',
    adminOnly: '❌ Khusus Admin Grup!',
    botAdminOnly: '❌ Bot harus menjadi Admin grup dulu!',
    busy: '⏳ Bot sedang sibuk, coba lagi sebentar.',
    mediaRecovering: 'Koneksi media sedang disambung ulang otomatis. Coba kirim ulang perintahmu dalam beberapa detik.',
    commandError: (command, message) => `❌ *Terjadi error pada command .${command}*\n\`\`\`${String(message).slice(0, 300)}\`\`\``,

    /* ── limit ── */
    limitTitle: '🎟️ LIMIT HARIAN HABIS',
    limitBody: (used, max) => `Limit kamu hari ini sudah habis (*${used}/${max}*).\nReset otomatis setiap tengah malam.\n\n⭐ *Premium* = limit *UNLIMITED* + jadibot gratis.`,

    /* ── premium ── */
    premiumTitle: '⭐ FITUR PREMIUM',
    premiumBody: (feature, prefix) =>
        `Fitur *${feature}* hanya untuk pengguna *Premium* ⭐\n\n` +
        `*Keuntungan Premium:*\n• Limit harian *UNLIMITED*\n• Jadibot gratis\n• Akses semua fitur premium\n\n` +
        `Harga mulai *Rp${Number(config.premium?.price?.perHour || 1000).toLocaleString('id-ID')}/jam* atau ` +
        `*Rp${Number(config.premium?.price?.perDay || 2000).toLocaleString('id-ID')}/hari*.\nKetik *${prefix}buyprem* untuk membeli.`,
    premiumActive: (user) => `⭐ *PREMIUM AKTIF*\n• Berakhir : ${user?.premium?.expire ? formatDateTime(new Date(user.premium.expire)) : 'Permanen'}\n• Limit    : UNLIMITED`,
    premiumInactive: (prefix) => `🆓 Kamu belum Premium.\nBeli premium: *${prefix}buyprem*`,

    /* ── pendaftaran ── */
    registerRequired: (prefix) =>
        `🔐 Kamu belum terdaftar di database bot.\n\nDaftar dulu dengan mengetik:\n*${prefix}daftar nama.umur*\n\nContoh: *${prefix}daftar Budi.17*`,
    registerDisabled: '❌ Fitur pendaftaran sedang dinonaktifkan.',
    registerUsage: (prefix, min, max) =>
        `*📝 PENDAFTARAN*\n\nFormat: *${prefix}daftar nama.umur*\nContoh: *${prefix}daftar Budi.17*\n\n• Nama 2–25 karakter (huruf, angka, spasi)\n• Umur ${min}–${max} tahun`,
    registerAlready: (user, prefix) =>
        `✅ Kamu sudah terdaftar.\n\n• Nama : ${user.regName || user.name || '-'}\n• Umur : ${user.age}\n• SN   : ${user.sn}\n\nHapus pendaftaran: *${prefix}unreg ${user.sn}*`,
    registerBadFormat: (prefix) => `❌ Format salah.\nGunakan: *${prefix}daftar nama.umur*\nContoh: *${prefix}daftar Budi.17*`,
    registerBadName: '❌ Nama tidak valid. Pakai 2–25 karakter: huruf, angka, atau spasi.',
    registerBadAge: (min, max) => `❌ Umur harus berupa angka antara *${min}* dan *${max}*.`,
    registerSuccess: (user, prefix) =>
        `✅ *PENDAFTARAN BERHASIL*\n\n╭───「 🪪 *DATA KAMU* 」\n│ Nama   : ${user.regName}\n│ Umur   : ${user.age}\n│ Nomor  : +${user.number}\n│ SN     : ${user.sn}\n│ Waktu  : ${formatDateTime(new Date(user.regTime))}\n╰────────────────────────\n\n_Simpan SN-mu. Dipakai untuk *${prefix}unreg*._\nKetik *${prefix}menu* untuk mulai.`,
    unregNotRegistered: (prefix) => `❌ Kamu belum terdaftar. Ketik *${prefix}daftar nama.umur*.`,
    unregUsage: (prefix) => `Format: *${prefix}unreg <SN>*\nSN ada di pesan pendaftaran atau lewat *${prefix}cekdaftar*.`,
    unregWrongSn: '❌ SN salah. Pendaftaran tidak dihapus.',
    unregSuccess: '🗑️ Pendaftaran dihapus dari database.',
    cekDaftar: (user) =>
        `🪪 *STATUS PENDAFTARAN*\n\n• Status : ${user.registered ? '✅ Terdaftar' : '❌ Belum terdaftar'}` +
        (user.registered ? `\n• Nama   : ${user.regName}\n• Umur   : ${user.age}\n• SN     : ${user.sn}\n• Sejak  : ${formatDateTime(new Date(user.regTime))}` : ''),

    /* ── panggilan ── */
    antiCall: '📵 Maaf, bot tidak bisa menerima panggilan. Panggilanmu ditolak otomatis.\nKirim pesan teks saja ya.',

    /* ── deteksi perubahan grup ── */
    detectOn: '🟢 *Deteksi perubahan grup* diaktifkan.\nBot akan memberi tahu bila ada perubahan nama, deskripsi, pengaturan, admin, dll.',
    detectOff: '🔴 *Deteksi perubahan grup* dimatikan.',
    detectPromote: (who, by) => `👑 ${who} dijadikan *admin*${by ? ` oleh ${by}` : ''}.`,
    detectDemote: (who, by) => `⬇️ ${who} dicopot dari *admin*${by ? ` oleh ${by}` : ''}.`,
    detectAdd: (who, by) => `➕ ${who} ditambahkan ke grup${by ? ` oleh ${by}` : ''}.`,
    detectJoin: (who) => `➕ ${who} bergabung ke grup.`,
    detectLeave: (who) => `🚪 ${who} keluar dari grup.`,
    detectKick: (who, by) => `🚫 ${who} dikeluarkan dari grup${by ? ` oleh ${by}` : ''}.`,
    detectJoinRequest: (who, action) => ({ created: `📨 ${who} meminta bergabung ke grup.`, revoked: `↩️ ${who} membatalkan permintaan bergabung.`, rejected: `❎ Permintaan bergabung ${who} ditolak.` }[action] || ''),
    detectSubject: (name, by) => `✏️ Nama grup diubah menjadi *${name}*${by ? ` oleh ${by}` : ''}.`,
    detectDesc: (desc, by) => `📝 Deskripsi grup ${desc ? `diubah${by ? ` oleh ${by}` : ''}:\n${truncate(desc, 300)}` : `dihapus${by ? ` oleh ${by}` : ''}`}.`,
    detectIcon: (by) => `🖼️ Foto grup diubah${by ? ` oleh ${by}` : ''}.`,
    detectAnnounce: (on, by) => on ? `🔒 Hanya *admin* yang boleh mengirim pesan${by ? ` (diatur ${by})` : ''}.` : `🔓 *Semua member* boleh mengirim pesan${by ? ` (diatur ${by})` : ''}.`,
    detectRestrict: (on, by) => on ? `🔒 Hanya *admin* yang boleh mengubah info grup${by ? ` (diatur ${by})` : ''}.` : `🔓 *Semua member* boleh mengubah info grup${by ? ` (diatur ${by})` : ''}.`,
    detectEphemeral: (sec, by) => sec ? `⌛ Pesan sementara diaktifkan (${formatDuration(sec * 1000)})${by ? ` oleh ${by}` : ''}.` : `⌛ Pesan sementara dimatikan${by ? ` oleh ${by}` : ''}.`,
    detectInvite: (by) => `🔗 Link undangan grup direset${by ? ` oleh ${by}` : ''}.`,
    detectApproval: (on, by) => `🛂 Persetujuan admin untuk bergabung *${on ? 'AKTIF' : 'NONAKTIF'}*${by ? ` (diatur ${by})` : ''}.`,
    detectMemberAdd: (all, by) => `👥 Yang boleh menambah anggota: *${all ? 'semua member' : 'hanya admin'}*${by ? ` (diatur ${by})` : ''}.`
};


module.exports = TEXT;
