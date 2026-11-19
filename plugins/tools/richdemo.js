/**
 * Plugin: Rich Demo (AI Rich Response)
 * Menampilkan SEMUA 9 tipe blok WhatsApp AI Rich Response dalam satu balon pesan,
 * persis seperti cara Meta AI merender jawabannya:
 * teks, tabel, kode, gambar inline, grid gambar, LaTeX, peta, GIF dinamis, carousel reel.
 */
const rich = require('../../lib/wa/rich');

module.exports = {
    name: 'Rich Demo',
    command: ['richdemo', 'richresponse'],
    category: 'tools',
    description: 'Demo semua tipe blok AI Rich Response (tabel, kode, LaTeX, peta, dll)',
    usage: '.richdemo',

    async execute(sock, m, { reply, from }) {
        const parts = [
            // 1. TEKS — dukung *tebal*, _miring_, ```kode```
            rich.text('🤖 *Demo AI Rich Response*\nSemua tipe blok dalam satu pesan, persis seperti Meta AI.'),

            // 2. TABEL — baris pertama otomatis jadi header
            rich.table([
                ['Blok', 'Tipe', 'Status'],
                ['Teks', 'TEXT', '✅'],
                ['Tabel', 'TABLE', '✅'],
                ['Kode', 'CODE', '✅'],
                ['LaTeX', 'LATEX', '✅']
            ], { title: 'Ringkasan Blok' }),

            // 3. KODE — dengan bahasa + highlight
            rich.code('const halo = (nama) => `Hai, ${nama}!`;\nconsole.log(halo("dunia"));', { language: 'javascript', highlight: 'KEYWORD' }),

            // 4. LATEX — rumus dirender klien (pakai url renderer agar tampil sempurna)
            rich.text('Rumus energi terkenal:'),
            rich.latex(
                { expression: 'E = mc^2', url: 'https://latex.codecogs.com/png.image?\\dpi{150}E=mc^2', width: 90, height: 40, fontHeight: 30 },
                { text: 'Fisika dasar' }
            ),

            // 5. PETA — dengan titik penanda + info list
            rich.text('Contoh peta (Monas, Jakarta):'),
            rich.map(-6.175392, 106.827153, [
                { latitude: -6.175392, longitude: 106.827153, title: 'Monas', body: 'Monumen Nasional' }
            ], { latitudeDelta: 0.02, longitudeDelta: 0.02, showInfoList: true }),

            // 6. GAMBAR INLINE — bisa left/right/center + caption
            rich.image('https://picsum.photos/id/237/400/300', { alignment: 'center', caption: 'Gambar inline' }),

            // 7. GRID GAMBAR — beberapa gambar sekaligus
            rich.gridImages([
                'https://picsum.photos/id/1015/300/200',
                'https://picsum.photos/id/1016/300/200',
                'https://picsum.photos/id/1018/300/200'
            ]),

            // 8. DYNAMIC — GIF/gambar beranimasi
            rich.dynamic('https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif', { type: 'gif', loopCount: 3 }),

            // 9. CONTENT ITEMS — carousel reel ala Meta AI
            rich.contentItems([
                { title: 'Reel Demo 1', thumbnailUrl: 'https://picsum.photos/id/1025/200/200', videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4' },
                { title: 'Reel Demo 2', thumbnailUrl: 'https://picsum.photos/id/1024/200/200', videoUrl: 'https://www.w3schools.com/html/movie.mp4' }
            ], { contentType: 'carousel' }),

            rich.text('_Selesai — 9/9 tipe blok terkirim ✅_')
        ];

        try {
            await rich.send(sock, from, parts, { quoted: m });
        } catch (err) {
            // Perangkat/Baileys tidak mendukung → jatuh ke teks biasa
            await reply(`⚠️ Rich response gagal dikirim (${err.message}).\n\nBerikut versi teks:\n\n${rich.toPlainText(parts)}`);
        }
    }
};
