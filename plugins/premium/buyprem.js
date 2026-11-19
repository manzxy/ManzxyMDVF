const config = require('../../config');
const payment = require('../../lib/billing/payment');
const promotions = require('../../lib/billing/promotions');
const { button } = require('../../lib/wa/rich');
const { parseDuration, formatDuration, rupiah, formatDateTime, normalizePhone } = require('../../lib/core/utils');

/* ───────── Harga premium: Rp2.000 per hari, Rp1.000 per jam; sisa jam tidak lebih mahal dari 1 hari ───────── */
function priceFor(durationMs) {
    const p = config.premium.price;
    const hours = Math.ceil(durationMs / 3600000);
    const days = Math.floor(hours / 24);
    const rem = hours - days * 24;
    return days * p.perDay + Math.min(rem * p.perHour, p.perDay);
}

/** '' jika valid, selain itu pesan error. */
function validate(durationMs) {
    const p = config.premium.price;
    if (!durationMs) return 'Durasi wajib diisi. Contoh: 1h (1 jam), 12h, 7d, 30d, 1y, 1d12h.';
    if (durationMs < p.minHours * 3600000) return `Durasi minimal ${p.minHours} jam.`;
    if (durationMs > p.maxDays * 86400000) return `Durasi maksimal ${p.maxDays} hari (±${Math.floor(p.maxDays / 365)} tahun).`;
    return '';
}

const priceTable = () => [['1h', '1 jam'], ['6h', '6 jam'], ['12h', '12 jam'], ['1d', '1 hari'], ['3d', '3 hari'], ['7d', '7 hari'], ['30d', '30 hari'], ['90d', '90 hari'], ['1y', '1 tahun']]
    .map(([key, label]) => ({ key, label, price: priceFor(parseDuration(key)) }));

module.exports = {
    name: 'Beli Premium',
    command: ['buyprem', 'beliprem', 'cekprem'],
    category: 'premium',
    description: 'Beli Premium (limit unlimited + jadibot gratis). Durasi bebas: jam, hari, hingga tahunan',
    usage: '.buyprem <durasi>',
    async execute(sock, m, ctx) {
        const { from, command, args, senderNumber, user, isOwner, isUnlimited, prefix, config, reply } = ctx;

        /* ───── .cekprem ───── */
        if (command === 'cekprem') {
            const pr = user?.premium;
            const lim = user ? `${user.limit.used}/${user.limit.max}` : '-';
            if (isOwner) return await reply('👑 Kamu *Owner* — limit & fitur *UNLIMITED* selamanya.');
            return await reply(ctx.isPremium
                ? `⭐ *PREMIUM AKTIF*\n• Berakhir : ${pr.expire ? formatDateTime(new Date(pr.expire)) : 'Permanen'}\n• Limit    : UNLIMITED\n• Jadibot  : gratis`
                : `🆓 *User biasa*\n• Limit hari ini : ${lim}\n• Premium : tidak aktif\n\nBeli premium: *${prefix}buyprem*`);
        }

        if (!config.premium.enabled) return await reply('❌ Fitur premium dinonaktifkan.');
        if (isOwner) return await reply('👑 Owner sudah *UNLIMITED* — tidak perlu beli premium.');

        // argumen: [nomor] <durasi>
        let target = senderNumber;
        const giftArg = args.find((a) => /^\+?[\d\s-]{8,}$/.test(a));
        if (giftArg) target = normalizePhone(giftArg);
        const durTok = args.find((a) => parseDuration(a));
        const durationMs = parseDuration(durTok);

        /* ───── tanpa durasi → daftar harga + button list ───── */
        if (!durationMs) {
            const rows = priceTable().map((t) => ({ header: 'PREMIUM', title: `${t.label} • ${rupiah(promotions.quote('prem', t.price).price)}`.slice(0, 24), description: `Limit unlimited + jadibot gratis${promotions.discount('prem') ? ` • diskon ${promotions.discount('prem')}%` : ''}`, id: `${prefix}buyprem ${t.key}${target !== senderNumber ? ' ' + target : ''}` }));
            const p = config.premium.price;
            const status = ctx.isPremium ? `\n⭐ Premium kamu aktif s/d ${user.premium.expire ? formatDateTime(new Date(user.premium.expire)) : 'permanen'} (beli lagi = diperpanjang)` : '';
            return await sock.sendUniversalButton(from, {
                title: '⭐ BELI PREMIUM',
                body:
                    `*Keuntungan Premium:*\n• Limit harian *UNLIMITED* (user biasa ${config.limit.daily}/hari)\n• Jadibot *gratis*\n\n` +
                    `*Harga:*\n• 1 hari  = ${promotions.priceText('prem', p.perDay, rupiah)}\n• 1 jam   = ${promotions.priceText('prem', p.perHour, rupiah)}\n_(sisa jam tidak pernah lebih mahal dari 1 hari)_\n\n` +
                    `*Durasi custom (bebas, hingga tahunan):*\n${prefix}buyprem 3d  •  ${prefix}buyprem 12h  •  ${prefix}buyprem 1y  •  ${prefix}buyprem 1d6h\n` +
                    `Hadiahkan ke nomor lain: ${prefix}buyprem 628xxx 30d${status}`,
                footer: config.footerText
            }, [button.list('⭐ Pilih Durasi', [{ title: 'Paket cepat', rows }]), button.quick('ℹ️ Status Premium', `${prefix}cekprem`)], m);
        }

        const bad = validate(durationMs);
        if (bad) return await reply(`❌ ${bad}`);
        if (target.length < 8 || target.length > 15) return await reply('❌ Nomor tujuan tidak valid.');

        if (!payment.isEnabled()) {
            return await sock.sendUniversalButton(from, { title: '💳 BELI PREMIUM', body: 'Pembayaran otomatis belum aktif. Silakan hubungi owner.', footer: config.footerText },
                [button.url('👑 Chat Owner', `https://wa.me/${config.ownerNumber[0]}`)], m);
        }
        const pending = payment.findPendingPrem(senderNumber, target);
        if (pending) return await payment.sendPendingNotice(sock, from, m, pending, 'premium');

        let created;
        try { created = await payment.createPremOrder({ target, owner: senderNumber, chat: from, durationMs, price: priceFor(durationMs) }); }
        catch (err) { return await reply(`❌ Gagal membuat tagihan: ${err.message}`); }

        const { order, trx } = created;
        const caption =
            `╭───「 💳 *TAGIHAN PREMIUM* 」\n` +
            `│ ⭐ Untuk   : +${target}${target !== senderNumber ? ' (hadiah)' : ''}\n` +
            `│ ⌛ Durasi  : ${formatDuration(durationMs)}\n` +
            promotions.invoiceLine(order, rupiah) +
            `│ 💰 *Bayar  : ${rupiah(order.amount)}* (tepat, termasuk kode unik)\n` +
            `│ ⏱️ Batas   : ${formatDateTime(new Date(order.expiresAt))}\n` +
            `│ 🧾 ID      : ${order.trxId}\n` +
            `╰────────────────────────\n\nScan QRIS di atas. Setelah lunas, *premium aktif otomatis*.`;
        await payment.sendInvoice(sock, from, m, order, trx, caption);
    }
    ,
    _priceFor: priceFor, _validate: validate
};
