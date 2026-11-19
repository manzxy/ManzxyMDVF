const { jadibotSessions, listAllJadibots, getJadibotOwner, hasSavedSession, launchAndDeliver } = require('../../lib/bot/jadibotManager');
const payment = require('../../lib/billing/payment');
const promotions = require('../../lib/billing/promotions');
const { button } = require('../../lib/wa/rich');
const { parseDuration, formatDuration, normalizePhone, rupiah, formatDateTime } = require('../../lib/core/utils');

module.exports = {
    name: 'Buat Jadibot',
    command: ['jadibot'],
    category: 'jadibot',
    description: 'Buat jadibot untuk nomor lain (harga dan promo sesuai pengaturan owner)',
    usage: '.jadibot <nomor> [durasi]',
    async execute(sock, m, ctx) {
        const { from, args, senderNumber, isOwner, isRootOwner, isPremium, prefix, config, handleIncomingMessage } = ctx;
        const reply = ctx.reply;

        if (!config.jadibot.enabled) return await reply('❌ Fitur jadibot dinonaktifkan.');
        if (sock.isJadibot) return await reply('❌ Jadibot tidak bisa membuat jadibot lagi. Gunakan bot utama.');

        const privileged = (isOwner && config.jadibot.freeForOwner) || (isPremium && config.jadibot.freeForPremium);
        const free = privileged || (promotions.freeJadibot() && promotions.freeAvailable());

        // Tanpa argumen → petunjuk + daftar harga
        if (!args[0]) {
            return await reply(
                `*🤖 JADIBOT*\n\nFormat: *${prefix}jadibot <nomor> [durasi]*\n` +
                `• *nomor* = nomor yang akan dijadikan bot (62812xxx / 0812xxx)\n• *durasi* = 7d, 30d, 1mo, dst.\n\n` +
                `Kamu otomatis menjadi *owner* bot tersebut, dan kode pairing dikirim ke *nomor itu*.\n\n` +
                (free ? '🆓 Akunmu gratis jadibot (durasi boleh dikosongkan = permanen).' : payment.priceListText(prefix))
            );
        }

        const target = normalizePhone(args[0]);
        const promoFree = !privileged && promotions.freeJadibot() && promotions.freeAvailable(target);
        const targetFree = privileged || promoFree;
        if (target.length < 8 || target.length > 15) return await reply('❌ Nomor tidak valid. Contoh: *' + prefix + 'jadibot 628123456789 7d*');

        const durasiArg = args[1];
        const expireMs = durasiArg ? parseDuration(durasiArg) : 0;
        if (durasiArg && !expireMs) return await reply('❌ Durasi tidak valid. Pakai format: 30m, 12h, 7d, 2w, 1mo, 1y');

        // ── Pengecekan umum (sebelum bayar) ──
        const existing = jadibotSessions.get(target);
        if (existing?.state === 'open') return await reply(`❌ Nomor *+${target}* sudah aktif sebagai jadibot.`);
        const knownOwner = getJadibotOwner(target);
        if (knownOwner && knownOwner !== senderNumber && !isRootOwner) return await reply(`❌ Nomor *+${target}* sudah terdaftar sebagai jadibot milik orang lain.`);
        if (!isRootOwner) {
            const mine = listAllJadibots().filter((j) => j.owner === senderNumber && j.number !== target).length + payment.countPendingByOwner(senderNumber);
            if (mine >= config.jadibot.maxPerUser) return await reply(`❌ Batas jadibot per user: *${config.jadibot.maxPerUser}*. Hapus yang lama lewat *${prefix}listjadibot*.`);
        }
        if (!existing && jadibotSessions.size >= config.jadibot.max) return await reply('❌ Slot jadibot penuh. Coba lagi nanti atau hubungi owner.');

        // ── Lanjutkan sesi tersimpan milik sendiri (tanpa bayar ulang selama belum kedaluwarsa) ──
        const rec = ctx.db.data.jadibots[target];
        const resumable = hasSavedSession(target) && rec && (rec.owner === senderNumber || isRootOwner) && (!rec.expire || rec.expire > Date.now());
        if (resumable && !durasiArg) {
            await reply(`♻️ Menyambungkan kembali jadibot *+${target}*${rec.expire ? ` (aktif s/d ${formatDateTime(new Date(rec.expire))})` : ''} ...`);
            try {
                await launchAndDeliver({ parentSock: sock, targetNumber: target, ownerNumber: rec.owner || senderNumber, chatFrom: from, quotedMsg: m, handleIncomingMessage });
                return await reply('✅ Sesi tersimpan ditemukan, bot sedang disambungkan. Tunggu notifikasi berikutnya.');
            } catch (err) { return await reply(`❌ Gagal: ${err.message}`); }
        }

        const pending = payment.findPending(senderNumber, target);
        if (pending) return await payment.sendPendingNotice(sock, from, m, pending, `jadibot *+${target}*`);

        // ════════ JALUR GRATIS (Owner / Premium / promo global) ════════
        if (targetFree) {
            if (expireMs && payment.validateDuration(expireMs)) return await reply(`❌ ${payment.validateDuration(expireMs)}`);
            await reply(`⏳ Menyiapkan jadibot untuk *+${target}* ...`);
            try {
                const r = await launchAndDeliver({ parentSock: sock, targetNumber: target, ownerNumber: senderNumber, chatFrom: from, quotedMsg: m, expireMs, tier: privileged ? 'privileged' : 'free', handleIncomingMessage });
                const where = r.deliveredTo === 'target' ? `Kode pairing sudah dikirim ke *+${target}*.` : r.deliveredTo === 'owner' ? `Kode tidak bisa dikirim ke +${target}, jadi dikirim ke chat pribadimu — teruskan ke pemilik nomor.` : 'Sesi tersimpan dipulihkan.';
                return await reply(`✅ ${where}\n\n👑 Owner: *+${senderNumber}*\n⌛ Masa aktif: ${expireMs ? formatDuration(expireMs) : 'Permanen'}\n\nPemilik nomor cukup memasukkan kode di WhatsApp › Perangkat Tertaut.`);
            } catch (err) { return await reply(`❌ Gagal: ${err.message}`); }
        }

        // ════════ JALUR BERBAYAR ════════
        if (!payment.isEnabled()) {
            return await sock.sendUniversalButton(from, {
                title: '💳 JADIBOT BERBAYAR',
                body: 'Jadibot hanya gratis untuk Owner & Premium. Pembayaran otomatis belum aktif, silakan hubungi owner.',
                footer: config.footerText
            }, [button.url('👑 Chat Owner', `https://wa.me/${config.ownerNumber[0]}`)], m);
        }
        if (!durasiArg) return await reply(`❌ Durasi wajib diisi.\n\n${payment.priceListText(prefix)}`);
        const bad = payment.validateDuration(expireMs);
        if (bad) return await reply(`❌ ${bad}\n\n${payment.priceListText(prefix)}`);

        let created;
        try { created = await payment.createJadibotOrder({ target, owner: senderNumber, chat: from, durationMs: expireMs }); }
        catch (err) { return await reply(`❌ Gagal membuat tagihan: ${err.message}`); }

        const { order, trx } = created;
        const caption =
            `╭───「 💳 *TAGIHAN JADIBOT* 」\n` +
            `│ 📱 Nomor bot : +${target}\n` +
            `│ 👑 Owner     : +${senderNumber}\n` +
            `│ ⌛ Durasi    : ${formatDuration(expireMs)}\n` +
            promotions.invoiceLine(order, rupiah) +
            `│ 💰 *Bayar    : ${rupiah(order.amount)}* (tepat, sudah termasuk kode unik)\n` +
            `│ ⏱️ Batas     : ${formatDateTime(new Date(order.expiresAt))}\n` +
            `│ 🧾 ID        : ${order.trxId}\n` +
            `╰────────────────────────\n\n` +
            `Scan QRIS di atas. Setelah lunas, *kode pairing otomatis dikirim ke +${target}* dan kamu jadi owner botnya.`;

        await payment.sendInvoice(sock, from, m, order, trx, caption);      // gambar QRIS + tombol Batalkan / Cek Status
    }
};
