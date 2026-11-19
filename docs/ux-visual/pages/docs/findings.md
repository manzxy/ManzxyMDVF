# docs — findings

## Verdict

- **1440x900 / 768x1024**: sehat. `overflowX` 0, tabel muat, `pre` scroll sendiri.
- **390x844 / 360x800**: **P0 — overflow horizontal**. `overflowX` 106px (390) / 136px (360).
  Penyebab: 9 `<table>` dengan `width:100%` di dalam `.ep` / `.wrap`, kolom `th/td` tidak bisa
  menyusut di bawah konten terpanjang (`td` terakhir 104px). Tidak ada wrapper scroll, jadi
  tabel melebar 409px di viewport 390px dan mendorong seluruh halaman ke kanan.
  Kontras: `<pre>` di halaman yang sama sudah benar (`overflow-x:auto`).

## Table

| id | level | element | problem | norm | evidence | severity |
|---|---|---|---|---|---|---|
| DOC-1 | layout | `table` (9 buah, `docs.html`) | Tabel `width:100%` tanpa wrapper scroll; lebar intrinsik kolom melampaui viewport → halaman scroll horizontal 106–136px | L6 | shots/390x844-before.png; DOM 390: table w=409 right=425 (vw 390); 360: overflowX=136 | **P0** |

## Fix (diterapkan)

Pola yang sama dengan `pre`: setiap tabel dibungkus `.tbl-scroll` dengan `overflow-x:auto`.
Tabel tetap boleh lebih lebar dari viewport, tapi scroll terjadi **di dalam** wrapper,
bukan di halaman. `min-width` dipertahankan agar baris tidak dipecah jadi dua baris.

## Excellent as is

- `pre` blok kode sudah `overflow-x:auto` — tidak ada overflow dari sana.
- TOC chip, `.ep` card, dan hierarki heading rapi di semua viewport.
- Kontras tinggi (hitam di cream), konsisten dengan landing.
