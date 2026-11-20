/**
 * PERPANJANG & UPGRADE WAKTU — Premium & Jadibot (satu perintah untuk keduanya).
 *
 *   .perpanjang                          → daftar langgananmu (button list)
 *   .perpanjang prem                     → pilih durasi premium
 *   .perpanjang jadibot [nomor]          → pilih durasi jadibot
 *   .perpanjang <jenis> [target] <durasi> → langsung buat tagihan QRIS (mis. 30d, 1y, 1d12h)
 *
 * Tombol di pesan pengingat (lib/renewal.js) memanggil perintah ini. Semua pemeriksaan hak akses, harga, dan
 * durasi dilakukan ULANG di sini & di lib/renewal.js — isi tombol tidak dipercaya.
 */
const renewal = require('../../lib/billing/renewal');
const payment = require('../../lib/billing/payment');
const promotions = require('../../lib/billing/promotions');
const { button } = require('../../lib/wa/rich');
const { parseDuration, formatDuration, rupiah, formatDateTime, normalizePhone } = require('../../lib/core/utils');

const isDuration = (t) => parseDuration(t) > 0;

function resolveTarget(kind, tokens, ctx) {
    if (kind === 'prem') return ctx.senderNumber;                       // premium hanya untuk diri sendiri
    const t = tokens.find((x) => /^\+?[\d\s-]{8,}$/.test(x) && !isDuration(x));
    if (t) return normalizePhone(t);
    const mine = renewal.listOwned(ctx.senderNumber, ctx.isRootOwner).filter((e) => e.kind === kind);
    return mine.length === 1 ? mine[0].target : '';
}

const howToBuy = (kind, prefix) => ({
    prem: `Beli premium dulu: *${prefix}buyprem*`,
    jadibot: `Buat dulu: *${prefix}jadibot <nomor> <durasi>*`
}[kind]);

