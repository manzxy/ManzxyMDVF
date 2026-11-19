# Migrasi Baileys → zapo-js

## Status

Jalur zapo sudah dibangun dan **teruji offline**, tetapi **belum diaktifkan** pada bot produksi.
Bot tetap berjalan normal dengan Baileys (default). Ini disengaja: cutover menyangkut sesi WhatsApp
nyata dan tidak bisa dibatalkan dengan mudah.

## Yang sudah ada

| File | Fungsi |
|---|---|
| `lib/zapoCompat.js` | Adapter: event zapo → event Baileys, `sendMessage` Baileys → `client.message.send`, facade `sock`, migrator sesi |
| `lib/zapoEngine.js` | Bootstrap `WaClient` + store sqlite + pairing + reconnect |
| `index.js` | Cabang `startBotZapo()` aktif hanya bila `WA_ENGINE=zapo` |
| `lib/projectWatcher.js` | `session_zapo` masuk ignore list (mencegah restart loop) |
| `scripts/migrate-session-zapo.js` | CLI migrasi sesi Baileys → sqlite zapo |
| `tests/zapo-compat.test.js` | 10 tes adapter |

## Verifikasi yang sudah dilakukan

- `npm run check` bersih; `npm test` **102 pass / 0 fail**.
- Boot zapo dengan sesi throwaway: WebSocket WhatsApp tersambung, QR dihasilkan, **0 restart loop**.
- Wire protobuf zapo vs Baileys: roundtrip **byte-identik** (tombol/kartu rich tetap kompatibel).
- Migrasi sesi pada **salinan** sesi produksi (834 file auth): berhasil, `losses: []`.

## Cara cutover (saat siap)

1. **Stop bot** supaya tidak ada dua proses yang memakai sesi yang sama:
   ```sh
   pm2 stop ManzxyMD
   ```

2. **Backup** sudah tersedia di `/root/backups/ManzxyBase-prezapo-20261118_161137/`
   (source + session + database). Buat backup baru bila sudah ada perubahan sejak itu.

3. **Migrasi sesi utama** (tanpa pairing ulang):
   ```sh
   cd /root/ManzxyBase
   node scripts/migrate-session-zapo.js
   ```

4. **Aktifkan zapo**:
   ```sh
   WA_ENGINE=zapo pm2 restart ManzxyMD --update-env
   ```

5. **Verifikasi** log: harus muncul `ZAPO · Menyambung sesi ...` lalu `✔ Sesi ... tersambung`,
   diikuti banner `BOT ONLINE` dengan akun yang sama.

## Rollback

```sh
pm2 stop ManzxyMD
# hapus/copy cadangan session_zapo bila perlu
pm2 restart ManzxyMD --update-env   # tanpa WA_ENGINE → kembali ke Baileys
```

Sesi Baileys lama (`session/`) sengaja **tidak dihapus**, sehingga rollback langsung bisa dipakai.

## Integrasi penuh paket resmi zapo (2026-11-18)

Versi terpasang `zapo-js@1.12.0` = latest npm. Paket resmi yang kini dipakai:

| Paket | Fungsi | Status |
| --- | --- | --- |
| `zapo-js` 1.12.0 | transport + 16 coordinator | aktif |
| `@zapo-js/store-sqlite` | sesi persisten sqlite | aktif |
| `@zapo-js/media-utils` | `createMediaProcessor()` — thumbnail, probe, waveform, voice-note | aktif (ffmpeg/ffprobe tersedia) |
| `@zapo-js/wam` | `wamPlugin()` — telemetry WAM untuk wire-parity | aktif |
| `@zapo-js/native` | akselerator crypto X25519/XEdDSA (WASM) | aktif, auto-detected |

`lib/zapoEngine.js` memasang `media.processor` dan `plugins: [wamPlugin()]` untuk
**semua** sesi (main + jadibot). Semua coordinator diekspos di `sock.zapo`
(auth, message, presence, chat, group, status, broadcastList, newsletter,
privacy, profile, business, bot, email, mobile, lowlevel, wam).

Perbaikan facade `lib/zapoCompat.js` dari audit dokumentasi:

- `sock.query()` — argumen `queryWithContext(context, node)` sebelumnya tertukar;
  ping plugin & health check connectionGuard sekarang memakai `client.lowlevel.query(node, timeoutMs)`.
- `sock.onWhatsApp()` — dulu mengembalikan mentah `SignalLidSyncResult`; kini di-map ke
  bentuk Baileys `{ jid, lid, exists }` (jadibot & `waWrapper.onWa` bergantung pada ini).
- `sock.fetchStatus()` — sekarang `client.profile.getStatus(jid)` (bukan no-op).
- `sock.rejectCall()` — sekarang kirim node `call` > `reject` via `client.lowlevel.sendNode`.
- `sock.chatModify()` — menerjemahkan `pushNameSetting` ke `profile.setPushName()`, plus mute/pin/archive/read.
- `signalRepository.lidMapping.getPNForLID()` — sekarang membaca contact store zapo
  (bukan lagi identitas), memberi mapping LID→PN yang benar untuk `lib/jid.js`.

## Yang belum terverifikasi

- Render tombol native-flow di klien WA clone lama (terbatas pada klien, bukan bot).
- Telemetri WAM tidak bisa diverifikasi visual dari server; hanya terpasang & tidak error.

## Catatan

`yt-search` sengaja **tidak dihapus** sesuai keputusan Anda. Modul "yv" tidak ada di source;
yang paling mirip adalah `yt-search` yang masih dipakai command `.ytsearch`, `.yts`, `.youtube`, `.ytinfo`.
