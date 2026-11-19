const { button } = require('../../lib/wa/rich');

/**
 * Uji SEMUA native-flow button yang didukung zapo-js / WhatsApp.
 *
 * zapo resolveNativeFlowAddonKind(): addon node ditentukan dari tombol PERTAMA:
 *   - quick_reply/cta_url/cta_copy/single_select/cta_call/cta_save_contact/
 *     share_phone_number/cta_catalog/cta_reminder → addon 'interactive'
 *   - payment_info   → addon 'payment_info'
 *   - review_and_pay → addon 'order_details'
 *   - form_message   → addon 'form_message'
 * Maka tiap grup dikirim terpisah supaya addon-nya benar.
 */
module.exports = {
    name: 'Tes Semua Tombol',
    command: ['allbutton', 'buttons'],
    category: 'interactive',
    description: 'Uji semua native-flow button zapo (quick, url, copy, list, call, contact, catalog, payment, form)',
    async execute(sock, m, { from, prefix, config }) {
        const send = (title, body, buttons) =>
            sock.sendUniversalButton(from, {
                title,
                body,
                footer: config.footerText,
                image: { url: config.thumbnailUrl }
            }, buttons, m);

        // Grup 1: tombol interaktif standar (addon 'interactive')
        await send(
            'NATIVE FLOW — INTERACTIVE',
            'Semua tombol di bawah memakai addon interactive. Klik untuk mencoba.',
            [
                button.quick('Quick Reply', `${prefix}ping`),
                button.url('Buka Web', config.sourceUrl || 'https://chat.perchai.app', true),
                button.copy('Copy Kode', 'FIXED-BUTTON-2026'),
                button.call('Telepon Owner', String((config.ownerNumber || [])[0] || '6280000000')),
                button.contact('Simpan Kontak', config.botName || 'ManzxyMD', String((config.ownerNumber || [])[0] || '6280000000')),
                button.catalog('Lihat Katalog'),
                button.reminder('Ingatkan', `${prefix}ping`),
                button.sharePhone('Bagikan Nomor'),
                button.list('Pilih Menu', [{ title: 'Contoh List', rows: [
                    { header: 'Menu', title: 'Menu Utama', description: 'Buka menu', id: `${prefix}menu` },
                    { header: 'Info', title: 'Ping', description: 'Cek status bot', id: `${prefix}ping` }
                ] }])
            ]
        );

        // Grup 2: payment_info (addon 'payment_info' — harus jadi tombol pertama)
        await send(
            'NATIVE FLOW — PAYMENT INFO',
            'Contoh tombol detail pembayaran (addon payment_info).',
            [button.paymentInfo('IDR', 25000)]
        );

        // Grup 3: review_and_pay (addon 'order_details')
        await send(
            'NATIVE FLOW — REVIEW & PAY',
            'Contoh tombol review & bayar (addon order_details).',
            [button.reviewAndPay('IDR', 50000, 'ORDER-CONTOH-001')]
        );

        // Grup 4: form_message (addon 'form_message')
        await send(
            'NATIVE FLOW — FORM',
            'Contoh tombol form input (addon form_message).',
            [button.form('kontak_form', 'Form Kontak', [
                { name: 'nama', label: 'Nama', type: 'text', required: true },
                { name: 'pesan', label: 'Pesan', type: 'text', required: false }
            ])]
        );
    }
};