module.exports = {
    name: 'Perpanjang & Upgrade Waktu',
    command: ['perpanjang', 'renew', 'upgrade', 'tambahwaktu', 'langganan'],
    category: 'premium',
    order: 3,
    limit: 0,
    description: 'Perpanjang / tambah waktu Premium & Jadibot — QRIS langsung, masa baru ditambahkan ke sisa waktu',
    usage: '.perpanjang [prem|jadibot] [target] [durasi]',
    async execute(sock, m, ctx) {
        const { from, command, args, senderNumber, isOwner, isRootOwner, isPremium, isGroup, isAdmin, prefix, config, reply } = ctx;
        const upgrade = command === 'upgrade' || command === 'tambahwaktu';
        const heading = upgrade ? '⬆️ UPGRADE WAKTU' : '🔄 PERPANJANG';

        if (sock.isJadibot) return await reply('❌ Perpanjang hanya lewat bot utama.');
        if (!config.renewal?.enabled) return await reply('❌ Fitur perpanjangan dinonaktifkan.');

        /* ───── tanpa argumen → daftar langganan ───── */
        if (!args[0]) {
            const mine = renewal.listOwned(senderNumber, isRootOwner);
            if (!mine.length) {
                return await reply(`Kamu belum punya langganan yang bisa diperpanjang.\n\n• Premium: *${prefix}buyprem*\n• Jadibot: *${prefix}jadibot <nomor> <durasi>*`);
            }
            const now = Date.now();
            const rows = mine.slice(0, 10).map((e) => ({
                header: renewal.KINDS[e.kind].label.toUpperCase(),
                title: e.label.slice(0, 24),
                description: (e.permanent ? 'Permanen' : e.expire > now ? `Sisa ${formatDuration(e.expire - now)}` : 'SUDAH HABIS').slice(0, 72),
                id: `${prefix}perpanjang ${renewal.KINDS[e.kind].cmd}${e.kind === 'prem' ? '' : ' ' + e.target}`
            }));
            const body = mine.slice(0, 10).map((e) => renewal.infoLines(e, now)).join('\n\n');
            return await sock.sendUniversalButton(from, {
                title: `${heading}`,
                body: `${body}\n\nPilih langganan yang ingin ditambah waktunya. Masa baru *ditambahkan* ke sisa waktu (tidak hangus).`,
                footer: config.footerText
            }, [button.list('📋 Pilih Langganan', [{ title: 'Langgananmu', rows }])], m);
        }

        const kind = renewal.normalizeKind(args[0]);
        if (!kind) return await reply(`❌ Jenis tidak dikenal. Pakai: *${prefix}perpanjang prem* atau *${prefix}perpanjang jadibot*.`);
        const tokens = args.slice(1);
        const K = renewal.KINDS[kind];

        const target = resolveTarget(kind, tokens, ctx);
        if (!target) {
            return await reply(`❌ Tentukan nomor jadibot: *${prefix}perpanjang jadibot 628xxx*, atau pilih dari *${prefix}perpanjang*.`);
        }

        const ent = renewal.getEntity(kind, target);
        if (!ent) return await reply(`❌ ${K.label} tidak ditemukan.\n${howToBuy(kind, prefix)}`);
        if (!renewal.canManage(ent, { senderNumber, isRootOwner, isAdmin, isGroup, from })) {
            return await reply(kind === 'prem' ? '❌ Premium hanya bisa diperpanjang oleh pemiliknya. Untuk hadiah ke orang lain: *.buyprem <nomor> <durasi>*.'
                : `❌ Hanya pemilik jadibot (+${ent.owner || '-'}) atau Root Owner yang bisa memperpanjang ini.`);
        }
        if (ent.permanent) return await reply(`♾️ ${ent.label} berstatus *permanen* — tidak perlu diperpanjang.`);
        if (kind === 'prem' && isOwner) return await reply('👑 Owner sudah *UNLIMITED* — tidak perlu premium.');

        const free = renewal.isFree(kind, { isRootOwner, isOwner, isPremium });
        const durTok = tokens.find(isDuration);
        const durationMs = durTok ? parseDuration(durTok) : 0;
        const tArg = kind === 'prem' ? '' : ` ${target}`;

        /* ───── tanpa durasi → pilihan paket ───── */
        if (!durationMs) {
            const rows = renewal.packageRows(kind, kind === 'prem' ? '' : target, ent, free);
            if (!rows.length) return await reply('❌ Tidak ada paket yang tersedia. Hubungi owner.');
            const btns = [button.list('💰 Pilih Durasi', [{ title: `Tambah waktu ${K.label}`, rows }]), ...renewal.renewButtons(kind, target, ent).slice(0, 1)];
            return await sock.sendUniversalButton(from, {
                title: heading,
                body:
                    `${renewal.infoLines(ent)}\n\n` +
                    `Pilih durasi tambahan${free ? ' — *GRATIS untukmu*' : ''}. Masa baru *ditambahkan* ke sisa waktu.\n` +
                    `Durasi custom: *${prefix}perpanjang ${K.cmd}${tArg} 45d*  •  *1y*  •  *1d12h*`,
                footer: config.footerText
            }, btns, m);
        }

        /* ───── dengan durasi → validasi & proses ───── */
        const bad = renewal.validate(kind, durationMs);
        if (bad) return await reply(`❌ ${bad}`);
        const newExpire = renewal.previewExpire(ent, durationMs);

        const res = await renewal.withLock(`renew:${kind}:${target}`, async () => {
            const pending = payment.findPendingRenew(kind, target);
            if (pending) {
                if (pending.owner === senderNumber) return await payment.sendPendingNotice(sock, from, m, pending, `perpanjangan ${ent.label}`);
                return await reply(`⏳ Sudah ada tagihan perpanjangan aktif untuk ${ent.label} (oleh +${pending.owner}). Tunggu sampai dibayar atau kedaluwarsa.`);
            }
            // ── gratis (Owner / Premium sesuai config / promo jadibot) ──
            if (free) {
                await reply(`⏳ Memperpanjang ${ent.label} ...`);
                try {
                    const r = await renewal.applyExtension(kind, target, durationMs, { sock, handleIncomingMessage: ctx.handleIncomingMessage, by: senderNumber });
                    return await reply(`✅ ${ent.label} diperpanjang *${formatDuration(durationMs)}* (gratis).\n📅 Aktif sampai: *${formatDateTime(new Date(r.expire))}*${r.note}`);
                } catch (err) { return await reply(`❌ Gagal: ${err.message}`); }
            }

            // ── berbayar ──
            if (!payment.isEnabled()) {
                return await sock.sendUniversalButton(from, { title: '💳 PERPANJANG', body: 'Pembayaran otomatis belum aktif. Silakan hubungi owner.', footer: config.footerText },
                    [button.url('👑 Chat Owner', `https://wa.me/${config.ownerNumber[0]}`)], m);
            }
            let created;
            try { created = await payment.createRenewOrder({ kind, target, targetLabel: ent.label, owner: senderNumber, chat: from, durationMs, price: renewal.priceOf(kind, durationMs) }); }
            catch (err) { return await reply(`❌ Gagal membuat tagihan: ${err.message}`); }

            const { order, trx } = created;
            const caption =
                `╭───「 💳 *TAGIHAN PERPANJANGAN* 」\n` +
                `│ ${K.icon} ${K.label} : ${ent.label}\n` +
                `│ ➕ Tambah    : ${formatDuration(durationMs)}\n` +
                `│ 📅 Aktif s/d : ${formatDateTime(new Date(newExpire))}\n` +
                promotions.invoiceLine(order, rupiah) +
                `│ 💰 *Bayar    : ${rupiah(order.amount)}* (tepat, termasuk kode unik)\n` +
                `│ ⏱️ Batas     : ${formatDateTime(new Date(order.expiresAt))}\n` +
                `│ 🧾 ID        : ${order.trxId}\n` +
                `╰────────────────────────\n\nScan QRIS di atas. Setelah lunas, masa aktif *bertambah otomatis*.`;
            await payment.sendInvoice(sock, from, m, order, trx, caption);
        });
        if (res.busy) await reply('⏳ Permintaan perpanjangan untuk ini sedang diproses, tunggu sebentar.');
    }
};
