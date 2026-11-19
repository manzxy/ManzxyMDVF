const payment = require('../../lib/billing/payment');
const promotions = require('../../lib/billing/promotions');
const rental = require('../../lib/billing/rental');
const { button } = require('../../lib/wa/rich');
const { parseDuration, formatDuration, rupiah, formatDateTime } = require('../../lib/core/utils');

const daysOf = (key) => Math.round(parseDuration(key) / 86400000);

module.exports = {
    name: 'Sewa Bot',
    command: ['sewabot', 'sewa', 'sewapay', 'ceksewa'],
    category: 'sewa',
    description: 'Sewa bot untuk grup — pilih paket lewat tombol, bayar QRIS, bot masuk otomatis',
    usage: '.sewabot [link grup]',
    sewaExempt: true,            // tetap bisa dipakai di grup yang belum menyewa (mode enforce)
    async execute(sock, m, ctx) {
        const { from, command, args, text, isGroup, isOwner, isPremium, senderNumber, groupName, group, prefix, config, reply } = ctx;
        const S = config.sewa;

        if (sock.isJadibot) return await reply('❌ Sewa bot hanya lewat bot utama.');
        if (!S.enabled) return await reply('❌ Fitur sewa bot dinonaktifkan.');

        /* ───── .ceksewa ───── */
        if (command === 'ceksewa') {
            if (isGroup) {
                const r = group?.rent;
                return await reply(rental.isActive(group)
                    ? `✅ *Sewa aktif*\n• Grup: ${groupName}\n• Penyewa: +${r.by}\n• Sejak: ${formatDateTime(new Date(r.since))}\n• Habis: ${r.expire ? formatDateTime(new Date(r.expire)) : 'Permanen'}`
                    : `❌ Grup ini belum menyewa bot (atau sudah habis).\nKetik *${prefix}sewabot* untuk menyewa.`);
            }
            const mine = Object.values(ctx.db.data.groups).filter((g) => g.rent?.by === senderNumber && rental.isActive(g));
            return await reply(mine.length
                ? `*🏷️ SEWA SAYA*\n\n` + mine.map((g, i) => `${i + 1}. ${g.name || g.id}\n   s/d ${g.rent.expire ? formatDateTime(new Date(g.rent.expire)) : 'Permanen'}`).join('\n\n')
                : `Kamu belum punya sewa aktif. Kirim *${prefix}sewabot <link grup>* untuk menyewa.`);
        }

        const durTok = args.find((a) => parseDuration(a));          // durasi custom: 45d, 1y, 6mo, ...
        const customHint = `\n\n_Durasi custom (hingga tahunan): ${prefix}sewabot ${isGroup ? '' : '<link> '}45d  •  ${prefix}sewabot ${isGroup ? '' : '<link> '}1y_`;
        const free = (isOwner && S.freeForOwner) || (isPremium && S.freeForPremium);
        const inviteCode = rental.parseInviteCode(text);

        /* ───── .sewapay <paket> [link]  (target tombol list) ───── */
        if (command === 'sewapay' || durTok) {
            const key = (durTok || args[0] || '').toLowerCase();
            const durationMs = parseDuration(key);
            const bad = payment.validateDuration(durationMs, S.price);
            if (bad) return await reply(`❌ ${bad}`);
            if (!isGroup && !inviteCode) return await reply(`❌ Kirim link grup dulu: *${prefix}sewabot https://chat.whatsapp.com/xxxx*`);

            let groupJid = isGroup ? from : '';
            let name = isGroup ? groupName : '';
            if (inviteCode) {
                try { const info = await rental.inviteInfo(sock, inviteCode); groupJid = info.id || ''; name = info.subject || ''; }
                catch (err) { return await reply(`❌ ${err.message}`); }
            }
            const targetKey = groupJid || inviteCode;
            const pending = payment.findPendingRent(senderNumber, targetKey);
            if (pending) return await payment.sendPendingNotice(sock, from, m, pending, 'sewa grup ini');

            // ── gratis (Owner / Premium sesuai config) ──
            if (free) {
                await reply(`⏳ Mengaktifkan sewa untuk *${name || 'grup'}* ...`);
                try {
                    const r = await rental.grant(sock, { groupJid: isGroup ? from : '', inviteCode: isGroup ? '' : inviteCode, owner: senderNumber, durationMs });
                    return await reply(`✅ Bot aktif di *${r.name || name}* sampai ${formatDateTime(new Date(r.expire))}.`);
                } catch (err) { return await reply(`❌ Gagal: ${err.message}`); }
            }

            // ── berbayar ──
            if (!payment.isEnabled()) {
                return await sock.sendUniversalButton(from, { title: '💳 SEWA BOT', body: 'Pembayaran otomatis belum aktif. Silakan hubungi owner untuk sewa.', footer: config.footerText },
                    [button.url('👑 Chat Owner', `https://wa.me/${config.ownerNumber[0]}`)], m);
            }
            let created;
            try { created = await payment.createRentOrder({ groupJid, inviteCode: isGroup ? '' : inviteCode, groupName: name, owner: senderNumber, chat: from, durationMs }); }
            catch (err) { return await reply(`❌ Gagal membuat tagihan: ${err.message}`); }

            const { order, trx } = created;
            const caption =
                `╭───「 💳 *TAGIHAN SEWA BOT* 」\n` +
                `│ 👥 Grup   : ${name || '-'}\n` +
                `│ 👑 Penyewa: +${senderNumber}\n` +
                `│ ⌛ Durasi : ${formatDuration(durationMs)}\n` +
                promotions.invoiceLine(order, rupiah) +
                `│ 💰 *Bayar : ${rupiah(order.amount)}* (tepat, termasuk kode unik)\n` +
                `│ ⏱️ Batas  : ${formatDateTime(new Date(order.expiresAt))}\n` +
                `│ 🧾 ID     : ${order.trxId}\n` +
                `╰────────────────────────\n\n` +
                `Scan QRIS di atas. Setelah lunas, *bot otomatis ${isGroup ? 'diaktifkan di grup ini' : 'masuk ke grup dan aktif'}*.`;
            return await payment.sendInvoice(sock, from, m, order, trx, caption);
        }

        /* ───── .sewabot / .sewa  → menu paket dengan tombol ───── */
        const pkgRows = (suffix) => Object.entries(S.price.packages).map(([k, price]) => ({
            header: 'PAKET', title: `${k} • ${free ? 'GRATIS' : rupiah(promotions.quote('rent', price).price)}`.slice(0, 24), description: `${daysOf(k)} hari${free ? ' • GRATIS untukmu' : promotions.discount('rent') ? ` • Diskon ${promotions.discount('rent')}%` : ''}`, id: `${prefix}sewapay ${k}${suffix}`
        }));

        if (isGroup) {
            const status = rental.isActive(group) ? `✅ Aktif s/d ${group.rent.expire ? formatDateTime(new Date(group.rent.expire)) : 'permanen'}\n_Memilih paket = memperpanjang (masa baru ditambahkan)._` : '❌ Belum menyewa';
            return await sock.sendUniversalButton(from, {
                title: '🏷️ SEWA BOT',
                body: `*Grup:* ${groupName}\n*Status:* ${status}\n\n${payment.priceListText(prefix, S.price, 'HARGA SEWA', false)}\n\nPilih paket di bawah, bayar via QRIS, bot otomatis aktif.${customHint}`,
                footer: config.footerText
            }, [button.list('💰 Pilih Paket Sewa', [{ title: 'Paket Sewa', rows: pkgRows('') }]), button.quick('ℹ️ Cek Status', `${prefix}ceksewa`)], m);
        }

        if (inviteCode) {
            let info;
            try { info = await rental.inviteInfo(sock, inviteCode); } catch (err) { return await reply(`❌ ${err.message}`); }
            return await sock.sendUniversalButton(from, {
                title: '🏷️ SEWA BOT',
                body: `*Grup:* ${info.subject || '-'}\n*Anggota:* ${info.size ?? '-'}\n\n${payment.priceListText(prefix, S.price, 'HARGA SEWA', false)}\n\nPilih paket di bawah. Setelah lunas, bot *masuk ke grup otomatis*.${customHint}`,
                footer: config.footerText
            }, [button.list('💰 Pilih Paket Sewa', [{ title: 'Paket Sewa', rows: pkgRows(` https://chat.whatsapp.com/${inviteCode}`) }])], m);
        }

        await sock.sendUniversalButton(from, {
            title: '🏷️ SEWA BOT OTOMATIS',
            body: `*Cara sewa (semua otomatis):*\n1. Kirim link grup:\n   *${prefix}sewabot https://chat.whatsapp.com/xxxx*\n2. Pilih paket lewat tombol\n3. Bayar QRIS\n4. Bot masuk grup & aktif sendiri\n\n_Atau ketik *${prefix}sewabot* langsung di grup yang bot-nya sudah ada, untuk perpanjang._\n\n${payment.priceListText(prefix, S.price, 'HARGA SEWA', false)}`,
            footer: config.footerText
        }, [button.copy('📋 Salin Contoh Perintah', `${prefix}sewabot https://chat.whatsapp.com/`), button.quick('ℹ️ Sewa Saya', `${prefix}ceksewa`)], m);
    }
};
