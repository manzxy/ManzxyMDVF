/**
 * DEMO CLIENT — contoh pemakaian API `client` yang ramah untuk pembuat plugin.
 * Semua method TIDAK perlu isi jid / quoted manual — otomatis mengarah ke chat & pesan ini.
 *
 * Kategori: tools (gratis). Command: .demo, .demomedia, .demopoll
 */
module.exports = {
    name: 'Demo Client',
    description: 'Contoh pemakaian API client (kirim, balas, reaksi, polling, unduh media).',
    command: ['demo', 'demomedia', 'demopoll'],
    category: 'tools',
    limit: 0,

    async execute(sock, m, { client: c, command, prefix, quoted, reply }) {
        if (command === 'demo') {
            // 1) teks biasa + balasan + reaksi — tanpa jid, tanpa quoted manual
            await c.text('👋 Ini *c.text()* — kirim teks biasa.');
            await c.reply('💬 Ini *c.reply()* — otomatis meng-quote pesanmu.');
            await c.react('⚡');
            await c.typing('…selesai! c.typing() menampilkan "mengetik…" selama proses berjalan.');
            return;
        }

        if (command === 'demopoll') {
            // 2) polling
            return await c.poll('Mau lihat fitur apa?', ['Album', 'Edit pesan', 'Hapus pesan', 'Unduh media'], { selectableCount: 1 });
        }

        if (command === 'demomedia') {
            // 3) unduh media yang kamu kirim/reply, lalu kirim ulang sebagai dokumen
            const buf = quoted ? await c.downloadQuoted().catch(() => null) : await c.download().catch(() => null);
            if (!buf) {
                return await reply(
                    `Kirim gambar/video/audio/dokumen dengan caption *${prefix}demomedia*,\n` +
                    `atau *reply* media lalu ketik *${prefix}demomedia*.`
                );
            }
            await c.typing(async () => {
                await c.document(buf, `media-${Date.now()}.bin`, { mimetype: 'application/octet-stream', caption: '📦 Media kamu, dikirim ulang sebagai dokumen oleh client API.' });
            });
        }
    },
};
