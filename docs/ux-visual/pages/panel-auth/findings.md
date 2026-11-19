# panel-auth — findings

## Verdict

- **1440x900 / 768x1024**: sehat. Card 440px + aside sejajar, tidak ada overflow, target cukup.
- **390x844 / 360x800**: **P0 — overflow horizontal**. `pageOverflowX` 36px (390) / 51px (360);
  `#view-auth` spill 46–61px. Konten terpotong di KIRI (screenshot 390x844-login.png) karena
  `#view-auth { display:flex; justify-content:center }` memusatkan kontainer yang lebih lebar
  dari viewport.

## Table

| id | level | element | problem | norm | evidence | severity |
|---|---|---|---|---|---|---|
| AU-1 | layout | `.auth-wrap` > `.auth-card`/`.auth-side` | Card `width:440px` + flex item `min-width:auto` menolak menyusut di wrap; `.auth-side { min-width:300px }` juga. `#view-auth` memusatkan → clip dua sisi, horizontal scroll | L6 | audit 390: pageOverflowX=36, spill #view-auth 46px; 360: 51px/61px; DOM: auth-wrap w=472 @ vw 380 | **P0** |
| AU-2 | target | footer link (landing, sama pola) | link footer 37x14 / 44x14 < 24px | I4 | layout-audit landing | P3 |

## Eksperimen (terverifikasi live di Chrome)

`.auth-card,.auth-side{min-width:0}` + `.auth-card{width:min(440px,100%)}` →
wrapW 472→332, overflowX 36→**0**, card menyusut 440→300 dan tetap 440 di desktop.

## Excellent as is

- Two-column → stack berfungsi (aside pindah ke bawah card).
- Form, OTP row, OAuth row rapi di 1440/768.
- Kontras & label jelas; tidak ada overlap.
