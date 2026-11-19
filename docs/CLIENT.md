# 📘 Client API — Cara Mudah Bikin Plugin

Semua plugin ManzxyMD sekarang dapat **`client`** di ctx. Ini API paling ramah:
**tidak perlu isi `jid` dan `quoted` manual** — otomatis mengarah ke chat & pesan yang sedang diproses.

```js
// plugins/tools/contoh.js
module.exports = {
    name: 'Contoh',
    command: ['contoh'],
    category: 'tools',
    async execute(sock, m, { client: c, text, reply }) {
        await c.text('halo!');            // kirim ke chat ini
        await c.reply('balasanmu');       // quote pesan user
        await c.react('🔥');              // reaksi pesan user
    },
};
```

## 📤 Kirim ke chat ini (tanpa isi jid)

| Method | Fungsi | Contoh |
|---|---|---|
| `c.text(teks, opts?)` | Teks biasa | `await c.text('halo')` |
| `c.reply(teks, opts?)` | Balas (quote) pesan user | `await c.reply('ini balasan')` |
| `c.image(src, opts?)` | Gambar — `src` = URL / Buffer / path | `await c.image(url, { caption: 'keren' })` |
| `c.video(src, opts?)` | Video (`{ gif: true }` → GIF) | `await c.video(url, { caption })` |
| `c.audio(src, opts?)` | Audio/musik | `await c.audio(url)` |
| `c.voice(src, opts?)` | Voice note (PTT) | `await c.voice(buffer)` |
| `c.sticker(src, opts?)` | Sticker (webp) | `await c.sticker(buf)` |
| `c.document(src, namaFile, opts?)` | Dokumen | `await c.document(buf, 'hasil.pdf', { mimetype })` |
| `c.poll(judul, opsi, opts?)` | Polling (2–12 opsi) | `await c.poll('Pilih', ['A','B'])` |
| `c.contact(kontak, opts?)` | Kontak/vCard | `await c.contact([{ name: 'Budi', number: '628xx' }])` |
| `c.location(lat, lng, opts?)` | Lokasi | `await c.location(-6.2, 106.8, { name: 'Monas' })` |
| `c.textTo(jid/No, teks)` | Kirim ke chat lain | `await c.textTo('628xx', 'psst')` |

## ⚡ Aksi pada pesan

| Method | Fungsi |
|---|---|
| `c.react(emoji)` | Reaksi pesan user |
| `c.edit(teksBaru, key?)` | Edit pesan bot — tanpa `key` = pesan bot terakhir yang dikirim client |
| `c.del(key?)` | Hapus pesan — tanpa `key` = pesan yang di-reply user |
| `c.forward(msg?, jid?)` | Teruskan pesan (default: yang di-reply user) |
| `c.typing(fn)` | Tampilkan "mengetik…" selama `fn` jalan: `await c.typing(async () => berat())` |

## 📥 Media

| Method | Fungsi |
|---|---|
| `c.download()` | Unduh media yang dikirim user → `Buffer` |
| `c.downloadQuoted()` | Unduh media dari pesan yang di-reply user → `Buffer` |
| `c.fetchBuffer(url/path)` | Buffer dari URL/path |

## 🎨 Rich Response (AIRichResponse ala Meta AI)

Pesan berformat kaya dalam SATU balon: teks bergaya, tabel, blok kode, gambar, LaTeX, peta.

```js
const rich = require('../lib/rich');
await c.rich([
    rich.text('Ringkasan hari ini'),
    rich.table([['Item', 'Harga'], ['Kopi', '18.000']], { title: 'Menu' }),
    rich.code('const x = 1;', { language: 'javascript' }),
]);
```

Atau pakai shorthand yang sudah disediakan client:

| Method | Fungsi |
|---|---|
| `c.richText(teks)` | Teks bergaya AI (`*tebal*`, `_miring_`, `` `kode` ``, list) |
| `c.richTable(rows, { title })` | Tabel: `[[header...], [baris...]]` |
| `c.richCode(kode, { language })` | Blok kode dengan syntax highlight |
| `c.richImage(url)` | Gambar inline dalam balon |
| `c.richGrid(urls)` | Grid banyak gambar |
| `c.richLatex(rumus)` | Rumus LaTeX dirender WhatsApp |
| `c.richMap(lat, lng)` | Peta dalam balon |
| `c.rich([blok...])` | Gabung semua blok di atas sekaligus |

## ℹ️ Info

| Method | Fungsi |
|---|---|
| `c.chat` | JID chat saat ini |
| `c.sender` | Nomor pengirim (628xx) |
| `c.botNumber` | Nomor bot |
| `c.jid('08xx')` | Ubah nomor apa pun → jid user |
| `c.onWa('628xx')` | Cek nomor terdaftar WA → `true/false` |
| `c.profilePic(jid?)` | URL foto profil (null kalau kosong) |
| `c.groupMeta()` | Metadata grup chat ini (null kalau bukan grup) |

## 💡 Contoh nyata: command download media

```js
module.exports = {
    name: 'Ambil Media',
    commands: ['ambil'],
    category: 'tools',
    async execute(sock, m, { client: c, quoted, reply }) {
        const buf = quoted ? await c.downloadQuoted() : await c.download();
        if (!buf) return await reply('Kirim/reply media dengan caption .ambil');
        await c.typing(async () => {
            await c.document(buf, `media-${Date.now()}.bin`);
        });
    },
};
```

## 🔗 Lapisan bawah

Butuh kontrol penuh? Semua ini tetap tersedia:

- `sock.reply/sendPoll/sendUniversalButton/sendCarousel` — helper rich bawaan bot (`lib/rich.js`)
- `require('../lib/waWrapper')` — wrapper Baileys 7 lengkap (50+ helper, retry otomatis)
- `sock.sendMessage(...)` — Baileys mentah
