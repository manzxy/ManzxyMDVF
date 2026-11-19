# DOC-1 — verifikasi

**Cluster**: tabel overflow horizontal di `/docs` pada mobile
**Perubahan**: `lib/web/public/docs.html`
1. `.tbl-scroll { overflow-x: auto }` — wrapper scroll, pola sama dengan `pre`.
2. 9 `<table>` dibungkus `.tbl-scroll`.
3. Tabel yang terukur terpotong (5 dari 9) diberi `table[data-wide]`, dan
   `@media (max-width:767px) .tbl-scroll:has(table[data-wide])` menambahkan
   `mask-image` fade di tepi kanan sebagai isyarat bisa digeser (pola yang sama
   dipakai `.tabs` di panel).

## Acceptance criteria

| Kriteria | Target | Sebelum | Sesudah | Hasil |
|---|---|---|---|---|
| `documentElement.scrollWidth - innerWidth` @390 | 0 | 106px | **0** | PASS |
| sama @360 | 0 | 136px | **0** | PASS |
| sama @768 | 0 | 0 | 0 | PASS |
| sama @1440 | 0 | 0 | 0 | PASS |
| Tabel terpotong tetap terbaca (scroll internal) | wrapper `scrollWidth > clientWidth` hanya di wrapper | — | 5 wrapper @390, 7 @360 | PASS |
| Fade hint hanya pada tabel terpotong, hanya mobile | 5 @≤767, 0 @≥768 | — | 5 @390/360, 0 @768/1440 | PASS |
| Tidak ada regresi halaman lain | overflowX 0 | — | `/` `/status` `/panel` `/docs` semua 0 di 4 viewport | PASS |

## Screenshot

- `shots/390x844-before.png` (overflow 106px)
- `shots/390x844-after.png`, `shots/360x800-after.png`, `shots/768x1024-after.png`, `shots/1440x900-after.png`
- `shots/390x844-table-final.png`, `shots/360x800-table-final.png`, `shots/1440x900-table-final.png`

## Test

`npm test` → 92 pass, 0 fail.

## Catatan

`look_at_image` mengonfirmasi tidak ada elemen yang keluar dari tepi layar dan fade
muncul di tabel terpotong. Overlap tabel-scroll tidak dianggap pelanggaran: tabel
memang lebih lebar dari layar HP, tapi scroll terjadi di dalam wrapper sehingga
halaman tidak ikut bergeser (terukur `overflowX = 0`).
